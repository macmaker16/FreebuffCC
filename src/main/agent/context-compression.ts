/**
 * Michaelangelo Agent - Dynamic Context Compression Engine
 *
 * Monitors the conversation context size in tokens. When it exceeds a
 * threshold, automatically compresses older tool outputs into a compact
 * "Action History & Learnings" summary and replaces the raw messages
 * with the compressed version — keeping the LLM focused without losing
 * the plot.
 *
 * Flow:
 *  1. After each iteration, estimate total token count
 *  2. If over threshold → find the oldest chunk of tool-heavy messages
 *  3. Summarize them via a quick LLM call (or naive extraction)
 *  4. Replace those messages with a single system summary message
 *  5. Inject "Action History & Learnings" summary into context
 */

import { ChatMessage } from './types';

// ============================================================================
// CONFIGURATION
// ============================================================================

/** Token estimation: ~4 chars per token for English text (conservative) */
const CHARS_PER_TOKEN = 4;

/** Default context threshold — trigger compression above this many tokens */
const DEFAULT_TOKEN_THRESHOLD = 8000;

/** Keep this many recent tool messages uncompressed (the "hot window") */
const HOT_WINDOW_SIZE = 6;

/** Max tokens for the compressed summary */
const SUMMARY_MAX_TOKENS = 800;

// ============================================================================
// TYPES
// ============================================================================

export interface CompressionConfig {
  /** Token threshold that triggers compression */
  tokenThreshold?: number;
  /** Number of recent tool messages to keep raw */
  hotWindowSize?: number;
}

export interface CompressionStats {
  totalTokensBefore: number;
  totalTokensAfter: number;
  messagesCompressed: number;
  summaryLength: number;
  triggered: boolean;
}

// ============================================================================
// CORE ENGINE
// ============================================================================

export class ContextCompressionEngine {
  private tokenThreshold: number;
  private hotWindowSize: number;
  private compressionCount = 0;

  constructor(config?: CompressionConfig) {
    this.tokenThreshold = config?.tokenThreshold ?? DEFAULT_TOKEN_THRESHOLD;
    this.hotWindowSize = config?.hotWindowSize ?? HOT_WINDOW_SIZE;
  }

  /**
   * Estimate token count for a single message.
   * Uses character-based estimation + overhead for role/structure.
   */
  estimateTokens(message: ChatMessage): number {
    let tokens = 4; // base overhead per message (role, formatting)
    if (message.content) {
      tokens += Math.ceil(message.content.length / CHARS_PER_TOKEN);
    }
    if (message.tool_calls) {
      for (const tc of message.tool_calls) {
        tokens += Math.ceil(tc.function.name.length / CHARS_PER_TOKEN);
        tokens += Math.ceil(tc.function.arguments.length / CHARS_PER_TOKEN);
      }
    }
    return tokens;
  }

  /**
   * Estimate total tokens across all messages.
   */
  estimateTotalTokens(messages: ChatMessage[]): number {
    return messages.reduce((sum, msg) => sum + this.estimateTokens(msg), 0);
  }

