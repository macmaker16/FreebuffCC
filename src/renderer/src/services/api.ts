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
