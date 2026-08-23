/**
 * Michaelangelo - Express Proxy Server with Full Claude Code Capabilities
 * 
 * Features:
 * 1. Multi-provider chat proxy (OpenRouter, NIM, OpenAI, etc.)
 * 2. Agentic tool execution with 4-phase loop
 * 3. Conversation persistence (save/load/search sessions)
 * 4. Streaming responses with tool execution events
 * 5. Slash command routing (/compact, /clear, /help, /cost, etc.)
 * 6. Token/cost tracking
 * 7. Auto-project detection
 * 8. Permission approval system
 */

import express, { Request, Response } from 'express';
import Store from 'electron-store';
import { Orchestrator, MultiModelRouter } from './agent';
import { BrowserSkill, playwrightReady } from './agent/skills/browser';
import { agentEventBus } from './agent/event-bus';
import { ConversationStore, ConversationMessage } from './conversations';
import { SlashCommandHandler } from './agent/slash-commands';
import { TokenTracker } from './agent/token-tracker';
import { ProjectDetector } from './agent/project-detection';
import { exec } from 'child_process';
import { readFile, writeFile, mkdir, access } from 'fs/promises';
import { dirname, resolve, isAbsolute, join } from 'path';
import { promisify } from 'util';

const execAsync = promisify(exec);

// ============================================================================
// TYPES
// ============================================================================

interface SettingsStore {
  openrouterApiKey: string;
  nvidiaNimApiKey: string;
  openaiApiKey: string;
  anthropicApiKey: string;
  deepseekApiKey: string;
  geminiApiKey: string;
  groqApiKey: string;
  togetherApiKey: string;
  mistralApiKey: string;
  cohereApiKey: string;
  localLlmEndpoint: string;
  localLlmApiKey: string;
  workspace: string;
}

interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}

// ============================================================================
// STORE & SERVICES
// ============================================================================

const store = new Store<SettingsStore>({
  defaults: {
    openrouterApiKey: '', nvidiaNimApiKey: '', openaiApiKey: '', anthropicApiKey: '',
    deepseekApiKey: '', geminiApiKey: '', groqApiKey: '', togetherApiKey: '',
    mistralApiKey: '', cohereApiKey: '',
    localLlmEndpoint: 'http://localhost:11434/v1', localLlmApiKey: 'ollama',
    workspace: '',
  },
});

// Global service instances (initialized once)
let conversationStore: ConversationStore;
let slashHandler: SlashCommandHandler;
let tokenTracker: TokenTracker;
let projectDetector: ProjectDetector;

function getWorkspaceDir(): string {
  return store.get('workspace') || process.cwd();
}

const MAX_ITERATIONS = 20;

const BLOCKED_COMMANDS = [
  'rm -rf /', 'rm -rf /*', 'mkfs', 'dd if=', 'format',
  ':(){:|:&};:', 'chmod -R 777 /', 'chown -R', '> /dev/sda',
];

// ============================================================================
// SYSTEM PROMPT
// ============================================================================

const SYSTEM_PROMPT = `You are Michaelangelo, an autonomous AI coding assistant.

YOUR JOB: When the user asks you to build, create, fix, or modify software, you MUST use your tools to actually do the work. Do NOT just output plans or code blocks — actually execute them.

HOW TO WORK:
1. Analyze what the user wants.
2. Break it into concrete steps.
3. Execute each step using your tools.
4. After each action, check the result and continue.
5. When everything is done, give the user a summary.

RULES:
- Always use your tools to create files, run commands, and read files.
- Never just show code — actually create the files.
- If a command fails, read the error output and fix the issue.
- Be thorough — complete the entire task before stopping.
- Your workspace is: {{WORKSPACE}}
{{PROJECT_CONTEXT}}`;

function getSystemPrompt(projectContext: string = ''): string {
  const workspace = getWorkspaceDir();
  let prompt = SYSTEM_PROMPT.replace('{{WORKSPACE}}', workspace);
  if (projectContext) {
    prompt = prompt.replace('{{PROJECT_CONTEXT}}', '\n' + projectContext);
  } else {
    prompt = prompt.replace('{{PROJECT_CONTEXT}}', '');
  }
  return prompt;
}

