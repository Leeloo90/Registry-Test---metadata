import { useState, useCallback } from 'react';
import { MediaFile } from '../types';

export const useForensicSurveyor = (accessToken: string | null) => {
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  
  // CONFIGURATION SYNC: Must match your Cloud Run index.js
  const BUCKET_NAME = "story-graph-proxies";
  const PROJECT_ID = "media-sync-registry";
  const LOCATION = "europe-west1"; // Updated from us-central1 to match Dispatcher

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
   * This is the "Bridge" that allows the Transcoder to see your files.
   */
  const syncToGCS = async (file: MediaFile) => {
    const encodedName = encodeURIComponent(file.filename);
    
    // 1. Check if it already exists to save bandwidth
    const checkRes = await fetch(
      `https://storage.googleapis.com/storage/v1/b/${BUCKET_NAME}/o/${encodedName}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (checkRes.ok) return;

    console.log(`%c[Surveyor] Mirroring to GCS: ${file.filename}`, "color: #6366f1;");

    // 2. Fetch from Drive and stream to GCS
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
   * PHASE 1: Shot Type Detection (Gemini 2.0 Flash)
   * Now running in europe-west1 to match the bucket data.
   */
  const runShotTypeDetection = async (file: MediaFile, gcsUri: string) => {
    const endpoint = `https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${PROJECT_ID}/locations/${LOCATION}/publishers/google/models/gemini-2.0-flash-001:generateContent`;
    
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ 
          role: "user", 
          parts: [
            { fileData: { mimeType: file.mime_type, fileUri: gcsUri } }, 
            { text: "Categorize this video. Respond ONLY with the word 'interview' or 'b-roll'." }
          ] 
        }]
      })
    });
    
    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || "Shot Type Detection Failed");
    
    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    const isInterview = /interview/i.test(rawText);
    
    return {
      clip_type: (isInterview ? 'interview' : 'b-roll') as 'interview' | 'b-roll',
      analysis_content: `Classified as ${isInterview ? 'Interview' : 'B-Roll'}`,
      operation_id: 'light_complete',
      last_forensic_stage: 'light' as const
    };
  };

  /**
   * PHASE 2 & 3: Heavy Passes (Video Intelligence API)
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
   * Pipeline Entry
   */
  const analyzeFile = useCallback(async (file: MediaFile, phase?: string): Promise<Partial<MediaFile>> => {
    if (!accessToken) throw new Error("Unauthorized");
    setIsAnalyzing(true);
    
    try {
      // 1. Ensure file is in GCS before trying any AI or Transcoding
      await syncToGCS(file);
      const gcsUri = `gs://${BUCKET_NAME}/${file.filename}`;

      switch (phase) {
        case 'shot_type':
          return await runShotTypeDetection(file, gcsUri);
        
        case 'b_roll_desc':
          return await runHeavyPass(file, gcsUri, 'b_roll_desc');
        
        case 'transcribe':
          return await runHeavyPass(file, gcsUri, 'transcribe');

        default:
          if (file.media_category === 'audio' || file.clip_type === 'interview') {
            return await runHeavyPass(file, gcsUri, 'transcribe');
          }
          return await runShotTypeDetection(file, gcsUri);
      }
    } catch (err: any) {
      console.error("[Surveyor] Pipeline Error:", err);
      return { analysis_content: `Error: ${err.message}`, operation_id: 'error' };
    } finally {
      setIsAnalyzing(false);
    }
  }, [accessToken]);

  /**
   * Polling Logic
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
    return { done: true, content: `Visual Labels: ${labels || 'None'}` };
  }, [accessToken]);

  return { analyzeFile, getAnalysisResult, isAnalyzing };
};