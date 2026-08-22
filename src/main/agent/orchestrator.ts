/**
 * Michaelangelo Agent System - Master Orchestrator
 * 
 * The central execution loop that integrates:
 * - Lifecycle hooks (plugins)
 * - MCP tools (external servers)
 * - Internal skills (built-in tools)
 * - Memory system (context injection)
 * 
 * Flow:
 * 1. Fire onSessionStart (plugins)
 * 2. Fire onUserPromptSubmit (plugins)
 * 3. Gather tools: internal skills + MCP tools
 * 4. Send to LLM
 * 5. If tool_calls: execute → fire onPostToolUse → feed back
 * 6. Repeat until final response
 * 7. Fire onSessionEnd (plugins)
 */

/** Generate a unique ID without external dependencies */
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}
import {
  ChatMessage, ToolCall, AgentTool, ExecutionContext, HookContext,
  OrchestratorConfig, OrchestratorResult, ToolResult, AgentSkill,
  MCPServerConfig,
} from './types';
import { LifecycleManager } from './lifecycle';
import { PluginRegistry } from './plugins/registry';
import { MemoryPlugin } from './plugins/memory-plugin';
import { MCPClientManager } from './mcp/client';
import { TerminalSkill } from './skills/terminal';
import { FileSystemSkill } from './skills/filesystem';
import { MemorySearchSkill, setMemoryStore } from './skills/memory-search';

/** System prompt for the agent */
const AGENT_SYSTEM_PROMPT = `You are Michaelangelo, an autonomous AI coding assistant. You have access to tools that let you interact with the user's filesystem and terminal.

YOUR JOB: When the user asks you to build, create, fix, or modify software, you MUST use your tools to actually do the work.

HOW TO WORK:
1. Analyze what the user wants.
2. Break it into concrete steps.
3. Execute each step using your tools.
4. After each action, check the result and continue.
5. When everything is done, give the user a summary.

RULES:
- ALWAYS use write_file to create files. Never just show code.
- ALWAYS use run_command to install dependencies and run commands.
- Use read_file to check existing files before modifying them.
- If a command fails, read the error and fix the issue.
- Be thorough — complete the entire task before stopping.
- Your workspace is: {{WORKSPACE}}

IMPORTANT: You MUST call tools. Do NOT output code blocks as your response.`;

export class Orchestrator {
  private config: OrchestratorConfig;
  private lifecycle: LifecycleManager;
  private plugins: PluginRegistry;
  private mcp: MCPClientManager;
  private memoryPlugin: MemoryPlugin;
  private internalSkills: AgentSkill[];
  private sessionId: string;

  constructor(config: OrchestratorConfig) {
    this.config = config;
    this.sessionId = generateId();
    this.lifecycle = new LifecycleManager();
    this.plugins = new PluginRegistry(this.lifecycle);
    this.mcp = new MCPClientManager();
    this.internalSkills = [TerminalSkill, FileSystemSkill];

    // Create and register memory plugin
    this.memoryPlugin = new MemoryPlugin(config.workspace);
    this.plugins.add(this.memoryPlugin);
  }

  /** Initialize the orchestrator */
  async init(): Promise<void> {
    // Initialize memory store
    await this.memoryPlugin.init();

    // Set memory store reference for the search skill
    setMemoryStore(this.memoryPlugin.getStore().getAll());

    // Connect to MCP servers if configured
    if (this.config.enableMCP && this.config.mcpServers) {
      for (const server of this.config.mcpServers) {
        try {
          await this.mcp.connect(server);
        } catch (err: any) {
          console.error(`[Orchestrator] Failed to connect MCP server ${server.name}:`, err.message);
        }
      }
    }

    console.log(`[Orchestrator] Initialized (session: ${this.sessionId})`);
  }

  /** Shutdown the orchestrator */
  async shutdown(): Promise<void> {
    await this.mcp.disconnectAll();
    console.log(`[Orchestrator] Shutdown complete`);
  }

