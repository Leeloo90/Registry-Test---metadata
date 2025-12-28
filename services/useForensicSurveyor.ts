import { useState, useCallback } from 'react';
import { MediaFile } from '../types';

export const useForensicSurveyor = (accessToken: string | null) => {
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  
  // CONFIGURATION SYNC: Must match your Cloud Run index.js
  const BUCKET_NAME = "story-graph-proxies";
  const PROJECT_ID = "media-sync-registry";
  const LOCATION = "europe-west1"; 
  
  // Dedicated Metadata Extractor Service URL
  const METADATA_SERVICE_URL = "https://metadata-extractor-286149224994.europe-west1.run.app";

  /**
   * Helper: Formats transcription results from Video Intelligence API
   */
  const formatTranscriptionResults = (annotationResults: any) => {
    const transcriptions = annotationResults?.[0]?.speechTranscriptions;
    if (!transcriptions || transcriptions.length === 0) return "No speech detected.";
    
    return transcriptions.map((transcription: any) => {
      const alt = transcription.alternatives?.[0];
      const startTime = alt?.words?.[0]?.startTime || "0s";
      return `[${startTime}] ${alt?.transcript || ""}`;
    }).join('\n\n');
  };

  /**
   * Mirroring Stage: Drive -> GCS
   * Required for AI and FFprobe to access the files.
   */
  const syncToGCS = async (file: MediaFile) => {
    const encodedName = encodeURIComponent(file.filename);
    
    // Check if it already exists to save bandwidth
    const checkRes = await fetch(
      `https://storage.googleapis.com/storage/v1/b/${BUCKET_NAME}/o/${encodedName}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (checkRes.ok) return;

    console.log(`%c[Surveyor] Mirroring RAW to GCS: ${file.filename}`, "color: #6366f1;");

    const driveRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${file.drive_id}?alt=media`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const blob = await driveRes.blob();
    
    const uploadRes = await fetch(
      `https://storage.googleapis.com/upload/storage/v1/b/${BUCKET_NAME}/o?uploadType=media&name=${encodedName}`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': file.mime_type },
        body: blob
      }
    );

    if (!uploadRes.ok) throw new Error("Mirroring to GCS failed. Check Bucket CORS.");
  };

  /**
   * SMPTE TECH PASS: Focused exclusively on Embedded Timecode
   */
  const runTechPass = async (file: MediaFile) => {
    try {
      const response = await fetch(METADATA_SERVICE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: file.filename }) 
      });

      if (!response.ok) throw new Error("Metadata Service Failed");

      const metadata = await response.json(); 

      // Streamlined to focus on SMPTE Start TC
      return {
        tech_metadata: {
          start_tc: metadata.start_tc || "00:00:00:00",
          // Placeholders for types.ts compatibility
          codec_id: metadata.codec_id || '',
          width: metadata.width || 0,
          height: metadata.height || 0,
          frame_rate_fraction: metadata.frame_rate_fraction || '25/1',
          total_frames: metadata.total_frames || '0'
        },
        analysis_content: `SMPTE TC: ${metadata.start_tc}`,
        operation_id: 'completed',
        last_forensic_stage: 'tech' as const
      };
    } catch (err: any) {
      return { analysis_content: `Error: ${err.message}`, operation_id: 'error' };
    }
  };

  /**
   * LIGHTWEIGHT DISCOVERY: Gemini 2.0 Flash
   */
  const runGeminiDiscovery = async (file: MediaFile, gcsUri: string) => {
    const endpoint = `https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${PROJECT_ID}/locations/${LOCATION}/publishers/google/models/gemini-2.0-flash-001:generateContent`;
    
    const mimeType = file.media_category === 'audio' ? "audio/wav" : file.mime_type;

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ 
          role: "user", 
          parts: [
            { fileData: { mimeType: mimeType, fileUri: gcsUri } }, 
            { text: `Analyze the audio and visuals of this clip. Is this an 'interview' or 'location_sound'? Respond ONLY with 'interview' or 'location_sound'.` }
          ] 
        }]
      })
    });
    
    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || "Gemini Discovery Failed");
    
    const rawResult = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim().toLowerCase() || "";
    const isInterview = rawResult.includes('interview');
    
    return {
      clip_type: (isInterview ? 'interview' : 'b-roll') as 'interview' | 'b-roll',
      analysis_content: `Discovery: ${isInterview ? 'Interview' : 'B-Roll'}`,
      operation_id: 'light_complete',
      last_forensic_stage: 'light' as const
    };
  };

  /**
   * HEAVY PASS: Video Intelligence API
   */
  const runHeavyPass = async (file: MediaFile, gcsUri: string, mode: 'b_roll_desc' | 'transcribe') => {
    const features = mode === 'transcribe' ? ['SPEECH_TRANSCRIPTION'] : ['LABEL_DETECTION', 'SHOT_CHANGE_DETECTION'];
    const videoContext = mode === 'transcribe' 
      ? { speechTranscriptionConfig: { languageCode: 'en-US', enableAutomaticPunctuation: true } }
      : { labelDetectionConfig: { labelDetectionMode: "SHOT_MODE" } };

    const res = await fetch(`https://videointelligence.googleapis.com/v1/videos:annotate`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ inputUri: gcsUri, features, videoContext })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || 'Cloud Analysis Error');
    
    return {
        operation_id: data.name,
        analysis_content: mode === 'transcribe' ? "Transcribing..." : "Analyzing...",
        last_forensic_stage: 'heavy' as const
    };
  };

  /**
   * Pipeline Entry: Routes the file to the correct AI logic
   */
  const analyzeFile = useCallback(async (file: MediaFile, phase?: string): Promise<Partial<MediaFile>> => {
    if (!accessToken) throw new Error("Unauthorized");
    setIsAnalyzing(true);
    
    try {
      await syncToGCS(file);
      const rawUri = `gs://${BUCKET_NAME}/${file.filename}`;

      switch (phase) {
        case 'tech_specs': // Phase 0 Trigger
          return await runTechPass(file);
        case 'audio_discovery':
        case 'shot_type':
          return await runGeminiDiscovery(file, rawUri);
        case 'b_roll_desc':
          return await runHeavyPass(file, rawUri, 'b_roll_desc');
        case 'transcribe':
          return await runHeavyPass(file, rawUri, 'transcribe');
        default:
          return await runGeminiDiscovery(file, rawUri);
      }
    } catch (err: any) {
      console.error("[Surveyor] Pipeline Error:", err);
      return { analysis_content: `Error: ${err.message}`, operation_id: 'error' };
    } finally {
      setIsAnalyzing(false);
    }
  }, [accessToken]);

  /**
   * Polling Logic for Long-Running Tasks
   */
  const getAnalysisResult = useCallback(async (operationId: string) => {
    if (!accessToken || ['light_complete', 'error', 'completed'].includes(operationId)) return null;

    const res = await fetch(`https://videointelligence.googleapis.com/v1/${operationId}`, { 
      headers: { Authorization: `Bearer ${accessToken}` } 
    });
    const data = await res.json();
    
    if (!data.done) return { done: false };

    const results = data.response.annotationResults;
    if (results?.[0]?.speechTranscriptions) {
        return { done: true, content: formatTranscriptionResults(results) };
    }
    const labels = results?.[0]?.segmentLabelAnnotations?.map((l: any) => l.entity.description).join(", ");
    return { done: true, content: `Labels: ${labels || 'None'}` };
  }, [accessToken]);

  return { analyzeFile, getAnalysisResult, isAnalyzing };
};