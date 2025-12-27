import { useState, useCallback } from 'react';
import { MediaFile } from '../types';

export const useForensicSurveyor = (accessToken: string | null) => {
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  
  // CONFIGURATION SYNC: Must match your Cloud Run index.js
  const BUCKET_NAME = "story-graph-proxies";
  const PROJECT_ID = "media-sync-registry";
  const LOCATION = "europe-west1"; 
  
  // NEW: The URL for your dedicated Metadata Extractor Service
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
   * Required for Gemini, Transcoder, Video Intelligence, AND FFprobe to access the files.
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
   * TECH PASS: Calls the Cloud Run Metadata Extractor (FFprobe)
   * This retrieves the "Ground Truth" for XML Sync (Start TC, Frame Rate, etc.)
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

      return {
        tech_metadata: metadata,
        analysis_content: `[Tech Spec] TC: ${metadata.start_tc} | FPS: ${metadata.frame_rate_fraction} | Res: ${metadata.width}x${metadata.height}`,
        operation_id: 'completed',
        last_forensic_stage: 'tech' as const
      };
    } catch (err: any) {
      return { analysis_content: `Error: ${err.message}`, operation_id: 'error' };
    }
  };

  /**
   * LIGHTWEIGHT DISCOVERY: Gemini 2.0 Flash
   * This handles both Video categorization and Audio discovery.
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
            { text: `Analyze the audio and visuals of this clip. Is this an 'interview' (talking head, structured speech, Q&A) or 'location_sound' (ambient noise, wind, background chatter, B-roll)? 
                     Respond ONLY with the word 'interview' or 'location_sound'.` }
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
      analysis_content: `Discovery: ${isInterview ? 'Interview Detected' : 'Location Sound'}`,
      operation_id: 'light_complete',
      last_forensic_stage: 'light' as const
    };
  };

  /**
   * HEAVY PASS: Video Intelligence API
   * Used for deep B-Roll mapping or full time-coded transcription.
   */
  const runHeavyPass = async (file: MediaFile, gcsUri: string, mode: 'b_roll_desc' | 'transcribe') => {
    const features = mode === 'transcribe' 
      ? ['SPEECH_TRANSCRIPTION'] 
      : ['LABEL_DETECTION', 'SHOT_CHANGE_DETECTION'];

    const videoContext = mode === 'transcribe' 
      ? { speechTranscriptionConfig: { languageCode: 'en-US', enableAutomaticPunctuation: true } }
      : { labelDetectionConfig: { labelDetectionMode: "SHOT_MODE" } };

    const res = await fetch(`https://videointelligence.googleapis.com/v1/videos:annotate`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        inputUri: gcsUri,
        features: features,
        videoContext: videoContext
      })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || 'Cloud Analysis Error');
    
    return {
        operation_id: data.name,
        analysis_content: mode === 'transcribe' ? "Transcribing audio..." : "Analyzing visuals...",
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
      // 1. All files are mirrored to GCS as the first step
      await syncToGCS(file);
      const rawUri = `gs://${BUCKET_NAME}/${file.filename}`;

      // 2. Route based on the requested phase
      switch (phase) {
        case 'tech_specs': // NEW: Phase 0 Trigger
          return await runTechPass(file);

        case 'audio_discovery':
        case 'shot_type':
          // Phase 1: Quick categorical check via Gemini
          return await runGeminiDiscovery(file, rawUri);
        
        case 'b_roll_desc':
          // Phase 2: Visual mapping via Video Intelligence
          return await runHeavyPass(file, rawUri, 'b_roll_desc');
        
        case 'transcribe':
          // Phase 4: Full word-for-word text record
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
   * Polling Logic: Checks the status of "Heavy Pass" operations
   */
  const getAnalysisResult = useCallback(async (operationId: string) => {
    // Avoid polling for quick tasks or errors
    if (!accessToken || ['light_complete', 'error', 'completed'].includes(operationId)) return null;

    const res = await fetch(`https://videointelligence.googleapis.com/v1/${operationId}`, { 
      headers: { Authorization: `Bearer ${accessToken}` } 
    });
    const data = await res.json();
    
    if (!data.done) return { done: false };

    const results = data.response.annotationResults;
    
    // Check if result is transcription
    if (results?.[0]?.speechTranscriptions) {
        return { done: true, content: formatTranscriptionResults(results) };
    }
    
    // Otherwise return visual labels
    const labels = results?.[0]?.segmentLabelAnnotations?.map((l: any) => l.entity.description).join(", ");
    return { done: true, content: `Visual Labels: ${labels || 'None'}` };
  }, [accessToken]);

  return { analyzeFile, getAnalysisResult, isAnalyzing };
};