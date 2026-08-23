/**
 * Michaelangelo Agent - Error Recovery Plugin
 *
 * Monitors tool execution errors and:
 * - Tracks error patterns (which tools fail, how often)
 * - Injects error context into subsequent messages to help the LLM avoid repeating mistakes
 * - Provides error statistics for debugging
 */

import { AgentPlugin, HookContext } from '../types';

export class ErrorRecoveryPlugin implements AgentPlugin {
  name = 'error-recovery';
  description = 'Tracks errors and injects recovery context';
  version = '1.0.0';
  enabled = true;

  private errors: Array<{
    tool: string;
    error: string;
    iteration: number;
    timestamp: number;
  }> = [];

  private maxErrorsTracked = 20;

  hooks: AgentPlugin['hooks'] = {
    onPostToolUse: async (ctx: HookContext) => {
      if (!ctx.toolResult || ctx.toolResult.success) return;
      if (!ctx.toolCall) return;

      const error = ctx.toolResult.error || ctx.toolResult.output || 'Unknown error';

      this.errors.push({
        tool: ctx.toolCall.function.name,
        error: error.substring(0, 500),
        iteration: (ctx.metadata?.iteration as number) || 0,
        timestamp: Date.now(),
      });

      // Trim to prevent memory growth
      if (this.errors.length > this.maxErrorsTracked) {
        this.errors = this.errors.slice(-this.maxErrorsTracked);
      }

      console.log(`[ErrorRecovery] Tracked error in ${ctx.toolCall.function.name}: ${error.substring(0, 100)}`);
    },

    onPhaseComplete: async (ctx: HookContext) => {
      // If there were errors in this phase, inject a recovery hint
      const recentErrors = this.errors.filter(
        e => e.iteration >= ((ctx.metadata?.iteration as number) || 0) - 3
      );

      if (recentErrors.length >= 2) {
        const errorSummary = recentErrors
          .map(e => `- ${e.tool}: ${e.error.substring(0, 150)}`)
          .join('\n');

        // Add a system message with recovery hints
        ctx.messages.push({
          role: 'system',
          content: `[ERROR PATTERN DETECTED] Multiple tool failures occurred:\n${errorSummary}\n\nPlease analyze these errors and adjust your approach. Consider:\n1. Are you using the correct file paths?\n2. Are the commands syntactically correct?\n3. Is the file you're editing the right version?`,
        });
      }
    },
  };

  /** Get error statistics */
  getStats(): {
    totalErrors: number;
    errorsByTool: Record<string, number>;
    recentErrors: Array<{ tool: string; error: string; iteration: number; timestamp: number }>;
  } {
    const errorsByTool: Record<string, number> = {};
    for (const e of this.errors) {
      errorsByTool[e.tool] = (errorsByTool[e.tool] || 0) + 1;
    }

    return {
      totalErrors: this.errors.length,
      errorsByTool,
      recentErrors: this.errors.slice(-5),
    };
  }

  /** Reset error tracking */
  reset(): void {
    this.errors = [];
  }
}
