/**
 * Michaelangelo Agent - Master Orchestrator
 * 
 * Clean autonomous tool-calling loop with:
 * - Human-in-the-loop permissions for destructive actions
 * - Auto-formatting after file writes
 * - Memory, MCP, Skills integration
 * - Dynamic Context Compression (auto-summarize when context is large)
 * - Multi-Model Routing (cheap orchestrator + heavy coder delegation)
 * - Workflow Meta-Tools (branch, commit, PR, tickets)
 */

import {
  ChatMessage, ToolCall, AgentTool, ExecutionContext, HookContext,
  OrchestratorConfig, OrchestratorResult, ToolResult, AgentSkill, AgentPhase,
} from './types';
import { LifecycleManager } from './lifecycle';
import { PluginRegistry } from './plugins/registry';
import { MemoryPlugin } from './plugins/memory-plugin';
import { MCPClientManager } from './mcp/client';
import { TerminalSkill } from './skills/terminal';
import { FileSystemSkill } from './skills/filesystem';
import { GitSkill } from './skills/git';
import { WorkflowMetaTools } from './skills/workflow';
import { MemorySearchSkill, setMemoryStore } from './skills/memory-search';
import { loadProjectInstructions } from './memory/instructions';
import { BUILTIN_SKILLS, detectSkillTrigger, expandSkillArgs } from './skills/builtin-skills';
import { SubAgentManager } from './subagent/manager';
import { PermissionManager, PermissionRequest } from './permissions';
import { ContextCompressionEngine, CompressionStats } from './context-compression';
import { MultiModelRouter, DelegationResult } from './multi-model-router';

const AGENT_SYSTEM_PROMPT = `You are Michaelangelo, an autonomous AI coding assistant.

Your job: Use your tools to complete the user's task. Do NOT output code blocks — use write_file, edit_file, and run_command instead.

APPROACH:
1. Read relevant files first to understand the codebase
2. Make changes using edit_file (for existing files) or write_file (for new files)
3. Run commands with run_command to test/verify
4. If something fails, fix it

TOOLS:
- read_file: Read a file's contents
- write_file: Create or overwrite a file
- edit_file: Edit a file by replacing specific text (preferred for existing files)
- list_files: List directory contents
- glob_files: Find files by pattern
- search_files: Search text across files
- run_command: Execute a shell command
- git_status, git_diff, git_add, git_commit, git_log, git_branch: Git operations
- create_branch, commit_changes, open_pull_request, update_ticket_status: Workflow tools
- delegate_complex_code: Offload complex refactors to a more capable model

RULES:
- ALWAYS use tools. Never just show code.
- Always verify by reading files or running tests after changes.
- If a command fails, read the error and fix it.
- Use delegate_complex_code for complex multi-file refactors.
- Your workspace is: {{WORKSPACE}}
{{PROJECT_INSTRUCTIONS}}`;

export class Orchestrator {
  private config: OrchestratorConfig;
  private lifecycle: LifecycleManager;
  private plugins: PluginRegistry;
  private mcp: MCPClientManager;
  private memoryPlugin: MemoryPlugin;
  private subAgentManager: SubAgentManager;
  private permissionManager: PermissionManager;
  private compressionEngine: ContextCompressionEngine;
  private multiModelRouter?: MultiModelRouter;
  private internalSkills: AgentSkill[];
  private sessionId: string;
  private projectInstructions: string = '';
  private onPermissionRequest?: (request: PermissionRequest) => void;

  constructor(config: OrchestratorConfig) {
    this.config = config;
    this.sessionId = `sess_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`;
    this.lifecycle = new LifecycleManager();
    this.plugins = new PluginRegistry(this.lifecycle);
    this.mcp = new MCPClientManager();
    this.subAgentManager = new SubAgentManager(config);
    this.permissionManager = new PermissionManager();
    this.compressionEngine = new ContextCompressionEngine({ tokenThreshold: 8000 });
    this.internalSkills = [TerminalSkill, FileSystemSkill, GitSkill, WorkflowMetaTools];
    this.memoryPlugin = new MemoryPlugin(config.workspace);
    this.plugins.add(this.memoryPlugin);
  }

  setPermissionHandler(handler: (request: PermissionRequest) => void): void {
    this.onPermissionRequest = handler;
    this.permissionManager.setRequestHandler(handler);
  }

  resolvePermission(requestId: string, action: 'approve' | 'deny', alwaysAllow = false): void {
    this.permissionManager.resolvePermission({ requestId, action, alwaysAllow });
  }

  /**
   * Configure multi-model routing (orchestrator + coder).
   */
  setMultiModelRouter(router: MultiModelRouter): void {
    this.multiModelRouter = router;
  }

