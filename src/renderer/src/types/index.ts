/**
 * FreebuffCC - TypeScript Type Definitions
 */

/** A model fetched from OpenRouter or hardcoded for NIM */
export interface Model {
  id: string;
  name: string;
  provider: 'openrouter' | 'nvidia_nim';
  description?: string;
}

/** UI state attached to each model card */
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

/** Server settings for API keys */
export interface Settings {
  openrouterApiKey: string;
  nvidiaNimApiKey: string;
}
