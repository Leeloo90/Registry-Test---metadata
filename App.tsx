import React, { useState, useEffect, useCallback } from 'react';
// import { Layout } from './components/Layout'; // Commented out to prevent 500 error if file is missing
import { MediaTable } from './components/MediaTable';
import { useRegistry } from './services/useRegistry'; 
import { useGoogleDrive } from './services/useGoogleDrive'; 
import { IndexingProgress, MediaFile } from './types';

const App: React.FC = () => {
  const { user, login, openPicker, fetchFilesRecursively, isReady } = useGoogleDrive();
  const { loading: dbLoading, upsertMedia, getAllMedia } = useRegistry();
  
  const [registryFiles, setRegistryFiles] = useState<MediaFile[]>([]);
  const [progress, setProgress] = useState<IndexingProgress>({
    total: 0,
    processed: 0,
    currentFile: '',
    isIndexing: false
  });

  const refreshRegistry = useCallback(async () => {
    const files = await getAllMedia();
    setRegistryFiles(files);
  }, [getAllMedia]);

  useEffect(() => {
    if (!dbLoading) refreshRegistry();
  }, [dbLoading, refreshRegistry]);

  const handleFolderSelected = async (id: string, name: string) => {
    setProgress({ total: 0, processed: 0, currentFile: 'Starting Discovery...', isIndexing: true });
    
    try {
      await fetchFilesRecursively(id, async (driveFile) => {
        const mediaFile: MediaFile = {
          drive_id: driveFile.id,
          filename: driveFile.name,
          md5_checksum: driveFile.md5Checksum || '',
          size_bytes: parseInt(driveFile.size) || 0,
          mime_type: driveFile.mimeType,
          sync_offset_frames: 0
        };
        await upsertMedia(mediaFile);
        setProgress(prev => ({ ...prev, currentFile: driveFile.name }));
      }, (count) => {
        setProgress(prev => ({ ...prev, processed: count }));
      });
      
      setProgress(prev => ({ ...prev, isIndexing: false, currentFile: 'Done' }));
      refreshRegistry();
    } catch (err) {
      console.error('Indexing failed:', err);
      setProgress(prev => ({ ...prev, isIndexing: false, currentFile: 'Error' }));
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 p-4 md:p-8">
      <div className="max-w-6xl mx-auto space-y-8">
        <header className="bg-white rounded-2xl p-8 border border-slate-200 shadow-sm">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
            <div>
              <h1 className="text-3xl font-bold text-slate-900">Story Graph Discovery</h1>
              <p className="text-slate-500 mt-2">Index your Google Drive media assets locally.</p>
            </div>
            
            {!user ? (
              <button onClick={login} disabled={!isReady} className="bg-indigo-600 text-white px-8 py-3 rounded-xl font-bold shadow-lg hover:bg-indigo-700 transition-all">
                Connect Google Drive
              </button>
            ) : (
              <button onClick={() => openPicker(handleFolderSelected)} className="bg-indigo-50 text-indigo-700 border border-indigo-100 px-8 py-3 rounded-xl font-bold hover:bg-indigo-100 transition-all">
                Select Folder
              </button>
            )}
          </div>

          {progress.isIndexing && (
            <div className="mt-8 p-4 bg-indigo-50 border border-indigo-100 rounded-xl">
              <div className="flex justify-between items-center mb-2">
                <span className="text-sm font-bold text-indigo-900">Indexing Files...</span>
                <span className="text-sm text-indigo-700">{progress.processed} found</span>
              </div>
              <p className="text-xs text-indigo-600 truncate">Current: {progress.currentFile}</p>
            </div>
          )}
        </header>

        <main>
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-bold text-slate-800">Registry Contents ({registryFiles.length})</h2>
            <button onClick={refreshRegistry} className="text-sm text-indigo-600 font-semibold hover:underline">
              Refresh Table
            </button>
          </div>
          
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <MediaTable files={registryFiles} />
          </div>
        </main>
      </div>
    </div>
  );
};

export default App;