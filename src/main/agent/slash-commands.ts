/**
 * Michaelangelo - Slash Command System
 *
 * Claude Code-style commands that users type in the chat:
 *   /compact  — Compress context, summarize tool outputs
 *   /clear    — Clear conversation history
 *   /help     — Show available commands
 *   /cost     — Show token usage and cost estimates
 *   /memory   — Show/ manage persistent memory
 *   /config   — Show current configuration
 *   /model    — Switch active model
 *   /export   — Export conversation as markdown
 *   /review   — Review code in workspace
 *   /test     — Run tests in workspace
 *   /fix      — Find and fix issues
 *   /build    — Build the project
 *   /init     — Initialize project instructions (.michaelangelo.md)
 */

import { ConversationStore, Conversation } from '../conversations';
import { readFile, writeFile, access } from 'fs/promises';
import { join } from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// ============================================================================
// TYPES
// ============================================================================

export interface SlashCommand {
  name: string;
  description: string;
  usage: string;
  category: 'session' | 'project' | 'agent' | 'info';
}

export interface SlashCommandResult {
  /** Response text to show in chat */
  response: string;
  /** Whether this is a meta-command (doesn't send to LLM) */
  meta: boolean;
  /** Optional action to perform */
  action?: 'clear' | 'compact' | 'switch_model' | 'export' | 'new_session' | 'load_session';
  /** Action payload */
  payload?: any;
}

// ============================================================================
// COMMAND DEFINITIONS
// ============================================================================

export const SLASH_COMMANDS: SlashCommand[] = [
  // Session management
  { name: '/compact', description: 'Compress conversation context to save tokens', usage: '/compact', category: 'session' },
  { name: '/clear', description: 'Clear conversation and start fresh', usage: '/clear', category: 'session' },
  { name: '/export', description: 'Export conversation as markdown', usage: '/export [filename]', category: 'session' },
  { name: '/cost', description: 'Show token usage and cost estimates', usage: '/cost', category: 'session' },
  { name: '/sessions', description: 'List recent conversations', usage: '/sessions [search]', category: 'session' },
  { name: '/resume', description: 'Resume a previous conversation', usage: '/resume <session-id>', category: 'session' },

  // Project
  { name: '/init', description: 'Initialize project instructions file (.michaelangelo.md)', usage: '/init', category: 'project' },
  { name: '/config', description: 'Show current model, workspace, and settings', usage: '/config', category: 'project' },
  { name: '/memory', description: 'Show or search persistent memory', usage: '/memory [search-query]', category: 'project' },

  // Agent
  { name: '/model', description: 'Switch the active model', usage: '/model <model-id>', category: 'agent' },
  { name: '/review', description: 'Review code in workspace for issues', usage: '/review [file-or-dir]', category: 'agent' },
  { name: '/test', description: 'Run the project test suite', usage: '/test', category: 'agent' },
  { name: '/fix', description: 'Find and fix issues in the codebase', usage: '/fix [description]', category: 'agent' },
  { name: '/build', description: 'Build the project', usage: '/build', category: 'agent' },

  // Permissions
  { name: '/approve', description: 'Approve the pending tool call', usage: '/approve [always]', category: 'agent' },
  { name: '/deny', description: 'Deny the pending tool call', usage: '/deny', category: 'agent' },
  { name: '/run', description: 'Run inline code snippet (JS, Python, Bash)', usage: '/run <code>', category: 'agent' },
  { name: '/commit', description: 'Auto-stage and commit all changes', usage: '/commit [message]', category: 'agent' },
  { name: '/branch', description: 'Create and switch to a new git branch', usage: '/branch <name>', category: 'agent' },
  { name: '/template', description: 'Scaffold a project from a template', usage: '/template <react|nextjs|express|python|vanilla>', category: 'agent' },
  { name: '/lang', description: 'Detect project language and set up tooling', usage: '/lang', category: 'project' },
  { name: '/compare', description: 'Run same prompt on multiple models and compare', usage: '/compare <prompt>', category: 'agent' },
  { name: '/explain', description: 'Explain code line by line', usage: '/explain <file>', category: 'agent' },
  { name: '/deps', description: 'Analyze dependencies and find all usages of a symbol', usage: '/deps <function-or-import>', category: 'agent' },
  { name: '/test-gen', description: 'Auto-generate tests for a file', usage: '/test-gen <file>', category: 'agent' },
  { name: '/format', description: 'Auto-format all files with prettier/black', usage: '/format [file]', category: 'agent' },
  { name: '/persona', description: 'Set custom system prompt for the agent', usage: '/persona <prompt>', category: 'project' },

  // Info
  { name: '/help', description: 'Show all available commands', usage: '/help', category: 'info' },
];

