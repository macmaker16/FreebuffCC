/**
 * Michaelangelo Agent - Git Skill
 * Git integration: status, diff, stage, commit, branch, log
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { AgentSkill, ExecutionContext, ToolResult } from '../types';

const execAsync = promisify(exec);

async function git(args: string, cwd: string): Promise<{ stdout: string; stderr: string }> {
  return execAsync(`git ${args}`, { cwd, timeout: 30000, maxBuffer: 1024 * 1024, env: { ...process.env, FORCE_COLOR: '0' } });
}

export const GitSkill: AgentSkill = {
  name: 'git',
  description: 'Git version control operations',
  tools: [
    {
      type: 'function',
      function: {
        name: 'git_status',
        description: 'Show the working tree status (modified, staged, untracked files).',
        parameters: { type: 'object', properties: {}, required: [] },
      },
    },
    {
      type: 'function',
      function: {
        name: 'git_diff',
        description: 'Show changes between working tree and staging area, or between commits.',
        parameters: {
          type: 'object',
          properties: {
            file: { type: 'string', description: 'Optional specific file to diff' },
            staged: { type: 'boolean', description: 'Show staged changes instead' },
          },
          required: [],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'git_add',
        description: 'Stage files for commit.',
        parameters: {
          type: 'object',
          properties: {
            files: { type: 'string', description: 'Space-separated file paths, or "." for all' },
          },
          required: ['files'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'git_commit',
        description: 'Create a git commit with a message.',
        parameters: {
          type: 'object',
          properties: {
            message: { type: 'string', description: 'Commit message' },
          },
          required: ['message'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'git_log',
        description: 'Show recent commit history.',
        parameters: {
          type: 'object',
          properties: {
            count: { type: 'number', description: 'Number of commits to show (default 10)' },
          },
          required: [],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'git_branch',
        description: 'Create or switch to a branch.',
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Branch name' },
            create: { type: 'boolean', description: 'Create new branch (default false = switch)' },
          },
          required: ['name'],
        },
      },
    },
  ],

  async execute(toolName: string, args: Record<string, any>, ctx: ExecutionContext): Promise<ToolResult> {
    const startTime = Date.now();
    const cwd = ctx.workspace;

    try {
      let output = '';
      switch (toolName) {
        case 'git_status': {
          const { stdout } = await git('status --short', cwd);
          output = stdout.trim() || 'Working tree clean';
          break;
        }
        case 'git_diff': {
          const { file, staged } = args;
          let cmd = 'diff';
          if (staged) cmd += ' --staged';
          if (file) cmd += ` -- "${file}"`;
          const { stdout } = await git(cmd, cwd);
          output = stdout.trim() || 'No changes';
          break;
        }
        case 'git_add': {
          const { files } = args;
          await git(`add ${files}`, cwd);
          output = `Staged: ${files}`;
          break;
        }
        case 'git_commit': {
          const { message } = args;
          const { stdout } = await git(`commit -m "${message.replace(/"/g, '\\"')}"`, cwd);
          output = stdout.trim();
          break;
        }
        case 'git_log': {
          const { count = 10 } = args;
          const { stdout } = await git(`log --oneline -${count}`, cwd);
          output = stdout.trim() || 'No commits yet';
          break;
        }
        case 'git_branch': {
          const { name, create } = args;
          if (create) {
            await git(`checkout -b ${name}`, cwd);
            output = `Created and switched to branch: ${name}`;
          } else {
            await git(`checkout ${name}`, cwd);
            output = `Switched to branch: ${name}`;
          }
          break;
        }
        default:
          return { success: false, output: '', error: `Unknown git tool: ${toolName}` };
      }
      return { success: true, output, duration_ms: Date.now() - startTime };
    } catch (err: any) {
      return { success: false, output: '', error: err.message, duration_ms: Date.now() - startTime };
    }
  },
};
