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
// SYSTEM PROMPT
// ============================================================================

const SYSTEM_PROMPT = `You are Michaelangelo, an autonomous AI coding assistant. You write code, create files, run commands, and build software — just like Claude Code.

## RULES
- ALWAYS use tools to do the work. Never output code blocks, markdown, or plans without executing them.
- When the user asks you to create something, actually create the files using write_file.
- When the user asks you to modify something, read the file first, then use edit_file with the exact text to replace.
- After making changes, verify by running the relevant command (build, test, lint).
- If something fails, read the error output, fix it, and try again.
- Be thorough — complete the entire task before stopping.

## HOW TO WORK
1. **Explore** the workspace first: list_files to see what exists, search_files to find relevant code.
2. **Read** the files you need to understand or modify: read_file.
3. **Create/Edit** files: write_file for new files, edit_file for modifications.
4. **Run** commands: npm install, npm test, npm run build, git commands, etc.
5. **Verify** your work: check the output, read the files you changed.

## TOOLS
- list_files: explore directories
- read_file: read file contents (supports line_range for large files)
- write_file: create new files (creates parent dirs automatically)
- edit_file: modify existing files (search and replace exact text)
- search_files: find code patterns with regex
- glob_files: find files by name pattern
- run_command: execute shell commands

## WORKSPACE
Your workspace is: {{WORKSPACE}}
{{PROJECT_COMMANDS}}
{{PROJECT_CONTEXT}}`;

