/**
 * Michaelangelo Agent - Subagent Dispatch
 *
 * Allows the main agent to spawn isolated background sub-agents
 * with their own context windows to handle independent research
 * tasks or parallel multi-file updates, merging results back.
 *
 * Each sub-agent gets:
 *   - Its own system prompt and context window
 *   - A subset of tools (read-only by default)
 *   - A timeout (prevents runaway agents)
 *
 * Flow:
 *  1. Main agent calls `dispatch_agent` tool with task description
 *  2. System creates isolated LLM session with focused system prompt
 *  3. Sub-agent runs autonomously until completion or timeout
 *  4. Results are collected and returned to main agent
 *  5. Main agent integrates results into its context
 */

import { ChatMessage, ToolResult } from './types';

// ============================================================================
// TYPES
// ============================================================================

export interface DispatchConfig {
  baseUrl: string;
  apiKey: string;
  authPrefix: string;
  model: string;
  workspace: string;
  /** Max sub-agents running concurrently */
  maxConcurrent?: number;
  /** Per-agent timeout in ms */
  agentTimeout?: number;
  /** Max iterations per sub-agent */
  maxIterations?: number;
}

export interface SubAgentTask {
  id: string;
  description: string;
  prompt: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'timeout';
  result?: string;
  startedAt?: number;
  completedAt?: number;
  toolCalls: number;
  tokens: number;
}

// ============================================================================
// SUBAGENT DISPATCH
// ============================================================================

export class SubagentDispatch {
  private config: Required<DispatchConfig>;
  private runningAgents = new Map<string, SubAgentTask>();
  private completedAgents: SubAgentTask[] = [];

  constructor(config: DispatchConfig) {
    this.config = {
      maxConcurrent: 3,
      agentTimeout: 120000,  // 2 minutes
      maxIterations: 10,
      ...config,
    };
  }

