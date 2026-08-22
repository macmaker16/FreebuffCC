/**
 * FreebuffCC Agent System - FileSystem Skill
 * 
 * Provides file read/write capabilities.
 */

import { readFile, writeFile, mkdir, access } from 'fs/promises';
import { dirname, resolve, isAbsolute } from 'path';
import { AgentSkill, ExecutionContext, ToolResult } from '../types';

function resolvePath(filePath: string, workspace: string): string {
  if (isAbsolute(filePath)) return resolve(filePath);
  return resolve(workspace, filePath);
}

function isPathSafe(filePath: string, workspace: string): boolean {
  return resolvePath(filePath, workspace).startsWith(resolve(workspace));
}

export const FileSystemSkill: AgentSkill = {
  name: 'filesystem',
  description: 'Read and write files',
  tools: [
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
  ],

  async execute(toolName: string, args: Record<string, any>, ctx: ExecutionContext): Promise<ToolResult> {
    const startTime = Date.now();

    if (toolName === 'write_file') {
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
        return {
          success: true,
          output: `SUCCESS: Wrote ${lines} lines (${bytes} bytes) to ${file_path}`,
          duration_ms: Date.now() - startTime,
        };
      } catch (err: any) {
        return { success: false, output: '', error: err.message, duration_ms: Date.now() - startTime };
      }
    }

    if (toolName === 'read_file') {
      const { file_path } = args;

      if (!isPathSafe(file_path, ctx.workspace)) {
        return { success: false, output: '', error: `Path outside workspace: ${file_path}` };
      }

      try {
        const fullPath = resolvePath(file_path, ctx.workspace);
        await access(fullPath);
        const content = await readFile(fullPath, 'utf-8');

        if (content.length > 50000) {
          return {
            success: true,
            output: content.substring(0, 50000) + '\n... [truncated]',
            duration_ms: Date.now() - startTime,
          };
        }

        return { success: true, output: content, duration_ms: Date.now() - startTime };
      } catch (err: any) {
        return {
          success: false,
          output: '',
          error: err.code === 'ENOENT' ? `File not found: ${file_path}` : err.message,
          duration_ms: Date.now() - startTime,
        };
      }
    }

    return { success: false, output: '', error: `Unknown tool: ${toolName}` };
  },
};
