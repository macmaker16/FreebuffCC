/**
 * FreebuffCC Agent System - Terminal Skill
 * 
 * Provides terminal/command execution capabilities.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { AgentSkill, ExecutionContext, ToolResult } from '../types';

const execAsync = promisify(exec);

const BLOCKED_COMMANDS = ['rm -rf /', 'rm -rf /*', 'mkfs', ':(){:|:&};:'];

export const TerminalSkill: AgentSkill = {
  name: 'terminal',
  description: 'Execute terminal/shell commands',
  tools: [
    {
      type: 'function',
      function: {
        name: 'run_command',
        description: 'Execute a terminal/shell command. Returns stdout and stderr.',
        parameters: {
          type: 'object',
          properties: {
            command: { type: 'string', description: 'The shell command to execute' },
            cwd: { type: 'string', description: 'Working directory (optional)' },
          },
          required: ['command'],
        },
      },
    },
  ],

  async execute(toolName: string, args: Record<string, any>, ctx: ExecutionContext): Promise<ToolResult> {
    if (toolName !== 'run_command') {
      return { success: false, output: '', error: `Unknown tool: ${toolName}` };
    }

    const { command, cwd } = args;

    // Security check
    const lowerCmd = command.toLowerCase().trim();
    for (const blocked of BLOCKED_COMMANDS) {
      if (lowerCmd.includes(blocked)) {
        return { success: false, output: '', error: `Command blocked for safety: ${blocked}` };
      }
    }

    const startTime = Date.now();
    const workingDir = cwd || ctx.workspace;

    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd: workingDir,
        timeout: 60000,
        maxBuffer: 1024 * 1024,
        env: { ...process.env, FORCE_COLOR: '0' },
      });

      let result = '';
      if (stdout) result += stdout;
      if (stderr) result += (result ? '\n--- STDERR ---\n' : '') + stderr;
      if (!result.trim()) result = '(command completed with no output)';

      if (result.length > 10000) result = result.substring(0, 10000) + '\n... [truncated]';

      return { success: true, output: result, duration_ms: Date.now() - startTime };
    } catch (err: any) {
      let errorMsg = err.message;
      if (err.stdout) errorMsg += `\n--- STDOUT ---\n${err.stdout}`;
      if (err.stderr) errorMsg += `\n--- STDERR ---\n${err.stderr}`;
      if (errorMsg.length > 10000) errorMsg = errorMsg.substring(0, 10000) + '\n... [truncated]';
      return { success: false, output: '', error: errorMsg, duration_ms: Date.now() - startTime };
    }
  },
};
