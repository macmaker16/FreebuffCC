/**
 * Michaelangelo Agent - Memory Search Skill
 * 3-tier search: Index, Timeline, Full Details
 */

import { AgentSkill, ExecutionContext, ToolResult } from '../types';
import { MemoryEntry } from '../memory/store';

let memoryStore: MemoryEntry[] = [];

export function setMemoryStore(store: MemoryEntry[]): void {
  memoryStore = store;
}

export const MemorySearchSkill: AgentSkill = {
  name: 'memory-search',
  description: 'Search past session memories and observations',
  tools: [
    {
      type: 'function',
      function: {
        name: 'search_memory',
        description: 'Search past session memories. Layer 1: index, Layer 2: timeline, Layer 3: full details.',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search query' },
            layer: { type: 'number', description: 'Search depth: 1=index, 2=timeline, 3=full (default 1)' },
          },
          required: ['query'],
        },
      },
    },
  ],

  async execute(toolName: string, args: Record<string, any>, _ctx: ExecutionContext): Promise<ToolResult> {
    if (toolName !== 'search_memory') {
      return { success: false, output: '', error: `Unknown tool: ${toolName}` };
    }

    const { query, layer = 1 } = args;
    const q = query.toLowerCase();
    const matches = memoryStore.filter(e =>
      e.content.toLowerCase().includes(q)
    ).slice(-10);

    if (matches.length === 0) {
      return { success: true, output: 'No relevant memories found.' };
    }

    let output = '';
    switch (layer) {
      case 1:
        output = matches.map((m, i) => `${i + 1}. [${m.type}] ${m.content.substring(0, 80)}...`).join('\n');
        break;
      case 2:
        output = matches.map(m => `[${new Date(m.timestamp).toISOString().split('T')[0]}] [${m.type}] ${m.content.substring(0, 200)}`).join('\n\n');
        break;
      case 3:
        output = matches.map(m => `---\nType: ${m.type}\nDate: ${new Date(m.timestamp).toISOString()}\n\n${m.content}\n`).join('\n');
        break;
    }

    return { success: true, output };
  },
};
