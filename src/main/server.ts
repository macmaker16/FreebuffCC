/**
 * FreebuffCC - Express Proxy Server
 * 
 * This lightweight Express server:
 * 1. Proxies chat requests to OpenRouter or Nvidia NIM based on the model
 * 2. Securely injects API keys from electron-store into outgoing requests
 * 3. Fetches available model lists from both providers
 * 4. Handles CORS so the React frontend can call localhost
 * 
 * All external API calls go through this server — the frontend never
 * touches API keys directly.
 */

import express, { Request, Response } from 'express';
import Store from 'electron-store';

// ============================================================================
// TYPES
// ============================================================================

interface SettingsStore {
  openrouterApiKey: string;
  nvidiaNimApiKey: string;
}

// ============================================================================
// SETTINGS STORE
// ============================================================================

/**
 * electron-store instance for persisting API keys.
 * Keys are stored in the OS-standard app data directory.
 */
const store = new Store<SettingsStore>({
  defaults: {
    openrouterApiKey: '',
    nvidiaNimApiKey: '',
  },
});

// ============================================================================
// PROVIDER CONFIGURATION
// ============================================================================

/**
 * Maps a model ID prefix to its provider configuration.
 * Both OpenRouter and Nvidia NIM expose OpenAI-compatible endpoints,
 * so the request format is identical — only the base URL and auth header differ.
 */
const PROVIDERS: Record<string, { baseUrl: string; getApiKey: () => string; authPrefix: string }> = {
  openrouter: {
    baseUrl: 'https://openrouter.ai/api/v1',
    getApiKey: () => store.get('openrouterApiKey'),
    authPrefix: 'Bearer ',
  },
  nvidia_nim: {
    baseUrl: 'https://integrate.api.nvidia.com/v1',
    getApiKey: () => store.get('nvidiaNimApiKey'),
    authPrefix: 'Bearer ',
  },
};

/**
 * Determines which provider a model belongs to based on its ID.
 * OpenRouter models use slash-separated IDs (e.g., "openai/gpt-4").
 * Nvidia NIM models typically use org/model format (e.g., "nvidia/llama-3.1-70b").
 */
function detectProvider(modelId: string): string {
  const lower = modelId.toLowerCase();

  // Nvidia NIM models are detected by known org prefixes
  const nvidiaPrefixes = ['nvidia', 'meta/', 'mistralai/', 'google/', 'microsoft/', 'ibm/', 'databricks/', 'baai/'];
  for (const prefix of nvidiaPrefixes) {
    if (lower.startsWith(prefix)) return 'nvidia_nim';
  }

  // Everything else goes to OpenRouter (which handles thousands of models)
  return 'openrouter';
}

// ============================================================================
// EXPRESS APP FACTORY
// ============================================================================

/**
 * Creates and configures the Express application.
 * Called once by the Electron main process.
 */
