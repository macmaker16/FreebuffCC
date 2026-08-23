/**
 * Michaelangelo Agent - Master Orchestrator
 * 
 * Production-grade agentic harness implementing Claude Code's architecture:
 * 
 *   ┌─────────────────────────────────────────────────────┐
 *   │  PHASE 1: GATHER CONTEXT                           │
 *   │  Read files, search patterns, understand the task   │
 *   └──────────────────┬──────────────────────────────────┘
 *                      ▼
 *   ┌─────────────────────────────────────────────────────┐
 *   │  PHASE 2: PLAN                                     │
 *   │  Identify what needs to change, plan the approach   │
 *   └──────────────────┬──────────────────────────────────┘
 *                      ▼
 *   ┌─────────────────────────────────────────────────────┐
 *   │  PHASE 3: EXECUTE                                  │
 *   │  Write files, run commands, git operations          │
 *   └──────────────────┬──────────────────────────────────┘
 *                      ▼
 *   ┌─────────────────────────────────────────────────────┐
 *   │  PHASE 4: VERIFY RESULTS                           │
 *   │  Run tests, read created files, check for errors    │
 *   │  If failed → loop back to Phase 3 to fix           │
 *   └─────────────────────────────────────────────────────┘
 *
 * Integrates ALL systems:
 * - Tool Registry with per-model limits and error recovery
 * - Human-in-the-loop permissions
 * - Dynamic Context Compression
 * - Multi-Model Routing (orchestrator + coder delegation)
 * - Memory & Project Instructions (.michaelangelo.md)
 * - MCP external tools (stdio + SSE)
 * - Lifecycle Hooks & Plugins (error-recovery, linter-hook, memory)
 * - Sub-Agent spawning via `task` tool
 * - Semantic Code Search (find_definitions, find_references)
 * - Workflow Meta-Tools (branch, commit, PR)
 * - Auto-formatting after file writes
 * - LLM retry with exponential backoff
 */

import {
  ChatMessage, ToolCall, AgentTool, ExecutionContext, HookContext,
  OrchestratorConfig, OrchestratorResult, ToolResult, AgentSkill, AgentPhase,
} from './types';
import { LifecycleManager } from './lifecycle';
import { PluginRegistry } from './plugins/registry';
import { MemoryPlugin } from './plugins/memory-plugin';
import { ErrorRecoveryPlugin } from './plugins/error-recovery';
import { LinterHookPlugin } from './plugins/linter-hook';
import { MCPClientManager } from './mcp/client';
import { ToolRegistry } from './tools/registry';
import { TerminalSkill } from './skills/terminal';
import { FileSystemSkill } from './skills/filesystem';
import { GitSkill } from './skills/git';
import { WorkflowMetaTools } from './skills/workflow';
import { SemanticCodeSearchSkill } from './skills/semantic-search';
import { BrowserSkill, closeBrowser, playwrightReady } from './skills/browser';
import { MemorySearchSkill, setMemoryStore } from './skills/memory-search';
import { loadProjectInstructions } from './memory/instructions';
import { BUILTIN_SKILLS, detectSkillTrigger, expandSkillArgs } from './skills/builtin-skills';
import { SubAgentManager } from './subagent/manager';
import { PermissionManager, PermissionRequest } from './permissions';
import { ContextCompressionEngine } from './context-compression';
import { MultiModelRouter } from './multi-model-router';
import { RepoMapGenerator, getRepoMapGenerator } from './repo-map';
import { CascadingPlanner } from './planner';
import { OutputInterceptor } from './output-interceptor';
import { SubagentDispatch } from './dispatch-agent';

// ============================================================================
// SYSTEM PROMPT
// ============================================================================

