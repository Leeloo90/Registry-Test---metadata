import React, { useState, useEffect, useCallback, useRef } from 'react';
import { MediaTable } from './components/MediaTable';
import { useRegistry } from './services/useRegistry'; 
import { useGoogleDrive } from './services/useGoogleDrive'; 
import { useForensicSurveyor } from './services/useForensicSurveyor';
import { MediaFile, IndexingStatus, IndexingProgress } from './types';

/**
 * Global styles for custom progress bar animations.
 */
const GlobalStyles = () => (
  <style>{`
    @keyframes progress-buffer {
      0% { transform: translateX(-100%); }
      50% { transform: translateX(-10%); }
      100% { transform: translateX(0%); }
    }
    .animate-progress-buffer {
      animation: progress-buffer 20s ease-in-out infinite;
    }
  `}</style>
);

const App: React.FC = () => {
  // Hooks for Drive, Database, and Forensic Logic
  const { user, login, openPicker, fetchFilesRecursively, isReady } = useGoogleDrive();
  const { loading: dbLoading, upsertMedia, getAllMedia, clearRegistry } = useRegistry();
  const { analyzeFile, getAnalysisResult, isAnalyzing } = useForensicSurveyor(user?.accessToken || null);
  
  // Local State
  const [registryFiles, setRegistryFiles] = useState<MediaFile[]>([]);
  const [analyzingId, setAnalyzingId] = useState<string | null>(null);
  const [progress, setProgress] = useState<IndexingProgress>({
    status: IndexingStatus.IDLE,
    filesProcessed: 0,
    foldersProcessed: 0,
    currentFile: ''
  });

  // Reference for the polling function to avoid stale closures in setInterval
  const checkStatusRef = useRef<((file: MediaFile) => Promise<void>) | null>(null);

  const refreshRegistry = useCallback(async () => {
    const files = await getAllMedia();
    setRegistryFiles(files);
  }, [getAllMedia]);

  useEffect(() => {
    if (!dbLoading) refreshRegistry();
  }, [dbLoading, refreshRegistry]);

  /**
   * TRIGGER ANALYSIS
   * This handles the Two-Step logic:
   * 1. If unknown: Triggers Gemini Light Pass (Updates state immediately).
   * 2. If categorized: Triggers Video Intelligence / STT (Sets an operation_id for polling).
   */
  const handleAnalyze = async (file: MediaFile) => {
    setAnalyzingId(file.drive_id);
    try {
      const forensicData = await analyzeFile(file);
      
      // Merge results into the file object and save to DB
      const updatedFile: MediaFile = { ...file, ...forensicData };
      await upsertMedia(updatedFile);
      await refreshRegistry();

      console.info(`[App] ${file.clip_type === 'unknown' ? 'Light' : 'Heavy'} Pass initialized for ${file.filename}`);
    } catch (err: any) {
      console.error('[App] Forensic analysis failed:', err);
    } finally {
      setAnalyzingId(null);
    }
  };

  /**
   * STATUS POLLING (For Heavy Passes)
   * Only checks operations that aren't Gemini (light_complete) or already finished.
   */
  const handleCheckStatus = useCallback(async (file: MediaFile) => {
    if (!file.operation_id || file.operation_id === 'completed' || file.operation_id === 'light_complete') return;
    
    try {
      const result = await getAnalysisResult(file.operation_id);
      
      if (result && result.done) {
        console.info(`%c[App] Heavy Pass Finalized for ${file.filename}`, "color: #10b981; font-weight: bold");
        const finalizedFile: MediaFile = { 
          ...file, 
          analysis_content: result.content,
          operation_id: 'completed' 
        };
        await upsertMedia(finalizedFile);
        await refreshRegistry();
      }
    } catch (err) {
      console.error('[App] Polling error:', err);
    }
  }, [getAnalysisResult, upsertMedia, refreshRegistry]);

  // Sync the ref with the latest callback
  useEffect(() => {
    checkStatusRef.current = handleCheckStatus;
  }, [handleCheckStatus]);

  /**
   * BACKGROUND POLLING ENGINE
   * Checks for pending heavy cloud operations every 10 seconds.
   */
  useEffect(() => {
    const pollInterval = setInterval(() => {
      const pending = registryFiles.filter(
        f => f.operation_id && f.operation_id !== 'completed' && f.operation_id !== 'light_complete'
      );

      if (pending.length > 0 && checkStatusRef.current) {
        console.log(`[Auto-Poll] Checking ${pending.length} cloud operations...`);
        pending.forEach(file => checkStatusRef.current!(file));
      }
    }, 10000);

    return () => clearInterval(pollInterval);
  }, [registryFiles]);

  const handleReset = async () => {
    if (window.confirm("Wipe local registry?")) {
      await clearRegistry();
      setRegistryFiles([]);
      setProgress({ status: IndexingStatus.IDLE, filesProcessed: 0, foldersProcessed: 0, currentFile: '' });
    }
  };

  /**
   * INDEXING: Discovery of Drive Assets
   */
  const handleFolderSelected = async (id: string) => {
    setProgress({ status: IndexingStatus.INDEXING, filesProcessed: 0, foldersProcessed: 0, currentFile: 'Discovering...' });
    
    try {
      await fetchFilesRecursively(id, async (driveFile) => {
        const name = driveFile.name.toLowerCase();
        const isAudio = driveFile.mimeType.includes('audio') || name.endsWith('.wav') || name.endsWith('.mp3');

        const mediaFile: MediaFile = {
          drive_id: driveFile.id,
          filename: driveFile.name,
          md5_checksum: driveFile.md5Checksum || '',
          size_bytes: parseInt(driveFile.size) || 0,
          mime_type: driveFile.mimeType,
          duration: driveFile.duration || 0,
          sync_offset_frames: 0,
          clip_type: 'unknown',
          media_category: isAudio ? 'audio' : 'video'
        };

        await upsertMedia(mediaFile);
        setProgress(prev => ({ 
          ...prev, 
          currentFile: driveFile.name, 
          filesProcessed: prev.filesProcessed + 1 
        }));
      }, () => {});
      
      setProgress(prev => ({ ...prev, status: IndexingStatus.COMPLETED, currentFile: 'Done' }));
      refreshRegistry();
    } catch (err) {
      console.error('Indexing failed:', err);
      setProgress(prev => ({ ...prev, status: IndexingStatus.ERROR }));
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 p-4 md:p-8">
      <GlobalStyles />

      <div className="max-w-6xl mx-auto space-y-8">
        <header className="bg-white rounded-2xl p-8 border border-slate-200 shadow-sm">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
            <div className="flex-1">
              <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Story Graph Discovery</h1>
              <p className="text-slate-500 mt-2 italic font-medium">Hybrid Lazy-Load Forensic Pipeline</p>
            </div>
            
            <div className="flex items-center gap-3">
              {user && (
                <button onClick={handleReset} className="px-4 py-2 text-red-600 font-bold hover:bg-red-50 rounded-lg transition-colors text-sm">
                  Reset Registry
                </button>
              )}
              {!user ? (
                <button onClick={login} disabled={!isReady} className="bg-indigo-600 text-white px-8 py-3 rounded-xl font-bold shadow-lg hover:bg-indigo-700 transition-all">
                  Connect Drive
                </button>
              ) : (
                <button onClick={() => openPicker(handleFolderSelected)} className="bg-white border border-slate-200 text-slate-700 px-8 py-3 rounded-xl font-bold hover:bg-slate-50 shadow-sm">
                  Index Folder
                </button>
              )}
            </div>
          </div>

          {progress.status === IndexingStatus.INDEXING && (
            <div className="mt-8 p-4 bg-indigo-50 border border-indigo-100 rounded-xl">
              <div className="flex justify-between items-center mb-2">
                <span className="text-sm font-bold text-indigo-900">Indexing {progress.filesProcessed} assets...</span>
              </div>
              <div className="h-1.5 w-full bg-indigo-200 rounded-full overflow-hidden">
                <div className="h-full bg-indigo-600 animate-pulse w-full"></div>
              </div>
            </div>
          )}
        </header>

        <main>
          <div className="flex items-center justify-between mb-6 px-2">
            <h2 className="text-xl font-bold text-slate-800 tracking-tight">Registry ({registryFiles.length})</h2>
          </div>
          
          <MediaTable 
            files={registryFiles} 
            onAnalyze={handleAnalyze}
            onCheckStatus={handleCheckStatus}
            isAnalyzing={isAnalyzing || !!analyzingId}
            activeId={analyzingId}
          />
        </main>
      </div>
    </div>
  );
};

export default App;