// ============================================================================
// COMMAND HANDLER
// ============================================================================

export class SlashCommandHandler {
  private conversationStore: ConversationStore;
  private workspace: string;
  private currentModel: string = '';
  private currentProvider: string = '';

  constructor(conversationStore: ConversationStore, workspace: string) {
    this.conversationStore = conversationStore;
    this.workspace = workspace;
  }

  setModel(model: string, provider: string): void {
    this.currentModel = model;
    this.currentProvider = provider;
  }

  /** Check if input is a slash command */
  isCommand(input: string): boolean {
    return input.trim().startsWith('/');
  }

  /** Parse the command and arguments */
  parse(input: string): { command: string; args: string } {
    const trimmed = input.trim();
    const parts = trimmed.split(/\s+/);
    const command = parts[0].toLowerCase();
    const args = parts.slice(1).join(' ');
    return { command, args };
  }

  /** Execute a slash command */
  async execute(input: string): Promise<SlashCommandResult> {
    const { command, args } = this.parse(input);

    switch (command) {
      case '/help': return this.cmdHelp();
      case '/compact': return this.cmdCompact();
      case '/clear': return this.cmdClear();
      case '/cost': return this.cmdCost();
      case '/config': return this.cmdConfig();
      case '/memory': return this.cmdMemory(args);
      case '/export': return this.cmdExport(args);
      case '/sessions': return this.cmdSessions(args);
      case '/model': return this.cmdModel(args);
      case '/init': return this.cmdInit();
      case '/review': return this.cmdReview(args);
      case '/test': return this.cmdTest();
      case '/fix': return this.cmdFix(args);
      case '/build': return this.cmdBuild();
      case '/resume': return this.cmdResume(args);
      case '/run': return this.cmdRun(args);
      case '/commit': return this.cmdCommit(args);
      case '/branch': return this.cmdBranch(args);
      case '/template': return this.cmdTemplate(args);
      case '/lang': return this.cmdLang();
      case '/compare': return this.cmdCompare(args);
      case '/explain': return this.cmdExplain(args);
      case '/deps': return this.cmdDeps(args);
      case '/test-gen': return this.cmdTestGen(args);
      case '/format': return this.cmdFormat(args);
      case '/persona': return this.cmdPersona(args);
      default:
        return {
          response: `Unknown command: ${command}\nType /help to see available commands.`,
          meta: true,
        };
    }
  }

  // ==========================================================================
  // COMMAND IMPLEMENTATIONS
  // ==========================================================================

  private cmdHelp(): SlashCommandResult {
    const categories = ['session', 'project', 'agent', 'info'] as const;
    const lines: string[] = ['## Available Commands\n'];

    for (const cat of categories) {
      const cmds = SLASH_COMMANDS.filter(c => c.category === cat);
      if (cmds.length === 0) continue;
      lines.push(`### ${cat.charAt(0).toUpperCase() + cat.slice(1)}`);
      for (const cmd of cmds) {
        lines.push(`  \`${cmd.usage}\` — ${cmd.description}`);
      }
      lines.push('');
    }

    return { response: lines.join('\n'), meta: true };
  }

  private cmdCompact(): SlashCommandResult {
    return {
      response: 'Context compressed. Conversation history summarized to save tokens.',
      meta: true,
      action: 'compact',
    };
  }

  private cmdClear(): SlashCommandResult {
    return {
      response: 'Conversation cleared. Starting fresh.',
      meta: true,
      action: 'clear',
    };
  }

