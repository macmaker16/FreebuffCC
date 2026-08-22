/**
 * Michaelangelo - Preload Script
 * 
 * Bridges the Electron main process and the React renderer.
 * Only safe, whitelisted methods are exposed to the frontend.
 */

import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  /** Get the Express server port (assigned dynamically at startup) */
  getServerPort: () => ipcRenderer.invoke('get-server-port'),

  /** Open a URL in the default system browser */
  openExternal: (url: string) => ipcRenderer.invoke('open-external', url),

  /** Get saved API keys from electron-store */
  getApiKeys: () => ipcRenderer.invoke('get-api-keys'),

  /** Save API keys to electron-store */
  setApiKeys: (keys: Record<string, string>) =>
    ipcRenderer.invoke('set-api-keys', keys),

  /** Get the current workspace folder path */
  getWorkspace: () => ipcRenderer.invoke('get-workspace'),

  /** Set the workspace folder path */
  setWorkspace: (path: string) => ipcRenderer.invoke('set-workspace', path),

  /** Open a native folder picker dialog */
  selectFolder: () => ipcRenderer.invoke('select-folder'),

  /** Permission system */
  respondPermission: (response: { requestId: string; action: string; alwaysAllow?: boolean }) =>
    ipcRenderer.invoke('permission-response', response),
  onPermissionRequest: (callback: (request: { id: string; description: string; type: string }) => void) => {
    ipcRenderer.on('permission-request', (_event, request) => callback(request));
  },
});

/**
 * Type definition for the exposed API.
 * Used by the renderer's TypeScript for type safety.
 */
export interface ElectronAPI {
  getServerPort: () => Promise<number>;
  openExternal: (url: string) => Promise<void>;
  getApiKeys: () => Promise<Record<string, string>>;
  setApiKeys: (keys: Record<string, string>) => Promise<{ success: boolean }>;
  getWorkspace: () => Promise<string>;
  setWorkspace: (path: string) => Promise<{ success: boolean }>;
  selectFolder: () => Promise<string | null>;
  respondPermission: (response: { requestId: string; action: string; alwaysAllow?: boolean }) => Promise<{ success: boolean }>;
  onPermissionRequest: (callback: (request: { id: string; description: string; type: string }) => void) => void;
}
