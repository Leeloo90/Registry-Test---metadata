export const GOOGLE_CONFIG = {
  CLIENT_ID: "286149224994-u7n0i9get24f628u0rgrkoo8jdem0apc.apps.googleusercontent.com",
  API_KEY: "AIzaSyB3_kwiIHDjQxhXWFqhuAzzVahrYTCxycs",
  DISCOVERY_DOCS: [
    "https://www.googleapis.com/discovery/v1/apis/drive/v3/rest",
    "https://videointelligence.googleapis.com/$discovery/rest?version=v1",
    "https://storage.googleapis.com/$discovery/rest?v1",
    "https://speech.googleapis.com/$discovery/rest?version=v1" 
  ],
  SCOPES: [
    "https://www.googleapis.com/auth/drive.metadata.readonly",
    "https://www.googleapis.com/auth/drive.readonly",
    "https://www.googleapis.com/auth/cloud-platform",          // For Gemini & general GCP access
    "https://www.googleapis.com/auth/devstorage.full_control", // For GCS mirroring
    "https://www.googleapis.com/auth/video.transcoder"        // NEW: Explicit permission for proxy generation
  ].join(' ')
};