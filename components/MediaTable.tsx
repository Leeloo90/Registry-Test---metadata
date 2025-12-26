import React, { useState, useMemo } from 'react';
import { MediaFile } from '../types';

interface MediaTableProps {
  files: MediaFile[];
  onCheckStatus: (file: MediaFile) => Promise<void>;
  onShowDetails: (file: MediaFile) => Promise<void>;
  isAnalyzing: boolean;
  activeId: string | null;
}

export const MediaTable: React.FC<MediaTableProps> = ({ 
  files, 
  onCheckStatus, 
  onShowDetails,
  isAnalyzing,
  activeId
}) => {
  const [searchTerm, setSearchTerm] = useState('');

  /**
   * Generates a .txt forensic report for download.
   */
  const handleDownloadTxt = (file: MediaFile) => {
    if (!file.analysis_content) return;
    
    const element = document.createElement("a");
    const header = `STORY GRAPH FORENSIC REPORT\n`;
    const subHeader = `Asset: ${file.filename}\nCategory: ${file.media_category}\nType: ${file.clip_type}\nStage: ${file.last_forensic_stage || 'N/A'}\nDate: ${new Date().toLocaleString()}\n`;
    const separator = `------------------------------------------\n\n`;
    
    const fileContent = header + subHeader + separator + file.analysis_content;
    const textFile = new Blob([fileContent], { type: 'text/plain' });
    element.href = URL.createObjectURL(textFile);
    const baseName = file.filename.substring(0, file.filename.lastIndexOf('.')) || file.filename;
    element.download = `${baseName}_forensic.txt`;
    
    document.body.appendChild(element); 
    element.click();
    document.body.removeChild(element);
  };

  const filteredFiles = useMemo(() => {
    return files.filter(f => 
      f.filename.toLowerCase().includes(searchTerm.toLowerCase()) ||
      f.mime_type.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [files, searchTerm]);

  const formatSize = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="p-6 border-b border-slate-100 bg-slate-50/30 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-slate-800">Media Registry</h2>
          <p className="text-xs text-slate-500 font-medium tracking-tight uppercase">Right-click for technical metadata</p>
        </div>
        <div className="relative">
          <input
            type="text"
            placeholder="Search assets..."
            className="pl-10 pr-4 py-2 bg-white border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none w-full sm:w-64 transition-all"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
          <svg className="w-4 h-4 absolute left-3.5 top-3 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-slate-50/50 text-slate-500 uppercase text-[10px] font-bold tracking-widest border-b border-slate-100">
              <th className="px-6 py-4">Asset Info</th>
              <th className="px-6 py-4">Classification</th>
              <th className="px-6 py-4">Forensic Intel</th>
              <th className="px-6 py-4">Pipeline Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {filteredFiles.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-6 py-16 text-center text-slate-400 italic text-sm">
                  {searchTerm ? 'No results found.' : 'Your registry is empty. Index a folder to begin.'}
                </td>
              </tr>
            ) : (
              filteredFiles.map((file) => {
                const isActive = activeId === file.drive_id;
                
                // State detection based on operation_id
                const isHeavyProcessing = !!file.operation_id && 
                                           file.operation_id.includes('operations/') && 
                                           file.operation_id !== 'completed';
                
                const isFullyComplete = file.operation_id === 'completed';

                return (
                  <tr 
                    key={file.drive_id} 
                    onContextMenu={(e) => { e.preventDefault(); onShowDetails(file); }}
                    className={`transition-colors group cursor-context-menu ${isActive ? 'bg-indigo-50/50' : 'hover:bg-slate-50'}`}
                  >
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-4">
                        <div className={`p-2.5 rounded-xl ${
                          file.media_category === 'video' ? 'bg-blue-50 text-blue-600' : 'bg-purple-50 text-purple-600'
                        }`}>
                          {file.media_category === 'video' ? (
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>
                          ) : (
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2z"/></svg>
                          )}
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-slate-800 truncate max-w-xs">{file.filename}</p>
                          <p className="text-[10px] font-mono text-slate-400 mt-0.5 uppercase tracking-tighter">
                            {formatSize(file.size_bytes)} • {file.duration ? `${Math.round(file.duration / 1000)}s` : 'Processing...'}
                          </p>
                        </div>
                      </div>
                    </td>

                    <td className="px-6 py-4">
                      <div className="flex flex-col gap-1.5">
                        <span className="px-2 py-0.5 bg-slate-100 text-slate-600 rounded text-[9px] font-extrabold uppercase w-fit tracking-tight border border-slate-200">
                          {file.media_category}
                        </span>
                        <div className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase w-fit border ${
                          file.clip_type === 'interview' ? 'bg-amber-50 text-amber-700 border-amber-100' : 
                          file.clip_type === 'b-roll' ? 'bg-sky-50 text-sky-700 border-sky-100' : 
                          'bg-slate-50 text-slate-400 border-slate-100'
                        }`}>
                          {file.clip_type}
                        </div>
                      </div>
                    </td>

                    <td className="px-6 py-4">
                      <div className="flex items-start gap-3 max-w-md">
                        <div className="flex-1 min-h-[40px]">
                          {file.analysis_content ? (
                            <div className="space-y-1">
                                <div className="flex items-center gap-2">
                                    <span className={`text-[8px] font-bold uppercase px-1 rounded ${
                                        file.last_forensic_stage === 'heavy' ? 'bg-green-100 text-green-700' : 'bg-indigo-100 text-indigo-700'
                                    }`}>
                                        {file.last_forensic_stage || 'AI Summary'}
                                    </span>
                                </div>
                                <p className="text-xs text-slate-600 italic line-clamp-3 leading-relaxed">
                                    "{file.analysis_content}"
                                </p>
                            </div>
                          ) : (
                            <p className="text-xs text-slate-400 italic">
                                {isActive ? 'Processing in current Phase...' : 'Pending Phase Trigger...'}
                            </p>
                          )}
                        </div>

                        {isFullyComplete && (
                          <button 
                            onClick={() => handleDownloadTxt(file)}
                            className="flex-shrink-0 p-2 bg-indigo-50 text-indigo-700 rounded-lg hover:bg-indigo-100 transition-colors border border-indigo-100"
                            title="Download TXT Report"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                            </svg>
                          </button>
                        )}
                      </div>
                    </td>

                    <td className="px-6 py-4 text-right">
                      {isHeavyProcessing ? (
                        <div className="flex flex-col gap-2 min-w-[140px] items-end">
                          <div className="flex items-center gap-2 text-[10px] font-bold text-indigo-600 uppercase">
                            <span className="animate-pulse">Analyzing...</span>
                          </div>
                          <div className="h-1 w-24 bg-slate-100 rounded-full overflow-hidden border border-slate-200">
                            <div className="h-full bg-indigo-500 animate-progress-buffer w-full"></div>
                          </div>
                          <button onClick={() => onCheckStatus(file)} className="text-[9px] text-slate-400 hover:text-indigo-600 underline">Refresh</button>
                        </div>
                      ) : (
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-tighter">
                            {isFullyComplete ? 'Forensic Ready' : (isActive ? 'Running...' : 'Idle')}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default MediaTable;