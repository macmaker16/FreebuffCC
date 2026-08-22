/**
 * Michaelangelo - TypeScript Type Definitions
 */

/** A model fetched from OpenRouter or hardcoded for NIM */
export interface Model {
  id: string;
  name: string;
  provider: 'openrouter' | 'nvidia_nim';
  description?: string;
}

/** Status of a model after auto-test or manual test */
export type ModelOnlineStatus = 'untested' | 'testing' | 'online' | 'offline';

/** Persistent online status for a model */
export interface ModelStatus {
  status: ModelOnlineStatus;
  lastTested?: number;
  error?: string;
}

/** UI state attached to each model row */
export interface ModelState {
  testStatus: 'idle' | 'testing' | 'success' | 'failed';
  testResponse?: string;
  testError?: string;
}

/** Chat message in the conversation */
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

/** Server settings for API keys and workspace */
export interface Settings {
  openrouterApiKey: string;
  nvidiaNimApiKey: string;
  workspace: string;
}
