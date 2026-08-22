/**
 * Michaelangelo - Electron Main Process
 * 
 * Responsibilities:
 * 1. Create and manage the Electron BrowserWindow
 * 2. Start the internal Express proxy server on a free port
 * 3. Handle graceful shutdown of both server and window
 * 4. Expose IPC for settings management via electron-store
 */

import { app, BrowserWindow, ipcMain, shell, dialog } from 'electron';
import * as path from 'path';
import { createServer, Server } from 'http';
import { startExpressApp } from './server';

// ============================================================================
// GLOBALS
// ============================================================================

let mainWindow: BrowserWindow | null = null;
let expressServer: Server | null = null;
let serverPort: number = 0;

// ============================================================================
// WINDOW CREATION
// ============================================================================

/**
 * Creates the main Electron window.
 * In development, loads the Vite dev server; in production, loads the built HTML.
 */
function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    title: 'Michaelangelo',
    backgroundColor: '#101014',
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#1a1a21',
      symbolColor: '#ffffff',
      height: 40,
    },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // Load the React app based on environment
  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ============================================================================
// EXPRESS SERVER LIFECYCLE
// ============================================================================

/**
 * Starts the Express proxy server on a dynamically assigned port.
 * The port is communicated to the renderer via the window URL hash.
 */
async function startInternalServer(): Promise<number> {
  return new Promise((resolve, reject) => {
    const app = startExpressApp();

    expressServer = createServer(app);

    // Listen on port 0 (OS assigns a free port)
    expressServer.listen(0, '127.0.0.1', () => {
      const addr = expressServer!.address();
      if (addr && typeof addr === 'object') {
        serverPort = addr.port;
        console.log(`[Michaelangelo] Express proxy running on port ${serverPort}`);
        resolve(serverPort);
      } else {
        reject(new Error('Failed to get server address'));
      }
    });

    expressServer.on('error', (err) => {
      console.error('[Michaelangelo] Express server error:', err);
      reject(err);
    });
  });
}

/**
 * Gracefully shuts down the Express server.
 */
function stopInternalServer(): Promise<void> {
  return new Promise((resolve) => {
    if (expressServer) {
      expressServer.close(() => {
        console.log('[Michaelangelo] Express proxy stopped');
        expressServer = null;
        resolve();
      });
    } else {
      resolve();
    }
  });
}

// ============================================================================
// IPC HANDLERS
// ============================================================================

function setupIPC(): void {
  /** Returns the Express server port so the renderer can connect */
  ipcMain.handle('get-server-port', () => serverPort);

  /** Open a URL in the default browser */
  ipcMain.handle('open-external', (_event, url: string) => {
    shell.openExternal(url);
  });

  const ALL_PROVIDER_KEYS = ['openrouterApiKey', 'nvidiaNimApiKey', 'openaiApiKey', 'anthropicApiKey', 'deepseekApiKey', 'geminiApiKey', 'groqApiKey', 'togetherApiKey', 'mistralApiKey', 'cohereApiKey', 'localLlmEndpoint', 'localLlmApiKey'];
  const DEFAULTS: Record<string, string> = {};
  for (const k of ALL_PROVIDER_KEYS) DEFAULTS[k] = '';
  DEFAULTS['workspace'] = '';

  /** Get current API keys from electron-store */
  ipcMain.handle('get-api-keys', () => {
    const Store = require('electron-store');
    const store = new Store({ defaults: DEFAULTS });
    const result: Record<string, string> = {};
    for (const k of ALL_PROVIDER_KEYS) result[k] = store.get(k);
    return result;
  });

  /** Save API keys to electron-store */
  ipcMain.handle('set-api-keys', (_event, keys: Record<string, string>) => {
    const Store = require('electron-store');
    const store = new Store({ defaults: DEFAULTS });
    for (const [k, v] of Object.entries(keys)) {
      if (v !== undefined && ALL_PROVIDER_KEYS.includes(k)) store.set(k, v);
    }
    return { success: true };
  });

  /** Get the current workspace folder */
  ipcMain.handle('get-workspace', () => {
    const Store = require('electron-store');
    const store = new Store({ defaults: DEFAULTS });
    return store.get('workspace') || process.cwd();
  });

  /** Set the workspace folder */
  ipcMain.handle('set-workspace', (_event, workspacePath: string) => {
    const Store = require('electron-store');
    const store = new Store({ defaults: DEFAULTS });
    store.set('workspace', workspacePath);
    return { success: true };
  });

  /** Open a native folder picker dialog */
  ipcMain.handle('select-folder', async () => {
    if (!mainWindow) return null;
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
      title: 'Select Workspace Folder',
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  // --- Permission system ---
  // Stores pending permission requests so the orchestrator can wait for them
  const pendingPermissions = new Map<string, { resolve: (v: any) => void }>();

  /** Permission request from agent (called by orchestrator, sends to renderer) */
  ipcMain.handle('permission-request', (_event, request: { id: string; description: string; type: string }) => {
    if (mainWindow) {
      mainWindow.webContents.send('permission-request', request);
    }
    return new Promise((resolve) => {
      pendingPermissions.set(request.id, { resolve });
    });
  });

  /** Permission response from user (called by renderer, resolves the orchestrator promise) */
  ipcMain.handle('permission-response', (_event, response: { requestId: string; action: string; alwaysAllow?: boolean }) => {
    const pending = pendingPermissions.get(response.requestId);
    if (pending) {
      pendingPermissions.delete(response.requestId);
      pending.resolve(response);
    }
    return { success: true };
  });
}

// ============================================================================
// APP LIFECYCLE
// ============================================================================

app.whenReady().then(async () => {
  // 1. Start the Express proxy first
  await startInternalServer();

  // 2. Set up IPC
  setupIPC();

  // 3. Create the Electron window
  createWindow();
});

app.on('window-all-closed', async () => {
  await stopInternalServer();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on('before-quit', async () => {
  await stopInternalServer();
});
