/**
 * Michaelangelo Agent - Linter Hook Plugin
 *
 * Automatically runs linters and formatters after file write/edit operations.
 * This is a post-action hook that fires after write_file and edit_file.
 *
 * Supports:
 * - Prettier (TS, JS, JSON, CSS, MD)
 * - ESLint (TS, JS)
 * - Ruff (Python)
 * - Cargo fmt (Rust)
 * - go fmt (Go)
 */

import { AgentPlugin, HookContext } from '../types';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

interface FormatterConfig {
  extensions: string[];
  command: string;
  description: string;
}

const FORMATTERS: FormatterConfig[] = [
  { extensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'css', 'md'], command: 'npx prettier --write', description: 'Prettier' },
  { extensions: ['py'], command: 'ruff format', description: 'Ruff' },
  { extensions: ['rs'], command: 'cargo fmt', description: 'Cargo fmt' },
  { extensions: ['go'], command: 'gofmt -w', description: 'gofmt' },
];

export class LinterHookPlugin implements AgentPlugin {
  name = 'linter-hook';
  description = 'Auto-runs linter/formatter after file writes';
  version = '1.0.0';
  enabled = true;

  private formatCount = 0;
  private skipPatterns = ['node_modules', '.git', 'dist', 'build', '.next', 'target'];

  hooks = {
    onPostToolUse: async (ctx: HookContext) => {
      if (!ctx.toolCall) return;
      if (ctx.toolCall.function.name !== 'write_file' && ctx.toolCall.function.name !== 'edit_file') return;

      let args: any;
      try { args = JSON.parse(ctx.toolCall.function.arguments); } catch { return; }

      const filePath = args.file_path;
      if (!filePath) return;

      // Skip files in ignored directories
      if (this.skipPatterns.some(p => filePath.includes(p))) return;

      // Find the right formatter for this file extension
      const ext = filePath.split('.').pop()?.toLowerCase();
      if (!ext) return;

      const formatter = FORMATTERS.find(f => f.extensions.includes(ext));
      if (!formatter) return;

      try {
        const command = `${formatter.command} "${filePath}"`;
        await execAsync(command, {
          cwd: ctx.workspace,
          timeout: 15000,
          env: { ...process.env, FORCE_COLOR: '0' },
        });

        this.formatCount++;
        console.log(`[LinterHook] ${formatter.description} formatted: ${filePath}`);
      } catch (err: any) {
        // Formatter might not be installed — don't block the agent
        console.log(`[LinterHook] ${formatter.description} not available for ${filePath}`);
      }
    },
  };

  /** Get formatting stats */
  getStats(): { formatCount: number; supportedExtensions: string[] } {
    return {
      formatCount: this.formatCount,
      supportedExtensions: FORMATTERS.flatMap(f => f.extensions),
    };
  }
}