// ============================================================================
// TOOL EXECUTION
// ============================================================================

function resolvePath(filePath: string): string {
  const workspace = getWorkspaceDir();
  return isAbsolute(filePath) ? resolve(filePath) : resolve(workspace, filePath);
}

function isPathSafe(filePath: string): boolean {
  return resolvePath(filePath).startsWith(resolve(getWorkspaceDir()));
}

async function executeWriteFile(args: { file_path: string; content: string }): Promise<string> {
  if (!isPathSafe(args.file_path)) return `ERROR: Path outside workspace: ${args.file_path}`;
  try {
    const fullPath = resolvePath(args.file_path);
    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, args.content, 'utf-8');
    return `SUCCESS: Wrote ${args.content.split('\n').length} lines (${Buffer.byteLength(args.content)} bytes) to ${args.file_path}`;
  } catch (err: any) { return `ERROR writing file: ${err.message}`; }
}

async function executeReadFile(args: { file_path: string }): Promise<string> {
  if (!isPathSafe(args.file_path)) return `ERROR: Path outside workspace: ${args.file_path}`;
  try {
    const content = await readFile(resolvePath(args.file_path), 'utf-8');
    return content.length > 50000 ? content.substring(0, 50000) + '\n\n... [truncated]' : content || '(empty file)';
  } catch (err: any) {
    return err.code === 'ENOENT' ? `ERROR: File not found: ${args.file_path}` : `ERROR: ${err.message}`;
  }
}

async function executeRunCommand(args: { command: string; cwd?: string }): Promise<string> {
  const lowerCmd = args.command.toLowerCase().trim();
  for (const blocked of BLOCKED_COMMANDS) {
    if (lowerCmd.includes(blocked)) return `ERROR: Command blocked for safety: "${blocked}"`;
  }
  try {
    const { stdout, stderr } = await execAsync(args.command, {
      cwd: args.cwd ? resolvePath(args.cwd) : getWorkspaceDir(),
      timeout: 60000, maxBuffer: 1024 * 1024,
      env: { ...process.env, FORCE_COLOR: '0' },
    });
    let result = '';
    if (stdout) result += stdout;
    if (stderr) result += (result ? '\n--- STDERR ---\n' : '') + stderr;
    if (!result.trim()) result = '(no output)';
    return result.length > 10000 ? result.substring(0, 10000) + '\n\n... [truncated]' : result;
  } catch (err: any) {
    let msg = `COMMAND FAILED: ${err.message}`;
    if (err.stdout) msg += `\n--- STDOUT ---\n${err.stdout}`;
    if (err.stderr) msg += `\n--- STDERR ---\n${err.stderr}`;
    return msg.length > 10000 ? msg.substring(0, 10000) + '\n\n... [truncated]' : msg;
  }
}

async function executeListFiles(args: any): Promise<string> {
  const dirPath = args.dir_path ? resolvePath(args.dir_path) : getWorkspaceDir();
  try {
    const { readdir } = require('fs/promises');
    const { join, relative } = require('path');
    const entries = await readdir(dirPath, { withFileTypes: true });
    const files = entries.filter((e: any) => !e.name.startsWith('.') && e.name !== 'node_modules')
      .map((e: any) => e.isDirectory() ? e.name + '/' : e.name);
    return files.join('\n') || '(empty directory)';
  } catch (err: any) {
    return `ERROR: ${err.message}`;
  }
}

async function executeSearchFiles(args: any): Promise<string> {
  try {
    let cmd = `rg -n --max-count 5 "${args.pattern.replace(/"/g, '\\"')}"`;
    if (args.file_pattern) cmd += ` -g "${args.file_pattern}"`;
    cmd += ` --max-columns 200`;
    const { stdout } = await execAsync(cmd, { cwd: getWorkspaceDir(), timeout: 15000, maxBuffer: 1024 * 1024 });
    const lines = stdout.trim().split('\n').filter(Boolean);
    const max = args.max_results || 20;
    if (lines.length > max) return lines.slice(0, max).join('\n') + `\n... [${lines.length} total]`;
    return lines.length > 0 ? lines.join('\n') : 'No matches found';
  } catch (err: any) {
    return `ERROR: ${err.message}`;
  }
}

