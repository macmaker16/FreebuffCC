/**
 * FreebuffCC - Electron Main Process
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
    title: 'FreebuffCC',
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
        console.log(`[FreebuffCC] Express proxy running on port ${serverPort}`);
        resolve(serverPort);
      } else {
        reject(new Error('Failed to get server address'));
      }
    });

    expressServer.on('error', (err) => {
      console.error('[FreebuffCC] Express server error:', err);
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
        console.log('[FreebuffCC] Express proxy stopped');
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

  /** Get current API key status from the Express server's store */
  ipcMain.handle('get-api-keys', () => {
    // Re-export from server module's store
    const Store = require('electron-store');
    const store = new Store({ defaults: { openrouterApiKey: '', nvidiaNimApiKey: '' } });
    return {
      openrouterApiKey: store.get('openrouterApiKey'),
      nvidiaNimApiKey: store.get('nvidiaNimApiKey'),
    };
  });

  /** Save API keys to electron-store (called from Settings view) */
  ipcMain.handle('set-api-keys', (_event, keys: { openrouterApiKey?: string; nvidiaNimApiKey?: string }) => {
    const Store = require('electron-store');
    const store = new Store({ defaults: { openrouterApiKey: '', nvidiaNimApiKey: '', workspace: '' } });
    if (keys.openrouterApiKey !== undefined) store.set('openrouterApiKey', keys.openrouterApiKey);
    if (keys.nvidiaNimApiKey !== undefined) store.set('nvidiaNimApiKey', keys.nvidiaNimApiKey);
    return { success: true };
  });

  /** Get the current workspace folder */
  ipcMain.handle('get-workspace', () => {
    const Store = require('electron-store');
    const store = new Store({ defaults: { openrouterApiKey: '', nvidiaNimApiKey: '', workspace: '' } });
    return store.get('workspace') || process.cwd();
  });

  /** Set the workspace folder */
  ipcMain.handle('set-workspace', (_event, workspacePath: string) => {
    const Store = require('electron-store');
    const store = new Store({ defaults: { openrouterApiKey: '', nvidiaNimApiKey: '', workspace: '' } });
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
