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
import { generateDiff } from './agent/diff-engine';
import { ConversationStore, ConversationMessage } from './conversations';
import { SlashCommandHandler } from './agent/slash-commands';
import { TokenTracker } from './agent/token-tracker';
import { ProjectDetector } from './agent/project-detection';
import { PermissionManager, PermissionRequest, PermissionResponse } from './agent/permissions';
import { CascadingPlanner } from './agent/planner';
import { OutputInterceptor } from './agent/output-interceptor';
import { ContextCompressionEngine } from './agent/context-compression';
import { getRepoMapGenerator } from './agent/repo-map';
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
  const stored = store.get('workspace');
  if (stored) return stored;
  // Auto-detect: walk up from cwd looking for project markers
  const { join, dirname } = require('path');
  const fs = require('fs');
  const markers = ['package.json', 'Cargo.toml', 'go.mod', 'pyproject.toml', '.git', 'README.md'];
  let dir = process.cwd();
  for (let i = 0; i < 5; i++) {
    for (const marker of markers) {
      if (fs.existsSync(join(dir, marker))) return dir;
    }
    dir = dirname(dir);
  }
  return process.cwd();
}

const MAX_ITERATIONS = 20;

const BLOCKED_COMMANDS = [
  'rm -rf /', 'rm -rf /*', 'mkfs', 'dd if=', 'format',
  ':(){:|:&};:', 'chmod -R 777 /', 'chown -R', '> /dev/sda',
];

// ============================================================================
// AGENT RUNTIME STATE
// ============================================================================

/** Human-in-the-loop permission manager (shared by all agent loops) */
const permissionManager = new PermissionManager();

/** Active agent runs keyed by session id — used for abort/interrupt (Esc) */
const activeRuns = new Map<string, AbortController>();

/** Per-session todo list (Claude Code-style task tracking) */
interface TodoItem { content: string; status: 'pending' | 'in_progress' | 'completed'; }
const sessionTodos = new Map<string, TodoItem[]>();

/** Per-session CascadingPlanner (Architect/Cascade planning mode) */
const sessionPlanners = new Map<string, CascadingPlanner>();
function getPlanner(sessionId: string): CascadingPlanner {
  let p = sessionPlanners.get(sessionId);
  if (!p) { p = new CascadingPlanner({ maxSteps: 15, autoApproveThreshold: 0 }); sessionPlanners.set(sessionId, p); }
  return p;
}

/** Pending plan approvals: planId → resolver (GUI Approve/Reject endpoint resolves) */
const pendingPlanApprovals = new Map<string, { resolve: (approved: boolean) => void; timer: NodeJS.Timeout }>();

/** Wait for the user to approve/reject a plan. Resolves false on timeout or abort. */
function waitForPlanApproval(planId: string, signal?: AbortSignal, timeoutMs = 10 * 60_000): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (approved: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
      pendingPlanApprovals.delete(planId);
      resolve(approved);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    const onAbort = () => finish(false);
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
    pendingPlanApprovals.set(planId, { resolve: finish, timer });
  });
}

/**
 * Tool Output Interceptor (Cursor/Windsurf style): terminal output > 1500 tokens
 * is compressed by a fast cheap local LLM (via the proxy) down to errors,
 * error codes and stack frames. Falls back to smart truncation.
 */
function createCheapCompressor(): ((prompt: string) => Promise<string>) | undefined {
  return async (prompt: string): Promise<string> => {
    const endpoint = store.get('localLlmEndpoint');
    if (!endpoint) throw new Error('no local LLM configured');
    const model = (store.get('localLlmModel') as string) || 'llama3.2';
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 30_000);
    try {
      const res = await fetch(`${endpoint}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${store.get('localLlmApiKey') || 'ollama'}` },
        body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], max_tokens: 500, temperature: 0.1 }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`compressor HTTP ${res.status}`);
      const data = await res.json() as any;
      const out = data.choices?.[0]?.message?.content;
      if (!out) throw new Error('empty compressor response');
      return out;
    } finally { clearTimeout(t); }
  };
}
const outputInterceptor = new OutputInterceptor({ maxTokens: 1500, llmCompressor: createCheapCompressor() });

/**
 * Context Compaction & Rehydration (Claude Code style): triggers at 60% of an
 * assumed 32k window; compresses old tool traffic into a State Block and
 * silently rehydrates the top hot-path files.
 */
const compressionEngine = new ContextCompressionEngine({
  tokenThreshold: Math.floor(0.60 * 32_768),
  hotWindowSize: 6,
});

function readWorkspaceFile(relPath: string): Promise<string | null> {
  return readFile(resolvePath(relPath), 'utf-8').catch(() => null);
}

/** PageRank repo map generator (AST-elided), cached per workspace */
function repoMap(): ReturnType<typeof getRepoMapGenerator> {
  return getRepoMapGenerator(getWorkspaceDir());
}

/**
 * UI bridge: called when the agent needs a permission decision.
 * Set by main.ts so requests reach the renderer over IPC.
 * Returns null when no UI is available (headless mode → auto-approve).
 */
let uiPermissionBridge: ((request: PermissionRequest) => Promise<PermissionResponse>) | null = null;

export function setPermissionUIBridge(bridge: (request: PermissionRequest) => Promise<PermissionResponse>): void {
  uiPermissionBridge = bridge;
}

/** Ask the user to approve an operation. Falls back sensibly in headless mode. */
async function requestUserPermission(toolName: string, args: Record<string, any>, signal?: AbortSignal): Promise<PermissionResponse> {
  if (!uiPermissionBridge || !permissionManager.requiresPermission(toolName, args)) {
    return { requestId: 'auto', action: 'approve' };
  }
  const request = buildPermissionRequest(toolName, args);
  const TIMEOUT_MS = 180_000;
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      uiPermissionBridge(request),
      new Promise<PermissionResponse>((resolve) => {
        timer = setTimeout(() => resolve({ requestId: request.id, action: 'deny' }), TIMEOUT_MS);
      }),
      ...(signal ? [new Promise<PermissionResponse>((resolve) => {
        signal.addEventListener('abort', () => resolve({ requestId: request.id, action: 'deny' }), { once: true });
      })] : []),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function buildPermissionRequest(toolName: string, args: Record<string, any>): PermissionRequest {
  const id = `perm_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
  let type: PermissionRequest['type'] = 'bash';
  let description = `Execute: ${toolName}`;
  if (toolName === 'run_command') { type = 'bash'; description = `Execute: ${args.command}`; }
  else if (toolName === 'write_file') { type = 'write'; description = `Write file: ${args.file_path}`; }
  else if (toolName === 'edit_file') { type = 'edit'; description = `Edit file: ${args.file_path}`; }
  return { id, timestamp: Date.now(), type, description, command: args.command, filePath: args.file_path };
}

// ============================================================================
// SYSTEM PROMPT — structured for API prompt caching
//
// LAYOUT RULE (critical for provider prompt caches):
//   1. STATIC band (top): identity, laws, tool protocol. Never interpolated.
//      Byte-identical across every request → cache prefix hit.
//   2. DYNAMIC band (bottom): workspace, commands, guardrails, repo map.
//      Session-specific → isolated at the tail so the static prefix stays
//      cacheable.
// ============================================================================

const SYSTEM_PROMPT_STATIC = `You are Michaelangelo, an expert AI coding agent: you work autonomously in a real codebase, using tools to read, search, plan, edit, and run — until the task is done.

## OPERATING LAWS
1. Do what was asked; nothing more. No unsolicited features, refactors, or comments.
2. Act through tools. Never paste code into chat without creating/editing files.
3. Understand before changing: consult the Repo Map, then read the exact code you will touch. Match existing style and libraries.
4. SURGICAL EDITS ONLY: modify existing files with edit_file (exact search/replace). write_file is for brand-new files ONLY. Full-file rewrites of existing files are FORBIDDEN — they truncate code.
5. edit_file requires old_string copied EXACTLY from the current file (re-read if unsure). Keep old_string minimal but unique.
6. PLAN FIRST for multi-step work: call create_plan before your first mutation. After user approval, execute steps in order and track them with todo_write.
7. If a command fails, READ the full error, fix, retry. Never end your turn on a broken build.
8. Verify before finishing: run the project's build/test/lint commands when they exist.
9. Finish with a short report: what changed, how it was verified.

## TOOL PROTOCOL
- list_files / glob_files / search_files — explore. read_file (line_range for big files) — read.
- create_plan — REQUIRED before first file mutation on non-trivial tasks. One plan at a time; the user must approve it.
- todo_write — maintain the checklist; exactly one item in_progress; mark completed immediately. You MUST continue to the next todo item — never stop after completing just one.
- write_file / edit_file — mutations. These pass through visual diff review; a DENIED review means: do not re-attempt the same edit.
- run_command — shell. Destructive system commands are blocked; other commands may require one-click user approval.
- web_search / web_fetch / web_lookup — current external information via DuckDuckGo (free, no key).
- browser_navigate / browser_screenshot / browser_get_content / browser_evaluate / browser_close — headless browser for visual analysis. Use after creating a UI to verify rendering.
- git_status / git_diff / git_stage / git_commit / git_branch / git_log — full git workflow. Stage changes, commit, create branches.
- code_symbols — extract function/class/interface/import/export declarations from a file. Use to understand structure before editing.
- diagnose_error — analyze error messages and stack traces. Reads the source file, shows context, suggests a fix.
- find_files — find files by name pattern (like the find command). Excludes node_modules, .git, dist.
- dispatch_agent — spawn an isolated read-only sub-agent for independent research; merge its summary.

## AGENTIC LOOP (CRITICAL — READ THIS BEFORE EVERY TOOL CALL)
You are in an AUTONOMOUS LOOP. You MUST keep calling tools until the task is 100% complete.

RULES:
1. After EVERY tool call, check the todo list. If items are pending, IMMEDIATELY call the next tool.
2. NEVER respond with plain text while todos remain pending. Always call a tool.
3. NEVER say "Done", "Finished", "Let me know", or stop working while tasks remain.
4. Chain your work: create file → install deps → run tests → fix errors → next file.
5. If a tool fails, analyze the error and retry with a fix. Never give up.
6. The ONLY acceptable time to stop is when ALL todos are completed AND the build/test passes.
7. After the last todo: run the project's test/build command to verify everything works.

## RESPONSE STYLE
Concise and technical. No apologies, no filler, no restating the task.`;

const SYSTEM_PROMPT_DYNAMIC_TEMPLATE = `
## ENVIRONMENT (session-specific)
Workspace root: {{WORKSPACE}} — file paths are relative to this unless absolute.
{{PROJECT_COMMANDS}}
{{PROJECT_INSTRUCTIONS}}
{{REPO_MAP}}
{{PROJECT_CONTEXT}}`;

function getSystemPrompt(projectContext: string = '', projectInfo?: any, repoMap?: string): string {
  const workspace = getWorkspaceDir();
  let dynamic = SYSTEM_PROMPT_DYNAMIC_TEMPLATE.replace('{{WORKSPACE}}', workspace);
  if (projectInfo) {
    const cmds: string[] = [];
    if (projectInfo.testCommand) cmds.push(`- Test: \`${projectInfo.testCommand}\``);
    if (projectInfo.buildCommand) cmds.push(`- Build: \`${projectInfo.buildCommand}\``);
    if (projectInfo.lintCommand) cmds.push(`- Lint: \`${projectInfo.lintCommand}\``);
    if (projectInfo.devCommand) cmds.push(`- Dev: \`${projectInfo.devCommand}\``);
    dynamic = dynamic.replace('{{PROJECT_COMMANDS}}', cmds.length > 0
      ? '\n### Verified project commands\n' + cmds.join('\n') : '');
  } else {
    dynamic = dynamic.replace('{{PROJECT_COMMANDS}}', '');
  }
  dynamic = dynamic.replace('{{PROJECT_INSTRUCTIONS}}', projectInfo?.instructions
    ? `\n### Project instructions (guardrails — follow strictly)\n${projectInfo.instructions}\n` : '');
  dynamic = dynamic.replace('{{REPO_MAP}}', repoMap
    ? `\n### Repo Map (PageRank-ranked, bodies elided with ⋮)\n${repoMap}\n` : '');
  dynamic = dynamic.replace('{{PROJECT_CONTEXT}}', projectContext ? '\n' + projectContext : '');
  // Load custom persona if set
  let persona = '';
  try {
    const personaFile = require('path').join(workspace, '.michaelangelo', 'persona.txt');
    if (require('fs').existsSync(personaFile)) {
      persona = '\n### Custom Persona\n' + require('fs').readFileSync(personaFile, 'utf-8') + '\n';
    }
  } catch { /* no persona */ }
  return SYSTEM_PROMPT_STATIC + persona + dynamic;
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