  /**
   * Main entry point: analyze messages and compress if needed.
   * Returns the (potentially modified) messages array and stats.
   */
  async maybeCompress(
    messages: ChatMessage[],
    llmCompressor?: (text: string) => Promise<string>,
  ): Promise<{ messages: ChatMessage[]; stats: CompressionStats }> {
    const tokensBefore = this.estimateTotalTokens(messages);
    const stats: CompressionStats = {
      totalTokensBefore: tokensBefore,
      totalTokensAfter: tokensBefore,
      messagesCompressed: 0,
      summaryLength: 0,
      triggered: false,
    };

    if (tokensBefore <= this.tokenThreshold) {
      return { messages, stats };
    }

    console.log(
      `[ContextCompression] ${tokensBefore} tokens exceeds threshold (${this.tokenThreshold}), compressing...`,
    );

    stats.triggered = true;

    // Find compressible region: all messages except system prompt and hot window
    const systemMessages: ChatMessage[] = [];
    const compressibleMessages: ChatMessage[] = [];
    const hotWindow: ChatMessage[] = [];

    let systemEnd = 0;
    for (let i = 0; i < messages.length; i++) {
      if (messages[i].role === 'system') {
        systemMessages.push(messages[i]);
        systemEnd = i + 1;
      } else {
        break;
      }
    }

    const remaining = messages.slice(systemEnd);
    const hotStart = Math.max(0, remaining.length - this.hotWindowSize);
    compressibleMessages.push(...remaining.slice(0, hotStart));
    hotWindow.push(...remaining.slice(hotStart));

    // Only compress if we have meaningful tool output to compress
    const toolMessages = compressibleMessages.filter(
      (m) => m.role === 'tool',
    );
    if (toolMessages.length < 2) {
      return { messages, stats };
    }

    // Build raw content for summarization
    const rawContent = this.extractToolOutputs(compressibleMessages);

    // Compress via LLM or naive extraction
    let summary: string;
    if (llmCompressor) {
      summary = await llmCompressor(rawContent);
    } else {
      summary = this.naiveCompress(compressibleMessages);
    }

    stats.messagesCompressed = compressibleMessages.length;
    stats.summaryLength = Math.ceil(summary.length / CHARS_PER_TOKEN);

    // Rebuild messages: system + summary + hot window
    const compressedMessages: ChatMessage[] = [
      ...systemMessages,
      {
        role: 'system',
        content: `\n\n--- ACTION HISTORY & LEARNINGS (compressed ${this.compressionCount + 1}) ---\n${summary}\n--- END HISTORY ---\n`,
      },
      ...hotWindow,
    ];

    this.compressionCount++;

    stats.totalTokensAfter = this.estimateTotalTokens(compressedMessages);
    console.log(
      `[ContextCompression] ${tokensBefore} → ${stats.totalTokensAfter} tokens ` +
        `(${stats.messagesCompressed} messages compressed, saved ~${tokensBefore - stats.totalTokensAfter} tokens)`,
    );

    return { messages: compressedMessages, stats };
  }

  /**
   * Extract tool outputs from messages into a compact text block.
   */
  private extractToolOutputs(messages: ChatMessage[]): string {
    const parts: string[] = [];
    for (const msg of messages) {
      if (msg.role === 'assistant' && msg.content) {
        parts.push(`[Assistant]: ${msg.content.substring(0, 300)}`);
      }
      if (msg.role === 'assistant' && msg.tool_calls) {
        for (const tc of msg.tool_calls) {
          parts.push(`[Tool Call] ${tc.function.name}(${tc.function.arguments.substring(0, 200)})`);
        }
      }
      if (msg.role === 'tool' && msg.content) {
        const truncated =
          msg.content.length > 500
            ? msg.content.substring(0, 500) + '...'
            : msg.content;
        parts.push(`[Tool Output]: ${truncated}`);
      }
    }
    return parts.join('\n');
  }

  /**
   * Naive compression: extract key facts without an LLM call.
   * Fast but less accurate — good as a fallback.
   */
  private naiveCompress(messages: ChatMessage[]): string {
    const actions: string[] = [];
    const errors: string[] = [];
    const filesModified: Set<string> = new Set();

    for (const msg of messages) {
      // Track tool calls
      if (msg.role === 'assistant' && msg.tool_calls) {
        for (const tc of msg.tool_calls) {
          actions.push(tc.function.name);
          // Extract file paths from write_file/edit_file/read_file calls
          try {
            const args = JSON.parse(tc.function.arguments);
            if (args.file_path) filesModified.add(args.file_path);
            if (args.command) actions.push(`run: ${args.command.substring(0, 80)}`);
          } catch { /* ignore parse errors */ }
        }
      }

      // Track errors
      if (msg.role === 'tool' && msg.content?.includes('ERROR')) {
        errors.push(msg.content.substring(0, 200));
      }
    }

    const summary: string[] = [];
    summary.push(`Actions taken: ${actions.join(', ')}`);
    if (filesModified.size > 0) {
      summary.push(`Files touched: ${[...filesModified].join(', ')}`);
    }
    if (errors.length > 0) {
      summary.push(`Errors encountered (${errors.length}):`);
      errors.slice(-3).forEach((e) => summary.push(`  - ${e}`));
    }
    summary.push(`Total tool invocations: ${actions.length}`);

    return summary.join('\n');
  }

