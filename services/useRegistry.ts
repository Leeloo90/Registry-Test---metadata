import { useState, useCallback, useEffect } from 'react';
import { MediaFile } from '../types';

export const useRegistry = () => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const openDB = (): Promise<IDBDatabase> => {
    return new Promise((resolve, reject) => {
      // Version 1 of the StoryGraphRegistry
      const request = indexedDB.open('StoryGraphRegistry', 1);
      
      request.onupgradeneeded = (event: any) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains('media')) {
          // drive_id serves as our unique primary key for Google Drive assets
          db.createObjectStore('media', { keyPath: 'drive_id' });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  };

  useEffect(() => {
    openDB()
      .then(() => setLoading(false))
      .catch((err) => {
        console.error('[Registry] Initialization failed:', err);
        setError('Failed to initialize local database.');
        setLoading(false);
      });
  }, []);

  const upsertMedia = useCallback(async (file: MediaFile) => {
    try {
      const db = await openDB();
      const tx = db.transaction('media', 'readwrite');
      const store = tx.objectStore('media');
      
      // .put() handles both initial discovery and Phase 2 forensic updates
      return new Promise<void>((resolve, reject) => {
        const request = store.put(file);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    } catch (err) {
      console.error('[Registry] Upsert failed:', err);
    }
  }, []);

  const getAllMedia = useCallback(async (): Promise<MediaFile[]> => {
    try {
      const db = await openDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('media', 'readonly');
        const store = tx.objectStore('media');
        const request = store.getAll();
        
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => reject(request.error);
      });
    } catch (err) {
      console.error('[Registry] Fetch failed:', err);
      return [];
    }
  }, []);

  // NEW: Hard Reset functionality to clear "ghost" data from previous sessions
  const clearRegistry = useCallback(async () => {
    try {
      const db = await openDB();
      const tx = db.transaction('media', 'readwrite');
      const store = tx.objectStore('media');
      
      return new Promise<void>((resolve, reject) => {
        const request = store.clear();
        request.onsuccess = () => {
          console.log('[Registry] Database cleared successfully.');
          resolve();
        };
        request.onerror = () => reject(request.error);
      });
    } catch (err) {
      console.error('[Registry] Clear failed:', err);
    }
  }, []);

  return { loading, error, upsertMedia, getAllMedia, clearRegistry };
};