async function executeTool(toolCall: ToolCall): Promise<string> {
  let args: any;
  try { args = JSON.parse(toolCall.function.arguments); } catch { return `ERROR: Failed to parse tool arguments`; }
  switch (toolCall.function.name) {
    case 'write_file': return executeWriteFile(args);
    case 'read_file': return executeReadFile(args);
    case 'run_command': return executeRunCommand(args);
    case 'list_files': return executeListFiles(args);
    case 'search_files': return executeSearchFiles(args);
    case 'browser_navigate':
    case 'browser_screenshot':
    case 'browser_get_content':
    case 'browser_get_styles':
    case 'browser_evaluate':
    case 'browser_wait':
    case 'browser_console': {
      const ctx = { sessionId: 'agentic', workspace: getWorkspaceDir(), model: '', messages: [], iteration: 0, maxIterations: 1, tools: new Map(), metadata: {} };
      const result = await BrowserSkill.execute(toolCall.function.name, args, ctx);
      return result.output || result.error || '(no output)';
    }
    default: return `ERROR: Unknown tool "${toolCall.function.name}"`;
  }
}

// ============================================================================
// LLM CALL
// ============================================================================

async function callLLM(baseUrl: string, apiKey: string, authPrefix: string, model: string, messages: ChatMessage[], tools?: any[]): Promise<any> {
  const body: any = { model, messages, max_tokens: 4096, temperature: 0.3 };
  if (tools && tools.length > 0) { body.tools = tools; }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5 * 60 * 1000);
  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `${authPrefix}${apiKey}` },
      body: JSON.stringify(body), signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!response.ok) throw new Error(`API ${response.status}: ${await response.text().catch(() => '')}`);
    return await response.json();
  } catch (err: any) { clearTimeout(timeout); throw err; }
}

// ============================================================================
// AGENTIC LOOP
// ============================================================================

const TOOL_DEFINITIONS = [
  { type: 'function', function: { name: 'write_file', description: 'Write content to a file. Creates parent dirs automatically.', parameters: { type: 'object', properties: { file_path: { type: 'string' }, content: { type: 'string' } }, required: ['file_path', 'content'] } } },
  { type: 'function', function: { name: 'read_file', description: 'Read file contents.', parameters: { type: 'object', properties: { file_path: { type: 'string' } }, required: ['file_path'] } } },
  { type: 'function', function: { name: 'run_command', description: 'Execute a shell command.', parameters: { type: 'object', properties: { command: { type: 'string' }, cwd: { type: 'string' } }, required: ['command'] } } },
];

