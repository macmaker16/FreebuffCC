/**
 * Michaelangelo Agent - Master Orchestrator
 * 
 * Three-Phase Claude Code-style execution loop:
 *   Phase 1: GATHER CONTEXT — Read files, search, understand the task
 *   Phase 2: TAKE ACTION — Write files, run commands, make changes
 *   Phase 3: VERIFY RESULTS — Run tests, check outputs, confirm success
 * 
 * Integrates: Skills, Memory, MCP, Lifecycle Hooks, Sub-Agents
 */

import {
  ChatMessage, ToolCall, AgentTool, ExecutionContext, HookContext,
  OrchestratorConfig, OrchestratorResult, ToolResult, AgentSkill,
  MCPServerConfig, AgentPhase, PhaseResult, SkillDefinition,
} from './types';
import { LifecycleManager } from './lifecycle';
import { PluginRegistry } from './plugins/registry';
import { MemoryPlugin } from './plugins/memory-plugin';
import { MCPClientManager } from './mcp/client';
import { TerminalSkill } from './skills/terminal';
import { FileSystemSkill } from './skills/filesystem';
import { GitSkill } from './skills/git';
import { MemorySearchSkill, setMemoryStore } from './skills/memory-search';
import { loadProjectInstructions } from './memory/instructions';
import { BUILTIN_SKILLS, detectSkillTrigger, expandSkillArgs } from './skills/builtin-skills';
import { SubAgentManager } from './subagent/manager';

/** System prompt for the agent */
const AGENT_SYSTEM_PROMPT = `You are Michaelangelo, an autonomous AI coding assistant. You follow a three-phase approach:

## Phase 1: GATHER CONTEXT
Before taking action, understand the task:
- Read relevant files with read_file
- Search for patterns with search_files
- List directory contents with list_files
- Check git status if relevant

## Phase 2: TAKE ACTION
Execute the work using your tools:
- Write files with write_file
- Run commands with run_command
- Use git tools for version control
- Break complex tasks into steps

## Phase 3: VERIFY RESULTS
After taking action, verify it worked:
- Run tests with run_command
- Read the files you created to confirm content
- Check for errors in command output
- If something failed, fix it and re-verify

## Available Skills
You can trigger built-in skills by mentioning them:
- /review-pr — Review staged changes
- /fix-bugs — Find and fix bugs
- /explain — Explain project structure
- /test-all — Run all tests
- /clean-build — Clean and rebuild

## Rules
- ALWAYS use tools to do the work. Never just output code blocks.
- ALWAYS verify your work in Phase 3.
- If a command fails, read the error, fix it, and try again.
- Be thorough — complete the entire task.
- Your workspace is: {{WORKSPACE}}
{{PROJECT_INSTRUCTIONS}}`;

export class Orchestrator {
  private config: OrchestratorConfig;
  private lifecycle: LifecycleManager;
  private plugins: PluginRegistry;
  private mcp: MCPClientManager;
  private memoryPlugin: MemoryPlugin;
  private subAgentManager: SubAgentManager;
  private internalSkills: AgentSkill[];
  private sessionId: string;
  private projectInstructions: string = '';

  constructor(config: OrchestratorConfig) {
    this.config = config;
    this.sessionId = `sess_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`;
    this.lifecycle = new LifecycleManager();
    this.plugins = new PluginRegistry(this.lifecycle);
    this.mcp = new MCPClientManager();
    this.subAgentManager = new SubAgentManager(config);
    this.internalSkills = [TerminalSkill, FileSystemSkill, GitSkill];

    // Create and register memory plugin
    this.memoryPlugin = new MemoryPlugin(config.workspace);
    this.plugins.add(this.memoryPlugin);
  }

  async init(): Promise<void> {
    await this.memoryPlugin.init();
    setMemoryStore(this.memoryPlugin.getStore().getAll());

    // Load project instructions from APP_INSTRUCTIONS.md
    this.projectInstructions = await loadProjectInstructions(this.config.workspace) || '';

    // Connect to MCP servers if configured
    if (this.config.enableMCP && this.config.mcpServers) {
      for (const server of this.config.mcpServers) {
        try {
          await this.mcp.connect(server);
        } catch (err: any) {
          console.error(`[Orchestrator] MCP connect failed for ${server.name}:`, err.message);
        }
      }
    }

    console.log(`[Orchestrator] Initialized (session: ${this.sessionId})`);
  }

