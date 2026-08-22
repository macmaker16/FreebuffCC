/**
 * Michaelangelo Agent - Enhanced FileSystem Skill
 * Read, write, edit (diff-based), list, search (ripgrep), glob (pattern match)
 */

import { readFile, writeFile, mkdir, access, readdir } from 'fs/promises';
import { dirname, resolve, isAbsolute, relative, join, basename } from 'path';
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

/** Recursively list files */
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
        results.push(...await listDir(fullPath, workspace, maxDepth, currentDepth + 1));
      } else {
        results.push(relPath);
      }
    }
  } catch { /* ignore */ }
  return results;
}

export const FileSystemSkill: AgentSkill = {
  name: 'filesystem',
  description: 'Read, write, edit, list, search, and glob files',
  tools: [
    {
      type: 'function',
      function: {
        name: 'read_file',
        description: 'Read the contents of a file.',
        parameters: {
          type: 'object',
          properties: {
            file_path: { type: 'string', description: 'Path to the file' },
          },
          required: ['file_path'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'write_file',
        description: 'Write content to a file. Creates parent directories automatically.',
        parameters: {
          type: 'object',
          properties: {
            file_path: { type: 'string', description: 'Path to the file' },
            content: { type: 'string', description: 'Content to write' },
          },
          required: ['file_path', 'content'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'edit_file',
        description: 'Edit a file by replacing a specific string. Provide the exact old_string to find and the new_string to replace it with. This is a diff-based edit — only the specified section changes.',
        parameters: {
          type: 'object',
          properties: {
            file_path: { type: 'string', description: 'Path to the file to edit' },
            old_string: { type: 'string', description: 'The exact string to find and replace (must match exactly, including whitespace)' },
            new_string: { type: 'string', description: 'The string to replace old_string with' },
          },
          required: ['file_path', 'old_string', 'new_string'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'list_files',
        description: 'List files and directories in a given path.',
        parameters: {
          type: 'object',
          properties: {
            dir_path: { type: 'string', description: 'Directory path (defaults to workspace root)' },
            max_depth: { type: 'number', description: 'Maximum depth (default 3)' },
          },
          required: [],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'search_files',
        description: 'Search for a text pattern across files using ripgrep. Returns matching file paths and line numbers.',
        parameters: {
          type: 'object',
          properties: {
            pattern: { type: 'string', description: 'Text pattern or regex to search for' },
            file_pattern: { type: 'string', description: 'Optional glob filter (e.g. "*.ts")' },
            max_results: { type: 'number', description: 'Maximum results (default 20)' },
          },
          required: ['pattern'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'glob_files',
        description: 'Find files matching a glob pattern (e.g. "**/*.ts", "src/**/*.test.js").',
        parameters: {
          type: 'object',
          properties: {
            pattern: { type: 'string', description: 'Glob pattern to match files' },
            max_results: { type: 'number', description: 'Maximum results (default 50)' },
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
        if (!isPathSafe(file_path, ctx.workspace)) return { success: false, output: '', error: `Path outside workspace: ${file_path}` };
        try {
          const content = await readFile(resolvePath(file_path, ctx.workspace), 'utf-8');
          if (content.length > 50000) return { success: true, output: content.substring(0, 50000) + '\n\n... [truncated]', duration_ms: Date.now() - startTime };
          return { success: true, output: content || '(empty file)', duration_ms: Date.now() - startTime };
        } catch (err: any) {
          return { success: false, output: '', error: err.code === 'ENOENT' ? `File not found: ${file_path}` : err.message, duration_ms: Date.now() - startTime };
        }
      }

      case 'write_file': {
        const { file_path, content } = args;
        if (!isPathSafe(file_path, ctx.workspace)) return { success: false, output: '', error: `Path outside workspace: ${file_path}` };
        try {
          const fullPath = resolvePath(file_path, ctx.workspace);
          await mkdir(dirname(fullPath), { recursive: true });
          await writeFile(fullPath, content, 'utf-8');
          return { success: true, output: `Wrote ${content.split('\n').length} lines (${Buffer.byteLength(content)} bytes) to ${file_path}`, duration_ms: Date.now() - startTime };
        } catch (err: any) {
          return { success: false, output: '', error: err.message, duration_ms: Date.now() - startTime };
        }
      }

      case 'edit_file': {
        const { file_path, old_string, new_string } = args;
        if (!isPathSafe(file_path, ctx.workspace)) return { success: false, output: '', error: `Path outside workspace: ${file_path}` };
        try {
          const fullPath = resolvePath(file_path, ctx.workspace);
          let content = await readFile(fullPath, 'utf-8');
          if (!content.includes(old_string)) {
            return { success: false, output: '', error: `old_string not found in ${file_path}. Make sure it matches exactly including whitespace.`, duration_ms: Date.now() - startTime };
          }
          // Replace first occurrence
          content = content.replace(old_string, new_string);
          await writeFile(fullPath, content, 'utf-8');
          const oldLines = old_string.split('\n').length;
          const newLines = new_string.split('\n').length;
          return { success: true, output: `Edited ${file_path}: replaced ${oldLines} lines with ${newLines} lines`, duration_ms: Date.now() - startTime };
        } catch (err: any) {
          return { success: false, output: '', error: err.message, duration_ms: Date.now() - startTime };
        }
      }

      case 'list_files': {
        const { dir_path = '.', max_depth = 3 } = args;
        try {
          const files = await listDir(resolvePath(dir_path, ctx.workspace), ctx.workspace, max_depth);
          return { success: true, output: files.length > 0 ? files.join('\n') : '(empty directory)', duration_ms: Date.now() - startTime };
        } catch (err: any) {
          return { success: false, output: '', error: err.message, duration_ms: Date.now() - startTime };
        }
      }

      case 'search_files': {
        const { pattern, file_pattern, max_results = 20 } = args;
        try {
          let cmd = `rg -n --max-count 5 "${pattern.replace(/"/g, '\\"')}"`;
          if (file_pattern) cmd += ` -g "${file_pattern}"`;
          cmd += ` --max-columns 200`;
          const { stdout } = await execAsync(cmd, { cwd: ctx.workspace, timeout: 15000, maxBuffer: 1024 * 1024 });
          const lines = stdout.trim().split('\n').filter(Boolean);
          if (lines.length > max_results) {
            return { success: true, output: lines.slice(0, max_results).join('\n') + `\n... [${lines.length} total]`, duration_ms: Date.now() - startTime };
          }
          return { success: true, output: lines.length > 0 ? lines.join('\n') : 'No matches found', duration_ms: Date.now() - startTime };
        } catch (err: any) {
          return { success: false, output: '', error: err.message, duration_ms: Date.now() - startTime };
        }
      }

      case 'glob_files': {
        const { pattern, max_results = 50 } = args;
        try {
          // Use find for glob matching
          const { stdout } = await execAsync(
            `find . -path '${pattern}' -not -path '*/node_modules/*' -not -path '*/.git/*' -not -path '*/dist/*' | head -${max_results}`,
            { cwd: ctx.workspace, timeout: 15000, maxBuffer: 1024 * 1024 }
          );
          const files = stdout.trim().split('\n').filter(Boolean).map(f => f.replace(/^\.\//, ''));
          return { success: true, output: files.length > 0 ? files.join('\n') : 'No files match', duration_ms: Date.now() - startTime };
        } catch (err: any) {
          return { success: false, output: '', error: err.message, duration_ms: Date.now() - startTime };
        }
      }

      default:
        return { success: false, output: '', error: `Unknown tool: ${toolName}` };
    }
  },
};
