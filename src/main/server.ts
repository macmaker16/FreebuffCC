/**
 * FreebuffCC - Express Proxy Server with Agentic Tool Execution
 * 
 * This server:
 * 1. Proxies chat requests to OpenRouter or Nvidia NIM
 * 2. Implements an agentic loop for autonomous tool execution
 * 3. Securely executes file operations and terminal commands
 * 4. Manages API keys via electron-store
 * 
 * The agentic loop allows the AI to:
 * - Write files to disk
 * - Read files from disk
 * - Execute terminal commands
 * - Loop until task completion
 */

import express, { Request, Response } from 'express';
import Store from 'electron-store';
import { Orchestrator } from './agent';
import { exec } from 'child_process';
import { readFile, writeFile, mkdir, access } from 'fs/promises';
import { dirname, resolve, isAbsolute } from 'path';
import { promisify } from 'util';

const execAsync = promisify(exec);

// ============================================================================
// TYPES
// ============================================================================

interface SettingsStore {
  openrouterApiKey: string;
  nvidiaNimApiKey: string;
  workspace: string;
}

interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}

// ============================================================================
// SETTINGS STORE
// ============================================================================

const store = new Store<SettingsStore>({
  defaults: {
    openrouterApiKey: '',
    nvidiaNimApiKey: '',
    workspace: '',
  },
});

// ============================================================================
// SECURITY CONSTANTS
// ============================================================================

/**
 * Working directory for all file operations.
 * Reads from electron-store; falls back to cwd.
 */
function getWorkspaceDir(): string {
  return store.get('workspace') || process.cwd();
}

/**
 * Maximum number of agentic loop iterations to prevent infinite loops.
 */
const MAX_ITERATIONS = 20;

/**
 * Blocked commands that should never be executed for safety.
 */
const BLOCKED_COMMANDS = [
  'rm -rf /',
  'rm -rf /*',
  'mkfs',
  'dd if=',
  'format',
  ':(){:|:&};:',
  'chmod -R 777 /',
  'chown -R',
  '> /dev/sda',
];

// ============================================================================
// TOOL DEFINITIONS (OpenAI-compatible format)
// ============================================================================

/**
 * Tool definitions sent to the LLM.
 * These tell the model what actions it can take.
 */
const TOOL_DEFINITIONS = [
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Write content to a file. Creates the file if it does not exist, overwrites if it does. Creates parent directories automatically.',
      parameters: {
        type: 'object',
        properties: {
          file_path: {
            type: 'string',
            description: 'Path to the file (relative to workspace or absolute)',
          },
          content: {
            type: 'string',
            description: 'The content to write to the file',
          },
        },
        required: ['file_path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read the contents of a file.',
      parameters: {
        type: 'object',
        properties: {
          file_path: {
            type: 'string',
            description: 'Path to the file (relative to workspace or absolute)',
          },
        },
        required: ['file_path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_command',
      description: 'Execute a terminal/shell command. Returns stdout and stderr. Use this to install packages, run builds, start servers, run tests, etc.',
      parameters: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            description: 'The shell command to execute',
          },
          cwd: {
            type: 'string',
            description: 'Working directory for the command (optional, defaults to workspace)',
          },
        },
        required: ['command'],
      },
    },
  },
];

// ============================================================================
// SYSTEM PROMPT
// ============================================================================

/**
 * System prompt that forces the model to use tools for autonomous coding.
 */
const SYSTEM_PROMPT = `You are FreebuffCC, an autonomous AI coding assistant. You have access to tools that let you interact with the user's filesystem and terminal.

YOUR JOB: When the user asks you to build, create, fix, or modify software, you MUST use your tools to actually do the work. Do NOT just output plans or code blocks — actually execute them.

HOW TO WORK:
1. Analyze what the user wants.
2. Break it into concrete steps.
3. Execute each step using your tools (write_file, read_file, run_command).
4. After each action, check the result and continue.
5. When everything is done, give the user a summary.

RULES:
- ALWAYS use write_file to create files. Never just show code.
- ALWAYS use run_command to install dependencies, run builds, and execute commands.
- Use read_file to check existing files before modifying them.
- Create files in a logical order (dependencies first).
- After writing all files, run the appropriate commands to verify everything works.
- If a command fails, read the error output and fix the issue.
- Be thorough — complete the entire task before stopping.
- When using run_command, prefer short, focused commands over long chains.
- Your workspace is: {{WORKSPACE}}

IMPORTANT: You MUST call tools. Do NOT output code blocks as your response. Use write_file to create files, and run_command to execute them.`;