  async shutdown(): Promise<void> {
    this.subAgentManager.cancelAll();
    await this.mcp.disconnectAll();
    console.log(`[Orchestrator] Shutdown complete`);
  }

  /** Build the complete tools array */
  private buildTools(): Map<string, AgentTool> {
    const tools = new Map<string, AgentTool>();

    // Internal skills
    for (const skill of this.internalSkills) {
      for (const def of skill.tools) {
        tools.set(def.function.name, {
          name: def.function.name,
          description: def.function.description,
          definition: def,
          execute: (args, ctx) => skill.execute(def.function.name, args, ctx),
          source: 'internal',
        });
      }
    }

    // Memory search skill
    for (const def of MemorySearchSkill.tools) {
      tools.set(def.function.name, {
        name: def.function.name,
        description: def.function.description,
        definition: def,
        execute: (args, ctx) => MemorySearchSkill.execute(def.function.name, args, ctx),
        source: 'internal',
      });
    }

    // MCP tools
    const mcpTools = this.mcp.getAllTools();
    for (const mcpTool of mcpTools) {
      const fnName = mcpTool.function.function.name;
      const fnDesc = mcpTool.function.function.description;
      tools.set(fnName, {
        name: fnName,
        description: fnDesc,
        definition: mcpTool.function,
        execute: (args) => this.mcp.callTool(mcpTool.serverId, fnName.split('__')[1], args).then(output => ({ success: true, output })),
        source: 'mcp',
        mcpServerId: mcpTool.serverId,
      });
    }

    // Add skill trigger tools (so the LLM can invoke skills)
    for (const skill of BUILTIN_SKILLS) {
      tools.set(`skill_${skill.name}`, {
        name: `skill_${skill.name}`,
        description: `Trigger skill: ${skill.description}`,
        definition: {
          type: 'function',
          function: {
            name: `skill_${skill.name}`,
            description: skill.description,
            parameters: {
              type: 'object',
              properties: skill.parameters.reduce((acc, p) => {
                acc[p.name] = { type: p.type, description: p.description };
                return acc;
              }, {} as Record<string, any>),
              required: skill.parameters.filter(p => p.required).map(p => p.name),
            },
          },
        },
        execute: async (args) => {
          // Execute skill steps
          const results: string[] = [];
          for (const step of skill.steps) {
            const expandedArgs = expandSkillArgs(step.args, args);
            const tool = tools.get(step.action);
            if (tool) {
              const ctx: ExecutionContext = {
                sessionId: this.sessionId,
                workspace: this.config.workspace,
                model: this.config.model,
                messages: [],
                iteration: 0,
                maxIterations: 1,
                tools,
                metadata: {},
              };
              const result = await tool.execute(expandedArgs, ctx);
              results.push(result.output || result.error || '(no output)');
            }
          }
          return { success: true, output: results.join('\n\n') };
        },
        source: 'skill',
      });
    }

    return tools;
  }