// Auto-format file after write/edit (best-effort, non-blocking)
async function autoFormatFile(filePath: string): Promise<void> {
  try {
    const fullPath = resolvePath(filePath);
    const ext = fullPath.split('.').pop()?.toLowerCase() || '';
    const ws = getWorkspaceDir();
    // Try prettier for JS/TS/CSS/HTML
    if (['js', 'jsx', 'ts', 'tsx', 'css', 'html', 'json', 'md'].includes(ext)) {
      const prettierPath = require('path').join(ws, 'node_modules/.bin/prettier');
      if (require('fs').existsSync(prettierPath)) {
        await execAsync(`"${prettierPath}" --write "${fullPath}"`, { cwd: ws, timeout: 10000 });
      }
    }
    // Try black for Python
    if (ext === 'py') {
      await execAsync(`python3 -m black "${fullPath}" 2>/dev/null || true`, { cwd: ws, timeout: 10000 });
    }
  } catch { /* auto-format is best-effort */ }
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

async function executeEditFile(args: { file_path: string; old_string: string; new_string: string }): Promise<ToolExecResult> {
  if (!args.file_path || args.old_string === undefined || args.new_string === undefined) {
    return { output: 'ERROR: file_path, old_string, and new_string are required' };
  }
  if (!isPathSafe(args.file_path)) {
    return { output: `ERROR: Path outside workspace: ${args.file_path}` };
  }
  try {
    const fullPath = resolvePath(args.file_path);
    let currentContent = '';
    try { currentContent = await readFile(fullPath, 'utf-8'); } catch { /* new file */ }
    if (!currentContent.includes(args.old_string)) {
      return { output: `ERROR: old_string not found in ${args.file_path}. The file may have changed — re-read it and try again.` };
    }
    const newContent = currentContent.replace(args.old_string, args.new_string);
    await writeFile(fullPath, newContent, 'utf-8');
    // Generate structured diff for the DiffViewer
    const diff = generateDiff(args.file_path, currentContent, newContent);
    return {
      output: `SUCCESS: Edited ${args.file_path} (+${diff.stats.additions} -${diff.stats.deletions})`,
      diff,
    };
  } catch (err: any) {
    return { output: `ERROR editing file: ${err.message}` };
  }
}

async function executeReadFile(args: { file_path: string; line_range?: string }): Promise<string> {
  if (!isPathSafe(args.file_path)) return `ERROR: Path outside workspace: ${args.file_path}`;
  try {
    let content = await readFile(resolvePath(args.file_path), 'utf-8');
    const totalLines = content.split('\n').length;
    // Line range support (e.g. "100-200")
    if (args.line_range) {
      const [startStr, endStr] = args.line_range.split('-');
      const start = parseInt(startStr, 10) || 1;
      const end = parseInt(endStr, 10) || totalLines;
      const lines = content.split('\n');
      const sliced = lines.slice(Math.max(0, start - 1), end);
      return `--- ${args.file_path} (lines ${start}-${Math.min(end, totalLines)} of ${totalLines}) ---\n${sliced.map((l, i) => `${start + i}: ${l}`).join('\n')}`;
    }
    if (content.length > 50000) content = content.substring(0, 50000) + '\n\n... [truncated]';
    return content || '(empty file)';
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

async function executeGlobFiles(args: { pattern: string }): Promise<string> {
  try {
    // Use rg to find files matching a glob pattern
    const { stdout } = await execAsync(`rg --files -g "${args.pattern}"`, {
      cwd: getWorkspaceDir(), timeout: 10000, maxBuffer: 1024 * 1024,
    });
    const files = stdout.trim().split('\n').filter(Boolean);
    const max = 50;
    if (files.length > max) return files.slice(0, max).join('\n') + `\n... [${files.length} total]`;
    return files.length > 0 ? files.join('\n') : 'No files match pattern';
  } catch (err: any) {
    // Fallback: use find command
    try {
      const { stdout } = await execAsync(
        `find . -name "${args.pattern.replace(/\*/g, '*')}" -type f | head -50`,
        { cwd: getWorkspaceDir(), timeout: 10000 },
      );
      return stdout.trim() || 'No files match pattern';
    } catch (err2: any) {
      return `ERROR: ${err2.message}`;
    }
  }
}

// ============================================================================
// WEB TOOLS — Give local LLMs internet access via the server
// ============================================================================

/**
 * Web Search via DuckDuckGo (free, no API key needed)
 * Returns top 5 results with titles, URLs, and snippets.
 */
async function executeWebSearch(args: { query: string; max_results?: number }): Promise<string> {
  try {
    const maxResults = Math.min(args.max_results || 5, 10);
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(args.query)}`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
      signal: AbortSignal.timeout(15000),
    });
    const html = await response.text();
    // Parse DuckDuckGo HTML results
    const results: string[] = [];
    const resultRegex = /<a[^>]+class="result__a"[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>[\s\S]*?<a[^>]+class="result__snippet"[^>]*>([^<]*(?:<[^>]+>[^<]*)*)<\/a>/g;
    let match: RegExpExecArray | null;
    while ((match = resultRegex.exec(html)) !== null && results.length < maxResults) {
      let href = match[1];
      // DuckDuckGo wraps URLs in redirects
      const uddg = href.match(/uddg=([^&]+)/);
      if (uddg) href = decodeURIComponent(uddg[1]);
      const title = match[2].replace(/<[^>]+>/g, '').trim();
      const snippet = match[3].replace(/<[^>]+>/g, '').trim();
      if (title && href.startsWith('http')) {
        results.push(`${results.length + 1}. **${title}**\n   ${href}\n   ${snippet}`);
      }
    }
    if (results.length === 0) {
      // Fallback: try simpler regex
      const simpleRegex = /<a[^>]+class="result__a"[^>]*>([^<]+)<\/a>/g;
      const urlRegex = /<a[^>]+class="result__url"[^>]*>([^<]+)<\/a>/g;
      const titles: string[] = [];
      const urls: string[] = [];
      while ((match = simpleRegex.exec(html)) !== null) titles.push(match[1].trim());
      while ((match = urlRegex.exec(html)) !== null) urls.push(match[1].trim());
      for (let i = 0; i < Math.min(titles.length, urls.length, maxResults); i++) {
        results.push(`${i + 1}. **${titles[i]}**\n   ${urls[i]}`);
      }
    }
    return results.length > 0
      ? `Search results for "${args.query}":\n\n${results.join('\n\n')}`
      : `No results found for "${args.query}"`;
  } catch (err: any) {
    return `ERROR: Web search failed: ${err.message}`;
  }
}

/**
 * Fetch a URL and return its content as text.
 * Strips HTML tags, scripts, and styles for readability.
 */
async function executeWebFetch(args: { url: string; max_chars?: number }): Promise<string> {
  try {
    const response = await fetch(args.url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
      },
      signal: AbortSignal.timeout(20000),
      redirect: 'follow',
    });
    if (!response.ok) return `ERROR: HTTP ${response.status} ${response.statusText}`;
    let html = await response.text();
    // Extract title
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim() : '';
    // Remove scripts, styles, nav, footer
    html = html.replace(/<script[\s\S]*?<\/script>/gi, '');
    html = html.replace(/<style[\s\S]*?<\/style>/gi, '');
    html = html.replace(/<nav[\s\S]*?<\/nav>/gi, '');
    html = html.replace(/<footer[\s\S]*?<\/footer>/gi, '');
    html = html.replace(/<header[\s\S]*?<\/header>/gi, '');
    // Convert common tags to text
    html = html.replace(/<br\s*\/?>/gi, '\n');
    html = html.replace(/<p[^>]*>/gi, '\n');
    html = html.replace(/<h[1-6][^>]*>/gi, '\n## ');
    html = html.replace(/<li[^>]*>/gi, '\n- ');
    // Remove remaining HTML tags
    html = html.replace(/<[^>]+>/g, '');
    // Decode entities
    html = html.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');
    // Clean whitespace
    html = html.replace(/\n{3,}/g, '\n\n').trim();
    const maxChars = args.max_chars || 8000;
    if (title) html = `# ${title}\n\n${html}`;
    if (html.length > maxChars) html = html.substring(0, maxChars) + '\n\n... [truncated]';
    return html || '(empty page)';
  } catch (err: any) {
    return `ERROR: Failed to fetch ${args.url}: ${err.message}`;
  }
}

/**
 * Quick web lookup — search and fetch the top result's content.
 * Combines web_search + web_fetch in one call for convenience.
 */
async function executeWebLookup(args: { query: string; max_chars?: number }): Promise<string> {
  try {
    // First, search
    const searchResult = await executeWebSearch({ query: args.query, max_results: 3 });
    if (searchResult.startsWith('ERROR') || searchResult.includes('No results')) {
      return searchResult;
    }
    // Extract the first URL
    const urlMatch = searchResult.match(/https?:\/\/[^\s\n]+/);
    if (!urlMatch) return `Found results but could not extract URL:\n${searchResult}`;
    // Fetch the first result
    const url = urlMatch[0];
    const content = await executeWebFetch({ url, max_chars: args.max_chars || 5000 });
    return `## Search: ${args.query}\n\n${searchResult}\n\n---\n\n## Content from ${url}\n\n${content}`;
  } catch (err: any) {
    return `ERROR: Web lookup failed: ${err.message}`;
  }
}

interface ToolExecResult { output: string; diff?: any; }

// ============================================================================
// GIT WORKFLOW TOOLS
// ============================================================================

async function executeGitStatus(_args: any): Promise<string> {
  const { stdout } = await execAsync('git status --short', { cwd: getWorkspaceDir(), timeout: 10000, maxBuffer: 1024 * 1024 });
  return stdout.trim() || 'Working tree clean — no changes.';
}

async function executeGitDiff(args: { file_path?: string }): Promise<string> {
  const cmd = args.file_path ? `git diff -- "${args.file_path}"` : 'git diff';
  const { stdout } = await execAsync(cmd, { cwd: getWorkspaceDir(), timeout: 15000, maxBuffer: 2 * 1024 * 1024 });
  return stdout.trim() || 'No changes staged.';
}

async function executeGitStage(args: { files: string[] }): Promise<string> {
  if (!args.files || args.files.length === 0) return 'ERROR: files array required';
  const cmd = `git add ${args.files.map(f => `"${f}"`).join(' ')}`;
  const { stdout, stderr } = await execAsync(cmd, { cwd: getWorkspaceDir(), timeout: 10000, maxBuffer: 1024 * 1024 });
  return `SUCCESS: Staged ${args.files.length} file(s).${stderr ? '\n' + stderr : ''}`;
}

async function executeGitCommit(args: { message: string }): Promise<string> {
  if (!args.message) return 'ERROR: message required';
  const { stdout, stderr } = await execAsync(`git commit -m "${args.message.replace(/"/g, '\"')}"`, { cwd: getWorkspaceDir(), timeout: 15000, maxBuffer: 1024 * 1024 });
  return `SUCCESS: ${stdout.trim()}${stderr ? '\n' + stderr : ''}`;
}

async function executeGitBranch(args: { name: string }): Promise<string> {
  if (!args.name) return 'ERROR: branch name required';
  const { stdout, stderr } = await execAsync(`git checkout -b "${args.name}"`, { cwd: getWorkspaceDir(), timeout: 10000, maxBuffer: 1024 * 1024 });
  return `SUCCESS: Created and switched to branch '${args.name}'.${stdout.trim()}${stderr ? '\n' + stderr : ''}`;
}

async function executeGitLog(args: { count?: number }): Promise<string> {
  const n = args.count || 10;
  const { stdout } = await execAsync(`git log --oneline -${n}`, { cwd: getWorkspaceDir(), timeout: 10000, maxBuffer: 1024 * 1024 });
  return stdout.trim() || 'No commits found.';
}

// ============================================================================
// AST CODE SYMBOLS TOOL
// ============================================================================

async function executeCodeSymbols(args: { file_path: string }): Promise<string> {
  if (!args.file_path) return 'ERROR: file_path required';
  const fullPath = resolvePath(args.file_path);
  let content: string;
  try { content = await readFile(fullPath, 'utf-8'); } catch { return `ERROR: File not found: ${args.file_path}`; }
  const lines = content.split('\n');
  const symbols: string[] = [];
  // Extract function/class/export declarations
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    // Function declarations
    const fnMatch = trimmed.match(/^(export\s+)?(async\s+)?function\s+(\w+)/);
    if (fnMatch) { symbols.push(`L${i + 1} function ${fnMatch[3]}${fnMatch[1] ? ' (exported)' : ''}`); continue; }
    // Arrow functions assigned to const/let/var
    const arrowMatch = trimmed.match(/^(export\s+)?(const|let|var)\s+(\w+)\s*=\s*(async\s+)?\(/);
    if (arrowMatch) { symbols.push(`L${i + 1} ${arrowMatch[2]} ${arrowMatch[3]}${arrowMatch[1] ? ' (exported)' : ''}`); continue; }
    // Class declarations
    const classMatch = trimmed.match(/^(export\s+)?(abstract\s+)?class\s+(\w+)/);
    if (classMatch) { symbols.push(`L${i + 1} class ${classMatch[3]}${classMatch[1] ? ' (exported)' : ''}`); continue; }
    // Interface/type declarations
    const ifaceMatch = trimmed.match(/^(export\s+)?(interface|type)\s+(\w+)/);
    if (ifaceMatch) { symbols.push(`L${i + 1} ${ifaceMatch[2]} ${ifaceMatch[3]}${ifaceMatch[1] ? ' (exported)' : ''}`); continue; }
    // Import statements
    const importMatch = trimmed.match(/^import\s+.*from\s+['"](.+)['"]/,);
    if (importMatch) { symbols.push(`L${i + 1} import from '${importMatch[1]}'`); continue; }
    // Export default
    if (trimmed.startsWith('export default')) { symbols.push(`L${i + 1} export default`); }
  }
  return symbols.length > 0 ? symbols.join('\n') : 'No symbols found (file may be empty or non-code).';
}

// ============================================================================
// ERROR DIAGNOSIS TOOL
// ============================================================================

async function executeDiagnoseError(args: { error_text: string; file_path?: string }): Promise<string> {
  if (!args.error_text) return 'ERROR: error_text required';
  const diag: string[] = [];
  diag.push('## Error Diagnosis');
  diag.push(`\n**Error:** ${args.error_text.substring(0, 500)}`);
  // Extract error type
  const typeMatch = args.error_text.match(/(TypeError|ReferenceError|SyntaxError|Error|ENOENT|EACCES|ModuleNotFoundError|ImportError|AttributeError|ValueError|RuntimeError|AssertionError)/i);
  if (typeMatch) diag.push(`**Type:** ${typeMatch[1]}`);
  // Extract file and line from stack trace
  const stackMatches = args.error_text.match(/(?:at|File ")(.+?)":?(\d+)?/g);
  if (stackMatches && stackMatches.length > 0) {
    diag.push('\n**Stack trace (relevant frames):**');
    for (const m of stackMatches.slice(0, 5)) diag.push(`  ${m.trim()}`);
  }
  // Try to read the referenced file
  const filePath = args.file_path || args.error_text.match(/(?:at|File ")(.+?\.\w+)/)?.[1];
  if (filePath && !filePath.includes('node_modules')) {
    try {
      const content = await readFile(resolvePath(filePath), 'utf-8');
      const lines = content.split('\n');
      const lineNum = parseInt(args.error_text.match(/:(\d+)/)?.[1] || '0', 10);
      if (lineNum > 0 && lineNum <= lines.length) {
        const start = Math.max(0, lineNum - 4);
        const end = Math.min(lines.length, lineNum + 3);
        diag.push(`\n**Source (${filePath}:${lineNum}):**`);
        for (let i = start; i < end; i++) {
          const marker = i + 1 === lineNum ? ' >> ' : '    ';
          diag.push(`${marker}${i + 1}: ${lines[i]}`);
        }
      }
    } catch { /* file not readable */ }
  }
  // Suggest fix based on error type
  diag.push('\n**Suggested fix:**');
  if (typeMatch) {
    switch (typeMatch[1].toLowerCase()) {
      case 'enoent': diag.push('  File or directory not found. Check the path and ensure parent directories exist.'); break;
      case 'eacces': diag.push('  Permission denied. Check file permissions.'); break;
      case 'typeerror': diag.push('  Wrong type used. Check if the variable is null/undefined or the wrong type.'); break;
      case 'referenceerror': diag.push('  Variable not defined. Check spelling and imports.'); break;
      case 'syntaxerror': diag.push('  Syntax error. Check for missing brackets, commas, or semicolons.'); break;
      default: diag.push(`  Review the error and check the referenced source code.`);
    }
  }
  return diag.join('\n');
}

// ============================================================================
// FIND FILES TOOL (enhanced directory listing)
// ============================================================================

async function executeFindFiles(args: { pattern?: string; dir?: string }): Promise<string> {
  const dir = args.dir ? resolvePath(args.dir) : getWorkspaceDir();
  const pattern = args.pattern || '*';
  try {
    const { stdout } = await execAsync(`find . -name "${pattern}" -not -path "*/node_modules/*" -not -path "*/.git/*" -not -path "*/dist/*" -not -path "*/.next/*" 2>/dev/null | head -100`, { cwd: dir, timeout: 10000, maxBuffer: 1024 * 1024 });
    return stdout.trim() || 'No files found.';
  } catch { return 'ERROR: find command failed'; }
}

function executeTodoWrite(sessionId: string, args: any): string {
  const todos: TodoItem[] = Array.isArray(args.todos) ? args.todos : [];
  const valid = todos.filter(t => t && typeof t.content === 'string' && ['pending', 'in_progress', 'completed'].includes(t.status));
  sessionTodos.set(sessionId, valid);
  return `SUCCESS: Todo list updated (${valid.length} items: ${valid.filter(t => t.status === 'completed').length} completed, ${valid.filter(t => t.status === 'in_progress').length} in progress)`;
}

/**
 * Execute a tool call with Claude Code-style permission gating.
 * Returns denied/timed-out results as tool errors so the model can adapt.
 */
async function executeToolWithPermissions(
  toolCall: ToolCall,
  sessionId: string,
  signal?: AbortSignal,
  onEvent?: (event: string, data: any) => void,
): Promise<ToolExecResult> {
  if (signal?.aborted) return { output: 'ABORTED: run was interrupted by the user' };

  // todo_write is handled locally — no permission needed
  if (toolCall.function.name === 'todo_write') {
    let args: any = {};
    try { args = JSON.parse(toolCall.function.arguments); } catch { /* ignore */ }
    const output = executeTodoWrite(sessionId, args);
    // Push the fresh checklist to the UI immediately
    onEvent?.('todos_updated', { todos: sessionTodos.get(sessionId) || [] });
    return { output };
  }

  let args: Record<string, any> = {};
  try { args = JSON.parse(toolCall.function.arguments); } catch { /* ignore */ }

  // Permission gate (run_command / write_file / edit_file)
  if (permissionManager.requiresPermission(toolCall.function.name, args)) {
    const description = buildPermissionRequest(toolCall.function.name, args).description;
    console.log(`[Permission] Requesting approval for ${toolCall.function.name}: ${description}`);
    onEvent?.('tool_permission', { tool: toolCall.function.name, description });
    const response = await requestUserPermission(toolCall.function.name, args, signal);
    if (response.action !== 'approve') {
      return { output: `DENIED: The user did not approve this operation (${description}). Continue without it or ask the user for guidance.` };
    }
    if (response.alwaysAllow) {
      permissionManager.markAlwaysAllowed(toolCall.function.name);
    }
  }

  return executeTool(toolCall);
}

async function executeTool(toolCall: ToolCall): Promise<ToolExecResult> {
  let args: any;
  try { args = JSON.parse(toolCall.function.arguments); } catch { return { output: `ERROR: Failed to parse tool arguments` }; }
  switch (toolCall.function.name) {
    case 'write_file': {
      const result = await executeWriteFile(args);
      // Auto-format after write
      autoFormatFile(args.file_path).catch(() => {});
      return { output: result };
    }
    case 'edit_file': {
      const result = await executeEditFile(args);
      // Auto-format after edit
      autoFormatFile(args.file_path).catch(() => {});
      return result;
    }
    case 'read_file': return { output: await executeReadFile(args) };
    case 'run_command': return { output: await executeRunCommand(args) };
    case 'list_files': return { output: await executeListFiles(args) };
    case 'search_files': return { output: await executeSearchFiles(args) };
    case 'glob_files': return { output: await executeGlobFiles(args) };
    case 'web_search': return { output: await executeWebSearch(args) };
    case 'web_fetch': return { output: await executeWebFetch(args) };
    case 'web_lookup': return { output: await executeWebLookup(args) };
    case 'git_status': return { output: await executeGitStatus(args) };
    case 'git_diff': return { output: await executeGitDiff(args) };
    case 'git_stage': return { output: await executeGitStage(args) };
    case 'git_commit': return { output: await executeGitCommit(args) };
    case 'git_branch': return { output: await executeGitBranch(args) };
    case 'git_log': return { output: await executeGitLog(args) };
    case 'code_symbols': return { output: await executeCodeSymbols(args) };
    case 'diagnose_error': return { output: await executeDiagnoseError(args) };
    case 'find_files': return { output: await executeFindFiles(args) };
    case 'browser_navigate':
    case 'browser_screenshot':
    case 'browser_get_content':
    case 'browser_get_styles':
    case 'browser_evaluate':
    case 'browser_wait':
    case 'browser_console': {
      const ctx = { sessionId: 'agentic', workspace: getWorkspaceDir(), model: '', messages: [], iteration: 0, maxIterations: 1, tools: new Map(), metadata: {} };
      const result = await BrowserSkill.execute(toolCall.function.name, args, ctx);
      return { output: result.output || result.error || '(no output)' };
    }
    case 'browser_close': {
      await BrowserSkill.execute('browser_close', args, { sessionId: 'agentic', workspace: getWorkspaceDir(), model: '', messages: [], iteration: 0, maxIterations: 1, tools: new Map(), metadata: {} });
      return { output: 'Browser closed.' };
    }
    default: return { output: `ERROR: Unknown tool "${toolCall.function.name}"` };
  }
}

// ============================================================================
// LLM CALL
// ============================================================================

async function callLLM(baseUrl: string, apiKey: string, authPrefix: string, model: string, messages: ChatMessage[], tools?: any[], signal?: AbortSignal): Promise<any> {
  const body: any = { model, messages, max_tokens: 8192, temperature: 0.3 };
  if (tools && tools.length > 0) { body.tools = tools; }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5 * 60 * 1000);
  const onExternalAbort = () => controller.abort();
  signal?.addEventListener('abort', onExternalAbort, { once: true });
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
  finally { signal?.removeEventListener('abort', onExternalAbort); }
}

// ============================================================================
// TEXT-BASED TOOL CALL PARSER (for NIM Llama models that output tool calls as text)
// ============================================================================

/**
 * Attempt to repair truncated/incomplete JSON by closing open braces, brackets, and strings.
 * Returns repaired string or null if unrepairable.
 */
function repairJson(str: string): string | null {
  let result = str.trim();
  // Remove trailing comma before closing brace
  result = result.replace(/,\s*$/, '');

  // Count open vs close braces/brackets
  let braces = 0, brackets = 0, inString = false, escape = false;
  for (const ch of result) {
    if (escape) { escape = false; continue; }
    if (ch === '\\') { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') braces++;
    if (ch === '}') braces--;
    if (ch === '[') brackets++;
    if (ch === ']') brackets--;
  }

  // If we're inside a string, close it
  if (inString) result += '"';
  // Close any unclosed arrays
  while (brackets > 0) { result += ']'; brackets--; }
  // Close any unclosed objects
  while (braces > 0) { result += '}'; braces--; }

  // Validate
  try {
    JSON.parse(result);
    return result;
  } catch {
    return null;
  }
}

function parseToolCallsFromText(content: string): ToolCall[] {
  const toolCalls: ToolCall[] = [];
  const toolNames = TOOL_DEFINITIONS.map(t => t.function.name);

  // Pattern 1: JSON object with name and parameters
  // e.g. {"name": "write_file", "parameters": {"file_path": "...", "content": "..."}}
  const jsonPattern = /\{\s*["']name["']\s*:\s*["']([\w_]+)["']\s*,\s*["']parameters["']\s*:\s*(\{[^}]*\}(?:\s*\{[^}]*\})*)/g;
  let match: RegExpExecArray | null;
  while ((match = jsonPattern.exec(content)) !== null) {
    const name = match[1];
    if (!toolNames.includes(name)) continue;
    try {
      // Find the complete JSON by looking for matching braces
      let braceDepth = 0;
      let endIdx = match.index;
      for (let i = match.index; i < content.length && i < match.index + 5000; i++) {
        if (content[i] === '{') braceDepth++;
        if (content[i] === '}') {
          braceDepth--;
          if (braceDepth === 0) { endIdx = i + 1; break; }
        }
      }
      let jsonStr = content.substring(match.index, endIdx);
      let parsed: any;
      try {
        parsed = JSON.parse(jsonStr);
      } catch {
        // Attempt JSON repair for truncated output
        const repaired = repairJson(jsonStr);
        if (repaired) {
          parsed = JSON.parse(repaired);
          console.log(`[TextParser] Repaired truncated JSON for tool: ${name}`);
        } else {
          console.warn(`[TextParser] Failed to parse or repair JSON for tool: ${name}`);
          continue;
        }
      }
      const params = parsed.parameters || parsed;
      toolCalls.push({
        id: `text_call_${Date.now()}_${toolCalls.length}`,
        type: 'function',
        function: { name, arguments: JSON.stringify(params) },
      });
    } catch (err: any) {
      console.warn(`[TextParser] Skipping malformed tool call: ${err.message}`);
    }
  }

  // Pattern 2: XML-style tool calls
  // e.g. <tool>write_file</tool><args>{...}</args>
  if (toolCalls.length === 0) {
    const xmlPattern = /<tool>([\w_]+)<\/tool>\s*<args>([\s\S]*?)<\/args>/g;
    while ((match = xmlPattern.exec(content)) !== null) {
      const name = match[1];
      if (!toolNames.includes(name)) continue;
      try {
        let argsStr = match[2];
        let parsed: any;
        try {
          parsed = JSON.parse(argsStr);
        } catch {
          const repaired = repairJson(argsStr);
          if (repaired) {
            parsed = JSON.parse(repaired);
          } else {
            continue;
          }
        }
        toolCalls.push({
          id: `text_call_${Date.now()}_${toolCalls.length}`,
          type: 'function',
          function: { name, arguments: JSON.stringify(parsed) },
        });
      } catch { /* skip */ }
    }
  }

  // Pattern 3: Markdown code fence tool calls
  // Looks for JSON objects inside triple-backtick code fences
  if (toolCalls.length === 0) {
    const fencePattern = /\x60\x60\x60(?:json)?\s*\n(\{[\s\S]*?\})\s*\n\x60\x60\x60/g;
    while ((match = fencePattern.exec(content)) !== null) {
      try {
        let jsonStr = match[1];
        let parsed: any;
        try {
          parsed = JSON.parse(jsonStr);
        } catch {
          const repaired = repairJson(jsonStr);
          if (repaired) { parsed = JSON.parse(repaired); } else { continue; }
        }
        const name = parsed.name;
        if (!toolNames.includes(name)) continue;
        const params = parsed.parameters || parsed;
        toolCalls.push({
          id: `text_call_${Date.now()}_${toolCalls.length}`,
          type: 'function',
          function: { name, arguments: JSON.stringify(params) },
        });
      } catch { /* skip */ }
    }
  }

  return toolCalls;
}

// ============================================================================
// STREAMING LLM CALL
// ============================================================================

interface StreamCallbacks {
  onToken?: (token: string) => void;
  onThinking?: (token: string) => void;
  onToolCall?: (toolCall: ToolCall) => void;
  onComplete?: (usage: { prompt: number; completion: number }) => void;
}

async function callLLMStream(
  baseUrl: string, apiKey: string, authPrefix: string, model: string,
  messages: ChatMessage[], tools: any[] | undefined, callbacks: StreamCallbacks, signal?: AbortSignal,
): Promise<{ content: string; reasoning: string; toolCalls: ToolCall[]; usage: { prompt: number; completion: number } }> {
  const body: any = { model, messages, max_tokens: 8192, temperature: 0.3, stream: true };
  if (tools && tools.length > 0) { body.tools = tools; }
  // Enable parallel tool calls for providers that support it (not NIM Llama)
  if (tools && tools.length > 0 && !model.includes('llama')) {
    body.parallel_tool_calls = true;
    body.tool_choice = 'auto';
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5 * 60 * 1000);
  const onExternalAbort = () => controller.abort();
  signal?.addEventListener('abort', onExternalAbort, { once: true });

  let fullContent = '';
  let fullReasoning = '';
  const toolCallsMap: Record<number, { id: string; name: string; arguments: string }> = {};
  let usage = { prompt: 0, completion: 0 };

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `${authPrefix}${apiKey}` },
      body: JSON.stringify(body), signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) throw new Error(`API ${response.status}: ${await response.text().catch(() => '')}`);
    if (!response.body) throw new Error('No response body');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // Process complete SSE lines
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // Keep incomplete line in buffer

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') continue;

        try {
          const parsed = JSON.parse(data);
          const choice = parsed.choices?.[0];
          if (!choice) continue;

          const delta = choice.delta;

          // Content tokens
          if (delta?.content) {
            fullContent += delta.content;
            callbacks.onToken?.(delta.content);
          }

          // Reasoning/thinking tokens (OpenRouter, Qwen, etc.)
          if (delta?.reasoning_content || delta?.reasoning) {
            const reasoning = delta.reasoning_content || delta.reasoning;
            fullReasoning += reasoning;
            callbacks.onThinking?.(reasoning);
          }

          // Tool calls (streamed in chunks)
          if (delta?.tool_calls) {
            for (const tc of delta.tool_calls) {
              const idx = tc.index || 0;
              if (!toolCallsMap[idx]) {
                toolCallsMap[idx] = { id: tc.id || `call_${Date.now()}_${idx}`, name: '', arguments: '' };
              }
              if (tc.id) toolCallsMap[idx].id = tc.id;
              if (tc.function?.name) toolCallsMap[idx].name = tc.function.name;
              if (tc.function?.arguments) toolCallsMap[idx].arguments += tc.function.arguments;
            }
          }

          // Usage (usually in the last chunk)
          if (parsed.usage) {
            usage = { prompt: parsed.usage.prompt_tokens || 0, completion: parsed.usage.completion_tokens || 0 };
          }
        } catch { /* skip malformed JSON */ }
      }
    }

    // Emit tool calls as complete objects
    let toolCalls: ToolCall[] = Object.values(toolCallsMap).map(tc => ({
      id: tc.id, type: 'function' as const,
      function: { name: tc.name, arguments: tc.arguments },
    }));

    // FALLBACK: Parse tool calls from content text (NIM Llama outputs tool calls as text)
    if (toolCalls.length === 0 && fullContent) {
      toolCalls = parseToolCallsFromText(fullContent);
    }

    for (const tc of toolCalls) {
      callbacks.onToolCall?.(tc);
    }

    callbacks.onComplete?.(usage);
    return { content: fullContent, reasoning: fullReasoning, toolCalls, usage };
  } catch (err: any) {
    clearTimeout(timeout);
    throw err;
  }
  finally { signal?.removeEventListener('abort', onExternalAbort); }
}

// ============================================================================
// STREAMING AGENTIC LOOP (real-time SSE emission, abortable)
// ============================================================================

interface StreamingRunResult {
  content: string;
  iterations: number;
  totalToolCalls: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  aborted: boolean;
}

async function runStreamingAgent(
  baseUrl: string, apiKey: string, authPrefix: string, model: string, provider: string,
  userMessages: ChatMessage[], conversationId: string | undefined, sessionId: string,
  sendEvent: (event: string, data: any) => void,
  signal: AbortSignal,
): Promise<StreamingRunResult> {
  const projectInfo = projectDetector ? await projectDetector.detect() : null;
  const projectContext = projectInfo?.instructions || '';
  const messages: ChatMessage[] = [
    { role: 'system', content: getSystemPrompt(projectContext, projectInfo) },
    ...userMessages,
  ];

  // Restore any todos from a previous turn of this session
  const existingTodos = sessionTodos.get(sessionId);
  if (existingTodos?.length) {
    sendEvent('todos_updated', { todos: existingTodos });
  }

  sendEvent('agent_start', {
    model, provider,
    prompt: userMessages.filter(m => m.role === 'user').pop()?.content?.substring(0, 200) || '',
  });

  let iterations = 0;
  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;
  let lastContent = '';

  while (iterations < MAX_ITERATIONS && !signal.aborted) {
    iterations++;
    sendEvent('iteration_start', { iteration: iterations, maxIterations: MAX_ITERATIONS });
    sendEvent('llm_call', { iteration: iterations, model, toolCount: TOOL_DEFINITIONS.length });

    // Progress injection: remind the agent of remaining work every 3 iterations
    const currentTodos = sessionTodos.get(sessionId) || [];
    const pendingTodos = currentTodos.filter(t => t.status === 'pending');
    const completedTodos = currentTodos.filter(t => t.status === 'completed');
    if (iterations > 1 && iterations % 3 === 0 && pendingTodos.length > 0) {
      const progressMsg = `[System Progress: ${completedTodos.length}/${currentTodos.length} tasks done. ${pendingTodos.length} remaining: ${pendingTodos.map(t => t.content).join('; ')}]`;
      messages.push({ role: 'system', content: progressMsg });
    }

    // Stream tokens to the client AS THEY ARRIVE (Claude Code-style live output)
    let usage = { prompt: 0, completion: 0 };
    let result;
    try {
      result = await callLLMStream(baseUrl, apiKey, authPrefix, model, messages, TOOL_DEFINITIONS, {
        onToken: (token) => sendEvent('token_delta', { content: token, iteration: iterations }),
        onThinking: (token) => sendEvent('thinking_delta', { content: token, iteration: iterations }),
        onComplete: (u) => { usage = u; },
      }, signal);
    } catch (err: any) {
      if (signal.aborted || err.name === 'AbortError') break; // interrupted mid-generation
      throw err;
    }

    const { content: streamContent, toolCalls: streamToolCalls } = result;
    usage = result.usage;
    lastContent = streamContent;

    totalPromptTokens += usage.prompt;
    totalCompletionTokens += usage.completion;
    sendEvent('token_usage', {
      iteration: iterations,
      prompt: usage.prompt, completion: usage.completion,
      totalPrompt: totalPromptTokens, totalCompletion: totalCompletionTokens,
    });

    messages.push({
      role: 'assistant',
      content: streamContent,
      tool_calls: streamToolCalls.length > 0 ? streamToolCalls : undefined,
    });

    // No tool calls — check if we should auto-continue or exit
    if (streamToolCalls.length === 0 || signal.aborted) {
      console.log(`[Agent-Stream] No tool calls. Iter: ${iterations}, Content len: ${streamContent.length}, Aborted: ${signal.aborted}`);
      console.log(`[Agent-Stream] Last 200 chars: ${streamContent.substring(streamContent.length - 200)}`);

      // AUTO-CONTINUE: if there are pending todos, re-prompt the model
      const currentTodos = sessionTodos.get(sessionId) || [];
      const pendingTodos = currentTodos.filter(t => t.status === 'pending');
      if (pendingTodos.length > 0 && !signal.aborted && iterations < MAX_ITERATIONS) {
        console.log(`[Agent-Stream] ${pendingTodos.length} todos remain — auto-continuing`);
        const todoSummary = pendingTodos.map((t, i) => `${i + 1}. ${t.content}`).join('\n');
        messages.push({
          role: 'system',
          content: `[System: You stopped but ${pendingTodos.length} tasks remain unfinished. You MUST continue now. Remaining tasks:\n${todoSummary}\nPick the next pending task and execute it with a tool call. Do NOT respond with text — call a tool.]`,
        });
        sendEvent('token_delta', { content: `\n\n⏳ Continuing — ${pendingTodos.length} tasks remaining...\n`, iteration: iterations });
        continue; // loop back to call LLM again
      }
      break;
    }

    // Execute tool calls sequentially with permission gating
    for (const toolCall of streamToolCalls) {
      if (signal.aborted) break;
      let args: any = {};
      try { args = JSON.parse(toolCall.function.arguments); } catch { /* ignore */ }
      sendEvent('tool_start', { tool: toolCall.function.name, args, iteration: iterations });
      console.log(`[Agent-Stream] Tool: ${toolCall.function.name}`);

      const started = Date.now();
      const toolExecResult = await executeToolWithPermissions(toolCall, sessionId, signal, sendEvent);
      const toolResult = toolExecResult.output;
      const isSuccess = !toolResult.startsWith('ERROR') && !toolResult.startsWith('DENIED');
      sendEvent('tool_complete', {
        tool: toolCall.function.name, success: isSuccess,
        outputPreview: toolResult.substring(0, 300), iteration: iterations,
        duration_ms: Date.now() - started,
        ...(toolExecResult.diff ? { diff: toolExecResult.diff } : {}),
      });

      // If the tool failed, inject a recovery message so the agent retries
      if (!isSuccess) {
        console.log(`[Agent-Stream] Tool ${toolCall.function.name} failed: ${toolResult.substring(0, 100)}`);
        messages.push({
          role: 'system',
          content: `[System: The tool call failed. Do NOT give up. Analyze the error, fix the issue, and retry with a corrected approach. Error: ${toolResult.substring(0, 300)}]`,
        });
      }

      messages.push({ role: 'tool', content: toolResult, tool_call_id: toolCall.id });
      // Save tool execution to conversation
      if (conversationId && conversationStore) {
        await conversationStore.addMessage(conversationId, {
          id: `tool_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
          role: 'tool', content: toolResult, timestamp: Date.now(),
        });
      }
    }

    // Context compression in streaming loop
    try {
      const compressed = await compressionEngine.maybeCompress(messages);
      if (compressed) {
        console.log(`[StreamingAgent] Context compressed: ${compressed.stats.messagesCompressed} messages`);
        sendEvent('context_compression', compressed.stats);
      }
    } catch { /* compression is best-effort */ }
  }


  // Max iterations reached (not aborted) — force a final summary
  let aborted = signal.aborted;
  if (!aborted && iterations >= MAX_ITERATIONS) {
    messages.push({ role: 'system', content: `[System: Max iterations (${MAX_ITERATIONS}) reached. Give your final answer now.]` });
    try {
      const final = await callLLMStream(baseUrl, apiKey, authPrefix, model, messages, undefined, {
        onToken: (token) => sendEvent('token_delta', { content: token, iteration: iterations }),
      }, signal);
      lastContent = final.content || lastContent;
      messages.push({ role: 'assistant', content: lastContent });
    } catch (err: any) {
      if (signal.aborted || err.name === 'AbortError') aborted = true;
      else throw err;
    }
  }

  const finalTodos = sessionTodos.get(sessionId) || [];
  sendEvent('agent_end', {
    iterations,
    totalToolCalls: messages.filter(m => m.role === 'tool').length,
    totalPromptTokens, totalCompletionTokens,
    conversationId, sessionId, aborted,
    todos: finalTodos,
  });

  return {
    content: lastContent,
    iterations,
    totalToolCalls: messages.filter(m => m.role === 'tool').length,
    totalPromptTokens,
    totalCompletionTokens,
    aborted,
  };
}

// ============================================================================
// AGENTIC LOOP
// ============================================================================

const TOOL_DEFINITIONS = [
  { type: 'function', function: { name: 'list_files', description: 'List files and directories in a path. Use to explore the project structure.', parameters: { type: 'object', properties: { dir_path: { type: 'string', description: 'Directory path relative to workspace (default: workspace root)' } }, required: [] } } },
  { type: 'function', function: { name: 'read_file', description: 'Read file contents. Supports line_range for large files.', parameters: { type: 'object', properties: { file_path: { type: 'string' }, line_range: { type: 'string', description: 'Optional line range, e.g. "100-200"' } }, required: ['file_path'] } } },
  { type: 'function', function: { name: 'write_file', description: 'Write content to a file. Creates parent dirs automatically. Use for NEW files only.', parameters: { type: 'object', properties: { file_path: { type: 'string', description: 'Path relative to workspace' }, content: { type: 'string', description: 'Full file content' } }, required: ['file_path', 'content'] } } },
  { type: 'function', function: { name: 'edit_file', description: 'Edit a file by replacing exact text. Provide the old_string to find and new_string to replace it with. ALWAYS use this instead of write_file for modifying existing files.', parameters: { type: 'object', properties: { file_path: { type: 'string', description: 'Path relative to workspace' }, old_string: { type: 'string', description: 'The EXACT text to find (must match exactly)' }, new_string: { type: 'string', description: 'The replacement text' } }, required: ['file_path', 'old_string', 'new_string'] } } },
  { type: 'function', function: { name: 'search_files', description: 'Search for a pattern across files using regex. Returns matching lines with file paths and line numbers.', parameters: { type: 'object', properties: { pattern: { type: 'string', description: 'Regex pattern to search for' }, file_pattern: { type: 'string', description: 'Optional file glob, e.g. "*.ts"' } }, required: ['pattern'] } } },
  { type: 'function', function: { name: 'glob_files', description: 'Find files matching a glob pattern. Use to discover files by name.', parameters: { type: 'object', properties: { pattern: { type: 'string', description: 'Glob pattern, e.g. "**/*.ts", "src/**/*.test.js"' } }, required: ['pattern'] } } },
  { type: 'function', function: { name: 'run_command', description: 'Execute a shell command. Use for builds, tests, git, and any CLI operations.', parameters: { type: 'object', properties: { command: { type: 'string', description: 'The shell command to execute' }, cwd: { type: 'string', description: 'Optional working directory (default: workspace)' } }, required: ['command'] } } },
  { type: 'function', function: { name: 'web_search', description: 'Search the internet using DuckDuckGo. Returns top results with titles, URLs, and snippets. Use when you need current information, documentation, or solutions.', parameters: { type: 'object', properties: { query: { type: 'string', description: 'Search query' }, max_results: { type: 'number', description: 'Max results (default 5, max 10)' } }, required: ['query'] } } },
  { type: 'function', function: { name: 'web_fetch', description: 'Fetch a URL and return its content as readable text. Strips HTML for clean output.', parameters: { type: 'object', properties: { url: { type: 'string', description: 'URL to fetch' }, max_chars: { type: 'number', description: 'Max characters (default 8000)' } }, required: ['url'] } } },
  { type: 'function', function: { name: 'web_lookup', description: 'Search and fetch the top result. Combines web_search + web_fetch for quick lookups.', parameters: { type: 'object', properties: { query: { type: 'string', description: 'What to look up' }, max_chars: { type: 'number', description: 'Max characters for content' } }, required: ['query'] } } },
  {
    type: 'function',
    function: {
      name: 'todo_write',
      description: 'Write the task checklist for the current task. Use for any task with 3+ distinct steps. Replace the entire list each call; keep exactly one item in_progress; mark items completed immediately when done.',
      parameters: {
        type: 'object',
        properties: {
          todos: {
            type: 'array',
            description: 'The full todo list (replaces previous state)',
            items: {
              type: 'object',
              properties: {
                content: { type: 'string', description: 'Short imperative description of the step' },
                status: { type: 'string', enum: ['pending', 'in_progress', 'completed'], description: 'Item status' },
              },
              required: ['content', 'status'],
            },
          },
        },
        required: ['todos'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_plan',
      description: 'Create a structured execution plan (Architect mode). REQUIRED before your first file mutation on non-trivial tasks. The GUI pauses and asks the user to approve. Steps must be concrete and ordered by dependency.',
      parameters: {
        type: 'object',
        properties: {
          goal: { type: 'string', description: 'One-sentence statement of what the plan achieves' },
          reasoning: { type: 'string', description: 'Why this approach was chosen (1-3 sentences)' },
          steps: {
            type: 'array',
            description: 'Ordered, concrete steps',
            items: {
              type: 'object',
              properties: {
                description: { type: 'string', description: 'What will be done' },
                tool: { type: 'string', description: 'Primary tool for the step (edit_file, write_file, run_command, ...)' },
                target: { type: 'string', description: 'Target file path or command' },
              },
              required: ['description', 'tool'],
            },
          },
        },
        required: ['goal', 'steps'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'dispatch_agent',
      description: 'Spawn an isolated read-only sub-agent with its own context window for independent research (codebase analysis, multi-file investigation). Returns its summary. Does not block on user.',
      parameters: {
        type: 'object',
        properties: {
          description: { type: 'string', description: 'Brief task description' },
          prompt: { type: 'string', description: 'Detailed instructions for the sub-agent' },
        },
        required: ['description', 'prompt'],
      },
    },
  },
  { type: 'function', function: { name: 'browser_navigate', description: 'Navigate the headless browser to a URL. Use to open localhost dev servers or webpages for visual analysis.', parameters: { type: 'object', properties: { url: { type: 'string', description: 'URL to navigate to (e.g., http://localhost:3000)' }, wait_until: { type: 'string', description: 'When to consider loaded: load, networkidle, domcontentloaded (default: load)' } }, required: ['url'] } } },
  { type: 'function', function: { name: 'browser_screenshot', description: 'Take a screenshot of the current page. Returns the file path for visual analysis of rendered UI.', parameters: { type: 'object', properties: { filename: { type: 'string', description: 'Filename for the screenshot (default: auto-generated)' }, full_page: { type: 'boolean', description: 'Capture full scrollable page (default: viewport only)' }, selector: { type: 'string', description: 'CSS selector to screenshot a specific element' } }, required: [] } } },
  { type: 'function', function: { name: 'browser_get_content', description: 'Get the text content of the current page or a specific element.', parameters: { type: 'object', properties: { selector: { type: 'string', description: 'CSS selector (default: entire page)' }, max_length: { type: 'number', description: 'Max characters (default 5000)' } }, required: [] } } },
  { type: 'function', function: { name: 'browser_evaluate', description: 'Evaluate JavaScript in the page context. Useful for querying DOM state, checking element counts, measuring sizes.', parameters: { type: 'object', properties: { expression: { type: 'string', description: 'JavaScript expression to evaluate' } }, required: ['expression'] } } },
  { type: 'function', function: { name: 'browser_close', description: 'Close the headless browser. Call when done with visual analysis.', parameters: { type: 'object', properties: {}, required: [] } } },
  { type: 'function', function: { name: 'git_status', description: 'Show the working tree status. Use before committing to see what changed.', parameters: { type: 'object', properties: {}, required: [] } } },
  { type: 'function', function: { name: 'git_diff', description: 'Show file changes not yet staged. Pass file_path for a specific file.', parameters: { type: 'object', properties: { file_path: { type: 'string', description: 'Optional specific file to diff' } }, required: [] } } },
  { type: 'function', function: { name: 'git_stage', description: 'Stage files for commit using git add.', parameters: { type: 'object', properties: { files: { type: 'array', items: { type: 'string' }, description: 'Array of file paths to stage' } }, required: ['files'] } } },
  { type: 'function', function: { name: 'git_commit', description: 'Commit staged changes with a message. Stage files first with git_stage.', parameters: { type: 'object', properties: { message: { type: 'string', description: 'Commit message' } }, required: ['message'] } } },
  { type: 'function', function: { name: 'git_branch', description: 'Create and switch to a new branch.', parameters: { type: 'object', properties: { name: { type: 'string', description: 'Branch name' } }, required: ['name'] } } },
  { type: 'function', function: { name: 'git_log', description: 'Show recent commit history.', parameters: { type: 'object', properties: { count: { type: 'number', description: 'Number of commits to show (default 10)' } }, required: [] } } },
  { type: 'function', function: { name: 'code_symbols', description: 'Extract all symbols (functions, classes, interfaces, imports, exports) from a file. Use to understand file structure without reading the full content.', parameters: { type: 'object', properties: { file_path: { type: 'string', description: 'Path to the file to analyze' } }, required: ['file_path'] } } },
  { type: 'function', function: { name: 'diagnose_error', description: 'Analyze an error message or stack trace. Reads the referenced file, shows the error context, and suggests a fix.', parameters: { type: 'object', properties: { error_text: { type: 'string', description: 'The full error message or stack trace' }, file_path: { type: 'string', description: 'Optional file path where the error occurred' } }, required: ['error_text'] } } },
  { type: 'function', function: { name: 'find_files', description: 'Find files by name pattern (like find command). Excludes node_modules, .git, dist.', parameters: { type: 'object', properties: { pattern: { type: 'string', description: 'Filename pattern, e.g. "*.test.ts", "config.*"' }, dir: { type: 'string', description: 'Directory to search in (default: workspace root)' } }, required: [] } } },
];

async function agenticLoop(baseUrl: string, apiKey: string, authPrefix: string, model: string, provider: string, userMessages: ChatMessage[], conversationId?: string): Promise<{ messages: ChatMessage[]; iterations: number; tokenUsage: { prompt: number; completion: number } }> {
  const session = `session_${Date.now()}`;
  const projectInfo = projectDetector ? await projectDetector.detect() : null;
  const projectContext = projectInfo?.instructions || '';
  const messages: ChatMessage[] = [
    { role: 'system', content: getSystemPrompt(projectContext, projectInfo) },
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

    let assistantMsg = choice.message;

    // FALLBACK: Parse tool calls from content text (NIM Llama outputs tool calls as text)
    let toolCalls = assistantMsg.tool_calls;
    if ((!toolCalls || toolCalls.length === 0) && assistantMsg.content) {
      const parsed = parseToolCallsFromText(assistantMsg.content);
      if (parsed.length > 0) {
        console.log(`[Agent] Parsed ${parsed.length} tool calls from text content`);
        toolCalls = parsed;
      }
    }

    messages.push({ role: 'assistant', content: assistantMsg.content, tool_calls: toolCalls });

    if (!toolCalls || toolCalls.length === 0) {
      console.log(`[Agent] Completed after ${iterations} iterations`);
      agentEventBus.emit('agent_end', session, { iterations, totalToolCalls: messages.filter(m => m.role === 'tool').length, totalPromptTokens, totalCompletionTokens });
      return { messages, iterations, tokenUsage: { prompt: totalPromptTokens, completion: totalCompletionTokens } };
    }

    for (const toolCall of toolCalls!) {
      console.log(`[Agent] Tool: ${toolCall.function.name}`);
      let args: any = {};
      try { args = JSON.parse(toolCall.function.arguments); } catch { /* ignore */ }
      agentEventBus.emit('tool_start', session, {
        tool: toolCall.function.name, args, iteration: iterations,
      });

      const execResult = await executeToolWithPermissions(toolCall, session);
      const result = execResult.output;
      const isSuccess = !result.startsWith('ERROR');
      agentEventBus.emit('tool_complete', session, {
        tool: toolCall.function.name, success: isSuccess,
        outputPreview: result.substring(0, 300), iteration: iterations,
        ...(execResult.diff ? { diff: execResult.diff } : {}),
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

    // Context compression: if context is too large, compress older messages
    try {
      const compressed = await compressionEngine.maybeCompress(messages);
      if (compressed) {
        console.log(`[Agent] Context compressed: ${compressed.stats.messagesCompressed} messages, ${compressed.stats.totalTokensBefore} -> ${compressed.stats.totalTokensAfter} tokens`);
        agentEventBus.emit('context_compression', session, compressed.stats);
      }
    } catch (err: any) {
      console.warn('[Agent] Context compression failed:', err.message);
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
  // POST /api/agent/stream — Streaming agent endpoint (SSE, abortable)
  // ==========================================================================
  app.post('/api/agent/stream', async (req: Request, res: Response) => {
    const { model, messages, provider: ep, conversationId, sessionId: clientSessionId } = req.body;
    if (!model || !messages) return res.status(400).json({ error: 'model and messages required' });

    const pk = (ep && ep !== 'auto' && PROVIDERS[ep]) ? ep : detectProvider(model);
    const provider = PROVIDERS[pk];
    const apiKey = provider.getApiKey();
    if (!apiKey) return res.status(400).json({ error: `No API key for ${pk}` });
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'messages required' });
    }

    // Set up SSE headers (MUST be before flushHeaders)
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    // Disable TCP buffering so events are sent immediately
    if (req.socket) req.socket.setNoDelay(true);
    res.flushHeaders();

    let clientDisconnected = false;
    const sessionId = clientSessionId || `sess_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`;
    const abortController = new AbortController();
    activeRuns.set(sessionId, abortController);

    const finishRun = () => { activeRuns.delete(sessionId); };
    res.on('close', () => {
      clientDisconnected = true;
      // Client gone (window closed / fetch aborted) — stop the agent too
      activeRuns.delete(sessionId);
      if (!abortController.signal.aborted) abortController.abort();
    });

    const sendEvent = (event: string, data: any) => {
      if (clientDisconnected || res.writableEnded) return;
      try {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        if (typeof (res as any).flush === 'function') (res as any).flush();
      } catch { clientDisconnected = true; }
    };

    let convId = conversationId;
    try {
      // Slash command parity with /api/agent — handle meta commands before streaming
      let workMessages: ChatMessage[] = messages;
      const lastUserMsg = messages.filter((m: any) => m.role === 'user').pop();
      if (lastUserMsg?.content?.startsWith('/')) {
        slashHandler.setModel(model, pk);
        const result = await slashHandler.execute(lastUserMsg.content);
        if (result.meta) {
          if (result.action === 'clear') {
            sendEvent('token_delta', { content: result.response, iteration: 0 });
            sendEvent('session', { conversationId: null, model, provider: pk, sessionId, slashAction: 'clear' });
            sendEvent('done', {});
            finishRun();
            res.write('', () => { res.end(); });
            return;
          }
          if (result.action === 'load_session') {
            const conv = conversationStore.get(result.payload);
            sendEvent('session', { conversationId: conv?.id || null, model, provider: pk, sessionId, slashAction: 'load_session', conversation: conv });
            sendEvent('token_delta', { content: result.response, iteration: 0 });
            sendEvent('done', {});
            finishRun();
            res.write('', () => { res.end(); });
            return;
          }
          sendEvent('token_delta', { content: result.response, iteration: 0 });
          sendEvent('done', {});
          finishRun();
          res.write('', () => { res.end(); });
          return;
        }
        // Non-meta command — forward expanded prompt to the agent
        workMessages = [...messages];
        workMessages[workMessages.length - 1] = { role: 'user', content: result.response };
      }

      // Create conversation
      if (!convId) {
        const conv = await conversationStore.create(
          messages.filter((m: any) => m.role === 'user').pop()?.content?.substring(0, 80) || 'New conversation',
          model, pk, getWorkspaceDir(),
        );
        convId = conv.id;
      }

      // Save user message
      const lastUserMsg2 = messages.filter((m: any) => m.role === 'user').pop();
      await conversationStore.addMessage(convId, {
        id: `msg_${Date.now()}`, role: 'user',
        content: lastUserMsg2?.content || '', timestamp: Date.now(),
      });

      sendEvent('session', { conversationId: convId, model, provider: pk, sessionId });

      // Run the streaming agentic loop
      const runResult = await runStreamingAgent(
        getBaseUrl(provider), apiKey, provider.authPrefix, model, pk, workMessages, convId,
        sessionId, sendEvent, abortController.signal,
      );

      // Record per-run token usage
      const runUsage = tokenTracker.record(runResult.totalPromptTokens, runResult.totalCompletionTokens, model, pk);

      // Save final assistant message
      if (runResult.content) {
        await conversationStore.addMessage(convId, {
          id: `msg_${Date.now()}`, role: 'assistant', content: runResult.content, timestamp: Date.now(),
          tokens: { prompt: runResult.totalPromptTokens, completion: runResult.totalCompletionTokens, total: runResult.totalPromptTokens + runResult.totalCompletionTokens },
          cost: runUsage.estimatedCost,
        });
      }
      sendEvent('metadata', {
        iterations: runResult.iterations, totalToolCalls: runResult.totalToolCalls,
        tokens: { prompt: runResult.totalPromptTokens, completion: runResult.totalCompletionTokens },
        cost: runUsage.estimatedCost, conversationId: convId,
        aborted: runResult.aborted,
      });

      sendEvent('done', {});
    } catch (err: any) {
      console.error('[Agent-Stream] Error:', err.message);
      sendEvent('error', { message: err.message });
      sendEvent('done', {});
    } finally {
      finishRun();
    }

    // Wait for the last write to flush before ending
    res.write('', () => { res.end(); });
  });

  // ==========================================================================
  // POST /api/agent/abort — Interrupt a running agent session (Esc / Stop)
  // ==========================================================================
  app.post('/api/agent/abort', async (req: Request, res: Response) => {
    const { sessionId } = req.body || {};
    if (!sessionId) return res.status(400).json({ error: 'sessionId required' });
    const controller = activeRuns.get(sessionId);
    if (controller && !controller.signal.aborted) {
      controller.abort();
      console.log(`[Agent-Stream] Aborted session ${sessionId}`);
      return res.json({ success: true, aborted: true });
    }
    return res.json({ success: true, aborted: false });
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
      const c = new AbortController(); const t = setTimeout(() => c.abort(), pk === 'local_llm' ? 120000 : 30000);
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
  // POST /api/diff-preview — Generate a diff preview for edit_file
  // ==========================================================================
  app.post('/api/diff-preview', async (req: Request, res: Response) => {
    const { file_path, old_string, new_string } = req.body;
    if (!file_path || old_string === undefined || new_string === undefined) {
      return res.status(400).json({ error: 'file_path, old_string, and new_string required' });
    }
    if (!isPathSafe(file_path)) {
      return res.status(403).json({ error: 'Path outside workspace' });
    }
    try {
      const fullPath = resolvePath(file_path);
      let currentContent = '';
      try { currentContent = await readFile(fullPath, 'utf-8'); } catch { /* new file */ }
      if (!currentContent.includes(old_string)) {
        return res.json({ error: 'old_string not found in file', diff: null });
      }
      const newContent = currentContent.replace(old_string, new_string);
      const diff = generateDiff(file_path, currentContent, newContent);
      res.json({ diff });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ==========================================================================
  // POST /api/apply-edit — Apply an edit and return the diff
  // ==========================================================================
  app.post('/api/apply-edit', async (req: Request, res: Response) => {
    const { file_path, old_string, new_string } = req.body;
    if (!file_path || old_string === undefined || new_string === undefined) {
      return res.status(400).json({ error: 'file_path, old_string, and new_string required' });
    }
    if (!isPathSafe(file_path)) {
      return res.status(403).json({ error: 'Path outside workspace' });
    }
    try {
      const fullPath = resolvePath(file_path);
      const currentContent = await readFile(fullPath, 'utf-8');
      if (!currentContent.includes(old_string)) {
        return res.json({ success: false, error: 'old_string not found' });
      }
      const newContent = currentContent.replace(old_string, new_string);
      const diff = generateDiff(file_path, currentContent, newContent);
      await writeFile(fullPath, newContent, 'utf-8');
      res.json({ success: true, diff });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ==========================================================================
  // Plugin Marketplace API
  // ==========================================================================
  const { getPluginRegistry } = require('./agent/plugins/registry');
  const pluginRegistry = getPluginRegistry();

  app.get('/api/plugins', (_req: Request, res: Response) => {
    const query = _req.query.q as string;
    const category = _req.query.category as string;
    let plugins = pluginRegistry.getAll();
    if (query) plugins = pluginRegistry.search(query);
    else if (category && category !== 'all') plugins = pluginRegistry.getByCategory(category);
    res.json({ plugins, stats: pluginRegistry.getStats() });
  });

  app.post('/api/plugins/install', (req: Request, res: Response) => {
    const { pluginId } = req.body;
    if (!pluginId) return res.status(400).json({ error: 'pluginId required' });
    const success = pluginRegistry.install(pluginId);
    res.json({ success });
  });

  app.post('/api/plugins/uninstall', (req: Request, res: Response) => {
    const { pluginId } = req.body;
    if (!pluginId) return res.status(400).json({ error: 'pluginId required' });
    const success = pluginRegistry.uninstall(pluginId);
    res.json({ success });
  });

  app.post('/api/plugins/toggle', (req: Request, res: Response) => {
    const { pluginId } = req.body;
    if (!pluginId) return res.status(400).json({ error: 'pluginId required' });
    const success = pluginRegistry.toggle(pluginId);
    res.json({ success });
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
  // POST /api/compare — Run prompt on multiple models
  // ==========================================================================
  app.post('/api/compare', async (req: Request, res: Response) => {
    const { prompt, models: modelList } = req.body;
    if (!prompt || !modelList || !Array.isArray(modelList)) return res.status(400).json({ error: 'prompt and models array required' });
    const results: Array<{ model: string; response: string; time_ms: number; tokens: number }> = [];
    await Promise.allSettled(modelList.map(async (m: any) => {
      const pk = (m.provider && PROVIDERS[m.provider]) ? m.provider : detectProvider(m.id);
      const provider = PROVIDERS[pk];
      const apiKey = provider.getApiKey();
      if (!apiKey) { results.push({ model: m.id, response: `No API key for ${pk}`, time_ms: 0, tokens: 0 }); return; }
      const start = Date.now();
      try {
        const c = new AbortController(); const t = setTimeout(() => c.abort(), 60000);
        const r = await fetch(`${getBaseUrl(provider)}/chat/completions`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `${provider.authPrefix}${apiKey}` },
          body: JSON.stringify({ model: m.id, messages: [{ role: 'user', content: prompt }], max_tokens: 2048, temperature: 0.3 }),
          signal: c.signal,
        });
        clearTimeout(t);
        const data = await r.json() as any;
        results.push({ model: m.id, response: data.choices?.[0]?.message?.content || 'No response', time_ms: Date.now() - start, tokens: data.usage?.total_tokens || 0 });
      } catch (err: any) { results.push({ model: m.id, response: `Error: ${err.message}`, time_ms: Date.now() - start, tokens: 0 }); }
    }));
    results.sort((a, b) => a.time_ms - b.time_ms);
    res.json({ results });
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