  private cmdCost(): SlashCommandResult {
    const conv = this.conversationStore.getActive();
    if (!conv) {
      return { response: 'No active conversation.', meta: true };
    }

    const stats = this.conversationStore.getStats();
    const sessionTokens = conv.totalTokens;
    const sessionCost = conv.totalCost;
    const toolCalls = conv.toolCallCount;
    const messages = conv.messages.length;

    const lines = [
      '## Session Usage',
      `- **Messages:** ${messages}`,
      `- **Tool calls:** ${toolCalls}`,
      `- **Tokens:** ${sessionTokens.toLocaleString()}`,
      `- **Estimated cost:** $${sessionCost.toFixed(4)}`,
      '',
      '## All-time Usage',
      `- **Conversations:** ${stats.totalConversations}`,
      `- **Total tokens:** ${stats.totalTokens.toLocaleString()}`,
      `- **Total cost:** $${stats.totalCost.toFixed(4)}`,
      `- **Total tool calls:** ${stats.totalToolCalls}`,
    ];

    return { response: lines.join('\n'), meta: true };
  }

  private cmdConfig(): SlashCommandResult {
    const lines = [
      '## Current Configuration',
      `- **Model:** ${this.currentModel || 'None'}`,
      `- **Provider:** ${this.currentProvider || 'None'}`,
      `- **Workspace:** ${this.workspace || 'None'}`,
      '',
      '## Active Session',
      `ID: ${this.conversationStore.getActive()?.id || 'None'}`,
      `Messages: ${this.conversationStore.getActive()?.messages.length || 0}`,
    ];

    return { response: lines.join('\n'), meta: true };
  }

  private async cmdMemory(query: string): Promise<SlashCommandResult> {
    const memoryFile = join(this.workspace, '.michaelangelo', 'memory', 'entries.json');
    try {
      const content = await readFile(memoryFile, 'utf-8');
      const entries = JSON.parse(content) as Array<{ content: string; type: string; timestamp: number }>;

      if (!query) {
        const recent = entries.slice(-10);
        const lines = [
          `## Memory (${entries.length} entries total)`,
          '',
          ...recent.map((e, i) => `${i + 1}. [${e.type}] ${e.content.substring(0, 120)}`),
        ];
        return { response: lines.join('\n'), meta: true };
      }

      // Search memory
      const q = query.toLowerCase();
      const matches = entries.filter(e => e.content.toLowerCase().includes(q));
      if (matches.length === 0) {
        return { response: `No memory entries match "${query}"`, meta: true };
      }

      const lines = [
        `## Memory Search: "${query}" (${matches.length} results)`,
        '',
        ...matches.slice(0, 10).map((e, i) => `${i + 1}. [${e.type}] ${e.content.substring(0, 200)}`),
      ];
      return { response: lines.join('\n'), meta: true };
    } catch {
      return { response: 'No memory entries found. Memory is built automatically during conversations.', meta: true };
    }
  }

  private async cmdExport(filename: string): Promise<SlashCommandResult> {
    const conv = this.conversationStore.getActive();
    if (!conv) {
      return { response: 'No active conversation to export.', meta: true };
    }

    const markdown = this.conversationStore.exportMarkdown(conv.id);
    if (!markdown) {
      return { response: 'Failed to export conversation.', meta: true };
    }

    const exportFile = filename
      ? join(this.workspace, filename.endsWith('.md') ? filename : `${filename}.md`)
      : join(this.workspace, `michaelangelo-export-${Date.now()}.md`);

    try {
      await writeFile(exportFile, markdown, 'utf-8');
      return {
        response: `Conversation exported to: ${exportFile}`,
        meta: true,
        action: 'export',
        payload: exportFile,
      };
    } catch (err: any) {
      return { response: `Export failed: ${err.message}`, meta: true };
    }
  }

  private async cmdSessions(query: string): Promise<SlashCommandResult> {
    const sessions = query
      ? this.conversationStore.search(query)
      : this.conversationStore.list(10);

    if (sessions.length === 0) {
      return { response: query ? `No sessions match "${query}"` : 'No conversations yet.', meta: true };
    }

    const lines = [
      `## Recent Conversations (${sessions.length})`,
      '',
      ...sessions.map((s, i) => {
        const date = new Date(s.updatedAt).toLocaleDateString();
        const cost = s.totalCost > 0 ? ` $${s.totalCost.toFixed(4)}` : '';
        return `${i + 1}. **${s.title}**\n   ${date} | ${s.messageCount} msgs | ${s.toolCallCount} tools | ${s.totalTokens.toLocaleString()} tokens${cost}\n   ID: \`${s.id}\``;
      }),
      '',
      'Use `/resume <session-id>` to continue a conversation.',
    ];

    return { response: lines.join('\n'), meta: true };
  }

