/**
 * Michaelangelo - API Service
 * 
 * All communication with the Express proxy goes through this module.
 * The Express server port is obtained from the Electron main process
 * via IPC at startup, then used as the base URL for all fetch calls.
 */

import { Model } from '../types';

// The Express server port — set once on app load
let SERVER_PORT: number | null = null;

/**
 * Initializes the API service by fetching the server port from main process.
 * Must be called once before any other API functions.
 */
export async function initAPI(): Promise<void> {
  SERVER_PORT = await window.electronAPI.getServerPort();
}

/**
 * Returns the base URL for the Express proxy.
 */
function baseUrl(): string {
  if (!SERVER_PORT) throw new Error('API not initialized. Call initAPI() first.');
  return `http://127.0.0.1:${SERVER_PORT}`;
}

// ============================================================================
// MODELS
// ============================================================================

/**
 * Fetches all available models from both OpenRouter and Nvidia NIM.
 * The Express server handles the actual API calls to each provider.
 */
export async function fetchModels(): Promise<Model[]> {
  const res = await fetch(`${baseUrl()}/api/models`);
  if (!res.ok) throw new Error(`Failed to fetch models: ${res.statusText}`);
  const data = await res.json();
  return data.models || [];
}

/**
 * Tests a model by sending a simple "Hello world" prompt.
 * Returns whether the model responded and the response text.
 */
export async function testModel(modelId: string, provider?: string): Promise<{ success: boolean; response?: string; error?: string }> {
  const res = await fetch(`${baseUrl()}/api/test-model`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: modelId, provider: provider || 'auto' }),
  });
  if (!res.ok) return { success: false, error: `HTTP ${res.status}` };
  return res.json();
}

// ============================================================================
// CHAT
// ============================================================================

/**
 * Sends a chat message (non-streaming) to the Express proxy.
 * The proxy routes it to the correct provider based on the model ID.
 */
export async function sendChat(
  messages: Array<{ role: string; content: string }>,
  model: string,
  provider?: string,
  options: { maxTokens?: number; temperature?: number } = {}
): Promise<any> {
  const res = await fetch(`${baseUrl()}/api/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      provider: provider || 'auto',
      messages,
      max_tokens: options.maxTokens || 4096,
      temperature: options.temperature ?? 0.7,
      stream: false,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || 'Chat request failed');
  }
  return res.json();
}

/**
 * Sends a message to the agentic endpoint which has tool execution.
 * The agent will autonomously create files, run commands, etc.
 */
export async function sendAgentMessage(
  messages: Array<{ role: string; content: string }>,
  model: string,
  provider?: string,
): Promise<any> {
  const res = await fetch(`${baseUrl()}/api/agent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      provider: provider || 'auto',
      messages,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || 'Agent request failed');
  }
  return res.json();
}

/**
 * Streams a chat message. Returns a ReadableStream of SSE chunks.
 * The caller should parse each "data: ..." line as JSON.
 */
export async function streamChat(
  messages: Array<{ role: string; content: string }>,
  model: string,
  options: { maxTokens?: number; temperature?: number } = {}
): Promise<ReadableStream<Uint8Array>> {
  const res = await fetch(`${baseUrl()}/api/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages,
      max_tokens: options.maxTokens || 4096,
      temperature: options.temperature ?? 0.7,
      stream: true,
    }),
  });
  if (!res.ok || !res.body) {
    throw new Error('Streaming request failed');
  }
  return res.body;
}

// ============================================================================
// SETTINGS
// ============================================================================

// Settings are managed through the Express proxy's /api/settings endpoints,
// but for simplicity we store them directly via electron-store through IPC.
// The Express server reads from the same store, so changes are immediate.

// ============================================================================
// UTILITIES
// ============================================================================

/** Generate a unique ID for chat messages */
export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/** Detect provider from model ID (mirrors server logic) */
export function detectProvider(modelId: string): string {
  const lower = modelId.toLowerCase();
  const nvidiaPrefixes = ['nvidia', 'meta/', 'mistralai/', 'google/', 'microsoft/', 'ibm/', 'databricks/', 'baai/'];
  for (const prefix of nvidiaPrefixes) {
    if (lower.startsWith(prefix)) return 'nvidia_nim';
  }
  return 'openrouter';
}
