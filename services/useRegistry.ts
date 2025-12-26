import { useState, useCallback, useEffect } from 'react';
import { MediaFile } from '../types';

export const useRegistry = () => {
  const [loading, setLoading] = useState(true);

  const openDB = (): Promise<IDBDatabase> => {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('StoryGraphRegistry', 1);
      request.onupgradeneeded = (event: any) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains('media')) {
          db.createObjectStore('media', { keyPath: 'drive_id' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  };

  useEffect(() => {
    openDB().then(() => setLoading(false)).catch(() => setLoading(false));
  }, []);

  const upsertMedia = useCallback(async (file: MediaFile) => {
    const db = await openDB();
    const tx = db.transaction('media', 'readwrite');
    tx.objectStore('media').put(file);
  }, []);

  const getAllMedia = useCallback(async (): Promise<MediaFile[]> => {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction('media', 'readonly');
      const request = tx.objectStore('media').getAll();
      request.onsuccess = () => resolve(request.result || []);
    });
  }, []);

  return { loading, upsertMedia, getAllMedia };
};