  private cmdModel(modelId: string): SlashCommandResult {
    if (!modelId) {
      return {
        response: `Current model: ${this.currentModel || 'None'}\nUsage: /model <model-id>`,
        meta: true,
      };
    }

    return {
      response: `Model switched to: ${modelId}`,
      meta: true,
      action: 'switch_model',
      payload: modelId,
    };
  }

  private async cmdInit(): Promise<SlashCommandResult> {
    const instructionsFile = join(this.workspace, '.michaelangelo.md');

    try {
      await access(instructionsFile);
      return {
        response: '.michaelangelo.md already exists. Edit it to customize project instructions.',
        meta: true,
      };
    } catch {
      // File doesn't exist — create it
      const template = `# Project Instructions for Michaelangelo

## Overview
<!-- Describe what this project does -->

## Tech Stack
<!-- List the main technologies: TypeScript, React, Node.js, etc. -->

## Build & Run
<!-- How to install, build, and run the project -->
- Install: \`npm install\`
- Build: \`npm run build\`
- Test: \`npm test\`
- Dev: \`npm run dev\`

## Code Style
<!-- Coding conventions and preferences -->
- Use TypeScript strict mode
- Prefer functional components over class components
- Use named exports

## Architecture
<!-- High-level architecture notes -->

## Important Notes
<!-- Any special instructions for the AI assistant -->
`;

      await writeFile(instructionsFile, template, 'utf-8');
      return {
        response: `Created .michaelangelo.md in workspace.\nEdit it to add project-specific instructions that Michaelangelo will read at the start of every conversation.`,
        meta: true,
      };
    }
  }

  private cmdReview(fileOrDir: string): SlashCommandResult {
    const target = fileOrDir || '.';
    return {
      response: `[REVIEW] Analyzing code in: ${target}\nThis will be sent to the agent for code review.`,
      meta: false,
    };
  }

  private async cmdTest(): Promise<SlashCommandResult> {
    // Detect test command
    const testCommands = [
      { file: 'package.json', cmd: 'npm test' },
      { file: 'Cargo.toml', cmd: 'cargo test' },
      { file: 'go.mod', cmd: 'go test ./...' },
      { file: 'pyproject.toml', cmd: 'pytest' },
    ];

    let testCmd = 'npm test';
    for (const tc of testCommands) {
      try {
        await access(join(this.workspace, tc.file));
        testCmd = tc.cmd;
        break;
      } catch { /* continue */ }
    }

    return {
      response: `[TEST] Running: ${testCmd}\nThis will be sent to the agent to execute.`,
      meta: false,
    };
  }

  private cmdFix(description: string): SlashCommandResult {
    const msg = description
      ? `[FIX] Find and fix: ${description}`
      : '[FIX] Scan the codebase for issues and fix them';
    return { response: msg, meta: false };
  }

  private cmdBuild(): SlashCommandResult {
    return {
      response: '[BUILD] Building the project...\nThis will be sent to the agent to execute.',
      meta: false,
    };
  }

  private async cmdResume(sessionId: string): Promise<SlashCommandResult> {
    if (!sessionId) {
      return {
        response: 'Usage: /resume <session-id>\nUse /sessions to list available sessions.',
        meta: true,
      };
    }

    const conv = this.conversationStore.get(sessionId);
    if (!conv) {
      return { response: `Session not found: ${sessionId}`, meta: true };
    }

    return {
      response: `Resumed session: ${conv.title}\n${conv.messages.length} messages loaded.`,
      meta: true,
      action: 'load_session',
      payload: sessionId,
    };
  }

  // ==========================================================================
  // /run — Execute inline code snippet
  // ==========================================================================

