/**
 * Michaelangelo - Preload Script
 * Bridges Electron main process and React renderer.
 */

import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  getServerPort: () => ipcRenderer.invoke('get-server-port'),
  openExternal: (url: string) => ipcRenderer.invoke('open-external', url),

  // Settings
  getApiKeys: () => ipcRenderer.invoke('get-api-keys'),
  setApiKeys: (keys: Record<string, string>) => ipcRenderer.invoke('set-api-keys', keys),
  getWorkspace: () => ipcRenderer.invoke('get-workspace'),
  setWorkspace: (path: string) => ipcRenderer.invoke('set-workspace', path),
  selectFolder: () => ipcRenderer.invoke('select-folder'),

  // Permissions
  respondPermission: (response: { requestId: string; action: string; alwaysAllow?: boolean }) =>
    ipcRenderer.invoke('permission-response', response),
  onPermissionRequest: (callback: (request: { id: string; description: string; type: string }) => void) => {
    ipcRenderer.on('permission-request', (_event, request) => callback(request));
  },

  // Auto-Update
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  installUpdate: () => ipcRenderer.invoke('install-update'),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  onUpdateStatus: (callback: (status: any) => void) => {
    ipcRenderer.on('update-status', (_event, status) => callback(status));
  },
});

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

  // Auto-Update
  checkForUpdates: () => Promise<{ success: boolean }>;
  installUpdate: () => Promise<{ success: boolean }>;
  getAppVersion: () => Promise<string>;
  onUpdateStatus: (callback: (status: any) => void) => void;
}
