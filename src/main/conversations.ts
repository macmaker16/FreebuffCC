/**
 * Michaelangelo - Conversation Persistence
 *
 * Claude Code-style conversation management:
 * - Auto-save sessions to disk
 * - Load and continue past conversations
 * - Search through conversation history
 * - Export conversations as markdown
 * - Token/cost tracking per session
 */

import { readFile, writeFile, readdir, mkdir } from 'fs/promises';
import { join, basename } from 'path';

// ============================================================================
// TYPES
// ============================================================================

export interface ConversationMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool' | 'permission';
  content: string;
  timestamp: number;
  /** Tool execution metadata for assistant messages */
  toolCalls?: Array<{
    name: string;
    args: Record<string, any>;
    result?: string;
    status: 'pending' | 'approved' | 'denied' | 'executing' | 'completed' | 'error';
    permissionId?: string;
  }>;
  /** Token usage for this message */
  tokens?: {
    prompt: number;
    completion: number;
    total: number;
  };
  /** Cost estimate in USD */
  cost?: number;
}

export interface Conversation {
  id: string;
  title: string;
  model: string;
  provider: string;
  workspace: string;
  messages: ConversationMessage[];
  createdAt: number;
  updatedAt: number;
  /** Total tokens used across all messages */
  totalTokens: number;
  /** Total estimated cost in USD */
  totalCost: number;
  /** Number of tool calls in this conversation */
  toolCallCount: number;
  /** Tags for search */
  tags: string[];
}

export interface ConversationSummary {
  id: string;
  title: string;
  model: string;
  provider: string;
  messageCount: number;
  toolCallCount: number;
  totalTokens: number;
  totalCost: number;
  createdAt: number;
  updatedAt: number;
}

// ============================================================================
// CONVERSATION STORE
// ============================================================================

export class ConversationStore {
  private dir: string;
  private conversations: Map<string, Conversation> = new Map();
  private activeId: string | null = null;

  constructor(dataDir: string) {
    this.dir = join(dataDir, 'conversations');
  }