const AGENT_SYSTEM_PROMPT = `You are Michaelangelo, an autonomous AI coding assistant with a production-grade agentic harness.

--- STATIC RULES (cache these, do not modify) ---

## YOUR MISSION
Complete the user's task by executing real actions via tools. Never output code blocks without creating files.

## THE 4-PHASE LOOP

### Phase 1: GATHER CONTEXT
Before making changes, explore the codebase using the Repo Map below.
- Use read_file to examine specific files (with line_range for large files)
- Use find_definitions / find_references for code relationships
- Use search_files / glob_files to locate patterns
- NEVER skip this phase — always understand before editing

### Phase 2: PLAN
Formulate a concrete execution plan:
- List exactly which files to change and what changes
- Order changes by dependency (foundations first)
- Use dispatch_agent for parallel multi-file analysis
- Consider edge cases and error handling

### Phase 3: EXECUTE
Make changes surgically:
- Use edit_file for existing files (search/replace blocks, NOT full rewrites)
- Use write_file ONLY for brand-new files
- Use run_command for builds, tests, installs
- Verify each change before moving to the next

### Phase 4: VERIFY
Confirm your work:
- Read modified files to check correctness
- Run tests: run_command with test/build commands
- If verification fails → diagnose and go back to Phase 3
- Only respond to user when ALL verifications pass

## TOOL USAGE RULES
- Prefer edit_file over write_file for existing files
- Use read_file with line_range for large files (e.g. "100-200")
- After any file write/edit, verify with run_command (build, test, lint)
- If a command fails, READ the full error output and fix it
- Use dispatch_agent for independent sub-tasks that can run in parallel
- Use delegate_complex_code for difficult multi-file refactors

## EDIT PROTOCOL (CRITICAL)
The edit_file tool uses SEARCH/REPLACE. Always provide the EXACT original text to find.
NEVER use full-file rewrites — they truncate code and cause the '// rest of code' hallucination.
Read the file first, identify the exact lines to change, then use edit_file.

## TOOLS AVAILABLE
**File System:** read_file, write_file, edit_file, list_files, glob_files, search_files
**Semantic Search:** find_definitions, find_references, find_implementations, call_graph
**Browser:** browser_navigate, browser_screenshot, browser_get_content, browser_get_styles, browser_evaluate, browser_wait, browser_console
**Terminal:** run_command
**Git:** git_status, git_diff, git_add, git_commit, git_log, git_branch
**Workflow:** create_branch, commit_changes, open_pull_request, update_ticket_status
**Agent:** dispatch_agent (spawn parallel sub-agents), delegate_complex_code (offload to frontier model)
**Memory:** search_memory

--- DYNAMIC CONTENT (changes per session, append below) ---

{{REPO_MAP}}
{{PROJECT_INSTRUCTIONS}}
{{SESSION_MEMORY}}

## WORKSPACE
Your workspace is: {{WORKSPACE}}`;

// ============================================================================
// ORCHESTRATOR
// ============================================================================

export class Orchestrator {
  private config: OrchestratorConfig;
  private lifecycle: LifecycleManager;
  private plugins: PluginRegistry;
  private mcp: MCPClientManager;
  private memoryPlugin: MemoryPlugin;
  private errorRecoveryPlugin: ErrorRecoveryPlugin;
  private linterHookPlugin: LinterHookPlugin;
  private subAgentManager: SubAgentManager;
  private permissionManager: PermissionManager;
  private compressionEngine: ContextCompressionEngine;
  private multiModelRouter?: MultiModelRouter;
  private toolRegistry: ToolRegistry;
  private sessionId: string;
  private projectInstructions: string = '';
  private repoMapGenerator: RepoMapGenerator;
  private planner: CascadingPlanner;
  private outputInterceptor: OutputInterceptor;
  private subagentDispatch: SubagentDispatch;
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
    this.toolRegistry = new ToolRegistry({ enableRetries: true, maxRetries: 2 });
    this.repoMapGenerator = getRepoMapGenerator(config.workspace);
    this.planner = new CascadingPlanner({ autoApproveThreshold: 0 });
    this.outputInterceptor = new OutputInterceptor({ maxTokens: 1500 });
    this.subagentDispatch = new SubagentDispatch({
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      authPrefix: config.authPrefix,
      model: config.model,
      workspace: config.workspace,
    });

    // Configure per-model tool limits (Llama 3.1 on NIM works best with ≤12)
    this.toolRegistry.setModelLimit('meta/llama-3.1-8b-instruct', 18);
    this.toolRegistry.setModelLimit('meta/llama-3.1-70b-instruct', 20);