  async init(): Promise<void> {
    await this.memoryPlugin.init();
    setMemoryStore(this.memoryPlugin.getStore().getAll());
    this.projectInstructions = await loadProjectInstructions(this.config.workspace) || '';
    if (this.config.enableMCP && this.config.mcpServers) {
      for (const server of this.config.mcpServers) {
        try { await this.mcp.connect(server); } catch (err: any) {
          console.error(`[Orchestrator] MCP failed for ${server.name}:`, err.message);
        }
      }
    }
    console.log(`[Orchestrator] Initialized (session: ${this.sessionId})`);
  }

  async shutdown(): Promise<void> {
    this.subAgentManager.cancelAll();
    await this.mcp.disconnectAll();
  }

  private buildTools(): Map<string, AgentTool> {
    const tools = new Map<string, AgentTool>();
    for (const skill of this.internalSkills) {
      for (const def of skill.tools) {
        tools.set(def.function.name, {
          name: def.function.name, description: def.function.description, definition: def,
          execute: (args, ctx) => skill.execute(def.function.name, args, ctx),
          source: 'internal',
        });
      }
    }
    for (const def of MemorySearchSkill.tools) {
      tools.set(def.function.name, {
        name: def.function.name, description: def.function.description, definition: def,
        execute: (args, ctx) => MemorySearchSkill.execute(def.function.name, args, ctx),
        source: 'internal',
      });
    }
    for (const mcpTool of this.mcp.getAllTools()) {
      const fnName = mcpTool.function.function.name;
      tools.set(fnName, {
        name: fnName, description: mcpTool.function.function.description, definition: mcpTool.function,
        execute: (args) => this.mcp.callTool(mcpTool.serverId, fnName.split('__')[1], args).then(output => ({ success: true, output })),
        source: 'mcp', mcpServerId: mcpTool.serverId,
      });
    }

    // Add delegate_complex_code tool if multi-model router is configured
    if (this.multiModelRouter) {
      const delegateDef = this.multiModelRouter.getDelegateToolDefinition();
      tools.set('delegate_complex_code', {
        name: 'delegate_complex_code',
        description: delegateDef.function.description,
        definition: delegateDef,
        execute: async (args) => this.handleDelegation(args),
        source: 'internal',
      });
    }

    for (const skill of BUILTIN_SKILLS) {
      tools.set(`skill_${skill.name}`, {
        name: `skill_${skill.name}`, description: skill.description,
        definition: {
          type: 'function',
          function: {
            name: `skill_${skill.name}`, description: skill.description,
            parameters: {
              type: 'object',
              properties: skill.parameters.reduce((a, p) => ({ ...a, [p.name]: { type: p.type, description: p.description } }), {} as Record<string, any>),
              required: skill.parameters.filter(p => p.required).map(p => p.name),
            },
          },
        },
        execute: async (args) => {
          const results: string[] = [];
          for (const step of skill.steps) {
            const expandedArgs = expandSkillArgs(step.args, args);
            const tool = tools.get(step.action);
            if (tool) {
              const ctx: ExecutionContext = {
                sessionId: this.sessionId, workspace: this.config.workspace, model: this.config.model,
                messages: [], iteration: 0, maxIterations: 1, tools, metadata: {},
              };
              const result = await tool.execute(expandedArgs, ctx);
              results.push(result.output || result.error || '');
            }
          }
          return { success: true, output: results.join('\n\n') };
        },
        source: 'skill',
      });
    }
    return tools;
  }

  /**
   * Handle delegation to the coder model.
   */
  private async handleDelegation(args: Record<string, any>): Promise<ToolResult> {
    if (!this.multiModelRouter) {
      return { success: false, output: '', error: 'No multi-model router configured' };
    }

    const files: { path: string; content: string }[] = [];
    if (args.files) {
      const filePaths = args.files.split(',').map((f: string) => f.trim());
      for (const fp of filePaths) {
        files.push({ path: fp, content: '' }); // Will be read by router
      }
    }

    const result = await this.multiModelRouter.delegateComplexCode({
      task: args.task,
      files,
      language: args.language,
      constraints: args.constraints,
    }, new Map()); // Tools map not needed — router reads files itself

    if (result.success) {
      // Write the delegated files using FileSystem skill
      const fs = require('fs');
      const pathMod = require('path');
      for (const file of result.filesChanged) {
        try {
          const fullPath = pathMod.resolve(this.config.workspace, file.path);
          const dir = pathMod.dirname(fullPath);
          fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(fullPath, file.content, 'utf-8');
          console.log(`[Orchestrator] Delegated file written: ${file.path}`);
        } catch (err: any) {
          console.error(`[Orchestrator] Failed to write delegated file ${file.path}:`, err.message);
        }
      }

      return {
        success: true,
        output: `Coder model generated code:\n\n${result.explanation}\n\nFiles written:\n${result.filesChanged.map(f => `  - ${f.path}`).join('\n')}`,
      };
    }

    return { success: false, output: '', error: result.error || result.explanation };
  }

