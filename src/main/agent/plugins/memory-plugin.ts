/**
 * Michaelangelo Agent System - Persistent Memory Plugin
 * 
 * Automatically captures observations during tool use,
 * compresses session summaries on end, and injects context on start.
 * 
 * Uses lifecycle hooks:
 * - onSessionStart: Load and inject past context
 * - onPostToolUse: Capture tool observations
 * - onSessionEnd: Compress and save session summary
 */

import { AgentPlugin, HookContext, ChatMessage } from '../types';
import { MemoryStore } from '../memory/store';
import { join } from 'path';

export class MemoryPlugin implements AgentPlugin {
  name = 'memory';
  description = 'Persistent memory - captures observations and injects context';
  version = '1.0.0';
  enabled = true;

  private store: MemoryStore;
  private observations: string[] = [];
  private sessionMessages: ChatMessage[] = [];

  constructor(workspace: string) {
    const storagePath = join(workspace, '.freebuffcc', 'memory.json');
    this.store = new MemoryStore(storagePath);
  }

  /** Initialize the memory store */
  async init(): Promise<void> {
    await this.store.load();
  }

  hooks = {
    /**
     * onSessionStart: Load recent memories and inject as system context.
     */
    onSessionStart: async (ctx: HookContext) => {
      this.observations = [];
      this.sessionMessages = [];

      // Get recent memories
      const recent = this.store.getRecent(10);
      if (recent.length === 0) return;

      // Build context injection
      const contextLines = recent.map(m => {
        const time = new Date(m.timestamp).toISOString();
        return `[${m.type}] ${time}: ${m.content.substring(0, 200)}`;
      });

      const memoryContext = `\n\n--- PAST CONTEXT ---\n${contextLines.join('\n')}\n--- END CONTEXT ---\n`;

      // Inject into the last system message or add a new one
      const systemMsg = ctx.messages.find(m => m.role === 'system');
      if (systemMsg && systemMsg.content) {
        systemMsg.content += memoryContext;
      } else {
        ctx.messages.unshift({
          role: 'system',
          content: `You have access to past session memories:${memoryContext}`,
        });
      }

      console.log(`[Memory] Injected ${recent.length} past memories into context`);
    },

    /**
     * onPostToolUse: Silently capture tool output as observation.
     */
    onPostToolUse: async (ctx: HookContext) => {
      if (!ctx.toolCall || !ctx.toolResult) return;

      const observation = `[${ctx.toolCall.function.name}] ${ctx.toolResult.success ? ctx.toolResult.output : ctx.toolResult.error}`;
      this.observations.push(observation);

      // Store as raw observation
      await this.store.add({
        sessionId: ctx.sessionId,
        type: 'observation',
        content: observation,
        metadata: {
          tool: ctx.toolCall.function.name,
          success: ctx.toolResult.success,
          iteration: ctx.metadata?.iteration || 0,
        },
      });
    },

    /**
     * onSessionEnd: Compress observations into a summary.
     * In production, this would call the LLM to generate a semantic summary.
     */
    onSessionEnd: async (ctx: HookContext) => {
      if (this.observations.length === 0) return;

      // Build a simple summary (in production, call LLM for semantic compression)
      const tasksCompleted = this.observations
        .filter(o => o.includes('[write_file]') && o.includes('SUCCESS'))
        .map(o => o.replace('[write_file] SUCCESS: ', ''));

      const commandsRun = this.observations
        .filter(o => o.includes('[run_command]'))
        .map(o => o.split('\n')[0].substring(0, 100));

      const summary = `Session Summary:\n- Tasks completed: ${tasksCompleted.length}\n- Commands executed: ${commandsRun.length}\n- Key actions: ${this.observations.slice(0, 5).join('; ')}`;

      // Save summary
      await this.store.add({
        sessionId: ctx.sessionId,
        type: 'summary',
        content: summary,
        metadata: {
          observationCount: this.observations.length,
          tasksCompleted: tasksCompleted.length,
          commandsRun: commandsRun.length,
        },
      });

      console.log(`[Memory] Saved session summary (${this.observations.length} observations)`);
    },
  };

  /** Get the memory store for external access */
  getStore(): MemoryStore {
    return this.store;
  }
}