export function startExpressApp(): express.Express {
  const app = express();

  // Parse JSON bodies (up to 10MB for large message histories)
  app.use(express.json({ limit: '10mb' }));

  // CORS — allow the renderer to call this local server
  app.use((_req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    if (_req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  // --------------------------------------------------------------------------
  // GET /api/models
  // Fetches available models from OpenRouter.
  // Nvidia NIM models are hardcoded (their catalog requires auth to list).
  // --------------------------------------------------------------------------
  app.get('/api/models', async (_req: Request, res: Response) => {
    const models: Array<{ id: string; name: string; provider: string; description?: string }> = [];

    // --- Fetch OpenRouter models ---
    const orKey = store.get('openrouterApiKey');
    if (orKey) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15 * 1000);
        const response = await fetch('https://openrouter.ai/api/v1/models', {
          headers: { Authorization: `Bearer ${orKey}` },
          signal: controller.signal,
        });
        clearTimeout(timeout);
        if (response.ok) {
          const data = await response.json() as any;
          for (const m of data.data || []) {
            models.push({
              id: m.id,
              name: m.name || m.id,
              provider: 'openrouter',
              description: m.description,
            });
          }
        }
      } catch (err) {
        console.error('[Proxy] Failed to fetch OpenRouter models:', err);
      }
    }

    // --- Nvidia NIM models (curated list of popular free models) ---
    const nimKey = store.get('nvidiaNimApiKey');
    if (nimKey) {
      const nimModels = [
        { id: 'nvidia/llama-3.1-nemotron-70b-instruct', name: 'Nemotron 70B' },
        { id: 'nvidia/llama-3.1-8b-instruct', name: 'Llama 3.1 8B' },
        { id: 'meta/llama-3.1-405b-instruct', name: 'Llama 3.1 405B' },
        { id: 'meta/llama-3.1-70b-instruct', name: 'Llama 3.1 70B' },
        { id: 'meta/llama-3.1-8b-instruct', name: 'Llama 3.1 8B (Meta)' },
        { id: 'mistralai/mistral-large-2-instruct', name: 'Mistral Large 2' },
        { id: 'mistralai/mixtral-8x22b-instruct-v0.1', name: 'Mixtral 8x22B' },
        { id: 'google/gemma-2-27b-it', name: 'Gemma 2 27B' },
        { id: 'microsoft/phi-3-mini-128k-instruct', name: 'Phi-3 Mini' },
        { id: 'ibm/granite-8b-code-instruct-12k', name: 'Granite 8B Code' },
        { id: 'databricks/dbrx-instruct', name: 'DBRX Instruct' },
        { id: 'baai/bge-m3', name: 'BGE M3 Embedding' },
      ];
      for (const m of nimModels) {
        models.push({ id: m.id, name: m.name, provider: 'nvidia_nim' });
      }
    }

    res.json({ models });
  });

  // --------------------------------------------------------------------------
  // POST /api/chat/completions
  // Proxies a chat completion request to the appropriate provider.
  // Request body: { model, messages, max_tokens?, temperature?, stream? }
  // --------------------------------------------------------------------------
  app.post('/api/chat/completions', async (req: Request, res: Response) => {
    const { model, messages, max_tokens, temperature, stream } = req.body;

    if (!model || !messages) {
      return res.status(400).json({ error: 'model and messages are required' });
    }

    // Determine provider and get config
    const providerKey = detectProvider(model);
    const provider = PROVIDERS[providerKey];
    const apiKey = provider.getApiKey();

    if (!apiKey) {
      return res.status(400).json({
        error: `No API key configured for ${providerKey}. Add it in Settings.`,
      });
    }

    // Build the upstream request body (OpenAI-compatible format)
    const upstreamBody = {
      model,
      messages,
      max_tokens: max_tokens || 4096,
      temperature: temperature ?? 0.7,
      stream: stream ?? false,
    };

    console.log(`[Proxy] ${providerKey} → ${model}`);

    try {
      // 5 minute timeout for long generation
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5 * 60 * 1000);

      const response = await fetch(`${provider.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `${provider.authPrefix}${apiKey}`,
        },
        body: JSON.stringify(upstreamBody),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      // Stream the response back if requested
      if (stream) {
        // Check upstream responded OK before streaming
        if (!response.ok) {
          const errBody = await response.text().catch(() => 'Unknown error');
          return res.status(response.status).json({
            error: `Provider returned ${response.status}: ${errBody}`,
          });
        }

        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        const reader = response.body?.getReader();
        if (!reader) {
          return res.status(502).json({ error: 'No response body from provider' });
        }

        const decoder = new TextDecoder();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            res.write(decoder.decode(value, { stream: true }));
          }
        } catch (streamErr: any) {
          console.error('[Proxy] Stream interrupted:', streamErr.message);
        }
        res.end();
      } else {
        // Non-streaming: forward the JSON response
        const data = await response.json();
        res.status(response.status).json(data);
      }
    } catch (err: any) {
      const msg = err.name === 'AbortError' ? 'Request timed out (5 min limit)' : err.message;
      console.error(`[Proxy] Error calling ${providerKey}:`, msg);
      res.status(502).json({ error: `Provider error: ${msg}` });
    }
  });

  // --------------------------------------------------------------------------
  // POST /api/test-model
  // Quick test: sends "Say hello" and checks for a valid response.
  // --------------------------------------------------------------------------
  app.post('/api/test-model', async (req: Request, res: Response) => {
    const { model } = req.body;

    if (!model) {
      return res.status(400).json({ error: 'model is required' });
    }

    const providerKey = detectProvider(model);
    const provider = PROVIDERS[providerKey];
    const apiKey = provider.getApiKey();

    if (!apiKey) {
      return res.json({ success: false, error: `No API key for ${providerKey}` });
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30 * 1000); // 30s for test

      const response = await fetch(`${provider.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `${provider.authPrefix}${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: 'Say exactly: Hello world' }],
          max_tokens: 50,
          temperature: 0.7,
          stream: false,
        }),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      const data = await response.json() as any;
      const content = data.choices?.[0]?.message?.content;

      if (content && content.trim().length > 0) {
        res.json({ success: true, response: content.trim() });
      } else {
        res.json({ success: false, error: data.error?.message || 'No content in response' });
      }
    } catch (err: any) {
      const msg = err.name === 'AbortError' ? 'Test timed out' : err.message;
      res.json({ success: false, error: msg });
    }
  });

  // --------------------------------------------------------------------------
  // GET /api/settings (read-only — just to verify keys are set)
  // --------------------------------------------------------------------------
  app.get('/api/settings/status', (_req: Request, res: Response) => {
    res.json({
      openrouter: !!store.get('openrouterApiKey'),
      nvidia_nim: !!store.get('nvidiaNimApiKey'),
    });
  });

  return app;
}
