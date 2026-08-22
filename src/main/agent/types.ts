/**
 * Michaelangelo Agent System - Complete Type Definitions
 * Claude Code-style architecture with 3-phase loop, MCP, sub-agents, skills
 */

// ============================================================================
// MESSAGE TYPES
// ============================================================================

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, any>;
      required: string[];
    };
  };
}

// ============================================================================
// TOOL EXECUTION
// ============================================================================

export interface ToolResult {
  success: boolean;
  output: string;
  error?: string;
  duration_ms?: number;
  metadata?: Record<string, any>;
}

export interface AgentTool {
  name: string;
  description: string;
  definition: ToolDefinition;
  execute: (args: Record<string, any>, context: ExecutionContext) => Promise<ToolResult>;
  source: 'internal' | 'mcp' | 'plugin' | 'skill';
  mcpServerId?: string;
}

// ============================================================================
// SKILL SYSTEM
// ============================================================================

/** A skill is a package of repeatable workflows the model can invoke */
export interface SkillDefinition {
  name: string;
  description: string;
  trigger: string; // e.g. "/review-pr", "/deploy-staging"
  steps: SkillStep[];
  parameters: { name: string; type: string; description: string; required: boolean }[];
}

export interface SkillStep {
  action: string; // tool name to call
  args: Record<string, string>; // template args with {{param}} placeholders
  description: string;
}

export interface AgentSkill {
  name: string;
  description: string;
  tools: ToolDefinition[];
  execute: (toolName: string, args: Record<string, any>, ctx: ExecutionContext) => Promise<ToolResult>;
}

// ============================================================================
// EXECUTION CONTEXT
// ============================================================================

export interface ExecutionContext {
  sessionId: string;
  workspace: string;
  model: string;
  messages: ChatMessage[];
  iteration: number;
  maxIterations: number;
  tools: Map<string, AgentTool>;
  metadata: Record<string, any>;
  /** Project instructions loaded from APP_INSTRUCTIONS.md */
  projectInstructions?: string;
  /** Abort signal for user interruption */
  abortSignal?: AbortSignal;
}

// ============================================================================
// THREE-PHASE LOOP
// ============================================================================

export type AgentPhase = 'gather_context' | 'take_action' | 'verify_results';

export interface PhaseResult {
  phase: AgentPhase;
  toolCalls: ToolCall[];
  toolResults: ToolResult[];
  context?: string; // Gathered context for the phase
  verified?: boolean; // For verify phase
}

// ============================================================================
// LIFECYCLE HOOKS
// ============================================================================

export type LifecycleHook =
  | 'onSessionStart'
  | 'onUserPromptSubmit'
  | 'onPreToolUse'
  | 'onPostToolUse'
  | 'onToolError'
  | 'onPhaseComplete'
  | 'onSessionEnd';

export interface AgentPlugin {
  name: string;
  description: string;
  version: string;
  enabled: boolean;
  hooks: Partial<Record<LifecycleHook, (ctx: HookContext) => Promise<void>>>;
}

export interface HookContext {
  sessionId: string;
  workspace: string;
  model: string;
  messages: ChatMessage[];
  toolCall?: ToolCall;
  toolResult?: ToolResult;
  metadata: Record<string, any>;
}

// ============================================================================
// ORCHESTRATOR CONFIG
// ============================================================================

export interface OrchestratorConfig {
  model: string;
  baseUrl: string;
  apiKey: string;
  authPrefix: string;
  workspace: string;
  maxIterations?: number;
  enableMemory?: boolean;
  enableMCP?: boolean;
  mcpServers?: MCPServerConfig[];
  /** Enable sub-agent spawning */
  enableSubAgents?: boolean;
  /** User abort signal for interruption */
  abortSignal?: AbortSignal;
}

export interface OrchestratorResult {
  messages: ChatMessage[];
  iterations: number;
  toolExecutions: { tool: string; result: string; duration_ms: number; phase: string }[];
  memoryEntries: { key: string; value: string }[];
  subAgentResults?: SubAgentResult[];
}

// ============================================================================
// MCP CLIENT
// ============================================================================

export interface MCPServerConfig {
  name: string;
  transport: 'stdio' | 'sse';
  command?: string; // For stdio transport
  args?: string[];
  url?: string; // For SSE transport
  env?: Record<string, string>;
}

export interface MCPTool {
  serverId: string;
  function: ToolDefinition;
}

// ============================================================================
// SUB-AGENTS
// ============================================================================

export interface SubAgentTask {
  id: string;
  description: string;
  prompt: string;
  workspace: string;
  model: string;
  parentSessionId: string;
}

export interface SubAgentResult {
  taskId: string;
  status: 'completed' | 'failed' | 'cancelled';
  output: string;
  toolExecutions: { tool: string; result: string }[];
  duration_ms: number;
}
