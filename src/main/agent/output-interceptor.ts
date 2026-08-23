/**
 * Michaelangelo Agent - Tool Output Interceptor & Truncation
 *
 * Intercepts all stdout/stderr from the Bash/PowerShell tool.
 * If terminal output exceeds a token threshold, compresses it using
 * a fast, cheap LLM call to extract ONLY:
 *   - Failure messages
 *   - Error codes
 *   - Stack frames
 *   - Relevant warnings
 *
 * The filtered summary is fed back to the main agent, saving context
 * tokens while preserving diagnostic value.
 */

import { ChatMessage } from './types';

// ============================================================================
// CONFIGURATION
// ============================================================================

const DEFAULT_MAX_TOKENS = 1500;
const CHARS_PER_TOKEN = 4;

export interface InterceptorConfig {
  /** Max tokens before interception triggers */
  maxTokens?: number;
  /** LLM compressor function (cheap model) */
  llmCompressor?: (prompt: string) => Promise<string>;
}

export interface InterceptionResult {
  wasIntercepted: boolean;
  originalLength: number;
  truncatedLength: number;
  tokensSaved: number;
  output: string;
  summary?: string;
}

// ============================================================================
// OUTPUT INTERCEPTOR
// ============================================================================

export class OutputInterceptor {
  private maxTokens: number;
  private llmCompressor?: (prompt: string) => Promise<string>;
  private interceptionCount = 0;
  private totalTokensSaved = 0;

  constructor(config?: InterceptorConfig) {
    this.maxTokens = config?.maxTokens ?? DEFAULT_MAX_TOKENS;
    this.llmCompressor = config?.llmCompressor;
  }

  /**
   * Main entry point: intercept and optionally compress tool output.
   */
  async intercept(
    output: string,
    toolName: string,
    args?: Record<string, any>,
  ): Promise<InterceptionResult> {
    const tokenEstimate = Math.ceil(output.length / CHARS_PER_TOKEN);

    // Under threshold — return as-is
    if (tokenEstimate <= this.maxTokens) {
      return {
        wasIntercepted: false,
        originalLength: output.length,
        truncatedLength: output.length,
        tokensSaved: 0,
        output,
      };
    }

    console.log(
      `[OutputInterceptor] ${toolName} output is ${tokenEstimate} tokens (threshold: ${this.maxTokens}), intercepting...`,
    );

    // Try LLM compression first
    if (this.llmCompressor) {
      try {
        const summary = await this.compressWithLLM(output, toolName, args);
        this.interceptionCount++;
        const saved = tokenEstimate - Math.ceil(summary.length / CHARS_PER_TOKEN);
        this.totalTokensSaved += saved;

        return {
          wasIntercepted: true,
          originalLength: output.length,
          truncatedLength: summary.length,
          tokensSaved: saved,
          output: summary,
          summary,
        };
      } catch (err: any) {
        console.error(`[OutputInterceptor] LLM compression failed, falling back to truncation:`, err.message);
      }
    }

    // Fallback: smart truncation
    const truncated = this.smartTruncate(output);
    this.interceptionCount++;
    const saved = tokenEstimate - Math.ceil(truncated.length / CHARS_PER_TOKEN);
    this.totalTokensSaved += saved;

    return {
      wasIntercepted: true,
      originalLength: output.length,
      truncatedLength: truncated.length,
      tokensSaved: saved,
      output: truncated,
    };
  }

  /**
   * Compress output using a cheap LLM to extract errors and relevant info.
   */
  private async compressWithLLM(
    output: string,
    toolName: string,
    args?: Record<string, any>,
  ): Promise<string> {
    const truncOutput = output.substring(0, 10000); // Cap input to LLM

    const prompt = `You are an error log compressor. Given terminal/command output, extract ONLY the essential diagnostic information.

RULES:
- Extract error messages, error codes, and stack traces
- Extract warnings that might be relevant
- Extract the last 5 lines of output (often contain the result)
- Include file paths mentioned in errors
- DO NOT explain or add commentary
- Output should be ~10-20% of the original size
- If the command succeeded, just say "Command succeeded" and include the last few lines

Command: ${toolName}${args?.command ? ` — ${args.command}` : ''}
Output (${output.length} chars):
${truncOutput}`;

    const result = await this.llmCompressor!(prompt);
    return result || this.smartTruncate(output);
  }

  /**
   * Smart truncation without LLM: keep errors, stack traces, and tail.
   */
  private smartTruncate(output: string): string {
    const lines = output.split('\n');
    const maxChars = this.maxTokens * CHARS_PER_TOKEN;

    // Extract error lines (contain ERROR, FAIL, error codes, stack traces)
    const errorLines: string[] = [];
    const tailLines: string[] = [];
    const seen = new Set<number>();

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lower = line.toLowerCase();

      if (
        lower.includes('error') ||
        lower.includes('fail') ||
        lower.includes('exception') ||
        lower.includes('warning') ||
        lower.includes('stack trace') ||
        lower.includes('at ') && lower.includes('(') ||
        /^\s*at\s+/.test(line) ||
        lower.includes('exit code') ||
        lower.includes('errno') ||
        line.match(/^\s*\^/) // Caret underlines (compiler errors)
      ) {
        errorLines.push(line);
        seen.add(i);
      }
    }

    // Always include last 10 lines
    const tailStart = Math.max(0, lines.length - 10);
    for (let i = tailStart; i < lines.length; i++) {
      if (!seen.has(i)) {
        tailLines.push(lines[i]);
        seen.add(i);
      }
    }

    // Combine and truncate
    const parts: string[] = [];
    if (errorLines.length > 0) {
      parts.push('--- ERRORS & WARNINGS ---');
      parts.push(...errorLines.slice(0, 30)); // Cap error lines
    }
    if (tailLines.length > 0) {
      parts.push('--- LAST LINES ---');
      parts.push(...tailLines);
    }

    let result = parts.join('\n');
    if (result.length > maxChars) {
      result = result.substring(0, maxChars) + '\n... [truncated]';
    }

    return result || output.substring(0, maxChars) + '\n... [truncated]';
  }

  /**
   * Get interception statistics.
   */
  getStats(): {
    totalInterceptions: number;
    totalTokensSaved: number;
    avgTokensSavedPerInterception: number;
  } {
    return {
      totalInterceptions: this.interceptionCount,
      totalTokensSaved: this.totalTokensSaved,
      avgTokensSavedPerInterception: this.interceptionCount > 0
        ? Math.round(this.totalTokensSaved / this.interceptionCount)
        : 0,
    };
  }

  reset(): void {
    this.interceptionCount = 0;
    this.totalTokensSaved = 0;
  }
}
