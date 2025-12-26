
import React from 'react';
import { IndexingProgress, IndexingStatus } from '../types';

interface ProgressBarProps {
  progress: IndexingProgress;
}

const ProgressBar: React.FC<ProgressBarProps> = ({ progress }) => {
  if (progress.status === IndexingStatus.IDLE) return null;

  const isComplete = progress.status === IndexingStatus.COMPLETED;
  const isError = progress.status === IndexingStatus.ERROR;

  return (
    <div className="w-full whiteboard-card p-6 mb-8 animate-in fade-in duration-500">
      <div className="flex justify-between items-end mb-2">
        <div>
          <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wider">
            {isComplete ? 'Indexing Finished' : isError ? 'Indexing Failed' : 'Indexing Media Registry...'}
          </h3>
          <p className="text-xl font-bold text-slate-800">
            {isComplete ? `${progress.filesProcessed} files added` : progress.currentFile || 'Scanning folders...'}
          </p>
        </div>
        <div className="text-right">
          <span className="text-sm font-medium text-slate-500">
            {progress.filesProcessed} files · {progress.foldersProcessed} folders
          </span>
        </div>
      </div>
      
      <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden border border-slate-200">
        <div 
          className={`h-full transition-all duration-300 ${
            isComplete ? 'bg-green-500' : isError ? 'bg-red-500' : 'bg-indigo-600 animate-pulse'
          }`}
          style={{ width: progress.status === IndexingStatus.INDEXING ? '75%' : '100%' }}
        />
      </div>
      
      {isError && (
        <p className="mt-2 text-sm text-red-600 font-medium">
          Error: {progress.error}
        </p>
      )}
    </div>
  );
};

export default ProgressBar;
