import React, { useState, useEffect, useCallback, useRef } from 'react';
import { MediaTable } from './components/MediaTable';
import { useRegistry } from './services/useRegistry'; 
import { useGoogleDrive } from './services/useGoogleDrive'; 
import { useForensicSurveyor } from './services/useForensicSurveyor';
import { useWaveformSync } from './services/useWaveformSync';
import { useXMLExporter } from './services/useXMLExporter';
import { MediaFile, IndexingStatus, IndexingProgress } from './types';

const CLOUD_EXTRACTOR_URL = 'https://extract-proxy-286149224994.europe-west1.run.app';

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
  `}</style>
);

const App: React.FC = () => {
  const { user, login, openPicker, fetchFilesRecursively, isReady } = useGoogleDrive();
  const { loading: dbLoading, upsertMedia, getAllMedia, clearRegistry } = useRegistry();
  
  // Hooks
  const { analyzeFile, getAnalysisResult, isAnalyzing } = useForensicSurveyor(user?.accessToken || null);
  const { syncFiles, isSyncing: waveformSyncing } = useWaveformSync(user?.accessToken || null);
  const { generateXML, downloadXML } = useXMLExporter();
  
  const [registryFiles, setRegistryFiles] = useState<MediaFile[]>([]);
  const [analyzingId, setAnalyzingId] = useState<string | null>(null);
  const [activePhase, setActivePhase] = useState<string | null>(null);
  const [cloudStatus, setCloudStatus] = useState<'testing' | 'online' | 'offline'>('testing');
  const [progress, setProgress] = useState<IndexingProgress>({
    status: IndexingStatus.IDLE,
    filesProcessed: 0,
    foldersProcessed: 0,
    currentFile: ''
  });

  const refreshRegistry = useCallback(async () => {
    const files = await getAllMedia();
    setRegistryFiles(files);
  }, [getAllMedia]);

  useEffect(() => {
    if (!dbLoading) refreshRegistry();
  }, [dbLoading, refreshRegistry]);

  useEffect(() => {
    const checkCloudRun = async () => {
      try {
        const res = await fetch(CLOUD_EXTRACTOR_URL, { method: 'OPTIONS' });
        setCloudStatus(res.ok || res.status === 204 ? 'online' : 'offline');
      } catch (err) { setCloudStatus('offline'); }
    };
    checkCloudRun();
  }, []);

  const handleCheckStatus = useCallback(async (file: MediaFile) => {
    if (!file.operation_id || ['completed', 'light_complete', 'error'].includes(file.operation_id)) return;
    try {
      if (typeof getAnalysisResult === 'function') {
        const result = await getAnalysisResult(file.operation_id);
        if (result && result.done) {
          await upsertMedia({ ...file, analysis_content: result.content, operation_id: 'completed' });
          refreshRegistry();
        }
      }
    } catch (err) { console.error('[App] Polling error:', err); }
  }, [getAnalysisResult, upsertMedia, refreshRegistry]);

  useEffect(() => {
    const pollInterval = setInterval(() => {
      const pending = registryFiles.filter(f => 
        f.operation_id && !['completed', 'light_complete', 'error'].includes(f.operation_id)
      );
      if (pending.length > 0) {
        pending.forEach(file => handleCheckStatus(file));
      }
    }, 10000);
    return () => clearInterval(pollInterval);
  }, [registryFiles, handleCheckStatus]);

  /**
   * PHASE 0: Tech Specs (New)
   * Calls Cloud Run to get FFprobe data (Timecode, FPS, Res)
   */
  const handleTechSpecs = async () => {
    const targets = registryFiles.filter(f => f.media_category === 'video' || f.media_category === 'audio');
    setActivePhase('Tech Specs');
    
    for (const file of targets) {
      setAnalyzingId(file.drive_id);
      try {
        // Calls the new 'tech_specs' phase in useForensicSurveyor
        const data = await analyzeFile(file, 'tech_specs');
        await upsertMedia({ ...file, ...data });
      } catch (err) { console.error(err); }
    }
    
    setAnalyzingId(null);
    setActivePhase(null);
    await refreshRegistry();
  };

  const handleCategorization = async () => {
    const unknowns = registryFiles.filter(f => f.clip_type === 'unknown');
    setActivePhase('Categorization');
    for (const file of unknowns) {
      setAnalyzingId(file.drive_id);
      try {
        const data = await analyzeFile(file, file.media_category === 'audio' ? 'audio_discovery' : 'shot_type');
        if (file.media_category === 'video' && data.clip_type === 'interview') {
          await fetch(CLOUD_EXTRACTOR_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filename: file.filename })
          });
        }
        await upsertMedia({ ...file, ...data });
      } catch (err) { console.error(err); }
    }
    setAnalyzingId(null);
    setActivePhase(null);
    await refreshRegistry();
  };

  const handleBRollMapping = async () => {
    const broll = registryFiles.filter(f => f.clip_type === 'b-roll');
    setActivePhase('B-Roll Mapping');
    for (const file of broll) {
      setAnalyzingId(file.drive_id);
      const data = await analyzeFile(file, 'b_roll_desc');
      await upsertMedia({ ...file, ...data });
    }
    setAnalyzingId(null);
    setActivePhase(null);
    await refreshRegistry();
  };

  const handleRelationalSync = async () => {
    const masterAudio = registryFiles.filter(f => f.media_category === 'audio' && f.clip_type === 'interview');
    const videoAngles = registryFiles.filter(f => f.clip_type === 'interview' && f.media_category === 'video');
    setActivePhase('Relational Sync');
    try {
        if (masterAudio.length > 0 && videoAngles.length > 0) {
          const results = await syncFiles(masterAudio[0], videoAngles);
          for (const res of results) {
            const file = registryFiles.find(f => f.drive_id === res.drive_id);
            if (file) {
                // RULE: Clip_Start_Tag = Waveform_Offset_Frames 
                await upsertMedia({ ...file, sync_offset_frames: Math.round(res.offset * 25) });
            }
          }
        }
    } finally {
        setActivePhase(null);
        await refreshRegistry();
    }
  };

  const handleTranscribeMulticam = async () => {
    const target = registryFiles.find(f => f.clip_type === 'interview');
    if (!target) return;
    setActivePhase('Transcription');
    setAnalyzingId(target.drive_id);
    const data = await analyzeFile(target, 'transcribe');
    await upsertMedia({ ...target, ...data });
    setAnalyzingId(null);
    setActivePhase(null);
    await refreshRegistry();
  };

  /**
   * EXPORT ACTION: Uses Tech Specs from Database if available
   */
  const handleExportXML = () => {
    // Protocol mandates Flattened Sequence Structure
    const xml = generateXML(registryFiles, "StoryGraph_Multicam_Sync");
    downloadXML(xml, "StoryGraph_Final_Sync.xml");
  };

  const handleFolderSelected = async (id: string) => {
    setProgress({ status: IndexingStatus.INDEXING, filesProcessed: 0, foldersProcessed: 0, currentFile: 'Discovering...' });
    try {
      // Modified indexing logic to capture full relative folder path 
      await fetchFilesRecursively(id, async (driveFile, relativePath) => {
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
          media_category: isAudio ? 'audio' : 'video',
          relative_path: relativePath // Saved in database for path construction
        };
        await upsertMedia(mediaFile);
        setProgress(prev => ({ ...prev, currentFile: driveFile.name, filesProcessed: prev.filesProcessed + 1 }));
      }, () => {});
      setProgress(prev => ({ ...prev, status: IndexingStatus.COMPLETED, currentFile: 'Done' }));
      refreshRegistry();
    } catch (err) { console.error('Indexing failed:', err); }
  };

  const framesToTimecode = (totalFrames: number, fps: number = 25) => {
    const base = 1 * 60 * 60 * fps; // 01:00:00:00
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
      <div className={`fixed top-0 left-0 w-full h-1 z-[3000] ${
        cloudStatus === 'online' ? 'bg-emerald-500' : cloudStatus === 'offline' ? 'bg-red-500' : 'bg-amber-500'
      }`} />

      <div className="max-w-6xl mx-auto w-full space-y-8">
        <header className="bg-white rounded-2xl p-8 border border-slate-200 shadow-sm space-y-6">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
            <div className="flex-1">
              <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Story Graph</h1>
              <p className="text-slate-500 mt-2 italic font-medium flex items-center gap-2">
                Forensic Multicam discovery 
                <span className={`inline-block w-2 h-2 rounded-full ${cloudStatus === 'online' ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'}`} />
              </p>
            </div>
            <div className="flex items-center gap-3">
              {user ? (
                <>
                  <button onClick={handleReset} className="px-4 py-2 text-red-600 font-bold hover:bg-red-50 rounded-lg text-sm">Reset</button>
                  <button onClick={() => openPicker(handleFolderSelected)} className="bg-white border border-slate-200 text-slate-700 px-8 py-3 rounded-xl font-bold shadow-sm transition-all">Index Folder</button>
                </>
              ) : (
                <button onClick={login} disabled={!isReady} className="bg-indigo-600 text-white px-8 py-3 rounded-xl font-bold shadow-lg transition-all">Connect Drive</button>
              )}
            </div>
          </div>

          <div className="flex flex-wrap gap-3 pt-4 border-t border-slate-50">
            {/* NEW PHASE 0 BUTTON */}
            <button onClick={handleTechSpecs} disabled={!user || !!activePhase} className={`phase-btn ${activePhase === 'Tech Specs' ? 'bg-indigo-600 text-white animate-pulse' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}>
              <span className="opacity-50 text-[9px] mb-1">Phase 0</span> Tech Specs
            </button>

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
        </header>

        <main className="space-y-12">
          <MediaTable 
            files={registryFiles} 
            onCheckStatus={handleCheckStatus} 
            isAnalyzing={isAnalyzing || !!analyzingId} 
            activeId={analyzingId} 
          />

          <section className="bg-slate-900 rounded-2xl p-6 shadow-2xl border border-slate-800 relative">
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h2 className="text-xl font-bold text-white tracking-tight">Multicam Bin</h2>
                    <p className="text-slate-500 font-mono text-[10px] mt-1 uppercase tracking-widest font-bold">Anchor Frame: 01:00:00:00</p>
                </div>
            </div>
            
            <div className="bg-slate-800/50 rounded-xl border border-slate-700 overflow-hidden mb-12">
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
                  {registryFiles.filter(f => f.media_category === 'audio' || f.clip_type === 'interview').map((file, idx) => (
                    <tr key={file.drive_id} className="text-slate-300">
                      <td className="px-4 py-3 font-bold text-xs">{file.media_category === 'audio' ? 'MASTER AUDIO' : `ANGLE ${idx}`}</td>
                      <td className="px-4 py-3 text-slate-400 text-xs">{file.filename}</td>
                      <td className="px-4 py-3 text-slate-500 text-xs">{file.sync_offset_frames}</td>
                      <td className="px-4 py-3 font-mono text-emerald-400 font-bold">{framesToTimecode(file.sync_offset_frames)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* XML EXPORT ACTION */}
            <div className="absolute bottom-6 right-6">
                <button 
                    onClick={handleExportXML}
                    disabled={registryFiles.filter(f => f.sync_offset_frames > 0).length === 0}
                    className="bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed text-white px-8 py-3 rounded-xl font-bold text-xs uppercase tracking-widest shadow-lg transition-all flex items-center gap-2"
                >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg>
                    Export Sync XML
                </button>
            </div>
          </section>
        </main>
      </div>
    </div>
  );
};

export default App;