  /**
   * Get compression stats without actually compressing.
   */
  analyze(messages: ChatMessage[]): {
    totalTokens: number;
    needsCompression: boolean;
    toolMessageCount: number;
    oldestToolIndex: number;
  } {
    const totalTokens = this.estimateTotalTokens(messages);
    const toolIndices = messages
      .map((m, i) => (m.role === 'tool' ? i : -1))
      .filter((i) => i >= 0);

    return {
      totalTokens,
      needsCompression: totalTokens > this.tokenThreshold,
      toolMessageCount: toolIndices.length,
      oldestToolIndex: toolIndices[0] ?? -1,
    };
  }

  /**
   * Reset compression state for a new session.
   */
  reset(): void {
    this.compressionCount = 0;
    this.hotFiles.clear();
  }

  getCompressionCount(): number {
    return this.compressionCount;
  }

  // ==========================================================================
  // REHYDRATION SUPPORT (Claude Code style)
  // ==========================================================================

  /** Track hot files that are frequently accessed */
  private hotFiles = new Map<string, { path: string; lastRead: number; readCount: number }>();

  /**
   * Record that a file was read — used to determine which files to rehydrate.
   */
  recordFileAccess(filePath: string): void {
    const existing = this.hotFiles.get(filePath);
    if (existing) {
      existing.readCount++;
      existing.lastRead = Date.now();
    } else {
      this.hotFiles.set(filePath, { path: filePath, lastRead: Date.now(), readCount: 1 });
    }
  }

  /**
   * Get the top N most frequently accessed files ("hot path" files).
   */
  getHotFiles(n = 3): string[] {
    return [...this.hotFiles.values()]
      .sort((a, b) => b.readCount - a.readCount)
      .slice(0, n)
      .map(f => f.path);
  }

  /**
   * After compression, rehydrate context by re-reading the top hot files.
   * This preserves agent momentum without token bloat.
   *
   * @param fileReader - async function that reads a file by path, returns content or null
   * @param hotFiles - explicit list of file paths to rehydrate (overrides auto-detection)
   */
  async rehydrate(
    fileReader: (path: string) => Promise<string | null>,
    hotFiles?: string[],
  ): Promise<ChatMessage[]> {
    const paths = hotFiles || this.getHotFiles(3);
    const messages: ChatMessage[] = [];

    for (const filePath of paths) {
      try {
        const content = await fileReader(filePath);
        if (content) {
          // Only include first 50 lines to save tokens
          const lines = content.split('\n');
          const truncated = lines.slice(0, 50).join('\n');
          const suffix = lines.length > 50 ? `\n... (${lines.length - 50} more lines)` : '';
          messages.push({
            role: 'system',
            content: `[REHYDRATED] File: ${filePath}\n\n${truncated}${suffix}`,
          });
        }
      } catch {
        // Skip unreadable files
      }
    }

    return messages;
  }

  /**
   * Combined compress + rehydrate pass.
   * Compresses old context, then injects hot file summaries.
   */
  async maybeCompressAndRehydrate(
    messages: ChatMessage[],
    fileReader: (path: string) => Promise<string | null>,
    llmCompressor?: (text: string) => Promise<string>,
  ): Promise<{ messages: ChatMessage[]; stats: CompressionStats; rehydratedFiles: string[] }> {
    // Step 1: Compress
    const { messages: compressed, stats } = await this.maybeCompress(messages, llmCompressor);

    // Step 2: Rehydrate if compression occurred
    let rehydratedFiles: string[] = [];
    if (stats.triggered) {
      const rehydrationMsgs = await this.rehydrate(fileReader);
      if (rehydrationMsgs.length > 0) {
        // Insert rehydrated files after the compression summary
        const insertIdx = compressed.findIndex(m => m.content?.includes('ACTION HISTORY & LEARNINGS'));
        const insertAt = insertIdx >= 0 ? insertIdx + 1 : Math.min(2, compressed.length);
        compressed.splice(insertAt, 0, ...rehydrationMsgs);
        rehydratedFiles = this.getHotFiles(3);
        console.log(`[ContextCompression] Rehydrated ${rehydratedFiles.length} hot files after compression`);
      }
    }

    return { messages: compressed, stats, rehydratedFiles };
  }
}
