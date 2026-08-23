/**
 * Michaelangelo - API Service
 * All communication with the Express proxy.
 */

import { Model } from '../types';

let SERVER_PORT: number | null = null;

export async function initAPI(): Promise<void> {
  SERVER_PORT = await window.electronAPI.getServerPort();
}

function baseUrl(): string {
  if (!SERVER_PORT) throw new Error('API not initialized.');
  return `http://127.0.0.1:${SERVER_PORT}`;
}

// ============================================================================
// MODELS
// ============================================================================

export async function fetchModels(): Promise<Model[]> {
  const res = await fetch(`${baseUrl()}/api/models`);
  if (!res.ok) throw new Error(`Failed to fetch models: ${res.statusText}`);
  const data = await res.json();
  return data.models || [];
}

export async function testModel(modelId: string, provider?: string): Promise<{ success: boolean; response?: string; error?: string }> {
  const res = await fetch(`${baseUrl()}/api/test-model`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: modelId, provider: provider || 'auto' }),
  });
  if (!res.ok) return { success: false, error: `HTTP ${res.status}` };
  return res.json();
}

// ============================================================================
// CHAT & AGENT
// ============================================================================

export async function sendChat(
  messages: Array<{ role: string; content: string }>,
  model: string, provider?: string,
  options: { maxTokens?: number; temperature?: number } = {},
): Promise<any> {
  const res = await fetch(`${baseUrl()}/api/chat/completions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, provider: provider || 'auto', messages, max_tokens: options.maxTokens || 4096, temperature: options.temperature ?? 0.7, stream: false }),
  });
  if (!res.ok) { const err = await res.json().catch(() => ({ error: res.statusText })); throw new Error(err.error || 'Chat failed'); }
  return res.json();
}

export async function sendAgentMessage(
  messages: Array<{ role: string; content: string }>,
  model: string, provider?: string, conversationId?: string,
): Promise<any> {
  const res = await fetch(`${baseUrl()}/api/agent`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, provider: provider || 'auto', messages, conversationId }),
  });
  if (!res.ok) { const err = await res.json().catch(() => ({ error: res.statusText })); throw new Error(err.error || 'Agent failed'); }
  return res.json();
}

// ============================================================================
// STREAMING AGENT
// ============================================================================

export interface StreamCallbacks {
  onToken?: (content: string) => void;
  onToolStart?: (tool: string, args: any, iteration: number) => void;
  onToolComplete?: (tool: string, success: boolean, outputPreview: string, iteration: number) => void;
  onIterationStart?: (iteration: number, maxIterations: number) => void;
  onPhaseChange?: (phase: string, iteration: number) => void;
  onTokenUsage?: (prompt: number, completion: number, totalPrompt: number, totalCompletion: number) => void;
  onMetadata?: (meta: any) => void;
  onError?: (message: string) => void;
  onDone?: () => void;
}

export function sendAgentMessageStream(
  messages: Array<{ role: string; content: string }>,
  model: string, provider?: string, conversationId?: string, callbacks?: StreamCallbacks,
): { abort: () => void } {
  const controller = new AbortController();

  (async () => {
    const res = await fetch(`${baseUrl()}/api/agent/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, provider: provider || 'auto', messages, conversationId }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      callbacks?.onError?.(err.error || 'Agent failed');
      return;
    }

    const reader = res.body?.getReader();
    if (!reader) { callbacks?.onError?.('No response body'); return; }
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        let currentEvent = '';
        for (const line of lines) {
          if (line.startsWith('event: ')) {
            currentEvent = line.slice(7).trim();
          } else if (line.startsWith('data: ')) {
            const dataStr = line.slice(6).trim();
            if (!dataStr || !currentEvent) continue;
            try {
              const data = JSON.parse(dataStr);
              switch (currentEvent) {
                case 'token_stream': callbacks?.onToken?.(data.content); break;
                case 'tool_start': callbacks?.onToolStart?.(data.tool, data.args, data.iteration); break;
                case 'tool_complete': callbacks?.onToolComplete?.(data.tool, data.success, data.outputPreview, data.iteration); break;
                case 'iteration_start': callbacks?.onIterationStart?.(data.iteration, data.maxIterations); break;
                case 'phase_change': callbacks?.onPhaseChange?.(data.phase, data.iteration); break;
                case 'token_usage': callbacks?.onTokenUsage?.(data.prompt, data.completion, data.totalPrompt, data.totalCompletion); break;
                case 'metadata': callbacks?.onMetadata?.(data); break;
                case 'error': callbacks?.onError?.(data.message); break;
                case 'done': callbacks?.onDone?.(); break;
              }
            } catch { /* skip */ }
            currentEvent = '';
          }
        }
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') callbacks?.onError?.(err.message);
    }
  })();

  return { abort: () => controller.abort() };
}

// ============================================================================
// CONVERSATIONS
// ============================================================================

export interface ConversationSummary {
  id: string; title: string; model: string; provider: string;
  messageCount: number; toolCallCount: number; totalTokens: number;
  totalCost: number; createdAt: number; updatedAt: number;
}

export interface Conversation {
  id: string; title: string; model: string; provider: string; workspace: string;
  messages: Array<{ id: string; role: string; content: string; timestamp: number; tokens?: any; cost?: number }>;
  createdAt: number; updatedAt: number; totalTokens: number; totalCost: number; toolCallCount: number; tags: string[];
}

export async function fetchConversations(): Promise<ConversationSummary[]> {
  const res = await fetch(`${baseUrl()}/api/conversations`);
  if (!res.ok) return [];
  const data = await res.json();
  return data.conversations || [];
}

export async function getConversation(id: string): Promise<Conversation | null> {
  const res = await fetch(`${baseUrl()}/api/conversations/${id}`);
  if (!res.ok) return null;
  return res.json();
}

export async function deleteConversation(id: string): Promise<boolean> {
  const res = await fetch(`${baseUrl()}/api/conversations/${id}`, { method: 'DELETE' });
  return res.ok;
}

export async function searchConversations(query: string): Promise<ConversationSummary[]> {
  const res = await fetch(`${baseUrl()}/api/conversations/search?q=${encodeURIComponent(query)}`);
  if (!res.ok) return [];
  const data = await res.json();
  return data.conversations || [];
}

// ============================================================================
// PROJECT
// ============================================================================

export interface ProjectInfo {
  type: string; framework: string; languages: string[];
  packageManager: string; buildCommand: string; testCommand: string;
  lintCommand: string; devCommand: string; hasTypeScript: boolean;
  hasGit: boolean; hasDocker: boolean; configFiles: string[];
  instructions: string; directories: string[]; fileCount: number;
}

export async function detectProject(): Promise<ProjectInfo> {
  const res = await fetch(`${baseUrl()}/api/project`);
  if (!res.ok) throw new Error('Failed to detect project');
  return res.json();
}

// ============================================================================
// STATS
// ============================================================================

export async function getStats(): Promise<any> {
  const res = await fetch(`${baseUrl()}/api/stats`);
  if (!res.ok) return {};
  return res.json();
}

// ============================================================================
// UTILITIES
// ============================================================================

export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

export function detectProvider(modelId: string): string {
  const lower = modelId.toLowerCase();
  for (const prefix of ['nvidia', 'meta/', 'mistralai/', 'google/', 'microsoft/', 'ibm/', 'databricks/', 'baai/']) {
    if (lower.startsWith(prefix)) return 'nvidia_nim';
  }
  return 'openrouter';
}