    this.memoryPlugin = new MemoryPlugin(config.workspace);
    this.errorRecoveryPlugin = new ErrorRecoveryPlugin();
    this.linterHookPlugin = new LinterHookPlugin();

    this.plugins.add(this.memoryPlugin);
    this.plugins.add(this.errorRecoveryPlugin);
    this.plugins.add(this.linterHookPlugin);
  }

  setPermissionHandler(handler: (request: PermissionRequest) => void): void {
    this.onPermissionRequest = handler;
    this.permissionManager.setRequestHandler(handler);
  }

  resolvePermission(requestId: string, action: 'approve' | 'deny', alwaysAllow = false): void {
    this.permissionManager.resolvePermission({ requestId, action, alwaysAllow });
  }

  setMultiModelRouter(router: MultiModelRouter): void {
    this.multiModelRouter = router;
  }

  async init(): Promise<void> {
    await this.memoryPlugin.init();
    setMemoryStore(this.memoryPlugin.getStore().getAll());
    this.projectInstructions = await loadProjectInstructions(this.config.workspace) || '';

    // Register all internal skills with the tool registry
    const skills: AgentSkill[] = [TerminalSkill, FileSystemSkill, GitSkill, WorkflowMetaTools, SemanticCodeSearchSkill];
    if (playwrightReady) skills.push(BrowserSkill);
    for (const skill of skills) {
      this.toolRegistry.registerSkill(skill);
    }
    this.toolRegistry.registerSkill(MemorySearchSkill);

    // Validate tool definitions
    const validation = this.toolRegistry.validate();
    if (validation.invalid.length > 0) {
      console.warn(`[Orchestrator] ${validation.invalid.length} tools have invalid definitions:`,
        validation.invalid.map(t => t.name));
    }
    console.log(`[Orchestrator] ${validation.valid.length} valid tools registered`);

    // Connect MCP servers
    if (this.config.enableMCP && this.config.mcpServers) {
      for (const server of this.config.mcpServers) {
        try { await this.mcp.connect(server); } catch (err: any) {
          console.error(`[Orchestrator] MCP failed for ${server.name}:`, err.message);
        }
      }
      // Register MCP tools
      for (const mcpTool of this.mcp.getAllTools()) {
        const fnName = mcpTool.function.function.name;
        this.toolRegistry.register({
          name: fnName,
          description: mcpTool.function.function.description,
          definition: mcpTool.function,
          execute: (args) => this.mcp.callTool(mcpTool.serverId, fnName.split('__')[1], args)
            .then(output => ({ success: true, output }))
            .catch(err => ({ success: false, output: '', error: `MCP call failed: ${err.message}` })),
          source: 'mcp',
          mcpServerId: mcpTool.serverId,
        });
      }
    }

    // Register sub-agent task tool
    this.toolRegistry.register({
      name: 'task',
      description: 'Spawn a background sub-agent for parallel work.',
      definition: {
        type: 'function',
        function: {
          name: 'task',
          description: 'Spawn a background sub-agent to work on a specific sub-task in parallel.',
          parameters: {
            type: 'object',
            properties: {
              description: { type: 'string', description: 'Brief description of what this sub-agent should do' },
              prompt: { type: 'string', description: 'The full task prompt for the sub-agent' },
            },
            required: ['description', 'prompt'],
          },
        },
      },
      execute: async (args) => this.handleTaskSpawn(args),
      source: 'internal',
    });

    // Register dispatch_agent tool (Claude Code-style subagent dispatch)
    this.toolRegistry.register({
      name: 'dispatch_agent',
      description: 'Dispatch an isolated sub-agent to handle a research or analysis task in the background. Returns results when complete.',
      definition: {
        type: 'function',
        function: {
          name: 'dispatch_agent',
          description: 'Dispatch a focused sub-agent for research, analysis, or multi-file investigation.',
          parameters: {
            type: 'object',
            properties: {
              description: { type: 'string', description: 'Brief description of the task' },
              prompt: { type: 'string', description: 'Detailed prompt for the sub-agent' },
            },
            required: ['description', 'prompt'],
          },
        },
      },
      execute: async (args) => this.subagentDispatch.dispatch(args.description, args.prompt),
      source: 'internal',
    });

    // Register delegate_complex_code tool
    if (this.multiModelRouter) {
      const delegateDef = this.multiModelRouter.getDelegateToolDefinition();
      this.toolRegistry.register({
        name: 'delegate_complex_code',
        description: delegateDef.function.description,
        definition: delegateDef,
        execute: async (args) => this.handleDelegation(args),
        source: 'internal',
      });
    }

    // Register built-in skills
    for (const skill of BUILTIN_SKILLS) {
      this.toolRegistry.register({
        name: `skill_${skill.name}`,
        description: skill.description,
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
            const tool = this.toolRegistry.get(step.action);
            if (tool) {
              const ctx: ExecutionContext = {
                sessionId: this.sessionId, workspace: this.config.workspace, model: this.config.model,
                messages: [], iteration: 0, maxIterations: 1, tools: this.toolRegistry.getAll(), metadata: {},
              };
              const result = await this.toolRegistry.execute(step.action, expandedArgs, ctx);
              results.push(result.output || result.error || '');
            }
          }
          return { success: true, output: results.join('\n\n') };
        },
        source: 'skill',
      });
    }

    console.log(`[Orchestrator] Initialized (session: ${this.sessionId}) — ${this.toolRegistry.size()} tools`);
  }

  async shutdown(): Promise<void> {
    this.subAgentManager.cancelAll();
    await this.mcp.disconnectAll();
    await closeBrowser();
  }

  // ==========================================================================
  // TOOL HANDLERS
  // ==========================================================================

  private async handleTaskSpawn(args: Record<string, any>): Promise<ToolResult> {
    const { description, prompt } = args;
    if (!description || !prompt) {
      return { success: false, output: '', error: 'Both description and prompt are required' };
    }
    const taskId = this.subAgentManager.spawnSubAgent(description, prompt, this.config.workspace);
    return {
      success: true,
      output: `Sub-agent spawned: ${taskId}\nTask: ${description}\nThe sub-agent is running in the background.`,
    };
  }

  private async handleDelegation(args: Record<string, any>): Promise<ToolResult> {
    if (!this.multiModelRouter) {
      return { success: false, output: '', error: 'No multi-model router configured' };
    }
    const files: { path: string; content: string }[] = [];
    if (args.files) {
      for (const fp of args.files.split(',').map((f: string) => f.trim())) {
        files.push({ path: fp, content: '' });
      }
    }
    const result = await this.multiModelRouter.delegateComplexCode({
      task: args.task, files, language: args.language, constraints: args.constraints,
    }, this.toolRegistry.getAll());

    if (result.success) {
      const fs = require('fs');
      const pathMod = require('path');
      for (const file of result.filesChanged) {
        try {
          const fullPath = pathMod.resolve(this.config.workspace, file.path);
          fs.mkdirSync(pathMod.dirname(fullPath), { recursive: true });
          fs.writeFileSync(fullPath, file.content, 'utf-8');
        } catch (err: any) {
          console.error(`[Orchestrator] Delegated write failed: ${file.path}:`, err.message);
        }
      }
      return { success: true, output: `Coder model generated:\n${result.explanation}\n\nFiles:\n${result.filesChanged.map(f => `  - ${f.path}`).join('\n')}` };
    }
    return { success: false, output: '', error: result.error || result.explanation };
  }

  // ==========================================================================
  // LLM CALL WITH RETRY
  // ==========================================================================

  private async callLLM(messages: ChatMessage[], tools: Map<string, AgentTool>): Promise<any> {
    const body: any = { model: this.config.model, messages, max_tokens: 4096, temperature: 0.3 };

    // Use per-model tool limits from registry
    const allDefs = Array.from(tools.values()).map(t => t.definition);
    const modelDefs = this.toolRegistry.getForModel(this.config.model);
    body.tools = modelDefs.length > 0 ? modelDefs : allDefs.slice(0, 12);
    if (body.tools.length > 0) {
      body.tool_choice = 'auto';
    }

    // Retry with exponential backoff
    const MAX_LLM_RETRIES = 3;
    let lastError: any;

    for (let attempt = 0; attempt < MAX_LLM_RETRIES; attempt++) {
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

        if (!response.ok) {
          const errBody = await response.text().catch(() => '');
          const err = new Error(`API ${response.status}: ${errBody}`);

          // Retry on 429 (rate limit) or 5xx (server error)
          if ((response.status === 429 || response.status >= 500) && attempt < MAX_LLM_RETRIES - 1) {
            const delay = Math.min(1000 * Math.pow(2, attempt), 10000);
            console.log(`[Orchestrator] LLM ${response.status}, retrying in ${delay}ms (attempt ${attempt + 1}/${MAX_LLM_RETRIES})`);
            await new Promise(r => setTimeout(r, delay));
            lastError = err;
            continue;
          }
          throw err;
        }

        return await response.json();
      } catch (err: any) {
        clearTimeout(timeout);
        lastError = err;

        // Retry on network errors
        if (err.name === 'AbortError' && attempt < MAX_LLM_RETRIES - 1) {
          const delay = 2000 * (attempt + 1);
          console.log(`[Orchestrator] LLM timeout, retrying in ${delay}ms`);
          await new Promise(r => setTimeout(r, delay));
          continue;
        }
        throw err;
      }
    }

    throw lastError;
  }

  // ==========================================================================
  // TOOL EXECUTION with permissions, hooks, and auto-formatting
  // ==========================================================================

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

    // Pre-action hooks
    const hookCtx: HookContext = {
      sessionId: this.sessionId, workspace: this.config.workspace, model: this.config.model,
      messages: ctx.messages, toolCall, metadata: { iteration: ctx.iteration },
    };
    await this.lifecycle.fire('onPreToolUse', hookCtx);

    console.log(`[Orchestrator] Tool: ${toolCall.function.name}`);
    let result = await agentTool.execute(args, ctx);

    // Output interception: truncate large terminal output to save tokens
    if (result.output && result.output.length > 6000) {
      const intercepted = await this.outputInterceptor.intercept(
        result.output, toolCall.function.name, args,
      );
      if (intercepted.wasIntercepted) {
        console.log(`[Orchestrator] Output intercepted: ${intercepted.tokensSaved} tokens saved`);
        result = { ...result, output: intercepted.output };
      }
    }

    // Track file access for context rehydration
    if (args.file_path) {
      this.compressionEngine.recordFileAccess(args.file_path);
    }

    // Post-action hooks
    hookCtx.toolResult = result;
    await this.lifecycle.fire('onPostToolUse', hookCtx);

    return result;
  }

  // ==========================================================================
  // SYSTEM PROMPT
  // ==========================================================================

  private async buildSystemPrompt(): Promise<string> {
    let prompt = AGENT_SYSTEM_PROMPT.replace('{{WORKSPACE}}', this.config.workspace);

    // Inject project instructions
    if (this.projectInstructions) {
      prompt = prompt.replace('{{PROJECT_INSTRUCTIONS}}', `\n## Project Instructions (from .michaelangelo.md / CLAUDE.md)\n${this.projectInstructions}\n`);
    } else {
      prompt = prompt.replace('{{PROJECT_INSTRUCTIONS}}', '');
    }

    // Inject repo map (compressed AST elision — token-efficient)
    try {
      const repoMap = await this.repoMapGenerator.generateCompressedMap(2500);
      prompt = prompt.replace('{{REPO_MAP}}', repoMap);
    } catch (err: any) {
      console.error(`[Orchestrator] Repo map generation failed:`, err.message);
      prompt = prompt.replace('{{REPO_MAP}}', '');
    }

    // Inject session memory
    if (this.config.enableMemory) {
      const ctx = this.memoryPlugin.getStore().getRecentContext(3);
      prompt = prompt.replace('{{SESSION_MEMORY}}', ctx ? `\n## Recent Session Context\n${ctx}` : '');
    } else {
      prompt = prompt.replace('{{SESSION_MEMORY}}', '');
    }

    return prompt;
  }

  // ==========================================================================
  // THE 4-PHASE EXECUTION LOOP
  // ==========================================================================

  async execute(userMessages: ChatMessage[]): Promise<OrchestratorResult> {
    const maxIterations = this.config.maxIterations || 15;
    const toolExecutions: OrchestratorResult['toolExecutions'] = [];
    const allMessages: ChatMessage[] = [];

    allMessages.push({ role: 'system', content: await this.buildSystemPrompt() });
    allMessages.push(...userMessages);

    const tools = this.toolRegistry.getAll();
    console.log(`[Orchestrator] ${tools.size} tools available (model limit: ${this.toolRegistry.getForModel(this.config.model).length})`);

    const hookCtx = this.createHookContext(allMessages);
    await this.lifecycle.fire('onSessionStart', hookCtx);
    await this.lifecycle.fire('onUserPromptSubmit', hookCtx);

    const lastUserMsg = userMessages.filter(m => m.role === 'user').pop();
    if (lastUserMsg?.content) detectSkillTrigger(lastUserMsg.content);

    let currentPhase: AgentPhase = 'gather_context';
    let phaseIterations = 0;
    let totalIterations = 0;
    let consecutiveNoToolCalls = 0;
    let totalCompressionSavings = 0;
    const phaseHistory: { phase: AgentPhase; iteration: number; toolsUsed: string[] }[] = [];

    const MAX_PHASE_ITERATIONS: Record<AgentPhase, number> = {
      gather_context: 3, plan: 2, execute: 10, verify_results: 3,
    };

    const PHASE_INSTRUCTIONS: Record<AgentPhase, string> = {
      gather_context: '[PHASE: GATHER CONTEXT] Read files, explore structure, understand the task. Use read_file, list_files, find_definitions, search_files.',
      plan: '[PHASE: PLAN] Formulate a concrete plan. Identify files to change and their order. Use task tool for parallel analysis.',
      execute: '[PHASE: EXECUTE] Make changes using write_file, edit_file, run_command. Work step by step.',
      verify_results: '[PHASE: VERIFY] Read modified files, run tests. If issues found, loop back to execute. Only answer when verified.',
    };

    console.log(`[Orchestrator] Starting 4-phase loop (max ${maxIterations} iterations)`);

    while (totalIterations < maxIterations) {
      if (this.config.abortSignal?.aborted) break;

      totalIterations++;
      phaseIterations++;

      console.log(`[Orchestrator] Phase: ${currentPhase} | Iter: ${totalIterations}/${maxIterations}`);

      // Context compression
      const analysis = this.compressionEngine.analyze(allMessages);
      if (analysis.needsCompression) {
        try {
          const { messages: compressed, stats } = await this.compressionEngine.maybeCompress(allMessages);
          if (stats.triggered) {
            allMessages.length = 0;
            allMessages.push(...compressed);
            totalCompressionSavings += stats.totalTokensBefore - stats.totalTokensAfter;
          }
        } catch (err: any) { console.error(`[Orchestrator] Compression failed:`, err.message); }
      }

      // Inject phase instruction
      const lastMsg = allMessages[allMessages.length - 1];
      if (!lastMsg?.content?.includes('[PHASE:')) {
        allMessages.push({ role: 'system', content: PHASE_INSTRUCTIONS[currentPhase] });
      }

      // Call LLM
      const response = await this.callLLM(allMessages, tools);
      const choice = response.choices?.[0];
      if (!choice) throw new Error('No response from LLM');

      const assistantMsg = choice.message;
      allMessages.push({ role: 'assistant', content: assistantMsg.content, tool_calls: assistantMsg.tool_calls });

      if (!assistantMsg.tool_calls || assistantMsg.tool_calls.length === 0) {
        consecutiveNoToolCalls++;
        if (currentPhase === 'verify_results' && consecutiveNoToolCalls >= 1) break;
        if (consecutiveNoToolCalls >= 2) {
          const nextPhase = this.getNextPhase(currentPhase);
          if (nextPhase) {
            phaseHistory.push({ phase: currentPhase, iteration: totalIterations, toolsUsed: [] });
            currentPhase = nextPhase;
            phaseIterations = 0;
            consecutiveNoToolCalls = 0;
            continue;
          }
          break;
        }
        continue;
      }

      consecutiveNoToolCalls = 0;

      // Execute tool calls
      const ctx: ExecutionContext = {
        sessionId: this.sessionId, workspace: this.config.workspace, model: this.config.model,
        messages: allMessages, iteration: totalIterations, maxIterations, tools,
        metadata: { phase: currentPhase, phaseIteration: phaseIterations },
        projectInstructions: this.projectInstructions,
        abortSignal: this.config.abortSignal, permissionManager: this.permissionManager,
      };

      const phaseToolsUsed: string[] = [];
      for (const toolCall of assistantMsg.tool_calls) {
        const result = await this.executeTool(toolCall, tools, ctx);
        toolExecutions.push({
          tool: toolCall.function.name, result: result.output || result.error || '',
          duration_ms: result.duration_ms || 0, phase: currentPhase,
        });
        allMessages.push({ role: 'tool', content: result.output || result.error || '(no output)', tool_call_id: toolCall.id });
        phaseToolsUsed.push(toolCall.function.name);
      }

      await this.lifecycle.fire('onPhaseComplete', this.createHookContext(allMessages, { iterations: totalIterations, phase: currentPhase }));

      // Phase transitions
      if (phaseIterations >= MAX_PHASE_ITERATIONS[currentPhase]) {
        const nextPhase = this.getNextPhase(currentPhase);
        if (nextPhase) {
          phaseHistory.push({ phase: currentPhase, iteration: totalIterations, toolsUsed: phaseToolsUsed });
          currentPhase = nextPhase;
          phaseIterations = 0;
        }
      }

      if (currentPhase === 'gather_context' && phaseToolsUsed.some(t => ['read_file', 'list_files', 'find_definitions', 'search_files'].includes(t)) && phaseIterations >= 2) {
        phaseHistory.push({ phase: currentPhase, iteration: totalIterations, toolsUsed: phaseToolsUsed });
        currentPhase = 'plan'; phaseIterations = 0;
      }

      if (currentPhase === 'plan' && (phaseToolsUsed.some(t => ['write_file', 'edit_file', 'run_command', 'task'].includes(t)) || phaseIterations >= 2)) {
        phaseHistory.push({ phase: currentPhase, iteration: totalIterations, toolsUsed: phaseToolsUsed });
        currentPhase = 'execute'; phaseIterations = 0;
      }

      if (currentPhase === 'execute' && phaseToolsUsed.some(t => ['write_file', 'edit_file', 'run_command'].includes(t)) && phaseIterations >= 2) {
        phaseHistory.push({ phase: currentPhase, iteration: totalIterations, toolsUsed: phaseToolsUsed });
        currentPhase = 'verify_results'; phaseIterations = 0;
      }

      if (currentPhase === 'verify_results' && phaseIterations >= 1) {
        const lastToolResult = toolExecutions[toolExecutions.length - 1];
        if (lastToolResult && (lastToolResult.result.includes('ERROR') || lastToolResult.result.includes('FAIL'))) {
          phaseHistory.push({ phase: currentPhase, iteration: totalIterations, toolsUsed: phaseToolsUsed });
          currentPhase = 'execute'; phaseIterations = 0;
        }
      }
    }

    // Session end
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

    const interceptorStats = this.outputInterceptor.getStats();
    console.log(`[Orchestrator] Session complete: ${totalIterations} iterations, ${toolExecutions.length} tool calls, ${interceptorStats.totalTokensSaved} tokens saved via output interception`);

    return {
      messages: allMessages, iterations: totalIterations, toolExecutions, memoryEntries: [],
      compressionStats: {
        compressed: this.compressionEngine.getCompressionCount(),
        tokensSaved: totalCompressionSavings + interceptorStats.totalTokensSaved,
      },
      phaseHistory,
    };
  }

  private getNextPhase(current: AgentPhase): AgentPhase | null {
    const order: AgentPhase[] = ['gather_context', 'plan', 'execute', 'verify_results'];
    const idx = order.indexOf(current);
    return idx < order.length - 1 ? order[idx + 1] : null;
  }

  private createHookContext(messages: ChatMessage[], extra?: Record<string, any>): HookContext {
    return { sessionId: this.sessionId, workspace: this.config.workspace, model: this.config.model, messages, metadata: { ...extra } };
  }
}