  private async callLLM(messages: ChatMessage[], tools: Map<string, AgentTool>): Promise<any> {
    const body: any = { model: this.config.model, messages, max_tokens: 4096, temperature: 0.3 };
    const toolDefs = Array.from(tools.values()).map(t => t.definition);
    if (toolDefs.length > 0) { body.tools = toolDefs; body.tool_choice = 'auto'; }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5 * 60 * 1000);
    try {
      const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `${this.config.authPrefix}${this.config.apiKey}` },
        body: JSON.stringify(body),
        signal: this.config.abortSignal || controller.signal,
      });
      clearTimeout(timeout);
      if (!response.ok) throw new Error(`API ${response.status}: ${await response.text().catch(() => '')}`);
      return await response.json();
    } catch (err: any) { clearTimeout(timeout); throw err; }
  }

  private async executeTool(toolCall: ToolCall, tools: Map<string, AgentTool>, ctx: ExecutionContext): Promise<ToolResult> {
    const agentTool = tools.get(toolCall.function.name);
    if (!agentTool) return { success: false, output: '', error: `Unknown tool: ${toolCall.function.name}` };

    let args: Record<string, any>;
    try { args = JSON.parse(toolCall.function.arguments); } catch {
      return { success: false, output: '', error: 'Failed to parse tool arguments' };
    }

    // Permission check
    if (this.permissionManager.requiresPermission(toolCall.function.name, args)) {
      console.log(`[Permission] Requesting approval for: ${toolCall.function.name}`);
      const response = await this.permissionManager.requestPermission(toolCall.function.name, args);
      if (response.action === 'deny') {
        return { success: false, output: '', error: `Permission denied: ${toolCall.function.name}` };
      }
    }

    // Hooks
    const hookCtx: HookContext = {
      sessionId: this.sessionId, workspace: this.config.workspace, model: this.config.model,
      messages: ctx.messages, toolCall, metadata: { iteration: ctx.iteration },
    };
    await this.lifecycle.fire('onPreToolUse', hookCtx);

    console.log(`[Orchestrator] Tool: ${toolCall.function.name}`);
    const result = await agentTool.execute(args, ctx);

    hookCtx.toolResult = result;
    await this.lifecycle.fire('onPostToolUse', hookCtx);

    // Auto-format after file writes
    if ((toolCall.function.name === 'write_file' || toolCall.function.name === 'edit_file') && result.success) {
      await this.runPostActionHooks(toolCall.function.name, args, ctx);
    }

    return result;
  }

  private async runPostActionHooks(toolName: string, args: Record<string, any>, ctx: ExecutionContext): Promise<void> {
    if (!args.file_path) return;
    const ext = args.file_path.split('.').pop()?.toLowerCase();
    const formatters: Record<string, string> = {
      ts: 'npx prettier --write', tsx: 'npx prettier --write', js: 'npx prettier --write',
      jsx: 'npx prettier --write', json: 'npx prettier --write', css: 'npx prettier --write',
      md: 'npx prettier --write',
    };
    if (ext && formatters[ext]) {
      try {
        const terminal = this.internalSkills.find(s => s.name === 'terminal');
        if (terminal) await terminal.execute('run_command', { command: `${formatters[ext]} "${args.file_path}"`, cwd: this.config.workspace }, ctx);
      } catch { /* formatter not available */ }
    }
  }

  private buildSystemPrompt(): string {
    let prompt = AGENT_SYSTEM_PROMPT.replace('{{WORKSPACE}}', this.config.workspace);
    if (this.projectInstructions) {
      prompt = prompt.replace('{{PROJECT_INSTRUCTIONS}}', `\n## Project Instructions\n${this.projectInstructions}\n`);
    } else {
      prompt = prompt.replace('{{PROJECT_INSTRUCTIONS}}', '');
    }
    if (this.config.enableMemory) {
      const ctx = this.memoryPlugin.getStore().getRecentContext(3);
      if (ctx) prompt += `\n\n## Recent Session Context\n${ctx}`;
    }
    return prompt;
  }

  async execute(userMessages: ChatMessage[]): Promise<OrchestratorResult> {
    const maxIterations = this.config.maxIterations || 15;
    const toolExecutions: OrchestratorResult['toolExecutions'] = [];
    const allMessages: ChatMessage[] = [];

    allMessages.push({ role: 'system', content: this.buildSystemPrompt() });
    allMessages.push(...userMessages);

    const tools = this.buildTools();
    console.log(`[Orchestrator] ${tools.size} tools available`);

    const hookCtx = this.createHookContext(allMessages);
    await this.lifecycle.fire('onSessionStart', hookCtx);
    await this.lifecycle.fire('onUserPromptSubmit', hookCtx);

    const lastUserMsg = userMessages.filter(m => m.role === 'user').pop();
    if (lastUserMsg?.content) detectSkillTrigger(lastUserMsg.content);

    let iterations = 0;
    let consecutiveNoToolCalls = 0;
    let totalCompressionSavings = 0;

    while (iterations < maxIterations) {
      if (this.config.abortSignal?.aborted) { console.log(`[Orchestrator] Aborted`); break; }
      iterations++;
      console.log(`[Orchestrator] Iter ${iterations}/${maxIterations}`);

      // === CONTEXT COMPRESSION CHECK ===
      const analysis = this.compressionEngine.analyze(allMessages);
      if (analysis.needsCompression) {
        console.log(`[Orchestrator] Context at ${analysis.totalTokens} tokens, compressing...`);
        try {
          const { messages: compressed, stats } = await this.compressionEngine.maybeCompress(
            allMessages,
            // Use LLM-based compression if we have a coder model or just naive
            undefined,
          );
          if (stats.triggered) {
            allMessages.length = 0;
            allMessages.push(...compressed);
            totalCompressionSavings += stats.totalTokensBefore - stats.totalTokensAfter;
          }
        } catch (err: any) {
          console.error(`[Orchestrator] Compression failed:`, err.message);
        }
      }

      const response = await this.callLLM(allMessages, tools);
      const choice = response.choices?.[0];
      if (!choice) throw new Error('No response from LLM');

      const assistantMsg = choice.message;
      allMessages.push({ role: 'assistant', content: assistantMsg.content, tool_calls: assistantMsg.tool_calls });

      if (!assistantMsg.tool_calls || assistantMsg.tool_calls.length === 0) {
        consecutiveNoToolCalls++;
        if (consecutiveNoToolCalls >= 2) {
          console.log(`[Orchestrator] Complete after ${iterations} iterations (no tool calls)`);
          break;
        }
        continue;
      }
      consecutiveNoToolCalls = 0;

      const ctx: ExecutionContext = {
        sessionId: this.sessionId, workspace: this.config.workspace, model: this.config.model,
        messages: allMessages, iteration: iterations, maxIterations, tools,
        metadata: {}, projectInstructions: this.projectInstructions,
        abortSignal: this.config.abortSignal, permissionManager: this.permissionManager,
      };

      for (const toolCall of assistantMsg.tool_calls) {
        const result = await this.executeTool(toolCall, tools, ctx);
        toolExecutions.push({ tool: toolCall.function.name, result: result.output || result.error || '', duration_ms: result.duration_ms || 0, phase: 'execute' });
        allMessages.push({ role: 'tool', content: result.output || result.error || '(no output)', tool_call_id: toolCall.id });
      }

      await this.lifecycle.fire('onPhaseComplete', this.createHookContext(allMessages, { iterations }));
    }

    await this.lifecycle.fire('onSessionEnd', this.createHookContext(allMessages));

    if (this.config.enableMemory) {
      const finalContent = allMessages.filter(m => m.role === 'assistant' && m.content).pop()?.content || '';
      this.memoryPlugin.getStore().addSession({
        sessionId: this.sessionId, timestamp: Date.now(), model: this.config.model,
        title: lastUserMsg?.content?.substring(0, 100) || 'Session',
        summary: finalContent.substring(0, 500),
        tasksCompleted: toolExecutions.filter(t => t.tool === 'write_file' || t.tool === 'edit_file').map(t => t.result.substring(0, 100)),
        learnings: [], toolsUsed: [...new Set(toolExecutions.map(t => t.tool))],
      });
      await this.memoryPlugin.getStore().save();
    }

    return {
      messages: allMessages,
      iterations,
      toolExecutions,
      memoryEntries: [],
      compressionStats: {
        compressed: this.compressionEngine.getCompressionCount(),
        tokensSaved: totalCompressionSavings,
      },
    };
  }

  private createHookContext(messages: ChatMessage[], extra?: Record<string, any>): HookContext {
    return { sessionId: this.sessionId, workspace: this.config.workspace, model: this.config.model, messages, metadata: { ...extra } };
  }
}