  async init(): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    await this.loadAll();
  }

  /** Load all conversations from disk */
  private async loadAll(): Promise<void> {
    try {
      const files = await readdir(this.dir);
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        try {
          const content = await readFile(join(this.dir, file), 'utf-8');
          const conv = JSON.parse(content) as Conversation;
          this.conversations.set(conv.id, conv);
        } catch { /* skip corrupted files */ }
      }
      console.log(`[Conversations] Loaded ${this.conversations.size} conversations`);
    } catch { /* first run */ }
  }

  /** Save a conversation to disk */
  private async save(conversation: Conversation): Promise<void> {
    const filePath = join(this.dir, `${conversation.id}.json`);
    await writeFile(filePath, JSON.stringify(conversation, null, 2), 'utf-8');
  }

  /** Create a new conversation */
  async create(title: string, model: string, provider: string, workspace: string): Promise<Conversation> {
    const id = `conv_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`;
    const conversation: Conversation = {
      id, title, model, provider, workspace,
      messages: [], createdAt: Date.now(), updatedAt: Date.now(),
      totalTokens: 0, totalCost: 0, toolCallCount: 0, tags: [],
    };
    this.conversations.set(id, conversation);
    await this.save(conversation);
    this.activeId = id;
    console.log(`[Conversations] Created: ${id} — ${title}`);
    return conversation;
  }

  /** Get a conversation by ID */
  get(id: string): Conversation | undefined {
    return this.conversations.get(id);
  }

  /** Get or create the active conversation */
  async getOrCreateActive(model: string, provider: string, workspace: string): Promise<Conversation> {
    if (this.activeId) {
      const conv = this.conversations.get(this.activeId);
      if (conv) return conv;
    }
    return this.create('New conversation', model, provider, workspace);
  }

  /** Get the active conversation */
  getActive(): Conversation | null {
    if (!this.activeId) return null;
    return this.conversations.get(this.activeId) || null;
  }

  /** Set the active conversation */
  setActive(id: string): void {
    this.activeId = id;
  }

  /** Add a message to a conversation */
  async addMessage(conversationId: string, message: ConversationMessage): Promise<void> {
    const conv = this.conversations.get(conversationId);
    if (!conv) return;

    conv.messages.push(message);
    conv.updatedAt = Date.now();

    if (message.tokens) {
      conv.totalTokens += message.tokens.total;
    }
    if (message.cost) {
      conv.totalCost += message.cost;
    }
    if (message.toolCalls) {
      conv.toolCallCount += message.toolCalls.length;
    }

    // Auto-generate title from first user message
    if (conv.messages.length === 1 && message.role === 'user') {
      conv.title = message.content.substring(0, 80);
      if (message.content.length > 80) conv.title += '...';
    }

    await this.save(conv);
  }

  /** Update tool call status in a conversation message */
  async updateToolCall(
    conversationId: string,
    messageId: string,
    toolIndex: number,
    updates: Partial<NonNullable<ConversationMessage['toolCalls']>[number]>,
  ): Promise<void> {
    const conv = this.conversations.get(conversationId);
    if (!conv) return;

    const msg = conv.messages.find(m => m.id === messageId);
    if (!msg || !msg.toolCalls) return;

    msg.toolCalls[toolIndex] = { ...msg.toolCalls[toolIndex], ...updates };
    conv.updatedAt = Date.now();
    await this.save(conv);
  }

  /** Get all conversations sorted by most recent */
  list(limit = 50): ConversationSummary[] {
    return [...this.conversations.values()]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, limit)
      .map(c => ({
        id: c.id,
        title: c.title,
        model: c.model,
        provider: c.provider,
        messageCount: c.messages.length,
        toolCallCount: c.toolCallCount,
        totalTokens: c.totalTokens,
        totalCost: c.totalCost,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
      }));
  }

  /** Search conversations by text content */
  search(query: string, limit = 20): ConversationSummary[] {
    const q = query.toLowerCase();
    return [...this.conversations.values()]
      .filter(c =>
        c.title.toLowerCase().includes(q) ||
        c.messages.some(m => m.content.toLowerCase().includes(q))
      )
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, limit)
      .map(c => ({
        id: c.id,
        title: c.title,
        model: c.model,
        provider: c.provider,
        messageCount: c.messages.length,
        toolCallCount: c.toolCallCount,
        totalTokens: c.totalTokens,
        totalCost: c.totalCost,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
      }));
  }

  /** Delete a conversation */
  async delete(id: string): Promise<boolean> {
    const conv = this.conversations.get(id);
    if (!conv) return false;

    this.conversations.delete(id);
    try {
      const { unlink } = require('fs/promises');
      await unlink(join(this.dir, `${id}.json`));
    } catch { /* file might not exist */ }

    if (this.activeId === id) {
      this.activeId = null;
    }
    console.log(`[Conversations] Deleted: ${id}`);
    return true;
  }

  /** Export a conversation as markdown */
  exportMarkdown(id: string): string | null {
    const conv = this.conversations.get(id);
    if (!conv) return null;

    const lines: string[] = [
      `# ${conv.title}`,
      '',
      `- **Model:** ${conv.model} (${conv.provider})`,
      `- **Created:** ${new Date(conv.createdAt).toISOString()}`,
      `- **Updated:** ${new Date(conv.updatedAt).toISOString()}`,
      `- **Messages:** ${conv.messages.length}`,
      `- **Tool calls:** ${conv.toolCallCount}`,
      `- **Tokens:** ${conv.totalTokens.toLocaleString()}`,
      `- **Cost:** $${conv.totalCost.toFixed(4)}`,
      '',
      '---',
      '',
    ];

    for (const msg of conv.messages) {
      if (msg.role === 'user') {
        lines.push(`## You`, '', msg.content, '');
      } else if (msg.role === 'assistant') {
        lines.push(`## Assistant`, '', msg.content, '');
        if (msg.toolCalls && msg.toolCalls.length > 0) {
          lines.push('**Tool calls:**');
          for (const tc of msg.toolCalls) {
            const status = tc.status === 'completed' ? '✅' : tc.status === 'error' ? '❌' : '⏳';
            lines.push(`- ${status} \`${tc.name}\``);
            if (tc.result) {
              lines.push(`  \`\`\``, tc.result.substring(0, 500), `  \`\`\``);
            }
          }
          lines.push('');
        }
      }
    }

    return lines.join('\n');
  }

  /** Get aggregate stats across all conversations */
  getStats(): {
    totalConversations: number;
    totalMessages: number;
    totalTokens: number;
    totalCost: number;
    totalToolCalls: number;
  } {
    let totalMessages = 0;
    let totalTokens = 0;
    let totalCost = 0;
    let totalToolCalls = 0;

    for (const conv of this.conversations.values()) {
      totalMessages += conv.messages.length;
      totalTokens += conv.totalTokens;
      totalCost += conv.totalCost;
      totalToolCalls += conv.toolCallCount;
    }

    return {
      totalConversations: this.conversations.size,
      totalMessages, totalTokens, totalCost, totalToolCalls,
    };
  }
}
