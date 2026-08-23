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
}