  /**
   * Dispatch a new sub-agent with a focused task.
   */
  async dispatch(
    description: string,
    prompt: string,
    allowedTools?: string[],
  ): Promise<ToolResult> {
    // Check concurrency limit
    if (this.runningAgents.size >= this.config.maxConcurrent) {
      return {
        success: false,
        output: '',
        error: `Max concurrent sub-agents (${this.config.maxConcurrent}) reached. Wait for one to finish.`,
      };
    }

    const taskId = `sub_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    const task: SubAgentTask = {
      id: taskId,
      description,
      prompt,
      status: 'running',
      startedAt: Date.now(),
      toolCalls: 0,
      tokens: 0,
    };

    this.runningAgents.set(taskId, task);
    console.log(`[SubAgent] Dispatched: ${taskId} — ${description}`);

    // Run the sub-agent
    try {
      const result = await this.runSubAgent(task, allowedTools);
      task.result = result;
      task.status = 'completed';
      task.completedAt = Date.now();

      return {
        success: true,
        output: `## Sub-agent Result: ${description}\n\n${result}`,
      };
    } catch (err: any) {
      task.result = err.message;
      task.status = err.message === 'timeout' ? 'timeout' : 'failed';
      task.completedAt = Date.now();

      return {
        success: false,
        output: '',
        error: `Sub-agent failed: ${err.message}`,
      };
    } finally {
      this.runningAgents.delete(taskId);
      this.completedAgents.push(task);
    }
  }

  /**
   * Run a single sub-agent's LLM loop.
   */
  private async runSubAgent(task: SubAgentTask, allowedTools?: string[]): Promise<string> {
    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: [
          'You are a focused research sub-agent working inside the Michaelangelo coding assistant.',
          `Your task: ${task.description}`,
          '',
          'Rules:',
          '- You have read-only access to the filesystem.',
          '- Explore files, analyze code, and return a clear summary.',
          '- Be concise. Focus on findings, not process.',
          '- If you cannot complete the task, explain why.',
          '',
          `Workspace: ${this.config.workspace}`,
        ].join('\n'),
      },
      { role: 'user', content: task.prompt },
    ];

    const startTime = Date.now();
    const maxIterations = this.config.maxIterations;

    for (let iter = 0; iter < maxIterations; iter++) {
      // Check timeout
      if (Date.now() - startTime > this.config.agentTimeout) {
        throw new Error('timeout');
      }

      // Build request
      const body: any = {
        model: this.config.model,
        messages,
        max_tokens: 2048,
        temperature: 0.3,
      };

      // Include a minimal tool set for sub-agents
      const tools = this.getSubAgentTools(allowedTools);
      if (tools.length > 0) {
        body.tools = tools;
        body.tool_choice = 'auto';
      }

      const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `${this.config.authPrefix}${this.config.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.config.agentTimeout),
      });

      if (!response.ok) {
        throw new Error(`API ${response.status}: ${await response.text().catch(() => '')}`);
      }

      const data = await response.json() as any;
      const choice = data.choices?.[0];
      if (!choice) throw new Error('No response from LLM');

      const assistantMsg = choice.message;
      messages.push({
        role: 'assistant',
        content: assistantMsg.content,
        tool_calls: assistantMsg.tool_calls,
      });

      // Track tokens
      if (data.usage) {
        task.tokens += (data.usage.prompt_tokens || 0) + (data.usage.completion_tokens || 0);
      }

      // If no tool calls, return the content
      if (!assistantMsg.tool_calls || assistantMsg.tool_calls.length === 0) {
        return assistantMsg.content || '(no response)';
      }

      // Execute tool calls (sub-agents get limited tools)
      for (const toolCall of assistantMsg.tool_calls) {
        task.toolCalls++;
        const result = await this.executeSubAgentTool(toolCall);
        messages.push({
          role: 'tool',
          content: result,
          tool_call_id: toolCall.id,
        });
      }
    }

    // Return last assistant message
    const lastAssistant = messages.filter(m => m.role === 'assistant' && m.content).pop();
    return lastAssistant?.content || '(max iterations reached)';
  }

  /**
   * Execute a sub-agent tool call (read-only operations).
   */
  private async executeSubAgentTool(toolCall: any): Promise<string> {
    let args: Record<string, any>;
    try {
      args = JSON.parse(toolCall.function.arguments);
    } catch {
      return 'ERROR: Failed to parse tool arguments';
    }

    const { exec } = require('child_process');
    const { readFile, readdir, access } = require('fs/promises');
    const { join, resolve, relative } = require('path');
    const util = require('util');
    const execAsync = util.promisify(exec);

    const name = toolCall.function.name;

    try {
      switch (name) {
        case 'read_file': {
          const filePath = resolve(this.config.workspace, args.file_path);
          const content = await readFile(filePath, 'utf-8');
          const maxLen = 8000;
          return content.length > maxLen ? content.substring(0, maxLen) + '\n...[truncated]' : content;
        }
        case 'list_files': {
          const dirPath = resolve(this.config.workspace, args.dir_path || '.');
          const entries = await readdir(dirPath, { withFileTypes: true });
          return entries.map((e: any) => `${e.isDirectory() ? '📁' : '📄'} ${e.name}`).join('\n');
        }
        case 'search_files': {
          const { stdout } = await execAsync(
            `rg -l "${args.pattern}" "${this.config.workspace}" 2>/dev/null | head -20`,
            { timeout: 10000 },
          );
          return stdout.trim() || 'No matches found';
        }
        case 'run_command': {
          // Sub-agents can run read-only commands
          const cmd = args.command || '';
          if (/\b(rm|del|write|install|deploy|push|force)\b/i.test(cmd)) {
            return 'ERROR: Sub-agents cannot run destructive commands';
          }
          const { stdout, stderr } = await execAsync(cmd, {
            cwd: this.config.workspace,
            timeout: 30000,
            maxBuffer: 1024 * 1024,
          });
          return stdout || stderr || '(no output)';
        }
        default:
          return `ERROR: Sub-agent tool "${name}" not available`;
      }
    } catch (err: any) {
      return `ERROR: ${err.message}`;
    }
  }

  /**
   * Minimal tool definitions for sub-agents.
   */
  private getSubAgentTools(allowedTools?: string[]): any[] {
    const allTools = [
      {
        type: 'function',
        function: {
          name: 'read_file',
          description: 'Read the contents of a file.',
          parameters: {
            type: 'object',
            properties: { file_path: { type: 'string' } },
            required: ['file_path'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'list_files',
          description: 'List files and directories in a path.',
          parameters: {
            type: 'object',
            properties: { dir_path: { type: 'string' } },
            required: [],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'search_files',
          description: 'Search for a pattern across files.',
          parameters: {
            type: 'object',
            properties: { pattern: { type: 'string' } },
            required: ['pattern'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'run_command',
          description: 'Run a read-only shell command.',
          parameters: {
            type: 'object',
            properties: { command: { type: 'string' } },
            required: ['command'],
          },
        },
      },
    ];

    if (allowedTools && allowedTools.length > 0) {
      return allTools.filter(t => allowedTools.includes(t.function.name));
    }
    return allTools;
  }

  /**
   * Get status of all running/completed agents.
   */
  getStatus(): {
    running: SubAgentTask[];
    completed: SubAgentTask[];
    totalTokens: number;
  } {
    return {
      running: [...this.runningAgents.values()],
      completed: this.completedAgents,
      totalTokens: this.completedAgents.reduce((sum, a) => sum + a.tokens, 0),
    };
  }

  /**
   * Cancel all running agents.
   */
  cancelAll(): void {
    for (const [, task] of this.runningAgents) {
      task.status = 'failed';
      task.result = 'Cancelled by parent';
      task.completedAt = Date.now();
    }
    this.runningAgents.clear();
  }
}