// The system prompt is regenerated per request to include the current workspace
function getSystemPrompt(): string {
  const workspace = getWorkspaceDir();
  return SYSTEM_PROMPT.replace('{{WORKSPACE}}', workspace);
}

// ============================================================================
// TOOL EXECUTION FUNCTIONS
// ============================================================================

/**
 * Resolves a file path relative to the workspace directory.
 */
function resolvePath(filePath: string): string {
  const workspace = getWorkspaceDir();
  if (isAbsolute(filePath)) {
    return resolve(filePath);
  }
  return resolve(workspace, filePath);
}

/**
 * Validates that a path is within the workspace (security check).
 */
function isPathSafe(filePath: string): boolean {
  const resolved = resolvePath(filePath);
  const workspace = resolve(getWorkspaceDir());
  return resolved.startsWith(workspace);
}

/**
 * Executes the write_file tool.
 */
async function executeWriteFile(args: { file_path: string; content: string }): Promise<string> {
  const { file_path, content } = args;
  
  if (!isPathSafe(file_path)) {
    return `ERROR: Path "${file_path}" is outside the workspace. Use a relative path or a path within ${getWorkspaceDir()}.`;
  }

  const fullPath = resolvePath(file_path);

  try {
    // Create parent directories if they don't exist
    await mkdir(dirname(fullPath), { recursive: true });
    
    // Write the file
    await writeFile(fullPath, content, 'utf-8');
    
    const lines = content.split('\n').length;
    const bytes = Buffer.byteLength(content, 'utf-8');
    return `SUCCESS: Wrote ${lines} lines (${bytes} bytes) to ${file_path}`;
  } catch (err: any) {
    return `ERROR writing file: ${err.message}`;
  }
}

/**
 * Executes the read_file tool.
 */
async function executeReadFile(args: { file_path: string }): Promise<string> {
  const { file_path } = args;
  
  if (!isPathSafe(file_path)) {
    return `ERROR: Path "${file_path}" is outside the workspace.`;
  }

  const fullPath = resolvePath(file_path);

  try {
    await access(fullPath);
    const content = await readFile(fullPath, 'utf-8');
    
    // Truncate very large files to avoid token limits
    if (content.length > 50000) {
      return content.substring(0, 50000) + '\n\n... [truncated, file is ' + content.length + ' bytes total]';
    }
    
    return content;
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      return `ERROR: File not found: ${file_path}`;
    }
    return `ERROR reading file: ${err.message}`;
  }
}

/**
 * Executes the run_command tool.
 * Runs commands asynchronously with a timeout.
 */
async function executeRunCommand(args: { command: string; cwd?: string }): Promise<string> {
  const { command, cwd } = args;

  // Security: Check for blocked commands
  const lowerCmd = command.toLowerCase().trim();
  for (const blocked of BLOCKED_COMMANDS) {
    if (lowerCmd.includes(blocked)) {
      return `ERROR: Command blocked for safety: "${blocked}"`;
    }
  }

  const workingDir = cwd ? resolvePath(cwd) : getWorkspaceDir();

  try {
    // Execute with a 60-second timeout
    const { stdout, stderr } = await execAsync(command, {
      cwd: workingDir,
      timeout: 60000,
      maxBuffer: 1024 * 1024, // 1MB buffer
      env: { ...process.env, FORCE_COLOR: '0' }, // No color codes in output
    });

    let result = '';
    if (stdout) result += stdout;
    if (stderr) result += (result ? '\n--- STDERR ---\n' : '') + stderr;
    
    if (!result.trim()) {
      result = '(command completed with no output)';
    }

    // Truncate very long output
    if (result.length > 10000) {
      result = result.substring(0, 10000) + '\n\n... [output truncated]';
    }

    return result;
  } catch (err: any) {
    let errorMsg = `COMMAND FAILED: ${err.message}`;
    if (err.stdout) errorMsg += `\n--- STDOUT ---\n${err.stdout}`;
    if (err.stderr) errorMsg += `\n--- STDERR ---\n${err.stderr}`;
    
    // Truncate error output
    if (errorMsg.length > 10000) {
      errorMsg = errorMsg.substring(0, 10000) + '\n\n... [error output truncated]';
    }
    
    return errorMsg;
  }
}

