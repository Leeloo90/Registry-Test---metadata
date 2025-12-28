import { useState, useCallback } from 'react';
import { MediaFile } from '../types';

export const useWaveformSync = (accessToken: string | null) => {
  const [isSyncing, setIsSyncing] = useState(false);
  
  // CONFIGURATION SYNC: Must match the bucket in your index.js
  const PROXY_BUCKET = "story-graph-proxies";

  /**
   * Fetches the audio source from GCS.
   * Logic: Fetches the RAW .wav if it's an audio file, or the .mp4 proxy if it's video.
   */
  const fetchAudioBuffer = async (file: MediaFile): Promise<AudioBuffer | null> => {
    if (!accessToken) return null;
    
    // PATH LOGIC: RAW for audio files, PROXY for video clips
    const baseName = file.filename.substring(0, file.filename.lastIndexOf('.'));
    const path = file.media_category === 'audio' 
      ? file.filename 
      : `proxies/${baseName}_audioproxy.mp4`;

    const encodedPath = encodeURIComponent(path);

    console.log(`%c[Waveform] Fetching source: ${path}`, "color: #94a3b8;");

    try {
      const response = await fetch(
        `https://storage.googleapis.com/storage/v1/b/${PROXY_BUCKET}/o/${encodedPath}?alt=media`, 
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      
      if (!response.ok) {
         if (response.status === 404) {
           console.warn(`[Waveform] File not found: ${path}. Ensure Phase 1 Mirroring/Transcoding finished.`);
         }
         throw new Error(`Fetch failed: ${response.status}`);
      }
      
      const arrayBuffer = await response.arrayBuffer();
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      
      // decodeAudioData handles both RAW WAV and AAC/MP4 containers
      return await audioContext.decodeAudioData(arrayBuffer);
    } catch (e) {
      console.warn(`[Waveform] Could not load ${file.filename}. Check CORS and bucket permissions.`);
      return null;
    }
  };

  /**
   * Standard Cross-Correlation Logic
   * Scan small buffers to find the point of highest mathematical similarity.
   */
  const calculateOffset = (masterBuffer: AudioBuffer, slaveBuffer: AudioBuffer) => {
    const masterData = masterBuffer.getChannelData(0);
    const slaveData = slaveBuffer.getChannelData(0);
    const sampleRate = masterBuffer.sampleRate;

    // INCREASE SCAN: Scan up to 30 minutes if necessary
    const scanWindow = Math.min(masterData.length - 2000, sampleRate * 1800); 
    let bestOffset = 0;
    let maxCorrelation = -Infinity;

    // ACCURACY: Scanning every 50th sample is fast, but for 4K sync, 
    // every 20th sample provides better frame-accuracy.
    for (let offset = 0; offset < scanWindow; offset += 20) {
      let correlation = 0;
      for (let i = 0; i < 2000; i++) {
        correlation += masterData[i + offset] * slaveData[i];
      }
      if (correlation > maxCorrelation) {
        maxCorrelation = correlation;
        bestOffset = offset;
      }
    }

    return bestOffset / sampleRate;
  };

  /**
   * Primary Sync Entry point
   */
  const syncFiles = useCallback(async (masterFile: MediaFile, slaveFiles: MediaFile[]) => {
    setIsSyncing(true);
    const results: { drive_id: string; offset: number }[] = [];

    try {
      // 1. Get Master Buffer (The high-quality audio from the main sound recorder)
      const masterBuffer = await fetchAudioBuffer(masterFile);
      
      if (!masterBuffer) {
        console.error("[Waveform] Cannot start sync: Master audio missing from GCS.");
        return [];
      }

      // 2. Compare Slaves (Video files with internal audio) to the Master anchor
      for (const slave of slaveFiles) {
        const slaveBuffer = await fetchAudioBuffer(slave);
        
        if (slaveBuffer) {
          const offset = calculateOffset(masterBuffer, slaveBuffer);
          results.push({ drive_id: slave.drive_id, offset });
          console.log(`%c[Waveform] Sync Success: ${slave.filename} matched at ${offset.toFixed(3)}s`, "color: #10b981;");
        }
      }
    } finally {
      setIsSyncing(false);
    }

    return results;
  }, [accessToken]);

  return { syncFiles, isSyncing };
};