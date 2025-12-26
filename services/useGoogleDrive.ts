import { useState, useCallback, useEffect } from 'react';
import { GOOGLE_CONFIG } from '../config'; 
import { GoogleUser } from '../types';

declare global {
  interface Window {
    google: any;
    gapi: any;
  }
}

/**
 * Updated Scopes: 
 * We include 'cloud-platform' to grant the access token permission to call 
 * Gemini 1.5 Flash via Vertex AI.
 */
const SCOPES = [
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/cloud-platform' // REQUIRED for Gemini/Vertex
].join(' ');

export const useGoogleDrive = () => {
  const [user, setUser] = useState<GoogleUser | null>(null);
  const [isGapiLoaded, setIsGapiLoaded] = useState(false);
  const [isGsiLoaded, setIsGsiLoaded] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);

  useEffect(() => {
    const handleGapiLoad = () => {
      window.gapi.load('client:picker', async () => {
        try {
          // Initialize with Drive and Video Intelligence Discovery Docs
          await window.gapi.client.init({
            apiKey: GOOGLE_CONFIG.API_KEY,
            discoveryDocs: GOOGLE_CONFIG.DISCOVERY_DOCS,
          });
          console.log("[GAPI] Client initialized with Cloud Video & Drive features.");
          setIsGapiLoaded(true);
        } catch (error: any) {
          console.error("[GAPI] Init Error:", error);
          
          // Fallback if specific discovery docs fail
          try {
            await window.gapi.client.init({
              apiKey: GOOGLE_CONFIG.API_KEY,
              discoveryDocs: ["https://www.googleapis.com/discovery/v1/apis/drive/v3/rest"],
            });
            setIsGapiLoaded(true);
          } catch (fallbackError) {
            setInitError("Critical Google Service Failure.");
          }
        }
      });
    };

    // Library Loading Checks
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

  /**
   * Updated Login:
   * Uses the joined SCOPES string including Vertex AI permissions.
   */
  const login = useCallback(() => {
    if (!isGsiLoaded) return;
    const tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CONFIG.CLIENT_ID,
      scope: SCOPES, 
      callback: (response: any) => {
        if (response.access_token) {
          console.log("[Auth] Token received with Cloud & Drive privileges.");
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

      try {
        do {
          const response = await window.gapi.client.drive.files.list({
            q: `'${currentId}' in parents and trashed = false`,
            fields: 'nextPageToken, files(id, name, md5Checksum, size, mimeType, videoMediaMetadata)',
            pageToken: pageToken
          });

          const files = response.result.files || [];
          for (const file of files) {
            if (file.mimeType === 'application/vnd.google-apps.folder') {
              queue.push(file.id);
            } else if (file.mimeType.startsWith('video/') || file.mimeType.startsWith('audio/')) {
              // Extract duration for temporal sampling in Gemini
              const duration = file.videoMediaMetadata?.durationMillis 
                ? parseInt(file.videoMediaMetadata.durationMillis) / 1000 
                : 0;

              onFileFound({
                ...file,
                duration 
              });
              processedCount++;
              onProgress(processedCount);
            }
          }
          pageToken = response.result.nextPageToken;
        } while (pageToken);
      } catch (err) {
        console.error("[Drive] Error listing files:", err);
      }
    }
  }, [user]);

  return { 
    user, 
    login, 
    openPicker, 
    fetchFilesRecursively, 
    isReady: isGapiLoaded && isGsiLoaded,
    initError 
  };
};