/**
 * Dispatches a tool call to the appropriate execution function.
 */
async function executeTool(toolCall: ToolCall): Promise<string> {
  const { name, arguments: argsStr } = toolCall.function;
  
  let args: any;
  try {
    args = JSON.parse(argsStr);
  } catch {
    return `ERROR: Failed to parse tool arguments: ${argsStr}`;
  }

  console.log(`[Agent] Executing tool: ${name}`);

  switch (name) {
    case 'write_file':
      return executeWriteFile(args);
    case 'read_file':
      return executeReadFile(args);
    case 'run_command':
      return executeRunCommand(args);
    default:
      return `ERROR: Unknown tool "${name}"`;
  }
}

// ============================================================================
// AGENTIC LOOP
// ============================================================================

/**
 * Calls the LLM API and returns the response.
 */
async function callLLM(
  baseUrl: string,
  apiKey: string,
  authPrefix: string,
  model: string,
  messages: ChatMessage[],
  tools?: any[],
): Promise<any> {
  const body: any = {
    model,
    messages,
    max_tokens: 4096,
    temperature: 0.3, // Lower temperature for more deterministic tool use
  };

  if (tools && tools.length > 0) {
    body.tools = tools;
    body.tool_choice = 'auto'; // Let the model decide when to use tools
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5 * 60 * 1000);

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `${authPrefix}${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) {
      const errBody = await response.text().catch(() => 'Unknown error');
      throw new Error(`API returned ${response.status}: ${errBody}`);
    }

    return await response.json();
  } catch (err: any) {
    clearTimeout(timeout);
    throw err;
  }
}

/**
 * The agentic loop:
 * 1. Sends user prompt + tools to the LLM
 * 2. If the LLM returns tool_calls, execute them
 * 3. Append results as tool messages
 * 4. Send back to the LLM
 * 5. Repeat until the LLM returns a final text response
 * 
 * Returns an array of all messages including tool executions.
 */
async function agenticLoop(
  baseUrl: string,
  apiKey: string,
  authPrefix: string,
  model: string,
  userMessages: ChatMessage[],
  onToolExecution?: (toolName: string, result: string) => void,
): Promise<{ messages: ChatMessage[]; iterations: number }> {
  // Start with system prompt + user messages
  const messages: ChatMessage[] = [
    { role: 'system', content: getSystemPrompt() },
    ...userMessages,
  ];

  let iterations = 0;

  while (iterations < MAX_ITERATIONS) {
    iterations++;
    console.log(`[Agent] Iteration ${iterations}/${MAX_ITERATIONS}`);

    // Call the LLM with tools
    const response = await callLLM(baseUrl, apiKey, authPrefix, model, messages, TOOL_DEFINITIONS);
    const choice = response.choices?.[0];

    if (!choice) {
      throw new Error('No response from LLM');
    }

    const assistantMessage = choice.message;

    // Add the assistant's response to the conversation
    messages.push({
      role: 'assistant',
      content: assistantMessage.content,
      tool_calls: assistantMessage.tool_calls,
    });

    // If no tool calls, we're done — return the final response
    if (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) {
      console.log(`[Agent] Completed after ${iterations} iterations`);
      return { messages, iterations };
    }

    // Execute each tool call and append results
    for (const toolCall of assistantMessage.tool_calls) {
      console.log(`[Agent] Tool call: ${toolCall.function.name}`);

      const result = await executeTool(toolCall);

      // Notify callback if provided
      if (onToolExecution) {
        onToolExecution(toolCall.function.name, result);
      }

      // Append the tool result as a tool role message
      messages.push({
        role: 'tool',
        content: result,
        tool_call_id: toolCall.id,
      });
    }
  }

  // If we hit the iteration limit, add a warning
  messages.push({
    role: 'system',
    content: `[System: Maximum iterations (${MAX_ITERATIONS}) reached. Please provide your final answer based on the work done so far.]`,
  });

  // One final call to get the summary
  const finalResponse = await callLLM(baseUrl, apiKey, authPrefix, model, messages);
  const finalChoice = finalResponse.choices?.[0];
  if (finalChoice?.message) {
    messages.push({
      role: 'assistant',
      content: finalChoice.message.content,
    });
  }

  return { messages, iterations };
}

// ============================================================================
// PROVIDER CONFIGURATION
// ============================================================================

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

function detectProvider(modelId: string): string {
  const lower = modelId.toLowerCase();
  const nvidiaPrefixes = ['nvidia', 'meta/', 'mistralai/', 'google/', 'microsoft/', 'ibm/', 'databricks/', 'baai/'];
  for (const prefix of nvidiaPrefixes) {
    if (lower.startsWith(prefix)) return 'nvidia_nim';
  }
  return 'openrouter';
}

// ============================================================================
// EXPRESS APP FACTORY
// ============================================================================

export function startExpressApp(): express.Express {
  const app = express();

  app.use(express.json({ limit: '10mb' }));

  // CORS
  app.use((_req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    if (_req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  // --------------------------------------------------------------------------
  // GET /api/models
  // --------------------------------------------------------------------------
  app.get('/api/models', async (_req: Request, res: Response) => {
    const models: Array<{ id: string; name: string; provider: string; description?: string }> = [];

    const orKey = store.get('openrouterApiKey');
    if (orKey) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);
        const response = await fetch('https://openrouter.ai/api/v1/models', {
          headers: { Authorization: `Bearer ${orKey}` },
          signal: controller.signal,
        });
        clearTimeout(timeout);
        if (response.ok) {
          const data = await response.json() as any;
          for (const m of data.data || []) {
            models.push({ id: m.id, name: m.name || m.id, provider: 'openrouter', description: m.description });
          }
        }
      } catch (err) {
        console.error('[Proxy] Failed to fetch OpenRouter models:', err);
      }
    }

    const nimKey = store.get('nvidiaNimApiKey');
    if (nimKey) {
      // Fetch actual models from NVIDIA NIM API
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);
        const response = await fetch('https://integrate.api.nvidia.com/v1/models', {
          headers: { Authorization: `Bearer ${nimKey}` },
          signal: controller.signal,
        });
        clearTimeout(timeout);
        if (response.ok) {
          const data = await response.json() as any;
          for (const m of data.data || []) {
            // Skip embedding and non-chat models
            if (m.id.includes('embed') || m.id.includes('vision') || m.id.includes('safety') || m.id.includes('parse') || m.id.includes('translate')) continue;
            models.push({
              id: m.id,
              name: m.id.split('/').pop() || m.id,
              provider: 'nvidia_nim',
            });
          }
        }
      } catch (err) {
        console.error('[Proxy] Failed to fetch NIM models:', err);
      }
    }

    res.json({ models });
  });

  // --------------------------------------------------------------------------
  // POST /api/chat/completions — Standard chat (no agent loop)
  // --------------------------------------------------------------------------
  app.post('/api/chat/completions', async (req: Request, res: Response) => {
    const { model, messages, max_tokens, temperature, stream } = req.body;

    if (!model || !messages) {
      return res.status(400).json({ error: 'model and messages are required' });
    }

    const providerKey = detectProvider(model);
    const provider = PROVIDERS[providerKey];
    const apiKey = provider.getApiKey();

    if (!apiKey) {
      return res.status(400).json({ error: `No API key for ${providerKey}. Add it in Settings.` });
    }

    const upstreamBody: any = {
      model,
      messages,
      max_tokens: max_tokens || 4096,
      temperature: temperature ?? 0.7,
      stream: stream ?? false,
    };

    console.log(`[Proxy] ${providerKey} → ${model}`);

    try {
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

      if (stream) {
        if (!response.ok) {
          const errBody = await response.text().catch(() => 'Unknown error');
          return res.status(response.status).json({ error: `Provider error: ${errBody}` });
        }

        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        const reader = response.body?.getReader();
        if (!reader) return res.status(502).json({ error: 'No response body' });

        const decoder = new TextDecoder();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            res.write(decoder.decode(value, { stream: true }));
          }
        } catch (err: any) {
          console.error('[Proxy] Stream interrupted:', err.message);
        }
        res.end();
      } else {
        const data = await response.json();
        res.status(response.status).json(data);
      }
    } catch (err: any) {
      const msg = err.name === 'AbortError' ? 'Request timed out' : err.message;
      console.error(`[Proxy] Error:`, msg);
      res.status(502).json({ error: msg });
    }
  });

  // --------------------------------------------------------------------------
  // POST /api/agent — Master Orchestrator endpoint
  // Integrates plugins, MCP, skills, and memory.
  // --------------------------------------------------------------------------
  app.post('/api/agent', async (req: Request, res: Response) => {
    const { model, messages } = req.body;

    if (!model || !messages) {
      return res.status(400).json({ error: 'model and messages are required' });
    }

    const providerKey = detectProvider(model);
    const provider = PROVIDERS[providerKey];
    const apiKey = provider.getApiKey();

    if (!apiKey) {
      return res.status(400).json({ error: `No API key for ${providerKey}. Add it in Settings.` });
    }

    console.log(`[Orchestrator] Starting: ${providerKey} → ${model}`);

    try {
      // Create and initialize the orchestrator
      const orchestrator = new Orchestrator({
        model,
        baseUrl: provider.baseUrl,
        apiKey,
        authPrefix: provider.authPrefix,
        workspace: getWorkspaceDir(),
        maxIterations: 20,
        enableMemory: true,
        enableMCP: false, // Enable when MCP servers are configured
      });

      await orchestrator.init();

      // Execute the agent task
      const result = await orchestrator.execute(messages);

      // Shutdown orchestrator
      await orchestrator.shutdown();

      res.json({
        choices: [{
          message: {
            role: 'assistant',
            content: result.messages
              .filter(m => m.role === 'assistant' && m.content)
              .pop()?.content || 'Task completed.',
          },
          finish_reason: 'stop',
        }],
        agent_metadata: {
          iterations: result.iterations,
          tool_executions: result.toolExecutions,
          total_tool_calls: result.toolExecutions.length,
          memory_entries: result.memoryEntries.length,
          plugins: ['memory'],
        },
      });
    } catch (err: any) {
      console.error('[Orchestrator] Error:', err.message);
      res.status(500).json({ error: `Agent error: ${err.message}` });
    }
  });

  // --------------------------------------------------------------------------
  // POST /api/test-model
  // --------------------------------------------------------------------------
  app.post('/api/test-model', async (req: Request, res: Response) => {
    const { model } = req.body;
    if (!model) return res.status(400).json({ error: 'model is required' });

    const providerKey = detectProvider(model);
    const provider = PROVIDERS[providerKey];
    const apiKey = provider.getApiKey();
    if (!apiKey) return res.json({ success: false, error: `No API key for ${providerKey}` });

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000);

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
        res.json({ success: false, error: data.error?.message || 'No content' });
      }
    } catch (err: any) {
      res.json({ success: false, error: err.name === 'AbortError' ? 'Timeout' : err.message });
    }
  });

  // --------------------------------------------------------------------------
  // GET /api/settings/status
  // --------------------------------------------------------------------------
  app.get('/api/settings/status', (_req: Request, res: Response) => {
    res.json({
      openrouter: !!store.get('openrouterApiKey'),
      nvidia_nim: !!store.get('nvidiaNimApiKey'),
    });
  });

  return app;
}