  private async cmdRun(code: string): Promise<SlashCommandResult> {
    if (!code) return { response: 'Usage: /run <code>\nExample: /run console.log("hello")', meta: true };
    const ext = code.includes('import ') || code.includes('require(') ? '.js' : code.startsWith('def ') || code.includes('print(') ? '.py' : '.sh';
    const tmpFile = `__tmp_run${ext}`;
    const { writeFile: wf, unlink } = require('fs/promises');
    const { join } = require('path');
    const filePath = join(this.workspace, tmpFile);
    try {
      await wf(filePath, code, 'utf-8');
      const cmd = ext === '.py' ? `python3 ${tmpFile}` : ext === '.sh' ? `bash ${tmpFile}` : `node ${tmpFile}`;
      const { stdout, stderr } = await execAsync(cmd, { cwd: this.workspace, timeout: 30000, maxBuffer: 1024 * 1024 });
      await unlink(filePath).catch(() => {});
      return { response: `**Output:**\n\n${stdout || '(no output)'}${stderr ? '\n**Errors:**\n' + stderr : ''}`, meta: true };
    } catch (err: any) {
      await unlink(filePath).catch(() => {});
      return { response: `**Error:** ${err.message}`, meta: true };
    }
  }

  // ==========================================================================
  // /commit — Auto-stage and commit
  // ==========================================================================

  private async cmdCommit(message: string): Promise<SlashCommandResult> {
    try {
      // Auto-detect a good commit message if none provided
      if (!message) {
        const { stdout: status } = await execAsync('git status --short', { cwd: this.workspace, timeout: 10000 });
        const changed = status.trim().split('\n').filter(l => l.trim());
        const fileCount = changed.length;
        const types = new Set<string>();
        for (const line of changed) {
          if (line.match(/\.(ts|tsx|js|jsx)$/)) types.add('code');
          else if (line.match(/\.css|\.scss|tailwind/)) types.add('styles');
          else if (line.match(/\.md|README/)) types.add('docs');
          else if (line.match(/package\.json/)) types.add('deps');
          else types.add('files');
        }
        message = `chore: update ${Array.from(types).join(', ')} (${fileCount} files)`;
      }
      await execAsync('git add -A', { cwd: this.workspace, timeout: 10000 });
      const { stdout } = await execAsync(`git commit -m "${message.replace(/"/g, '\"')}"`, { cwd: this.workspace, timeout: 15000 });
      return { response: `**Committed:** ${message}\n\n${stdout.trim()}`, meta: true };
    } catch (err: any) {
      return { response: `**Commit failed:** ${err.message}`, meta: true };
    }
  }

  // ==========================================================================
  // /branch — Create and switch branch
  // ==========================================================================

  private async cmdBranch(name: string): Promise<SlashCommandResult> {
    if (!name) return { response: 'Usage: /branch <name>', meta: true };
    try {
      const { stdout, stderr } = await execAsync(`git checkout -b "${name}"`, { cwd: this.workspace, timeout: 10000 });
      return { response: `**Created and switched to branch:** ${name}\n${stdout.trim()}`, meta: true };
    } catch (err: any) {
      return { response: `**Branch failed:** ${err.message}`, meta: true };
    }
  }

  // ==========================================================================
  // /template — Scaffold a project
  // ==========================================================================

