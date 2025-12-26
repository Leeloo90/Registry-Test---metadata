import { useState, useCallback } from 'react';
import { MediaFile } from '../types';

export const useForensicSurveyor = (accessToken: string | null) => {
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const BUCKET_NAME = "story-graph-proxies";
  const PROJECT_ID = "media-sync-registry";
  const LOCATION = "us-central1";

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
   */
  const syncToGCS = async (file: MediaFile) => {
    const encodedName = encodeURIComponent(file.filename);
    const checkRes = await fetch(
      `https://storage.googleapis.com/storage/v1/b/${BUCKET_NAME}/o/${encodedName}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (checkRes.ok) return;

    const driveRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${file.drive_id}?alt=media`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const blob = await driveRes.blob();
    await fetch(
      `https://storage.googleapis.com/upload/storage/v1/b/${BUCKET_NAME}/o?uploadType=media&name=${encodedName}`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': file.mime_type },
        body: blob
      }
    );
  };

  /**
   * Phase 1: Classification (Gemini 2.0 Flash)
   */
  const runLightPass = async (file: MediaFile, gcsUri: string) => {
    const endpoint = `https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${PROJECT_ID}/locations/${LOCATION}/publishers/google/models/gemini-2.0-flash-001:generateContent`;
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ 
          role: "user", 
          parts: [
            { fileData: { mimeType: file.mime_type, fileUri: gcsUri } }, 
            { text: "Identify CATEGORY: interview or b-roll. Provide 1-sentence ANALYSIS of visual content." }
          ] 
        }]
      })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || "Gemini Pass Failed");
    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    const isInterview = /interview/i.test(rawText);
    return {
      clip_type: (isInterview ? 'interview' : 'b-roll') as 'interview' | 'b-roll',
      analysis_content: rawText,
      last_forensic_stage: 'light' as const
    };
  };

  /**
   * Phase 2: Heavy Pass (Video Intelligence API)
   */
  const runHeavyPass = async (file: MediaFile, gcsUri: string) => {
    // Treat all Audio files or Interview video files as transcription tasks
    const isTranscriptionTask = file.mime_type.startsWith('audio/') || file.clip_type === 'interview';
    
    const features = isTranscriptionTask 
      ? ['SPEECH_TRANSCRIPTION'] 
      : ['SHOT_CHANGE_DETECTION', 'LABEL_DETECTION'];

    const videoContext = isTranscriptionTask 
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
    if (!res.ok) throw new Error(data.error?.message || 'Video Intelligence Error');
    return data;
  };

  /**
   * Pipeline Entry: Manages conditional branching for Audio vs Video
   */
  const analyzeFile = useCallback(async (file: MediaFile): Promise<Partial<MediaFile>> => {
    if (!accessToken) throw new Error("Unauthorized");
    setIsAnalyzing(true);
    try {
      await syncToGCS(file);
      const gcsUri = `gs://${BUCKET_NAME}/${file.filename}`;
      
      // OPTIMIZATION: Audio files skip Gemini classification and go straight to transcription
      if (file.mime_type.startsWith('audio/')) {
        const heavyOp = await runHeavyPass(file, gcsUri);
        return { 
          operation_id: heavyOp.name, 
          analysis_content: "Audio detected: Transcribing...", 
          clip_type: 'interview', // Set to interview to ensure transcription logic is followed
          last_forensic_stage: 'heavy' 
        };
      }

      // Standard Video Pipeline
      if (!file.clip_type || file.clip_type === 'unknown') {
        const lightResult = await runLightPass(file, gcsUri);
        return { ...lightResult, operation_id: 'light_complete' };
      }

      const heavyOp = await runHeavyPass(file, gcsUri);
      return { 
        operation_id: heavyOp.name, 
        analysis_content: file.clip_type === 'interview' ? "Transcribing Interview..." : "Mapping Visuals...",
        last_forensic_stage: 'heavy' 
      };
    } catch (err: any) {
      console.error("[Surveyor] Pipeline Error:", err);
      return { analysis_content: `Error: ${err.message}`, operation_id: 'error' };
    } finally {
      setIsAnalyzing(false);
    }
  }, [accessToken]);

  /**
   * Polling Logic: Retrieves results from background cloud operations
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