async function agenticLoop(baseUrl: string, apiKey: string, authPrefix: string, model: string, provider: string, userMessages: ChatMessage[], conversationId?: string): Promise<{ messages: ChatMessage[]; iterations: number; tokenUsage: { prompt: number; completion: number } }> {
  const session = `session_${Date.now()}`;
  const projectContext = projectDetector ? (await projectDetector.detect()).instructions : '';
  const messages: ChatMessage[] = [
    { role: 'system', content: getSystemPrompt(projectContext) },
    ...userMessages,
  ];

  // Emit agent start event
  agentEventBus.emit('agent_start', session, {
    model, provider, prompt: userMessages.filter(m => m.role === 'user').pop()?.content?.substring(0, 200) || '',
  });
  agentEventBus.emit('phase_change', session, { phase: 'gather_context', iteration: 0 });

  let iterations = 0;
  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;

  while (iterations < MAX_ITERATIONS) {
    iterations++;
    console.log(`[Agent] Iter ${iterations}/${MAX_ITERATIONS}`);
    agentEventBus.emit('llm_call', session, { iteration: iterations, model, toolCount: TOOL_DEFINITIONS.length });

    const response = await callLLM(baseUrl, apiKey, authPrefix, model, messages, TOOL_DEFINITIONS);
    const choice = response.choices?.[0];
    if (!choice) throw new Error('No response from LLM');

    // Track token usage
    if (response.usage) {
      totalPromptTokens += response.usage.prompt_tokens || 0;
      totalCompletionTokens += response.usage.completion_tokens || 0;
      agentEventBus.emit('token_usage', session, {
        iteration: iterations,
        prompt: response.usage.prompt_tokens || 0,
        completion: response.usage.completion_tokens || 0,
        totalPrompt: totalPromptTokens,
        totalCompletion: totalCompletionTokens,
      });
    }

    agentEventBus.emit('llm_response', session, { iteration: iterations, hasToolCalls: !!(choice.message.tool_calls?.length) });

    const assistantMsg = choice.message;
    messages.push({ role: 'assistant', content: assistantMsg.content, tool_calls: assistantMsg.tool_calls });

    if (!assistantMsg.tool_calls || assistantMsg.tool_calls.length === 0) {
      console.log(`[Agent] Completed after ${iterations} iterations`);
      agentEventBus.emit('agent_end', session, { iterations, totalToolCalls: messages.filter(m => m.role === 'tool').length, totalPromptTokens, totalCompletionTokens });
      return { messages, iterations, tokenUsage: { prompt: totalPromptTokens, completion: totalCompletionTokens } };
    }

    for (const toolCall of assistantMsg.tool_calls) {
      console.log(`[Agent] Tool: ${toolCall.function.name}`);
      let args: any = {};
      try { args = JSON.parse(toolCall.function.arguments); } catch { /* ignore */ }
      agentEventBus.emit('tool_start', session, {
        tool: toolCall.function.name, args, iteration: iterations,
      });

      const result = await executeTool(toolCall);
      const isSuccess = !result.startsWith('ERROR');
      agentEventBus.emit('tool_complete', session, {
        tool: toolCall.function.name, success: isSuccess,
        outputPreview: result.substring(0, 300), iteration: iterations,
      });

      messages.push({ role: 'tool', content: result, tool_call_id: toolCall.id });

      // Save tool execution to conversation
      if (conversationId && conversationStore) {
        await conversationStore.addMessage(conversationId, {
          id: `tool_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
          role: 'tool', content: result, timestamp: Date.now(),
        });
      }
    }
  }

  // Hit limit — get final summary
  messages.push({ role: 'system', content: `[System: Max iterations (${MAX_ITERATIONS}) reached. Give final answer.]` });
  const finalResponse = await callLLM(baseUrl, apiKey, authPrefix, model, messages);
  if (finalResponse.choices?.[0]?.message) {
    messages.push({ role: 'assistant', content: finalResponse.choices[0].message.content });
  }

  return { messages, iterations, tokenUsage: { prompt: totalPromptTokens, completion: totalCompletionTokens } };
}

// ============================================================================
// PROVIDERS
// ============================================================================

type ProviderConfig = { baseUrl: string | (() => string); getApiKey: () => string; authPrefix: string; };
function getBaseUrl(p: ProviderConfig): string { return typeof p.baseUrl === 'function' ? p.baseUrl() : p.baseUrl; }

const PROVIDERS: Record<string, ProviderConfig> = {
  openrouter: { baseUrl: 'https://openrouter.ai/api/v1', getApiKey: () => store.get('openrouterApiKey'), authPrefix: 'Bearer ' },
  nvidia_nim: { baseUrl: 'https://integrate.api.nvidia.com/v1', getApiKey: () => store.get('nvidiaNimApiKey'), authPrefix: 'Bearer ' },
  openai: { baseUrl: 'https://api.openai.com/v1', getApiKey: () => store.get('openaiApiKey'), authPrefix: 'Bearer ' },
  anthropic: { baseUrl: 'https://api.anthropic.com/v1', getApiKey: () => store.get('anthropicApiKey'), authPrefix: 'Bearer ' },
  deepseek: { baseUrl: 'https://api.deepseek.com/v1', getApiKey: () => store.get('deepseekApiKey'), authPrefix: 'Bearer ' },
  gemini: { baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', getApiKey: () => store.get('geminiApiKey'), authPrefix: 'Bearer ' },
  groq: { baseUrl: 'https://api.groq.com/openai/v1', getApiKey: () => store.get('groqApiKey'), authPrefix: 'Bearer ' },
  together: { baseUrl: 'https://api.together.xyz/v1', getApiKey: () => store.get('togetherApiKey'), authPrefix: 'Bearer ' },
  mistral: { baseUrl: 'https://api.mistral.ai/v1', getApiKey: () => store.get('mistralApiKey'), authPrefix: 'Bearer ' },
  cohere: { baseUrl: 'https://api.cohere.com/v2', getApiKey: () => store.get('cohereApiKey'), authPrefix: 'Bearer ' },
  local_llm: { baseUrl: () => store.get('localLlmEndpoint') || 'http://localhost:11434/v1', getApiKey: () => store.get('localLlmApiKey') || 'ollama', authPrefix: 'Bearer ' },
};

function detectProvider(modelId: string): string {
  const lower = modelId.toLowerCase();
  for (const prefix of ['nvidia', 'meta/', 'mistralai/', 'google/', 'microsoft/', 'ibm/', 'databricks/', 'baai/']) {
    if (lower.startsWith(prefix)) return 'nvidia_nim';
  }
  return 'openrouter';
}

// ============================================================================
// EXPRESS APP
// ============================================================================

export async function startExpressApp(): Promise<express.Express> {
  // Initialize services
  const dataDir = join(getWorkspaceDir(), '.michaelangelo');
  await mkdir(dataDir, { recursive: true });

  conversationStore = new ConversationStore(dataDir);
  await conversationStore.init();

  slashHandler = new SlashCommandHandler(conversationStore, getWorkspaceDir());
  tokenTracker = new TokenTracker();
  projectDetector = new ProjectDetector(getWorkspaceDir());

  const app = express();
  app.use(express.json({ limit: '10mb' }));

  // CORS
  app.use((_req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    if (_req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  // ==========================================================================
  // GET /api/models
  // ==========================================================================
  app.get('/api/models', async (_req: Request, res: Response) => {
    const models: Array<{ id: string; name: string; provider: string; description?: string }> = [];

    const fetchRemote = async (url: string, headers: Record<string, string>, filter?: (m: any) => boolean, mapper?: (m: any) => any) => {
      try {
        const c = new AbortController(); const t = setTimeout(() => c.abort(), 15000);
        const r = await fetch(url, { headers, signal: c.signal }); clearTimeout(t);
        if (r.ok) {
          const d = await r.json() as any;
          for (const m of d.data || []) {
            if (filter && !filter(m)) continue;
            models.push(mapper ? mapper(m) : { id: m.id, name: m.name || m.id, provider: 'unknown' });
          }
        }
      } catch { /* ignore */ }
    };

    // OpenRouter
    const orKey = store.get('openrouterApiKey');
    if (orKey) await fetchRemote('https://openrouter.ai/api/v1/models', { Authorization: `Bearer ${orKey}` }, undefined,
      m => ({ id: m.id, name: m.name || m.id, provider: 'openrouter', description: m.description }));

    // NIM
    const nimKey = store.get('nvidiaNimApiKey');
    if (nimKey) await fetchRemote('https://integrate.api.nvidia.com/v1/models', { Authorization: `Bearer ${nimKey}` },
      m => { const id = m.id.toLowerCase(); return (id.includes('instruct') || id.includes('chat')) && !['embed', 'vision', 'safety', 'parse', 'translate', 'rerank', 'guard', 'steer'].some(x => id.includes(x)); },
      m => ({ id: m.id, name: m.id.split('/').pop() || m.id, provider: 'nvidia_nim' }));

    // OpenAI
    const openaiKey = store.get('openaiApiKey');
    if (openaiKey) await fetchRemote('https://api.openai.com/v1/models', { Authorization: `Bearer ${openaiKey}` },
      m => m.id.startsWith('gpt') || m.id.startsWith('o1') || m.id.startsWith('o3'),
      m => ({ id: m.id, name: m.id, provider: 'openai' }));

    // Anthropic (static list)
    const antKey = store.get('anthropicApiKey');
    if (antKey) {
      for (const id of ['claude-sonnet-4-20250514', 'claude-3-5-sonnet-20241022', 'claude-3-5-haiku-20241022', 'claude-3-opus-20240229', 'claude-3-haiku-20240307']) {
        models.push({ id, name: id, provider: 'anthropic' });
      }
    }

    // DeepSeek
    const dsKey = store.get('deepseekApiKey');
    if (dsKey) await fetchRemote('https://api.deepseek.com/v1/models', { Authorization: `Bearer ${dsKey}` }, undefined,
      m => ({ id: m.id, name: m.id, provider: 'deepseek' }));

    // Gemini (static)
    const gemKey = store.get('geminiApiKey');
    if (gemKey) {
      for (const id of ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash', 'gemini-1.5-pro', 'gemini-1.5-flash']) {
        models.push({ id, name: id, provider: 'gemini' });
      }
    }

    // Groq
    const groqKey = store.get('groqApiKey');
    if (groqKey) await fetchRemote('https://api.groq.com/openai/v1/models', { Authorization: `Bearer ${groqKey}` },
      m => m.id.includes('llama') || m.id.includes('mixtral') || m.id.includes('gemma'),
      m => ({ id: m.id, name: m.id, provider: 'groq' }));

    // Together
    const togKey = store.get('togetherApiKey');
    if (togKey) await fetchRemote('https://api.together.xyz/v1/models', { Authorization: `Bearer ${togKey}` },
      m => m.id && ['llama', 'mistral', 'gemma', 'qwen'].some(x => m.id.includes(x)),
      m => ({ id: m.id, name: m.name || m.id, provider: 'together' }));

    // Mistral
    const mistKey = store.get('mistralApiKey');
    if (mistKey) await fetchRemote('https://api.mistral.ai/v1/models', { Authorization: `Bearer ${mistKey}` }, undefined,
      m => ({ id: m.id, name: m.id, provider: 'mistral' }));

    // Cohere (static)
    const cohKey = store.get('cohereApiKey');
    if (cohKey) {
      for (const id of ['command-r-plus', 'command-r', 'command-light']) {
        models.push({ id, name: id, provider: 'cohere' });
      }
    }

    // Local LLM
    const localEndpoint = store.get('localLlmEndpoint');
    if (localEndpoint) {
      await fetchRemote(`${localEndpoint}/models`, { Authorization: `Bearer ${store.get('localLlmApiKey') || 'ollama'}` }, undefined,
        m => ({ id: m.id, name: m.id, provider: 'local_llm' }));
    }

    res.json({ models });
  });

  // ==========================================================================
  // POST /api/chat/completions — Standard chat
  // ==========================================================================
  app.post('/api/chat/completions', async (req: Request, res: Response) => {
    const { model, messages, max_tokens, temperature, stream, provider: ep } = req.body;
    if (!model || !messages) return res.status(400).json({ error: 'model and messages required' });

    const pk = (ep && ep !== 'auto' && PROVIDERS[ep]) ? ep : detectProvider(model);
    const provider = PROVIDERS[pk];
    const apiKey = provider.getApiKey();
    if (!apiKey) return res.status(400).json({ error: `No API key for ${pk}` });

    const body: any = { model, messages, max_tokens: max_tokens || 4096, temperature: temperature ?? 0.7, stream: stream ?? false };
    console.log(`[Proxy] ${pk} → ${model}`);

    try {
      const c = new AbortController(); const t = setTimeout(() => c.abort(), 5 * 60 * 1000);
      const response = await fetch(`${getBaseUrl(provider)}/chat/completions`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `${provider.authPrefix}${apiKey}` },
        body: JSON.stringify(body), signal: c.signal,
      });
      clearTimeout(t);

      if (stream) {
        if (!response.ok) { const e = await response.text().catch(() => ''); return res.status(response.status).json({ error: e }); }
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        const reader = response.body?.getReader();
        if (!reader) return res.status(502).json({ error: 'No body' });
        const dec = new TextDecoder();
        try { while (true) { const { done, value } = await reader.read(); if (done) break; res.write(dec.decode(value, { stream: true })); } }
        catch { /* interrupted */ }
        res.end();
      } else {
        const data = await response.json();
        res.status(response.status).json(data);
      }
    } catch (err: any) {
      res.status(502).json({ error: err.name === 'AbortError' ? 'Timeout' : err.message });
    }
  });

  // ==========================================================================
  // POST /api/agent — Orchestrator endpoint
  // ==========================================================================
  app.post('/api/agent', async (req: Request, res: Response) => {
    const { model, messages, provider: ep, conversationId } = req.body;
    if (!model || !messages) return res.status(400).json({ error: 'model and messages required' });

    const pk = (ep && ep !== 'auto' && PROVIDERS[ep]) ? ep : detectProvider(model);
    const provider = PROVIDERS[pk];
    const apiKey = provider.getApiKey();
    if (!apiKey) return res.status(400).json({ error: `No API key for ${pk}` });

    // Check for slash commands in the last user message
    const lastUserMsg = messages.filter((m: any) => m.role === 'user').pop();
    if (lastUserMsg?.content?.startsWith('/')) {
      slashHandler.setModel(model, pk);
      const result = await slashHandler.execute(lastUserMsg.content);
      if (result.meta) {
        // Meta command — handle locally
        if (result.action === 'clear') {
          return res.json({ choices: [{ message: { role: 'assistant', content: result.response }, finish_reason: 'stop' }], slash_command: true, action: 'clear' });
        }
        if (result.action === 'load_session') {
          const conv = conversationStore.get(result.payload);
          if (conv) {
            return res.json({ choices: [{ message: { role: 'assistant', content: result.response }, finish_reason: 'stop' }], slash_command: true, action: 'load_session', conversation: conv });
          }
        }
        return res.json({ choices: [{ message: { role: 'assistant', content: result.response }, finish_reason: 'stop' }], slash_command: true });
      }
      // Non-meta command — forward to agent with modified message
      messages[messages.length - 1] = { role: 'user', content: result.response };
    }

    console.log(`[Orchestrator] Starting: ${pk} → ${model}`);

    try {
      // Create or get conversation
      let convId = conversationId;
      if (!convId) {
        const conv = await conversationStore.create(lastUserMsg?.content?.substring(0, 80) || 'New conversation', model, pk, getWorkspaceDir());
        convId = conv.id;
      }

      // Save user message
      await conversationStore.addMessage(convId, {
        id: `msg_${Date.now()}`, role: 'user',
        content: lastUserMsg?.content || '', timestamp: Date.now(),
      });

      const result = await agenticLoop(getBaseUrl(provider), apiKey, provider.authPrefix, model, pk, messages, convId);

      // Track tokens
      const usage = tokenTracker.record(result.tokenUsage.prompt, result.tokenUsage.completion, model, pk);

      // Get final response content
      const finalContent = result.messages.filter(m => m.role === 'assistant' && m.content).pop()?.content || 'Task completed.';

      // Save assistant message
      await conversationStore.addMessage(convId, {
        id: `msg_${Date.now()}`, role: 'assistant', content: finalContent, timestamp: Date.now(),
        tokens: { prompt: result.tokenUsage.prompt, completion: result.tokenUsage.completion, total: result.tokenUsage.prompt + result.tokenUsage.completion },
        cost: usage.estimatedCost,
      });

      res.json({
        choices: [{ message: { role: 'assistant', content: finalContent }, finish_reason: 'stop' }],
        agent_metadata: {
          iterations: result.iterations,
          total_tool_calls: result.messages.filter(m => m.role === 'tool').length,
          tokens: { prompt: result.tokenUsage.prompt, completion: result.tokenUsage.completion },
          cost: usage.estimatedCost,
          conversation_id: convId,
        },
      });
    } catch (err: any) {
      console.error('[Orchestrator] Error:', err.message);
      res.status(500).json({ error: `Agent error: ${err.message}` });
    }
  });

  // ==========================================================================
  // POST /api/test-model
  // ==========================================================================
  app.post('/api/test-model', async (req: Request, res: Response) => {
    const { model, provider: ep } = req.body;
    if (!model) return res.status(400).json({ error: 'model required' });
    const pk = (ep && ep !== 'auto' && PROVIDERS[ep]) ? ep : detectProvider(model);
    const provider = PROVIDERS[pk];
    const apiKey = provider.getApiKey();
    if (!apiKey) return res.json({ success: false, error: `No API key for ${pk}` });
    try {
      const c = new AbortController(); const t = setTimeout(() => c.abort(), 30000);
      const r = await fetch(`${getBaseUrl(provider)}/chat/completions`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `${provider.authPrefix}${apiKey}` },
        body: JSON.stringify({ model, messages: [{ role: 'user', content: 'Say exactly: Hello world' }], max_tokens: 50, temperature: 0.7 }),
        signal: c.signal,
      });
      clearTimeout(t);
      const data = await r.json() as any;
      const content = data.choices?.[0]?.message?.content;
      res.json(content?.trim() ? { success: true, response: content.trim() } : { success: false, error: data.error?.message || 'No content' });
    } catch (err: any) {
      res.json({ success: false, error: err.name === 'AbortError' ? 'Timeout' : err.message });
    }
  });

  // ==========================================================================
  // GET /api/conversations — List all conversations
  // ==========================================================================
  app.get('/api/conversations', (_req: Request, res: Response) => {
    res.json({ conversations: conversationStore.list(50) });
  });

  // ==========================================================================
  // GET /api/conversations/:id — Get a conversation
  // ==========================================================================
  app.get('/api/conversations/:id', (req: Request, res: Response) => {
    const conv = conversationStore.get(req.params.id);
    if (!conv) return res.status(404).json({ error: 'Not found' });
    res.json(conv);
  });

  // ==========================================================================
  // DELETE /api/conversations/:id — Delete a conversation
  // ==========================================================================
  app.delete('/api/conversations/:id', async (req: Request, res: Response) => {
    await conversationStore.delete(req.params.id);
    res.json({ success: true });
  });

  // ==========================================================================
  // GET /api/conversations/search?q= — Search conversations
  // ==========================================================================
  app.get('/api/conversations/search', (req: Request, res: Response) => {
    const q = (req.query.q as string) || '';
    res.json({ conversations: conversationStore.search(q) });
  });

  // ==========================================================================
  // GET /api/conversations/export/:id — Export as markdown
  // ==========================================================================
  app.get('/api/conversations/export/:id', (req: Request, res: Response) => {
    const md = conversationStore.exportMarkdown(req.params.id);
    if (!md) return res.status(404).json({ error: 'Not found' });
    res.setHeader('Content-Type', 'text/markdown');
    res.send(md);
  });

  // ==========================================================================
  // GET /api/project — Detect project info
  // ==========================================================================
  app.get('/api/project', async (_req: Request, res: Response) => {
    const info = await projectDetector.detect();
    res.json(info);
  });

  // ==========================================================================
  // GET /api/stats — Token/cost stats
  // ==========================================================================
  app.get('/api/stats', (_req: Request, res: Response) => {
    const trackerTotal = tokenTracker.getTotal();
    const convStats = conversationStore.getStats();
    res.json({
      tokens: trackerTotal,
      conversations: convStats,
    });
  });

  // ==========================================================================
  // GET /api/settings/status
  // ==========================================================================
  app.get('/api/settings/status', (_req: Request, res: Response) => {
    res.json({
      openrouter: !!store.get('openrouterApiKey'), nvidia_nim: !!store.get('nvidiaNimApiKey'),
      openai: !!store.get('openaiApiKey'), anthropic: !!store.get('anthropicApiKey'),
      deepseek: !!store.get('deepseekApiKey'), gemini: !!store.get('geminiApiKey'),
      groq: !!store.get('groqApiKey'), together: !!store.get('togetherApiKey'),
      mistral: !!store.get('mistralApiKey'), cohere: !!store.get('cohereApiKey'),
      local_llm: !!store.get('localLlmEndpoint'),
    });
  });

  return app;
}