  private async cmdTemplate(name: string): Promise<SlashCommandResult> {
    if (!name) {
      return { response: 'Available templates:\n- react — React + Vite + TypeScript\n- nextjs — Next.js + TypeScript\n- express — Express.js API\n- python — Python Flask\n- vanilla — Vanilla HTML/CSS/JS\n\nUsage: /template <name>', meta: true };
    }
    const templates: Record<string, string> = {
      react: 'npx create-vite@latest . --template react-ts',
      nextjs: 'npx create-next-app@latest . --typescript --tailwind --app',
      express: 'npm init -y && npm i express && mkdir -p src && echo "const express = require(\"express\");\nconst app = express();\napp.get(\"/\", (req, res) => res.json({ hello: \"world\" }));\napp.listen(3000, () => console.log(\"Server running on port 3000\"));" > src/index.js',
      python: 'python3 -m venv venv && pip install flask && mkdir -p src && echo "from flask import Flask\napp = Flask(__name__)\n@app.route(\"/\")\ndef hello(): return {\"hello\": \"world\"}\nif __name__ == \"__main__\": app.run(debug=True)" > src/app.py',
      vanilla: 'mkdir -p src && echo "<!DOCTYPE html>\n<html><head><title>App</title></head><body><h1>Hello</h1><script src=\"src/main.js\"></script></body></html>" > index.html && echo "console.log(\"Hello world\");" > src/main.js',
    };
    if (!templates[name]) return { response: `Unknown template: ${name}. Use /template to see available ones.`, meta: true };
    try {
      const { stdout, stderr } = await execAsync(templates[name], { cwd: this.workspace, timeout: 60000, maxBuffer: 2 * 1024 * 1024 });
      return { response: `**Template \"${name}\" scaffolded!**\n\n${stdout.substring(0, 500)}${stderr ? '\n' + stderr.substring(0, 200) : ''}`, meta: true };
    } catch (err: any) {
      return { response: `**Template failed:** ${err.message}`, meta: true };
    }
  }

  // ==========================================================================
  // /lang — Detect project language
  // ==========================================================================

  private async cmdLang(): Promise<SlashCommandResult> {
    const { existsSync } = require('fs');
    const { join } = require('path');
    const ws = this.workspace;
    const langs: string[] = [];
    if (existsSync(join(ws, 'package.json'))) {
      const pkg = JSON.parse(require('fs').readFileSync(join(ws, 'package.json'), 'utf-8'));
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      if (deps.react || deps.next || deps.vue) langs.push('JavaScript/TypeScript (React/Next.js)');
      else langs.push('JavaScript/TypeScript (Node.js)');
      const scripts = Object.keys(pkg.scripts || {});
      if (scripts.length > 0) langs.push(`  Scripts: ${scripts.join(', ')}`);
    }
    if (existsSync(join(ws, 'requirements.txt')) || existsSync(join(ws, 'pyproject.toml')) || existsSync(join(ws, 'setup.py'))) langs.push('Python');
    if (existsSync(join(ws, 'Cargo.toml'))) langs.push('Rust');
    if (existsSync(join(ws, 'go.mod'))) langs.push('Go');
    if (existsSync(join(ws, 'Gemfile'))) langs.push('Ruby');
    if (existsSync(join(ws, 'pom.xml')) || existsSync(join(ws, 'build.gradle'))) langs.push('Java');
    if (existsSync(join(ws, '*.csproj')) || existsSync(join(ws, '*.sln'))) langs.push('C#');
    return { response: langs.length > 0 ? `**Detected languages:**\n${langs.map(l => `- ${l}`).join('\n')}` : 'No programming language detected. Use /template to scaffold a project.', meta: true };
  }

  // ==========================================================================
  // /compare — Run same prompt on multiple models
  // ==========================================================================

  private async cmdCompare(prompt: string): Promise<SlashCommandResult> {
    if (!prompt) return { response: 'Usage: /compare <prompt>\nRuns the prompt on your active model and 2 alternatives.', meta: true };
    // Forward to the agent as a special multi-model prompt
    return { response: `[COMPARE MODE] Run this prompt on multiple models and show differences:\n${prompt}`, meta: false };
  }

  // ==========================================================================
  // /explain — Line-by-line code explanation
  // ==========================================================================