  /** Build the tools array from internal skills + MCP */
  private buildTools(): Map<string, AgentTool> {
    const tools = new Map<string, AgentTool>();

    // Add internal skill tools
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

    // Add MCP tools
    const mcpTools = this.mcp.getAllTools();
    for (const mcpTool of mcpTools) {
      tools.set(mcpTool.function.name, {
        name: mcpTool.function.name,
        description: mcpTool.function.description,
        definition: mcpTool,
        execute: (args) => this.mcp.callTool(mcpTool.serverId, mcpTool.function.name, args),
        source: 'mcp',
        mcpServerId: mcpTool.serverId,
      });
    }

    // Add memory search tool
    for (const def of MemorySearchSkill.tools) {
      tools.set(def.function.name, {
        name: def.function.name,
        description: def.function.description,
        definition: def,
        execute: (args, ctx) => MemorySearchSkill.execute(def.function.name, args, ctx),
        source: 'internal',
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
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!response.ok) {
        const errBody = await response.text().catch(() => 'Unknown error');
        throw new Error(`API returned ${response.status}: ${errBody}`);
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
      metadata: { iteration: ctx.iteration },
    };
    await this.lifecycle.fire('onPreToolUse', hookCtx);

    // Execute the tool
    console.log(`[Orchestrator] Executing: ${toolCall.function.name}`);
    const result = await agentTool.execute(args, ctx);

    // Fire onPostToolUse hook
    hookCtx.toolResult = result;
    await this.lifecycle.fire('onPostToolUse', hookCtx);

    return result;
  }

  /** Create the hook context for lifecycle events */
  private createHookContext(messages: ChatMessage[], extra?: Partial<HookContext>): HookContext {
    return {
      sessionId: this.sessionId,
      workspace: this.config.workspace,
      model: this.config.model,
      messages,
      metadata: extra?.metadata || {},
      ...extra,
    };
  }

  /**
   * Execute a complete agent task.
   * This is the main entry point.
   */
  async execute(userMessages: ChatMessage[]): Promise<OrchestratorResult> {
    const maxIterations = this.config.maxIterations || 20;
    const toolExecutions: OrchestratorResult['toolExecutions'] = [];
    const allMessages: ChatMessage[] = [];

    // Build system prompt with workspace
    const systemPrompt = AGENT_SYSTEM_PROMPT.replace('{{WORKSPACE}}', this.config.workspace);

    // Start with system prompt + user messages
    allMessages.push({ role: 'system', content: systemPrompt });
    allMessages.push(...userMessages);

    // Build tools
    const tools = this.buildTools();
    console.log(`[Orchestrator] ${tools.size} tools available`);

    // Fire onSessionStart
    await this.lifecycle.fire('onSessionStart', this.createHookContext(allMessages));

    // Fire onUserPromptSubmit
    await this.lifecycle.fire('onUserPromptSubmit', this.createHookContext(allMessages));

    let iterations = 0;

    while (iterations < maxIterations) {
      iterations++;
      console.log(`[Orchestrator] Iteration ${iterations}/${maxIterations}`);

      // Call the LLM
      const response = await this.callLLM(allMessages, tools);
      const choice = response.choices?.[0];

      if (!choice) throw new Error('No response from LLM');

      const assistantMsg = choice.message;

      // Add assistant response
      allMessages.push({
        role: 'assistant',
        content: assistantMsg.content,
        tool_calls: assistantMsg.tool_calls,
      });

      // If no tool calls, we're done
      if (!assistantMsg.tool_calls || assistantMsg.tool_calls.length === 0) {
        console.log(`[Orchestrator] Completed after ${iterations} iterations`);
        break;
      }

      // Execute each tool call
      for (const toolCall of assistantMsg.toolCalls || assistantMsg.tool_calls) {
        const ctx: ExecutionContext = {
          sessionId: this.sessionId,
          workspace: this.config.workspace,
          model: this.config.model,
          messages: allMessages,
          iteration: iterations,
          maxIterations,
          tools,
          metadata: { iteration: iterations },
        };

        const result = await this.executeTool(toolCall, tools, ctx);

        toolExecutions.push({
          tool: toolCall.function.name,
          result: result.success ? result.output : `ERROR: ${result.error}`,
          duration_ms: result.duration_ms || 0,
        });

        // Add tool result to messages
        allMessages.push({
          role: 'tool',
          content: result.success ? result.output : `ERROR: ${result.error}`,
          tool_call_id: toolCall.id,
        });
      }
    }

    // Hit iteration limit
    if (iterations >= maxIterations) {
      allMessages.push({
        role: 'system',
        content: `[System: Maximum iterations reached. Please provide your final answer.]`,
      });

      const finalResponse = await this.callLLM(allMessages, tools);
      const finalChoice = finalResponse.choices?.[0];
      if (finalChoice?.message) {
        allMessages.push({ role: 'assistant', content: finalChoice.message.content });
      }
    }

    // Fire onSessionEnd
    await this.lifecycle.fire('onSessionEnd', this.createHookContext(allMessages));

    // Get final assistant response
    const lastAssistant = allMessages
      .filter(m => m.role === 'assistant' && m.content)
      .pop();

    return {
      success: true,
      messages: allMessages,
      iterations,
      toolExecutions,
      memoryEntries: this.memoryPlugin.getStore().getBySession(this.sessionId),
    };
  }
}
