/**
 * Michaelangelo Agent - Persistent Memory Plugin
 * Auto-captures observations, injects context on start, saves summaries on end.
 */

import { AgentPlugin, HookContext, ChatMessage } from '../types';
import { MemoryStore } from '../memory/store';

export class MemoryPlugin implements AgentPlugin {
  name = 'memory';
  description = 'Persistent memory - captures observations and injects context';
  version = '1.0.0';
  enabled = true;

  private store: MemoryStore;
  private observations: string[] = [];

  constructor(workspace: string) {
    this.store = new MemoryStore(workspace);
  }

  async init(): Promise<void> {
    await this.store.init();
  }

  getStore(): MemoryStore {
    return this.store;
  }

  hooks = {
    onSessionStart: async (ctx: HookContext) => {
      this.observations = [];
      const recent = this.store.getRecent(10);
      if (recent.length === 0) return;

      const contextLines = recent.map((m: any) => {
        const time = new Date(m.timestamp).toISOString();
        return `[${m.type}] ${time}: ${m.content.substring(0, 200)}`;
      });

      const memoryContext = `\n\n--- PAST CONTEXT ---\n${contextLines.join('\n')}\n--- END CONTEXT ---\n`;
      const systemMsg = ctx.messages.find((m: any) => m.role === 'system');
      if (systemMsg && systemMsg.content) {
        systemMsg.content += memoryContext;
      }
      console.log(`[Memory] Injected ${recent.length} past memories`);
    },

    onPostToolUse: async (ctx: HookContext) => {
      if (!ctx.toolCall || !ctx.toolResult) return;
      const observation = `[${ctx.toolCall.function.name}] ${ctx.toolResult.success ? ctx.toolResult.output : ctx.toolResult.error}`;
      this.observations.push(observation);
      await this.store.add({
        sessionId: ctx.sessionId,
        type: 'observation',
        content: observation,
        metadata: { tool: ctx.toolCall.function.name, success: ctx.toolResult.success },
      });
    },

    onSessionEnd: async (ctx: HookContext) => {
      if (this.observations.length === 0) return;
      const tasksCompleted = this.observations.filter(o => o.includes('[write_file]') && o.includes('SUCCESS'));
      const summary = `Session: ${tasksCompleted.length} files written, ${this.observations.length} total actions`;
      this.store.addSession({
        sessionId: ctx.sessionId,
        timestamp: Date.now(),
        model: ctx.model,
        title: ctx.messages.filter((m: any) => m.role === 'user').pop()?.content?.substring(0, 100) || 'Session',
        summary,
        tasksCompleted: tasksCompleted.map((o: string) => o.substring(0, 100)),
        learnings: [],
        toolsUsed: [...new Set(this.observations.map((o: string) => o.split(']')[0].replace('[', '')))],
      });
      await this.store.save();
    },
  };
}
