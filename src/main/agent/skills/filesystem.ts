/**
 * Michaelangelo Agent - Enhanced FileSystem Skill
 * Read, write, list files, and search within files (like Claude Code)
 */

import { readFile, writeFile, mkdir, access, readdir, stat } from 'fs/promises';
import { dirname, resolve, isAbsolute, relative, join } from 'path';
import { AgentSkill, ExecutionContext, ToolResult } from '../types';
import { promisify } from 'util';
import { exec } from 'child_process';

const execAsync = promisify(exec);

function resolvePath(filePath: string, workspace: string): string {
  if (isAbsolute(filePath)) return resolve(filePath);
  return resolve(workspace, filePath);
}

function isPathSafe(filePath: string, workspace: string): boolean {
  return resolvePath(filePath, workspace).startsWith(resolve(workspace));
}

/** Recursively list files, respecting .gitignore patterns */
async function listDir(dirPath: string, workspace: string, maxDepth = 3, currentDepth = 0): Promise<string[]> {
  if (currentDepth > maxDepth) return [];
  const results: string[] = [];
  try {
    const entries = await readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === '__pycache__') continue;
      const fullPath = join(dirPath, entry.name);
      const relPath = relative(workspace, fullPath);
      if (entry.isDirectory()) {
        results.push(relPath + '/');
        const sub = await listDir(fullPath, workspace, maxDepth, currentDepth + 1);
        results.push(...sub);
      } else {
        results.push(relPath);
      }
    }
  } catch { /* ignore unreadable dirs */ }
  return results;
}

export const FileSystemSkill: AgentSkill = {
  name: 'filesystem',
  description: 'Read, write, list, and search files',
  tools: [
    {
      type: 'function',
      function: {
        name: 'read_file',
        description: 'Read the contents of a file. Returns the full text content.',
        parameters: {
          type: 'object',
          properties: {
            file_path: { type: 'string', description: 'Path to the file (relative to workspace or absolute)' },
          },
          required: ['file_path'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'write_file',
        description: 'Write content to a file. Creates the file if it does not exist, overwrites if it does. Creates parent directories automatically.',
        parameters: {
          type: 'object',
          properties: {
            file_path: { type: 'string', description: 'Path to the file' },
            content: { type: 'string', description: 'The content to write to the file' },
          },
          required: ['file_path', 'content'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'list_files',
        description: 'List files and directories in a given path. Shows file tree structure.',
        parameters: {
          type: 'object',
          properties: {
            dir_path: { type: 'string', description: 'Directory path (defaults to workspace root)' },
            max_depth: { type: 'number', description: 'Maximum depth to traverse (default 3)' },
          },
          required: [],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'search_files',
        description: 'Search for a text pattern across files in the workspace. Returns matching file paths and line numbers.',
        parameters: {
          type: 'object',
          properties: {
            pattern: { type: 'string', description: 'Text pattern or regex to search for' },
            file_pattern: { type: 'string', description: 'Optional glob filter (e.g. "*.ts", "*.py")' },
            max_results: { type: 'number', description: 'Maximum results to return (default 20)' },
          },
          required: ['pattern'],
        },
      },
    },
  ],

  async execute(toolName: string, args: Record<string, any>, ctx: ExecutionContext): Promise<ToolResult> {
    const startTime = Date.now();

    switch (toolName) {
      case 'read_file': {
        const { file_path } = args;
        if (!isPathSafe(file_path, ctx.workspace)) {
          return { success: false, output: '', error: `Path outside workspace: ${file_path}` };
        }
        try {
          const fullPath = resolvePath(file_path, ctx.workspace);
          await access(fullPath);
          const content = await readFile(fullPath, 'utf-8');
          if (content.length > 50000) {
            return { success: true, output: content.substring(0, 50000) + '\n\n... [truncated, ' + content.length + ' bytes total]', duration_ms: Date.now() - startTime };
          }
          return { success: true, output: content || '(empty file)', duration_ms: Date.now() - startTime };
        } catch (err: any) {
          return { success: false, output: '', error: err.code === 'ENOENT' ? `File not found: ${file_path}` : err.message, duration_ms: Date.now() - startTime };
        }
      }

      case 'write_file': {
        const { file_path, content } = args;
        if (!isPathSafe(file_path, ctx.workspace)) {
          return { success: false, output: '', error: `Path outside workspace: ${file_path}` };
        }
        try {
          const fullPath = resolvePath(file_path, ctx.workspace);
          await mkdir(dirname(fullPath), { recursive: true });
          await writeFile(fullPath, content, 'utf-8');
          const lines = content.split('\n').length;
          const bytes = Buffer.byteLength(content, 'utf-8');
          return { success: true, output: `Wrote ${lines} lines (${bytes} bytes) to ${file_path}`, duration_ms: Date.now() - startTime };
        } catch (err: any) {
          return { success: false, output: '', error: err.message, duration_ms: Date.now() - startTime };
        }
      }

      case 'list_files': {
        const { dir_path = '.', max_depth = 3 } = args;
        const fullPath = resolvePath(dir_path, ctx.workspace);
        try {
          const files = await listDir(fullPath, ctx.workspace, max_depth);
          if (files.length === 0) return { success: true, output: '(empty directory)', duration_ms: Date.now() - startTime };
          return { success: true, output: files.join('\n'), duration_ms: Date.now() - startTime };
        } catch (err: any) {
          return { success: false, output: '', error: err.message, duration_ms: Date.now() - startTime };
        }
      }

      case 'search_files': {
        const { pattern, file_pattern, max_results = 20 } = args;
        try {
          let cmd = `rg -n --max-count 5 "${pattern.replace(/"/g, '\\"')}"`;
          if (file_pattern) cmd += ` -g "${file_pattern}"`;
          cmd += ` --max-columns 200 --max-columns-preview`;
          const { stdout } = await execAsync(cmd, { cwd: ctx.workspace, timeout: 15000, maxBuffer: 1024 * 1024 });
          const lines = stdout.trim().split('\n').filter(Boolean);
          if (lines.length > max_results) {
            return { success: true, output: lines.slice(0, max_results).join('\n') + `\n... [${lines.length} total matches, showing ${max_results}]`, duration_ms: Date.now() - startTime };
          }
          return { success: true, output: lines.length > 0 ? lines.join('\n') : 'No matches found', duration_ms: Date.now() - startTime };
        } catch (err: any) {
          return { success: false, output: '', error: err.message, duration_ms: Date.now() - startTime };
        }
      }

      default:
        return { success: false, output: '', error: `Unknown tool: ${toolName}` };
    }
  },
};