function getSystemPrompt(projectContext: string = '', projectInfo?: any): string {
  const workspace = getWorkspaceDir();
  let prompt = SYSTEM_PROMPT.replace('{{WORKSPACE}}', workspace);
  // Inject project commands if available
  if (projectInfo) {
    const cmds: string[] = [];
    if (projectInfo.testCommand) cmds.push(`- Test: \`${projectInfo.testCommand}\``);
    if (projectInfo.buildCommand) cmds.push(`- Build: \`${projectInfo.buildCommand}\``);
    if (projectInfo.lintCommand) cmds.push(`- Lint: \`${projectInfo.lintCommand}\``);
    if (projectInfo.devCommand) cmds.push(`- Dev: \`${projectInfo.devCommand}\``);
    if (cmds.length > 0) {
      prompt = prompt.replace('{{PROJECT_COMMANDS}}', '\n## Project Commands\nUse these commands to verify your work:\n' + cmds.join('\n'));
    } else {
      prompt = prompt.replace('{{PROJECT_COMMANDS}}', '');
    }
  } else {
    prompt = prompt.replace('{{PROJECT_COMMANDS}}', '');
  }
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

async function executeTool(toolCall: ToolCall): Promise<ToolExecResult> {
  let args: any;
  try { args = JSON.parse(toolCall.function.arguments); } catch { return { output: `ERROR: Failed to parse tool arguments` }; }
  switch (toolCall.function.name) {
    case 'write_file': return { output: await executeWriteFile(args) };
    case 'edit_file': return await executeEditFile(args);
    case 'read_file': return { output: await executeReadFile(args) };
    case 'run_command': return { output: await executeRunCommand(args) };
    case 'list_files': return { output: await executeListFiles(args) };
    case 'search_files': return { output: await executeSearchFiles(args) };
    case 'glob_files': return { output: await executeGlobFiles(args) };
    case 'web_search': return { output: await executeWebSearch(args) };
    case 'web_fetch': return { output: await executeWebFetch(args) };
    case 'web_lookup': return { output: await executeWebLookup(args) };
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
    default: return { output: `ERROR: Unknown tool "${toolCall.function.name}"` };
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
  onToolCall?: (toolCall: ToolCall) => void;
  onComplete?: (usage: { prompt: number; completion: number }) => void;
}

async function callLLMStream(
  baseUrl: string, apiKey: string, authPrefix: string, model: string,
  messages: ChatMessage[], tools: any[] | undefined, callbacks: StreamCallbacks,
): Promise<{ content: string; toolCalls: ToolCall[]; usage: { prompt: number; completion: number } }> {
  const body: any = { model, messages, max_tokens: 4096, temperature: 0.3, stream: true };
  if (tools && tools.length > 0) { body.tools = tools; }
  // Enable parallel tool calls for providers that support it (not NIM Llama)
  if (tools && tools.length > 0 && !model.includes('llama')) {
    body.parallel_tool_calls = true;
    body.tool_choice = 'auto';
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5 * 60 * 1000);

  let fullContent = '';
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
    return { content: fullContent, toolCalls, usage };
  } catch (err: any) {
    clearTimeout(timeout);
    throw err;
  }
}

// ============================================================================
// STREAMING AGENTIC LOOP (SSE generator)
// ============================================================================

async function* agenticLoopStream(
  baseUrl: string, apiKey: string, authPrefix: string, model: string, provider: string,
  userMessages: ChatMessage[], conversationId?: string,
): AsyncGenerator<{ event: string; data: any }> {
  const session = `session_${Date.now()}`;
  const projectInfo = projectDetector ? await projectDetector.detect() : null;
  const projectContext = projectInfo?.instructions || '';
  const messages: ChatMessage[] = [
    { role: 'system', content: getSystemPrompt(projectContext, projectInfo) },
    ...userMessages,
  ];

  yield { event: 'agent_start', data: {
    model, provider,
    prompt: userMessages.filter(m => m.role === 'user').pop()?.content?.substring(0, 200) || '',
  }};

  let iterations = 0;
  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;
  let conversationIdOut = conversationId;

  while (iterations < MAX_ITERATIONS) {
    iterations++;
    yield { event: 'iteration_start', data: { iteration: iterations, maxIterations: MAX_ITERATIONS } };
    yield { event: 'llm_call', data: { iteration: iterations, model } };

    // Stream the LLM response
    let streamContent = '';
    let streamToolCalls: ToolCall[] = [];
    let usage = { prompt: 0, completion: 0 };

    const result = await callLLMStream(baseUrl, apiKey, authPrefix, model, messages, TOOL_DEFINITIONS, {
      onToken: (token) => {
        streamContent += token;
        // We can't yield from a callback, so we store and will emit after
      },
      onToolCall: (tc) => { streamToolCalls.push(tc); },
      onComplete: (u) => { usage = u; },
    });

    streamContent = result.content;
    streamToolCalls = result.toolCalls;
    usage = result.usage;

    // Now yield the accumulated tokens as a single event
    if (streamContent) {
      yield { event: 'token_stream', data: { content: streamContent, iteration: iterations } };
    }

    // Track token usage
    totalPromptTokens += usage.prompt;
    totalCompletionTokens += usage.completion;
    yield { event: 'token_usage', data: {
      iteration: iterations,
      prompt: usage.prompt, completion: usage.completion,
      totalPrompt: totalPromptTokens, totalCompletion: totalCompletionTokens,
    }};

    // Push assistant message to context
    messages.push({ role: 'assistant', content: streamContent, tool_calls: streamToolCalls.length > 0 ? streamToolCalls : undefined });

    // No tool calls — agent is done
    if (streamToolCalls.length === 0) {
      console.log(`[Agent-Stream] Completed after ${iterations} iterations`);
      yield { event: 'agent_end', data: {
        iterations, totalToolCalls: messages.filter(m => m.role === 'tool').length,
        totalPromptTokens, totalCompletionTokens, conversationId: conversationIdOut,
      }};
      return;
    }

    // Execute tool calls
    for (const toolCall of streamToolCalls) {
      let args: any = {};
      try { args = JSON.parse(toolCall.function.arguments); } catch { /* ignore */ }
      yield { event: 'tool_start', data: { tool: toolCall.function.name, args, iteration: iterations } };

      const toolExecResult = await executeTool(toolCall);
      const toolResult = toolExecResult.output;
      const isSuccess = !toolResult.startsWith('ERROR');
      yield { event: 'tool_complete', data: {
        tool: toolCall.function.name, success: isSuccess,
        outputPreview: toolResult.substring(0, 300), iteration: iterations,
        ...(toolExecResult.diff ? { diff: toolExecResult.diff } : {}),
      }};

      messages.push({ role: 'tool', content: toolResult, tool_call_id: toolCall.id });

      // Save tool execution to conversation
      if (conversationIdOut && conversationStore) {
        await conversationStore.addMessage(conversationIdOut, {
          id: `tool_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
          role: 'tool', content: toolResult, timestamp: Date.now(),
        });
      }
    }
  }

  // Hit limit — get final summary
  messages.push({ role: 'system', content: `[System: Max iterations (${MAX_ITERATIONS}) reached. Give final answer.]` });
  const finalResponse = await callLLM(baseUrl, apiKey, authPrefix, model, messages);
  if (finalResponse.choices?.[0]?.message) {
    messages.push({ role: 'assistant', content: finalResponse.choices[0].message.content });
    yield { event: 'token_stream', data: { content: finalResponse.choices[0].message.content, iteration: iterations } };
  }

  yield { event: 'agent_end', data: {
    iterations, totalToolCalls: messages.filter(m => m.role === 'tool').length,
    totalPromptTokens, totalCompletionTokens, conversationId: conversationIdOut,
  }};
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

      const execResult = await executeTool(toolCall);
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
  // POST /api/agent/stream — Streaming agent endpoint (SSE)
  // ==========================================================================
  app.post('/api/agent/stream', async (req: Request, res: Response) => {
    const { model, messages, provider: ep, conversationId } = req.body;
    if (!model || !messages) return res.status(400).json({ error: 'model and messages required' });

    const pk = (ep && ep !== 'auto' && PROVIDERS[ep]) ? ep : detectProvider(model);
    const provider = PROVIDERS[pk];
    const apiKey = provider.getApiKey();
    if (!apiKey) return res.status(400).json({ error: `No API key for ${pk}` });

    // Set up SSE headers (MUST be before flushHeaders)
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    // Disable TCP buffering so events are sent immediately
    if (req.socket) req.socket.setNoDelay(true);
    res.flushHeaders();

    let clientDisconnected = false;
    res.on('close', () => { clientDisconnected = true; });

    const sendEvent = (event: string, data: any) => {
      if (clientDisconnected || res.writableEnded) return;
      try {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        if (typeof (res as any).flush === 'function') (res as any).flush();
      } catch { clientDisconnected = true; }
    };

    let convId = conversationId;
    try {
      // Create conversation
      if (!convId) {
        const conv = await conversationStore.create(
          messages.filter((m: any) => m.role === 'user').pop()?.content?.substring(0, 80) || 'New conversation',
          model, pk, getWorkspaceDir(),
        );
        convId = conv.id;
      }

      // Save user message
      const lastUserMsg = messages.filter((m: any) => m.role === 'user').pop();
      await conversationStore.addMessage(convId, {
        id: `msg_${Date.now()}`, role: 'user',
        content: lastUserMsg?.content || '', timestamp: Date.now(),
      });

      sendEvent('session', { conversationId: convId, model, provider: pk });

      // Run the streaming agentic loop
      let finalContent = '';
      let finalIterations = 0;
      let finalToolCalls = 0;
      let totalPromptTokens = 0;
      let totalCompletionTokens = 0;

      for await (const evt of agenticLoopStream(
        getBaseUrl(provider), apiKey, provider.authPrefix, model, pk, messages, convId,
      )) {
        sendEvent(evt.event, evt.data);

        // Track final results
        if (evt.event === 'agent_end') {
          finalIterations = evt.data.iterations;
          finalToolCalls = evt.data.totalToolCalls;
          totalPromptTokens = evt.data.totalPromptTokens;
          totalCompletionTokens = evt.data.totalCompletionTokens;
        }
        if (evt.event === 'token_stream') {
          finalContent = evt.data.content;
        }
      }

      // Save final assistant message
      if (finalContent) {
        const usage = tokenTracker.record(totalPromptTokens, totalCompletionTokens, model, pk);
        await conversationStore.addMessage(convId, {
          id: `msg_${Date.now()}`, role: 'assistant', content: finalContent, timestamp: Date.now(),
          tokens: { prompt: totalPromptTokens, completion: totalCompletionTokens, total: totalPromptTokens + totalCompletionTokens },
          cost: usage.estimatedCost,
        });
        sendEvent('metadata', {
          iterations: finalIterations, totalToolCalls: finalToolCalls,
          tokens: { prompt: totalPromptTokens, completion: totalCompletionTokens },
          cost: usage.estimatedCost, conversationId: convId,
        });
      }

      sendEvent('done', {});
    } catch (err: any) {
      sendEvent('error', { message: err.message });
    }

    // Wait for the last write to flush before ending
    res.write('', () => { res.end(); });
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