  /** Call the LLM API */
  private async callLLM(messages: ChatMessage[], tools: Map<string, AgentTool>): Promise<any> {
    const toolDefs = Array.from(tools.values()).map(t => t.definition);

    const body: any = {
      model: this.config.model,
      messages,
      max_tokens: 4096,
      temperature: 0.3,
    };

    if (toolDefs.length > 0) {
      body.tools = toolDefs as any;
      body.tool_choice = 'auto';
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5 * 60 * 1000);

    try {
      const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `${this.config.authPrefix}${this.config.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: this.config.abortSignal || controller.signal,
      });
      clearTimeout(timeout);

      if (!response.ok) {
        const errBody = await response.text().catch(() => 'Unknown error');
        throw new Error(`API ${response.status}: ${errBody}`);
      }

      return await response.json();
    } catch (err: any) {
      clearTimeout(timeout);
      throw err;
    }
  }

  /** Execute a single tool call */
  private async executeTool(toolCall: ToolCall, tools: Map<string, AgentTool>, ctx: ExecutionContext): Promise<ToolResult> {
    const agentTool = tools.get(toolCall.function.name);
    if (!agentTool) {
      return { success: false, output: '', error: `Unknown tool: ${toolCall.function.name}` };
    }

    let args: Record<string, any>;
    try {
      args = JSON.parse(toolCall.function.arguments);
    } catch {
      return { success: false, output: '', error: 'Failed to parse tool arguments' };
    }

    // Fire onPreToolUse hook
    const hookCtx: HookContext = {
      sessionId: this.sessionId,
      workspace: this.config.workspace,
      model: this.config.model,
      messages: ctx.messages,
      toolCall,
      metadata: { iteration: ctx.iteration, phase: ctx.metadata.phase },
    };
    await this.lifecycle.fire('onPreToolUse', hookCtx);

    // Execute
    console.log(`[Orchestrator] Executing: ${toolCall.function.name} (phase: ${ctx.metadata.phase || 'main'})`);
    const result = await agentTool.execute(args, ctx);

    // Fire onPostToolUse hook
    hookCtx.toolResult = result;
    await this.lifecycle.fire('onPostToolUse', hookCtx);

    // Post-action hooks: auto-run formatters/linters after file writes
    if (toolCall.function.name === 'write_file' && result.success) {
      await this.runPostActionHooks(toolCall.function.name, args, ctx);
    }

    return result;
  }

  /** Run post-action hooks (e.g., auto-format after file write) */
  private async runPostActionHooks(toolName: string, args: Record<string, any>, ctx: ExecutionContext): Promise<void> {
    if (toolName === 'write_file' && args.file_path) {
      const ext = args.file_path.split('.').pop()?.toLowerCase();
      // Auto-format based on file type
      const formatCommands: Record<string, string> = {
        ts: 'npx prettier --write',
        tsx: 'npx prettier --write',
        js: 'npx prettier --write',
        jsx: 'npx prettier --write',
        json: 'npx prettier --write',
        css: 'npx prettier --write',
        md: 'npx prettier --write',
      };

      if (ext && formatCommands[ext]) {
        try {
          const terminalSkill = this.internalSkills.find(s => s.name === 'terminal');
          if (terminalSkill) {
            await terminalSkill.execute('run_command', {
              command: `${formatCommands[ext]} "${args.file_path}"`,
              cwd: this.config.workspace,
            }, ctx);
          }
        } catch { /* formatter not available, skip */ }
      }
    }
  }

  /** Build system prompt with workspace, project instructions, and memory context */
  private buildSystemPrompt(): string {
    let prompt = AGENT_SYSTEM_PROMPT.replace('{{WORKSPACE}}', this.config.workspace);

    // Add project instructions
    if (this.projectInstructions) {
      prompt = prompt.replace('{{PROJECT_INSTRUCTIONS}}',
        `\n## Project Instructions\n${this.projectInstructions}\n`);
    } else {
      prompt = prompt.replace('{{PROJECT_INSTRUCTIONS}}', '');
    }

    // Add memory context
    if (this.config.enableMemory) {
      const recentContext = this.memoryPlugin.getStore().getRecentContext(3);
      if (recentContext) {
        prompt += `\n\n## Recent Session Context\n${recentContext}`;
      }
    }

    return prompt;
  }

