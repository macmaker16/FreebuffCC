/**
 * Michaelangelo - Electron Main Process
 * 
 * Responsibilities:
 * 1. Create and manage the Electron BrowserWindow
 * 2. Start the internal Express proxy server on a free port
 * 3. Handle graceful shutdown of both server and window
 * 4. Expose IPC for settings, conversations, permissions
 */

import { app, BrowserWindow, ipcMain, shell, dialog } from 'electron';
import * as path from 'path';
import { createServer, Server } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { startExpressApp } from './server';
import { agentEventBus } from './agent/event-bus';

let mainWindow: BrowserWindow | null = null;
let expressServer: Server | null = null;
let wss: WebSocketServer | null = null;
let serverPort: number = 0;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400, height: 900, minWidth: 1000, minHeight: 700,
    title: 'Michaelangelo', backgroundColor: '#101014',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#1a1a21', symbolColor: '#ffffff', height: 40 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: false,
    },
  });

  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  mainWindow.on('closed', () => { mainWindow = null; });
}

async function startInternalServer(): Promise<number> {
  return new Promise(async (resolve, reject) => {
    try {
      const app = await startExpressApp();
      expressServer = createServer(app);

      // Create WebSocket server on the same HTTP server
      wss = new WebSocketServer({ server: expressServer });
      const wsClients = new Set<WebSocket>();

      // Forward all agent events to connected WebSocket clients
      agentEventBus.on('*', (event) => {
        const payload = JSON.stringify(event);
        for (const client of wsClients) {
          if (client.readyState === WebSocket.OPEN) {
            client.send(payload);
          }
        }
      });

      wss.on('connection', (ws) => {
        wsClients.add(ws);
        console.log(`[WS] Client connected (${wsClients.size} total)`);

        // Send recent events to newly connected client
        const recent = agentEventBus.getRecent(100);
        ws.send(JSON.stringify({ type: 'init', events: recent }));

        ws.on('close', () => {
          wsClients.delete(ws);
          console.log(`[WS] Client disconnected (${wsClients.size} remaining)`);
        });

        ws.on('error', (err) => {
          console.error('[WS] Error:', err.message);
          wsClients.delete(ws);
        });
      });

      expressServer.listen(0, '127.0.0.1', () => {
        const addr = expressServer!.address();
        if (addr && typeof addr === 'object') {
          serverPort = addr.port;
          console.log(`[Michaelangelo] Express proxy running on port ${serverPort}`);
          console.log(`[Michaelangelo] WebSocket server ready on port ${serverPort}`);
          resolve(serverPort);
        } else {
          reject(new Error('Failed to get server address'));
        }
      });
      expressServer.on('error', reject);
    } catch (err) {
      reject(err);
    }
  });
}

function stopInternalServer(): Promise<void> {
  return new Promise((resolve) => {
    if (expressServer) {
      expressServer.close(() => { expressServer = null; resolve(); });
    } else {
      resolve();
    }
  });
}

function setupIPC(): void {
  ipcMain.handle('get-server-port', () => serverPort);
  ipcMain.handle('open-external', (_event, url: string) => { shell.openExternal(url); });

  const ALL_PROVIDER_KEYS = ['openrouterApiKey', 'nvidiaNimApiKey', 'openaiApiKey', 'anthropicApiKey', 'deepseekApiKey', 'geminiApiKey', 'groqApiKey', 'togetherApiKey', 'mistralApiKey', 'cohereApiKey', 'localLlmEndpoint', 'localLlmApiKey'];
  const DEFAULTS: Record<string, string> = {};
  for (const k of ALL_PROVIDER_KEYS) DEFAULTS[k] = '';
  DEFAULTS['localLlmEndpoint'] = 'http://localhost:11434/v1';
  DEFAULTS['localLlmApiKey'] = 'ollama';
  DEFAULTS['workspace'] = '';

  ipcMain.handle('get-api-keys', () => {
    const Store = require('electron-store');
    const store = new Store({ defaults: DEFAULTS });
    const result: Record<string, string> = {};
    for (const k of ALL_PROVIDER_KEYS) result[k] = store.get(k);
    return result;
  });

  ipcMain.handle('set-api-keys', (_event, keys: Record<string, string>) => {
    const Store = require('electron-store');
    const store = new Store({ defaults: DEFAULTS });
    for (const [k, v] of Object.entries(keys)) {
      if (v !== undefined && ALL_PROVIDER_KEYS.includes(k)) store.set(k, v);
    }
    return { success: true };
  });

  ipcMain.handle('get-workspace', () => {
    const Store = require('electron-store');
    const store = new Store({ defaults: DEFAULTS });
    return store.get('workspace') || process.cwd();
  });

  ipcMain.handle('set-workspace', (_event, workspacePath: string) => {
    const Store = require('electron-store');
    const store = new Store({ defaults: DEFAULTS });
    store.set('workspace', workspacePath);
    return { success: true };
  });

  ipcMain.handle('select-folder', async () => {
    if (!mainWindow) return null;
    const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'], title: 'Select Workspace Folder' });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  // Permission system
  const pendingPermissions = new Map<string, { resolve: (v: any) => void }>();

  ipcMain.handle('permission-request', (_event, request: { id: string; description: string; type: string }) => {
    if (mainWindow) mainWindow.webContents.send('permission-request', request);
    return new Promise((resolve) => { pendingPermissions.set(request.id, { resolve }); });
  });

  ipcMain.handle('permission-response', (_event, response: { requestId: string; action: string; alwaysAllow?: boolean }) => {
    const pending = pendingPermissions.get(response.requestId);
    if (pending) { pendingPermissions.delete(response.requestId); pending.resolve(response); }
    return { success: true };
  });
}

app.whenReady().then(async () => {
  await startInternalServer();
  setupIPC();
  createWindow();
});

app.on('window-all-closed', async () => {
  await stopInternalServer();
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('before-quit', async () => {
  await stopInternalServer();
});
