export interface TechnicalMetadata {
  start_tc: string;       // "05:19:35:12" - The absolute truth for Resolve
  reel_name?: string;     // "A001_C005" - Critical for conform
  codec_id: string;       // "h264"
  width: number;
  height: number;
  frame_rate_fraction: string; // "25/1" or "50/1"
  total_frames: string; // "2545" - Exact integer frame count
}

export interface MediaFile {
  drive_id: string;
  filename: string;
  md5_checksum: string;
  size_bytes: number;
  mime_type: string;
  sync_offset_frames: number;
  duration?: number;
  
  // --- Forensic Pipeline Fields ---
  media_category: 'video' | 'audio'; 
  
  // Clip Type state:
  // unknown: Needs Light Pass
  // interview / b-roll: Light Pass complete, ready for Heavy Pass
  clip_type: 'interview' | 'b-roll' | 'unknown';
  
  // operation_id state:
  // undefined: No forensic started
  // 'light_complete': Gemini finished, waiting for user to trigger Heavy Pass
  // [GCP_OP_ID]: Heavy Pass is currently running in the cloud (needs polling)
  // 'completed': Full forensic history is finished
  // 'error': Something went wrong
  operation_id?: string;
  
  // Storage for the forensic results
  // Light pass stores the summary here; Heavy pass overwrites with full transcript/shot list
  analysis_content?: string; 

  // NEW: To distinguish between Gemini summary, deep cloud results, and Tech Specs
  last_forensic_stage?: 'light' | 'heavy' | 'tech';

  // NEW: Store the truth extracted via FFprobe
  tech_metadata?: TechnicalMetadata;
  
  // NEW: Store relative path for precise XML reconstruction (e.g., "Day 1/Camera A/")
  relative_path?: string;
}

export enum IndexingStatus {
  IDLE = 'IDLE',
  LOADING = 'LOADING',
  INDEXING = 'INDEXING',
  COMPLETED = 'COMPLETED',
  ERROR = 'ERROR'
}

export interface IndexingProgress {
  status: IndexingStatus;
  currentFile?: string;
  filesProcessed: number;
  foldersProcessed: number;
  error?: string;
}