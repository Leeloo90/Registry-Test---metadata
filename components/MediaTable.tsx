import React, { useState, useMemo } from 'react';
import { MediaFile } from '../types';

interface MediaTableProps {
  files: MediaFile[];
}

export const MediaTable: React.FC<MediaTableProps> = ({ files }) => {
  const [searchTerm, setSearchTerm] = useState('');

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
          <h2 className="text-lg font-bold text-slate-800">Indexed Assets</h2>
          <p className="text-xs text-slate-500">Local Registry Cache</p>
        </div>
        <div className="relative">
          <input
            type="text"
            placeholder="Search filenames or types..."
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
              <th className="px-6 py-4">Media Asset</th>
              <th className="px-6 py-4">MIME Type</th>
              <th className="px-6 py-4">File Size</th>
              <th className="px-6 py-4">MD5 Signature</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {filteredFiles.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-6 py-16 text-center text-slate-400 italic text-sm">
                  {searchTerm ? 'No assets match your search.' : 'Registry is empty. Index a folder to begin.'}
                </td>
              </tr>
            ) : (
              filteredFiles.map((file) => (
                <tr key={file.drive_id} className="hover:bg-indigo-50/30 transition-colors group">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-4">
                      <div className={`p-2.5 rounded-xl ${
                        file.mime_type.startsWith('video') ? 'bg-blue-50 text-blue-600' :
                        file.mime_type.startsWith('audio') ? 'bg-purple-50 text-purple-600' :
                        'bg-emerald-50 text-emerald-600'
                      }`}>
                        {file.mime_type.startsWith('video') ? (
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>
                        ) : file.mime_type.startsWith('audio') ? (
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2z"/></svg>
                        ) : (
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>
                        )}
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-slate-800 truncate max-w-md group-hover:text-indigo-600 transition-colors">{file.filename}</p>
                        <p className="text-[10px] font-mono text-slate-400 mt-0.5 uppercase tracking-tighter">DRIVE ID: {file.drive_id}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <span className="px-2 py-1 bg-slate-100 text-slate-600 rounded text-[10px] font-mono">
                      {file.mime_type}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm text-slate-600 font-medium">
                    {formatSize(file.size_bytes)}
                  </td>
                  <td className="px-6 py-4">
                    <p className="text-[10px] font-mono text-slate-400 uppercase">
                      {file.md5_checksum ? file.md5_checksum.substring(0, 16) : 'VERIFYING...'}
                    </p>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default MediaTable;