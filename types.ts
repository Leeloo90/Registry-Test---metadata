
export interface MediaFile {
  id: string;
  name: string;
  md5Checksum?: string;
  size: string;
  mimeType: string;
  parentFolderId?: string;
  indexedAt: number;
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