  private async cmdExplain(file: string): Promise<SlashCommandResult> {
    if (!file) return { response: 'Usage: /explain <file-path>', meta: true };
    const fullPath = require('path').join(this.workspace, file);
    try {
      const content = require('fs').readFileSync(fullPath, 'utf-8');
      const lines = content.split('\n');
      const summary: string[] = [];
      summary.push(`**File:** ${file} (${lines.length} lines)\n`);
      // Extract key structures
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.match(/^(export\s+)?(async\s+)?function\s+(\w+)/)) summary.push(`L${i + 1}: ${line.substring(0, 80)}`);
        else if (line.match(/^(export\s+)?class\s+(\w+)/)) summary.push(`L${i + 1}: ${line.substring(0, 80)}`);
        else if (line.match(/^(export\s+)?(interface|type)\s+(\w+)/)) summary.push(`L${i + 1}: ${line.substring(0, 80)}`);
        else if (line.match(/^import\s+/)) summary.push(`L${i + 1}: ${line.substring(0, 80)}`);
      }
      return { response: summary.join('\n') + '\n\nAsk the agent to explain specific sections in detail.', meta: true };
    } catch { return { response: `File not found: ${file}`, meta: true }; }
  }

  // ==========================================================================
  // /deps — Dependency analysis
  // ==========================================================================

  private async cmdDeps(symbol: string): Promise<SlashCommandResult> {
    if (!symbol) return { response: 'Usage: /deps <function-or-import-name>', meta: true };
    try {
      const { stdout } = await execAsync(`grep -rn "${symbol}" --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" . 2>/dev/null | grep -v node_modules | grep -v '.git/' | head -30`, { cwd: this.workspace, timeout: 15000, maxBuffer: 1024 * 1024 });
      const matches = stdout.trim().split('\n').filter(l => l.trim());
      if (matches.length === 0) return { response: `No references found for \"${symbol}\"`, meta: true };
      return { response: `**References to \"${symbol}\" (${matches.length}):**\n\n${matches.map(m => `\`${m}\``).join('\n')}`, meta: true };
    } catch { return { response: `Search failed for \"${symbol}\"`, meta: true }; }
  }

  // ==========================================================================
  // /test-gen — Auto-generate tests
  // ==========================================================================

  private async cmdTestGen(file: string): Promise<SlashCommandResult> {
    if (!file) return { response: 'Usage: /test-gen <file-to-test>', meta: true };
    return { response: `[TEST GEN] Generate comprehensive unit tests for ${file}. Create the test file with: 1) Happy path tests, 2) Edge cases, 3) Error handling, 4) Boundary conditions.`, meta: false };
  }

  // ==========================================================================
  // /format — Auto-format files
  // ==========================================================================

  private async cmdFormat(file: string): Promise<SlashCommandResult> {
    const target = file || '.';
    const { existsSync } = require('fs');
    const ws = this.workspace;
    // Try prettier first, then black for Python
    if (existsSync(require('path').join(ws, '.prettierrc')) || existsSync(require('path').join(ws, 'prettier.config.js')) || existsSync(require('path').join(ws, 'node_modules/.bin/prettier'))) {
      try {
        const { stdout } = await execAsync(`npx prettier --write "${target}"`, { cwd: ws, timeout: 30000, maxBuffer: 2 * 1024 * 1024 });
        return { response: `**Formatted with Prettier:**\n${stdout.substring(0, 500)}`, meta: true };
      } catch (err: any) { return { response: `Prettier failed: ${err.message}`, meta: true }; }
    }
    if (existsSync(require('path').join(ws, 'requirements.txt')) || existsSync(require('path').join(ws, 'pyproject.toml'))) {
      try {
        const { stdout } = await execAsync(`python3 -m black "${target}" 2>/dev/null || black "${target}"`, { cwd: ws, timeout: 30000, maxBuffer: 2 * 1024 * 1024 });
        return { response: `**Formatted with Black:**\n${stdout.substring(0, 500)}`, meta: true };
      } catch (err: any) { return { response: `Black failed: ${err.message}`, meta: true }; }
    }
    return { response: 'No formatter found. Install prettier (npm) or black (pip).', meta: true };
  }

  // ==========================================================================
  // /persona — Set custom system prompt
  // ==========================================================================

  private async cmdPersona(prompt: string): Promise<SlashCommandResult> {
    if (!prompt) return { response: 'Usage: /persona <system prompt>\nSets a custom persona for the agent.', meta: true };
    const personaFile = require('path').join(this.workspace, '.michaelangelo', 'persona.txt');
    try {
      await require('fs/promises').mkdir(require('path').join(this.workspace, '.michaelangelo'), { recursive: true });
      await require('fs/promises').writeFile(personaFile, prompt, 'utf-8');
      return { response: `**Persona saved!** The agent will use this custom system prompt in future sessions.\n\n> ${prompt.substring(0, 200)}`, meta: true };
    } catch (err: any) { return { response: `Failed to save persona: ${err.message}`, meta: true }; }
  }
}

