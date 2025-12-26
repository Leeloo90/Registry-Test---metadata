import React, { useState, useEffect, useCallback, useRef } from 'react';
import { MediaTable } from './components/MediaTable';
import { useRegistry } from './services/useRegistry'; 
import { useGoogleDrive } from './services/useGoogleDrive'; 
import { useForensicSurveyor } from './services/useForensicSurveyor';
import { useWaveformSync } from './services/useWaveformSync';
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
    .phase-btn {
      display: flex;
      flex: 1;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 0.75rem 1rem;
      border-radius: 0.75rem;
      font-weight: 700;
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      transition: all 0.2s;
      border-width: 1px;
    }
    .cursor-context-menu {
      cursor: context-menu;
    }
  `}</style>
);

const App: React.FC = () => {
  // Hooks
  const { user, login, openPicker, fetchFilesRecursively, isReady } = useGoogleDrive();
  const { loading: dbLoading, upsertMedia, getAllMedia, clearRegistry } = useRegistry();
  const { analyzeFile, getAnalysisResult, isAnalyzing } = useForensicSurveyor(user?.accessToken || null);
  const { syncFiles, isSyncing: waveformSyncing } = useWaveformSync(user?.accessToken || null);
  
  // Local State
  const [registryFiles, setRegistryFiles] = useState<MediaFile[]>([]);
  const [analyzingId, setAnalyzingId] = useState<string | null>(null);
  const [activePhase, setActivePhase] = useState<string | null>(null);
  const [selectedDetails, setSelectedDetails] = useState<any | null>(null);
  const [progress, setProgress] = useState<IndexingProgress>({
    status: IndexingStatus.IDLE,
    filesProcessed: 0,
    foldersProcessed: 0,
    currentFile: ''
  });

  const checkStatusRef = useRef<((file: MediaFile) => Promise<void>) | null>(null);

  const refreshRegistry = useCallback(async () => {
    const files = await getAllMedia();
    setRegistryFiles(files);
  }, [getAllMedia]);

  useEffect(() => {
    if (!dbLoading) refreshRegistry();
  }, [dbLoading, refreshRegistry]);

  /**
   * SHOW DETAILS (Right-Click Action)
   */
  const handleShowDetails = async (file: MediaFile) => {
    if (!user?.accessToken) return;
    try {
      const res = await fetch(
        `https://www.googleapis.com/drive/v3/files/${file.drive_id}?fields=*`,
        { headers: { Authorization: `Bearer ${user.accessToken}` } }
      );
      const data = await res.json();
      setSelectedDetails(data);
    } catch (err) {
      console.error("[App] Failed to fetch metadata:", err);
    }
  };

  // --- PHASED BATCH ACTIONS ---

  // PHASE 1: Categorization
  const handleCategorization = async () => {
    const unknowns = registryFiles.filter(f => f.media_category === 'video' && f.clip_type === 'unknown');
    console.info(`%c[PHASE 1 START] Categorizing ${unknowns.length} clips...`, "color: #6366f1; font-weight: bold;");
    setActivePhase('Categorization');
    for (const file of unknowns) {
      setAnalyzingId(file.drive_id);
      console.log(`%c > Busy: Gemini sorting ${file.filename}`, "color: #94a3b8;");
      const data = await analyzeFile(file, 'shot_type');
      await upsertMedia({ ...file, ...data });
    }
    setAnalyzingId(null);
    setActivePhase(null);
    console.info("%c[PHASE 1 COMPLETE] Categorization finished.", "color: #6366f1; font-weight: bold;");
    await refreshRegistry();
  };

  // PHASE 2: B-Roll Mapping
  const handleBRollMapping = async () => {
    const broll = registryFiles.filter(f => f.clip_type === 'b-roll');
    console.info(`%c[PHASE 2 START] B-Roll visual mapping for ${broll.length} clips...`, "color: #0ea5e9; font-weight: bold;");
    setActivePhase('B-Roll Mapping');
    for (const file of broll) {
      setAnalyzingId(file.drive_id);
      console.log(`%c > Busy: Labeling ${file.filename}`, "color: #94a3b8;");
      const data = await analyzeFile(file, 'b_roll_desc');
      await upsertMedia({ ...file, ...data });
    }
    setAnalyzingId(null);
    setActivePhase(null);
    console.info("%c[PHASE 2 COMPLETE] B-Roll mapping finished.", "color: #0ea5e9; font-weight: bold;");
    await refreshRegistry();
  };

  // PHASE 3: Relational Sync
  const handleRelationalSync = async () => {
    const interviews = registryFiles.filter(f => f.clip_type === 'interview');
    console.info(`%c[PHASE 3 START] Waveform alignment for ${interviews.length} angles...`, "color: #10b981; font-weight: bold;");
    setActivePhase('Relational Sync');
    if (interviews.length >= 2) {
      const master = interviews[0];
      const slaves = interviews.slice(1);
      const results = await syncFiles(master, slaves);
      for (const res of results) {
        const file = registryFiles.find(f => f.drive_id === res.drive_id);
        if (file) await upsertMedia({ ...file, sync_offset_frames: Math.round(res.offset * 24) });
      }
    }
    setActivePhase(null);
    console.info("%c[PHASE 3 COMPLETE] Waveform sync alignment calculated.", "color: #10b981; font-weight: bold;");
    await refreshRegistry();
  };

  // PHASE 4: Transcribe Multicam (Final Step)
  const handleTranscribeMulticam = async () => {
    const interviews = registryFiles.filter(f => f.clip_type === 'interview');
    if (interviews.length === 0) {
      alert("No interview clips found to transcribe.");
      return;
    }
    const master = interviews[0]; // Targeted Master Track
    console.info(`%c[PHASE 4 START] Transcribing master audio: ${master.filename}`, "color: #f59e0b; font-weight: bold;");
    
    setActivePhase('Transcription');
    setAnalyzingId(master.drive_id);
    const data = await analyzeFile(master, 'transcribe');
    await upsertMedia({ ...master, ...data });
    
    setAnalyzingId(null);
    setActivePhase(null);
    console.info("%c[PHASE 4 COMPLETE] Master transcription initialized.", "color: #f59e0b; font-weight: bold;");
    await refreshRegistry();
  };

  // --- POLLING & INDEXING ---

  const handleCheckStatus = useCallback(async (file: MediaFile) => {
    if (!file.operation_id || file.operation_id === 'completed' || file.operation_id === 'light_complete') return;
    try {
      const result = await getAnalysisResult(file.operation_id);
      if (result && result.done) {
        const finalizedFile: MediaFile = { ...file, analysis_content: result.content, operation_id: 'completed' };
        await upsertMedia(finalizedFile);
        await refreshRegistry();
      }
    } catch (err) { console.error('[App] Polling error:', err); }
  }, [getAnalysisResult, upsertMedia, refreshRegistry]);

  useEffect(() => { checkStatusRef.current = handleCheckStatus; }, [handleCheckStatus]);

  useEffect(() => {
    const pollInterval = setInterval(() => {
      const pending = registryFiles.filter(f => f.operation_id && f.operation_id !== 'completed' && f.operation_id !== 'light_complete');
      if (pending.length > 0 && checkStatusRef.current) {
        pending.forEach(file => checkStatusRef.current!(file));
      }
    }, 10000);
    return () => clearInterval(pollInterval);
  }, [registryFiles]);

  const handleFolderSelected = async (id: string) => {
    setProgress({ status: IndexingStatus.INDEXING, filesProcessed: 0, foldersProcessed: 0, currentFile: 'Discovering...' });
    try {
      await fetchFilesRecursively(id, async (driveFile) => {
        const isAudio = driveFile.mimeType.includes('audio') || driveFile.name.toLowerCase().endsWith('.wav');
        const mediaFile: MediaFile = {
          drive_id: driveFile.id,
          filename: driveFile.name,
          md5_checksum: driveFile.md5Checksum || '',
          size_bytes: parseInt(driveFile.size) || 0,
          mime_type: driveFile.mimeType,
          duration: driveFile.videoMediaMetadata?.durationMillis || 0,
          sync_offset_frames: 0,
          clip_type: 'unknown',
          media_category: isAudio ? 'audio' : 'video'
        };
        await upsertMedia(mediaFile);
        setProgress(prev => ({ ...prev, currentFile: driveFile.name, filesProcessed: prev.filesProcessed + 1 }));
      }, () => {});
      setProgress(prev => ({ ...prev, status: IndexingStatus.COMPLETED, currentFile: 'Done' }));
      refreshRegistry();
    } catch (err) { console.error('Indexing failed:', err); }
  };

  const framesToTimecode = (totalFrames: number, fps: number = 24) => {
    const base = 1 * 60 * 60 * fps;
    const abs = base + totalFrames;
    const h = Math.floor(abs / (3600 * fps));
    const m = Math.floor((abs % (3600 * fps)) / (60 * fps));
    const s = Math.floor((abs % (60 * fps)) / fps);
    const f = Math.floor(abs % fps);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}:${String(f).padStart(2, '0')}`;
  };

  const handleReset = async () => {
    if (window.confirm("Wipe local registry?")) {
      await clearRegistry();
      setRegistryFiles([]);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 p-4 md:p-8 flex flex-col gap-8">
      <GlobalStyles />
      
      {/* METADATA MODAL */}
      {selectedDetails && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[2000] flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl shadow-2xl max-w-2xl w-full max-h-[85vh] overflow-hidden flex flex-col">
            <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
              <h3 className="text-xl font-bold text-slate-900">Cloud Metadata</h3>
              <button onClick={() => setSelectedDetails(null)} className="text-slate-400 hover:text-slate-600 text-2xl">&times;</button>
            </div>
            <div className="p-6 overflow-y-auto bg-white custom-scrollbar">
                <pre className="text-xs text-indigo-900 font-mono whitespace-pre-wrap bg-slate-50 p-4 rounded-xl border">
                    {JSON.stringify(selectedDetails, null, 2)}
                </pre>
            </div>
            <div className="p-6 border-t flex gap-3">
              <button onClick={() => setSelectedDetails(null)} className="flex-1 py-3 bg-indigo-600 text-white rounded-xl font-bold">Close</button>
            </div>
          </div>
        </div>
      )}

      <div className="max-w-6xl mx-auto w-full space-y-8">
        
        <header className="bg-white rounded-2xl p-8 border border-slate-200 shadow-sm space-y-6">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
            <div className="flex-1">
              <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Story Graph</h1>
              <p className="text-slate-500 mt-2 italic font-medium">Phased Forensic Pipeline</p>
            </div>
            
            <div className="flex items-center gap-3">
              {user ? (
                <>
                  <button onClick={handleReset} className="px-4 py-2 text-red-600 font-bold hover:bg-red-50 rounded-lg text-sm transition-colors">Reset</button>
                  <button onClick={() => openPicker(handleFolderSelected)} className="bg-white border border-slate-200 text-slate-700 px-8 py-3 rounded-xl font-bold hover:bg-slate-50 shadow-sm transition-all">Index Folder</button>
                </>
              ) : (
                <button onClick={login} disabled={!isReady} className="bg-indigo-600 text-white px-8 py-3 rounded-xl font-bold shadow-lg hover:bg-indigo-700 transition-all">Connect Drive</button>
              )}
            </div>
          </div>

          <div className="flex flex-wrap gap-3 pt-4 border-t border-slate-50">
            <button onClick={handleCategorization} disabled={!user || !!activePhase} className={`phase-btn ${activePhase === 'Categorization' ? 'bg-indigo-600 text-white animate-pulse' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}>
              <span className="opacity-50 text-[9px] mb-1">Phase 1</span> Categorization
            </button>
            <button onClick={handleBRollMapping} disabled={!user || !!activePhase} className={`phase-btn ${activePhase === 'B-Roll Mapping' ? 'bg-sky-600 text-white animate-pulse' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}>
              <span className="opacity-50 text-[9px] mb-1">Phase 2</span> B-Roll Mapping
            </button>
            <button onClick={handleRelationalSync} disabled={!user || !!activePhase} className={`phase-btn ${activePhase === 'Relational Sync' ? 'bg-emerald-600 text-white animate-pulse' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}>
              <span className="opacity-50 text-[9px] mb-1">Phase 3</span> Relational Sync
            </button>
            <button onClick={handleTranscribeMulticam} disabled={!user || !!activePhase} className={`phase-btn ${activePhase === 'Transcription' ? 'bg-amber-600 text-white animate-pulse' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}>
              <span className="opacity-50 text-[9px] mb-1">Phase 4</span> Transcribe Interview
            </button>
          </div>

          {(progress.status === IndexingStatus.INDEXING || !!activePhase || waveformSyncing) && (
            <div className="mt-8 p-4 bg-indigo-50 border border-indigo-100 rounded-xl">
              <div className="flex justify-between items-center mb-2">
                <span className="text-sm font-bold text-indigo-900">
                  {activePhase ? `Busy: ${activePhase}...` : waveformSyncing ? 'Aligning Audio Waveforms...' : `Indexing assets...`}
                </span>
              </div>
              <div className="h-1.5 w-full bg-indigo-200 rounded-full overflow-hidden">
                <div className="h-full bg-indigo-600 animate-progress-buffer w-full"></div>
              </div>
            </div>
          )}
        </header>

        <main className="space-y-12">
          <section>
            <MediaTable 
              files={registryFiles} 
              onCheckStatus={handleCheckStatus} 
              onShowDetails={handleShowDetails}
              isAnalyzing={isAnalyzing || !!analyzingId} 
              activeId={analyzingId} 
            />
          </section>

          <section className="bg-slate-900 rounded-2xl p-6 shadow-2xl border border-slate-800">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="text-xl font-bold text-white tracking-tight">Multicam Bin</h2>
                <p className="text-slate-500 font-mono text-[10px] mt-1 uppercase tracking-widest font-bold">Timeline Start: 01:00:00:00</p>
              </div>
            </div>
            
            <div className="bg-slate-800/50 rounded-xl border border-slate-700 overflow-hidden">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="text-slate-500 text-[10px] uppercase font-bold tracking-widest border-b border-slate-700 bg-slate-800/80">
                    <th className="px-4 py-3">Editorial Role</th>
                    <th className="px-4 py-3">Source File</th>
                    <th className="px-4 py-3">Offset (Frames)</th>
                    <th className="px-4 py-3 text-emerald-400">Timeline Start (TC)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700">
                  {registryFiles.filter(f => f.clip_type === 'interview').map((file, idx) => (
                    <tr key={file.drive_id} className="text-slate-300">
                      <td className="px-4 py-3 font-bold text-xs">{idx === 0 ? 'MASTER AUDIO' : `ANGLE ${idx}`}</td>
                      <td className="px-4 py-3 text-slate-400 text-xs">{file.filename}</td>
                      <td className="px-4 py-3 text-slate-500 text-xs">{file.sync_offset_frames}</td>
                      <td className="px-4 py-3 font-mono text-emerald-400 font-bold">{framesToTimecode(file.sync_offset_frames)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </main>
      </div>
    </div>
  );
};

export default App;