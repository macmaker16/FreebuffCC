/**
 * FreebuffCC Agent System - Memory Search Skill
 * 
 * Provides 3-tier memory search capability:
 * - Layer 1: Index (titles and summaries)
 * - Layer 2: Timeline (chronological events)
 * - Layer 3: Full Details (complete content)
 */

import { AgentSkill, ExecutionContext, ToolResult, MemoryEntry } from '../types';

/** Reference to the memory store (injected at runtime) */
let memoryStore: MemoryEntry[] = [];

/** Set the memory store reference */
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
        description: 'Search past session memories. Use layer 1 for quick index, layer 2 for timeline, layer 3 for full details.',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search query' },
            layer: {
              type: 'string',
              enum: ['1', '2', '3'],
              description: 'Search depth: 1=index, 2=timeline, 3=full details',
            },
            limit: { type: 'number', description: 'Max results (default 5)' },
          },
          required: ['query'],
        },
      },
    },
  ],

  async execute(toolName: string, args: Record<string, any>, ctx: ExecutionContext): Promise<ToolResult> {
    if (toolName !== 'search_memory') {
      return { success: false, output: '', error: `Unknown tool: ${toolName}` };
    }

    const { query, layer = '1', limit = 5 } = args;
    const queryLower = query.toLowerCase();

    // Filter entries by relevance (simple keyword matching)
    const matches = memoryStore
      .map(entry => ({
        entry,
        relevance: calculateRelevance(queryLower, entry),
      }))
      .filter(m => m.relevance > 0)
      .sort((a, b) => b.relevance - a.relevance)
      .slice(0, limit);

    if (matches.length === 0) {
      return { success: true, output: 'No matching memories found.' };
    }

    let output = '';

    switch (layer) {
      case '1': // Index layer — just titles and summaries
        output = matches
          .map(m => `[${m.entry.type}] ${m.entry.timestamp ? new Date(m.entry.timestamp).toISOString() : 'unknown'}: ${m.entry.content.substring(0, 100)}`)
          .join('\n');
        break;

      case '2': // Timeline layer — chronological with more detail
        output = matches
          .map(m => `---\nType: ${m.entry.type}\nSession: ${m.entry.sessionId}\nTime: ${m.entry.timestamp ? new Date(m.entry.timestamp).toISOString() : 'unknown'}\nContent: ${m.entry.content.substring(0, 500)}\n`)
          .join('\n');
        break;

      case '3': // Full details layer — complete content
        output = matches
          .map(m => `===\nType: ${m.entry.type}\nSession: ${m.entry.sessionId}\nTime: ${m.entry.timestamp ? new Date(m.entry.timestamp).toISOString() : 'unknown'}\nContent: ${m.entry.content}\nMetadata: ${JSON.stringify(m.entry.metadata)}\n===`)
          .join('\n\n');
        break;

      default:
        output = 'Invalid layer. Use 1, 2, or 3.';
    }

    return { success: true, output };
  },
};

/** Simple keyword-based relevance scoring */
function calculateRelevance(query: string, entry: MemoryEntry): number {
  const content = entry.content.toLowerCase();
  const words = query.split(/\s+/);
  let score = 0;

  for (const word of words) {
    if (content.includes(word)) score += 1;
  }

  // Boost summaries and learnings
  if (entry.type === 'summary' || entry.type === 'learning') score += 0.5;

  return score / words.length;
}
