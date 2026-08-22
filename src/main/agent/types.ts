/**
 * Michaelangelo Agent System - Core Type Definitions
 * 
 * All interfaces and types used across the agent architecture.
 * This is the single source of truth for the agent's data model.
 */

// ============================================================================
// MESSAGE TYPES
// ============================================================================

/** OpenAI-compatible message format */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}

/** A tool call returned by the LLM */
export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

/** OpenAI-compatible tool definition */
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

/** Result of executing a tool */
export interface ToolResult {
  success: boolean;
  output: string;
  error?: string;
  duration_ms?: number;
}

/** A tool that can be executed by the agent */
export interface AgentTool {
  name: string;
  description: string;
  definition: ToolDefinition;
  execute: (args: Record<string, any>, context: ExecutionContext) => Promise<ToolResult>;
  source: 'internal' | 'mcp' | 'plugin';
  mcpServerId?: string; // For MCP tools, which server owns this tool
}

// ============================================================================
// EXECUTION CONTEXT
// ============================================================================

/** Context passed through the entire agent execution loop */
export interface ExecutionContext {
  sessionId: string;
  workspace: string;
  model: string;
  messages: ChatMessage[];
  iteration: number;
  maxIterations: number;
  tools: Map<string, AgentTool>;
  metadata: Record<string, any>;
}

// ============================================================================
// PLUGIN SYSTEM
// ============================================================================

/** Available lifecycle hooks */
export type LifecycleHook =
  | 'onSessionStart'
  | 'onUserPromptSubmit'
  | 'onPreToolUse'
  | 'onPostToolUse'
  | 'onSessionEnd';

/** A plugin that hooks into the agent lifecycle */
export interface AgentPlugin {
  name: string;
  description: string;
  version: string;
  hooks: Partial<Record<LifecycleHook, (ctx: HookContext) => Promise<void>>>;
  enabled: boolean;
}

/** Context passed to lifecycle hooks */
export interface HookContext {
  sessionId: string;
  workspace: string;
  model: string;
  messages: ChatMessage[];
  toolCall?: ToolCall;
  toolResult?: ToolResult;
  observation?: string;
  metadata: Record<string, any>;
}

// ============================================================================
// MCP CLIENT
// ============================================================================

/** Configuration for connecting to an MCP server */
export interface MCPServerConfig {
  id: string;
  name: string;
  transport: 'stdio' | 'sse';
  command?: string;      // For stdio: the command to run
  args?: string[];       // For stdio: command arguments
  url?: string;          // For SSE: the server URL
  env?: Record<string, string>; // Environment variables
}

/** MCP server connection state */
export interface MCPServerState {
  id: string;
  status: 'disconnected' | 'connecting' | 'connected' | 'error';
  tools: ToolDefinition[];
  error?: string;
}

// ============================================================================
// MEMORY SYSTEM
// ============================================================================

/** A memory entry stored in the database */
export interface MemoryEntry {
  id: string;
  sessionId: string;
  timestamp: number;
  type: 'observation' | 'summary' | 'learning' | 'task';
  content: string;
  metadata: Record<string, any>;
}

/** Search result from memory */
export interface MemorySearchResult {
  entry: MemoryEntry;
  relevance: number; // 0-1 score
}

// ============================================================================
// SKILL SYSTEM
// ============================================================================

/** A built-in skill that provides tools */
export interface AgentSkill {
  name: string;
  description: string;
  tools: ToolDefinition[];
  execute: (toolName: string, args: Record<string, any>, ctx: ExecutionContext) => Promise<ToolResult>;
}

// ============================================================================
// ORCHESTRATOR
// ============================================================================

/** Result of a complete agent execution */
export interface OrchestratorResult {
  success: boolean;
  messages: ChatMessage[];
  iterations: number;
  toolExecutions: Array<{ tool: string; result: string; duration_ms: number }>;
  memoryEntries: MemoryEntry[];
  error?: string;
}

/** Configuration for the orchestrator */
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
}