  /** Execute a complete agent task — the main entry point */
  async execute(userMessages: ChatMessage[]): Promise<OrchestratorResult> {
    const maxIterations = this.config.maxIterations || 20;
    const toolExecutions: OrchestratorResult['toolExecutions'] = [];
    const allMessages: ChatMessage[] = [];

    // Build system prompt
    allMessages.push({ role: 'system', content: this.buildSystemPrompt() });
    allMessages.push(...userMessages);

    // Build tools
    const tools = this.buildTools();
    console.log(`[Orchestrator] ${tools.size} tools available`);

    // Fire lifecycle hooks
    const hookCtx = this.createHookContext(allMessages);
    await this.lifecycle.fire('onSessionStart', hookCtx);
    await this.lifecycle.fire('onUserPromptSubmit', hookCtx);

    // Check for skill triggers in user input
    const lastUserMsg = userMessages.filter(m => m.role === 'user').pop();
    if (lastUserMsg?.content) {
      const skillTrigger = detectSkillTrigger(lastUserMsg.content);
      if (skillTrigger) {
        console.log(`[Orchestrator] Skill triggered: ${skillTrigger.skill.name}`);
        // The skill is available as a tool, the LLM should discover it
      }
    }

    // Three-phase execution loop
    let iterations = 0;
    let currentPhase: AgentPhase = 'gather_context';
    let phaseAttempts = 0;

    while (iterations < maxIterations) {
      // Check abort signal
      if (this.config.abortSignal?.aborted) {
        console.log(`[Orchestrator] Aborted by user at iteration ${iterations}`);
        break;
      }

      iterations++;
      console.log(`[Orchestrator] Iteration ${iterations}/${maxIterations} (phase: ${currentPhase})`);

      // Add phase instruction to guide the LLM
      const phaseInstructions: Record<AgentPhase, string> = {
        gather_context: `[Current phase: GATHER CONTEXT] — Read relevant files, search for patterns, understand the codebase before making changes.`,
        take_action: `[Current phase: TAKE ACTION] — Make the necessary changes: write files, run commands, execute the plan.`,
        verify_results: `[Current phase: VERIFY RESULTS] — Verify your work: run tests, read created files, check for errors. If something failed, fix it.`,
      };
      allMessages.push({ role: 'system', content: phaseInstructions[currentPhase] });

      // Call LLM
      const response = await this.callLLM(allMessages, tools);
      const choice = response.choices?.[0];
      if (!choice) throw new Error('No response from LLM');

      const assistantMsg = choice.message;
      allMessages.push({
        role: 'assistant',
        content: assistantMsg.content,
        tool_calls: assistantMsg.tool_calls,
      });

      // No tool calls — LLM is done
      if (!assistantMsg.tool_calls || assistantMsg.tool_calls.length === 0) {
        // If we're in verify phase and no tool calls, we're truly done
        if (currentPhase === 'verify_results') {
          console.log(`[Orchestrator] Completed after ${iterations} iterations (verified)`);
          break;
        }
        // If LLM finished without tool calls in earlier phases, advance
        phaseAttempts++;
        if (phaseAttempts >= 2) {
          // LLM seems done, let it finish
          console.log(`[Orchestrator] Completed after ${iterations} iterations`);
          break;
        }
        continue;
      }

      // Execute each tool call
      const ctx: ExecutionContext = {
        sessionId: this.sessionId,
        workspace: this.config.workspace,
        model: this.config.model,
        messages: allMessages,
        iteration: iterations,
        maxIterations,
        tools,
        metadata: { phase: currentPhase },
        projectInstructions: this.projectInstructions,
        abortSignal: this.config.abortSignal,
      };

      let hasSuccessfulAction = false;
      for (const toolCall of assistantMsg.tool_calls) {
        const result = await this.executeTool(toolCall, tools, ctx);

        toolExecutions.push({
          tool: toolCall.function.name,
          result: result.output || result.error || '',
          duration_ms: result.duration_ms || 0,
          phase: currentPhase,
        });

        allMessages.push({
          role: 'tool',
          content: result.output || result.error || '(no output)',
          tool_call_id: toolCall.id,
        });

        if (result.success) hasSuccessfulAction = true;
      }

      // Phase progression logic
      phaseAttempts++;
      if (phaseAttempts >= 3 || (phaseAttempts >= 1 && hasSuccessfulAction)) {
        if (currentPhase === 'gather_context') {
          currentPhase = 'take_action';
          phaseAttempts = 0;
        } else if (currentPhase === 'take_action') {
          currentPhase = 'verify_results';
          phaseAttempts = 0;
        } else if (currentPhase === 'verify_results') {
          // After verification, if all good, we're done
          console.log(`[Orchestrator] Verification complete after ${iterations} iterations`);
          break;
        }
      }

      // Fire onPhaseComplete
      await this.lifecycle.fire('onPhaseComplete', this.createHookContext(allMessages, {
        phase: currentPhase,
        iterations,
      }));
    }

    // Fire session end
    await this.lifecycle.fire('onSessionEnd', this.createHookContext(allMessages));

    // Save session to memory
    if (this.config.enableMemory) {
      const finalContent = allMessages.filter(m => m.role === 'assistant' && m.content).pop()?.content || '';
      this.memoryPlugin.getStore().addSession({
        sessionId: this.sessionId,
        timestamp: Date.now(),
        model: this.config.model,
        title: lastUserMsg?.content?.substring(0, 100) || 'Session',
        summary: finalContent.substring(0, 500),
        tasksCompleted: toolExecutions.filter(t => t.tool === 'write_file').map(t => t.result.substring(0, 100)),
        learnings: [],
        toolsUsed: [...new Set(toolExecutions.map(t => t.tool))],
      });
      await this.memoryPlugin.getStore().save();
    }

    return {
      messages: allMessages,
      iterations,
      toolExecutions,
      memoryEntries: [],
    };
  }

  private createHookContext(messages: ChatMessage[], extra?: Record<string, any>): HookContext {
    return {
      sessionId: this.sessionId,
      workspace: this.config.workspace,
      model: this.config.model,
      messages,
      metadata: { ...extra },
    };
  }
}
