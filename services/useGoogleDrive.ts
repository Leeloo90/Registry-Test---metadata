import { useState, useCallback, useEffect } from 'react';
import { GOOGLE_CONFIG } from '../config'; // This looks for 'export const GOOGLE_CONFIG'
import { GoogleUser } from '../types';

declare global {
  interface Window {
    google: any;
    gapi: any;
  }
}

export const useGoogleDrive = () => {
  const [user, setUser] = useState<GoogleUser | null>(null);
  const [isGapiLoaded, setIsGapiLoaded] = useState(false);
  const [isGsiLoaded, setIsGsiLoaded] = useState(false);

  useEffect(() => {
    const handleGapiLoad = () => {
      window.gapi.load('client:picker', async () => {
        await window.gapi.client.init({
          apiKey: GOOGLE_CONFIG.API_KEY,
          discoveryDocs: GOOGLE_CONFIG.DISCOVERY_DOCS,
        });
        setIsGapiLoaded(true);
      });
    };

    const interval = setInterval(() => {
      if (window.gapi) {
        clearInterval(interval);
        handleGapiLoad();
      }
    }, 100);

    const gsiInterval = setInterval(() => {
      if (window.google?.accounts?.oauth2) {
        clearInterval(gsiInterval);
        setIsGsiLoaded(true);
      }
    }, 100);

    return () => {
      clearInterval(interval);
      clearInterval(gsiInterval);
    };
  }, []);

  const login = useCallback(() => {
    if (!isGsiLoaded) return;
    const tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CONFIG.CLIENT_ID,
      scope: GOOGLE_CONFIG.SCOPES,
      callback: (response: any) => {
        if (response.access_token) {
          console.log("[Auth] Token received.");
          setUser({ accessToken: response.access_token });
        }
      },
    });
    tokenClient.requestAccessToken();
  }, [isGsiLoaded]);

  const openPicker = useCallback((onFolderSelected: (folderId: string, folderName: string) => void) => {
    if (!user || !isGapiLoaded) return;
    const view = new window.google.picker.DocsView(window.google.picker.ViewId.FOLDERS)
      .setSelectFolderEnabled(true)
      .setMimeTypes('application/vnd.google-apps.folder');

    const picker = new window.google.picker.PickerBuilder()
      .addView(view)
      .setOAuthToken(user.accessToken)
      .setDeveloperKey(GOOGLE_CONFIG.API_KEY)
      .setCallback((data: any) => {
        if (data.action === window.google.picker.Action.PICKED) {
          const doc = data.docs[0];
          onFolderSelected(doc.id, doc.name);
        }
      })
      .build();
    picker.setVisible(true);
  }, [user, isGapiLoaded]);

  const fetchFilesRecursively = useCallback(async (
    folderId: string, 
    onFileFound: (file: any) => void,
    onProgress: (count: number) => void
  ) => {
    if (!user) return;
    let processedCount = 0;
    const queue = [folderId];

    while (queue.length > 0) {
      const currentId = queue.shift()!;
      let pageToken: string | undefined = undefined;

      do {
        const response = await window.gapi.client.drive.files.list({
          q: `'${currentId}' in parents and trashed = false`,
          fields: 'nextPageToken, files(id, name, md5Checksum, size, mimeType)',
          pageToken: pageToken
        });

        const files = response.result.files || [];
        for (const file of files) {
          if (file.mimeType === 'application/vnd.google-apps.folder') {
            queue.push(file.id);
          } else if (file.mimeType.startsWith('video/') || file.mimeType.startsWith('audio/') || file.mimeType.startsWith('image/')) {
            console.log(`[Registry] Found Asset: ${file.name}`);
            onFileFound(file);
            processedCount++;
            onProgress(processedCount);
          }
        }
        pageToken = response.result.nextPageToken;
      } while (pageToken);
    }
  }, [user]);

  return { user, login, openPicker, fetchFilesRecursively, isReady: isGapiLoaded && isGsiLoaded };
};