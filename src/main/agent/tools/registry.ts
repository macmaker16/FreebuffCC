/**
 * Michaelangelo Agent - Tool Registry
 *
 * Central registry for managing all agent tools with:
 * - Dynamic loading and unloading of tools
 * - Tool validation and schema checking
 * - Error recovery with automatic retries
 * - Tool usage statistics
 * - Per-model tool filtering (some models support fewer tools)
 */

import { AgentTool, ToolDefinition, ToolResult, ExecutionContext, AgentSkill } from '../types';

// ============================================================================
// TOOL REGISTRY
// ============================================================================

export interface ToolStats {
  name: string;
  calls: number;
  successes: number;
  failures: number;
  avgDurationMs: number;
  totalDurationMs: number;
  lastUsed: number;
}

export interface ToolRegistryConfig {
  /** Maximum tools to expose per LLM call (some models choke with too many) */
  maxToolsPerModel?: Record<string, number>;
  /** Default max tools per model */
  defaultMaxTools?: number;
  /** Enable automatic retry for transient failures */
  enableRetries?: boolean;
  /** Max retries per tool call */
  maxRetries?: number;
}

export class ToolRegistry {
  private tools: Map<string, AgentTool> = new Map();
  private stats: Map<string, ToolStats> = new Map();
  private config: ToolRegistryConfig;

  constructor(config?: ToolRegistryConfig) {
    this.config = {
      maxToolsPerModel: {},
      defaultMaxTools: 25,
      enableRetries: true,
      maxRetries: 2,
      ...config,
    };
  }

  // ==========================================================================
  // REGISTRATION
  // ==========================================================================

  /** Register a single tool */
  register(tool: AgentTool): void {
    if (this.tools.has(tool.name)) {
      console.log(`[ToolRegistry] Replacing tool: ${tool.name}`);
    }
    this.tools.set(tool.name, tool);
    if (!this.stats.has(tool.name)) {
      this.stats.set(tool.name, {
        name: tool.name, calls: 0, successes: 0, failures: 0,
        avgDurationMs: 0, totalDurationMs: 0, lastUsed: 0,
      });
    }
  }

  /** Register all tools from a skill */
  registerSkill(skill: AgentSkill): number {
    let count = 0;
    for (const def of skill.tools) {
      this.register({
        name: def.function.name,
        description: def.function.description,
        definition: def,
        execute: (args, ctx) => skill.execute(def.function.name, args, ctx),
        source: 'internal',
      });
      count++;
    }
    return count;
  }

  /** Register tools from a list of definitions + executors */
  registerBatch(tools: Array<{ definition: ToolDefinition; execute: (args: Record<string, any>, ctx: ExecutionContext) => Promise<ToolResult>; source: AgentTool['source'] }>): number {
    let count = 0;
    for (const t of tools) {
      this.register({
        name: t.definition.function.name,
        description: t.definition.function.description,
        definition: t.definition,
        execute: t.execute,
        source: t.source,
      });
      count++;
    }
    return count;
  }

  /** Unregister a tool by name */
  unregister(name: string): boolean {
    return this.tools.delete(name);
  }

  /** Check if a tool is registered */
  has(name: string): boolean {
    return this.tools.has(name);
  }

  /** Get a tool by name */
  get(name: string): AgentTool | undefined {
    return this.tools.get(name);
  }

  /** Get all tools */
  getAll(): Map<string, AgentTool> {
    return new Map(this.tools);
  }

  /** Get all tool definitions (for LLM API calls) */
  getDefinitions(): ToolDefinition[] {
    return Array.from(this.tools.values()).map(t => t.definition);
  }

  /** Get tool count */
  size(): number {
    return this.tools.size;
  }

  // ==========================================================================
  // TOOL FILTERING (per-model limits)
  // ==========================================================================

  /**
   * Get tools filtered for a specific model.
   * Prioritizes tools by usage stats and relevance.
   */
  getForModel(model: string): ToolDefinition[] {
    const maxTools = this.config.maxToolsPerModel?.[model] || this.config.defaultMaxTools || 15;
    const allDefs = this.getDefinitions();

    if (allDefs.length <= maxTools) return allDefs;

    // Priority: filesystem > terminal > git > semantic > workflow > memory > mcp > builtin
    const priority: Record<string, number> = {
      'read_file': 1, 'write_file': 1, 'edit_file': 1,
      'list_files': 2, 'search_files': 2, 'glob_files': 2,
      'run_command': 3,
      'git_status': 4, 'git_diff': 4, 'git_add': 4, 'git_commit': 4,
      'find_definitions': 5, 'find_references': 5,
      'browser_navigate': 6, 'browser_screenshot': 6, 'browser_get_content': 6,
      'browser_get_styles': 6, 'browser_evaluate': 6, 'browser_wait': 6, 'browser_console': 6,
      'task': 7, 'delegate_complex_code': 8,
    };

    // Sort by priority (lower = more important), then by usage frequency
    allDefs.sort((a, b) => {
      const pa = priority[a.function.name] || 10;
      const pb = priority[b.function.name] || 10;
      if (pa !== pb) return pa - pb;
      const sa = this.stats.get(a.function.name);
      const sb = this.stats.get(b.function.name);
      return (sb?.calls || 0) - (sa?.calls || 0);
    });

    return allDefs.slice(0, maxTools);
  }

  /** Set model-specific tool limits */
  setModelLimit(model: string, maxTools: number): void {
    this.config.maxToolsPerModel = this.config.maxToolsPerModel || {};
    this.config.maxToolsPerModel[model] = maxTools;
  }

  // ==========================================================================
  // EXECUTION WITH RETRIES
  // ==========================================================================

  /** Execute a tool with automatic retry on transient failures */
  async execute(
    toolName: string,
    args: Record<string, any>,
    ctx: ExecutionContext,
  ): Promise<ToolResult> {
    const tool = this.tools.get(toolName);
    if (!tool) {
      return { success: false, output: '', error: `Unknown tool: ${toolName}` };
    }

    const startTime = Date.now();
    let lastError = '';
    const maxRetries = this.config.enableRetries ? (this.config.maxRetries || 2) : 0;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const result = await tool.execute(args, ctx);
        const duration = Date.now() - startTime;

        // Update stats
        this.updateStats(toolName, true, duration);

        return { ...result, duration_ms: duration };
      } catch (err: any) {
        lastError = err.message;

        // Only retry on transient errors
        if (attempt < maxRetries && this.isTransientError(err)) {
          console.log(`[ToolRegistry] Retrying ${toolName} (attempt ${attempt + 2}/${maxRetries + 1}): ${err.message}`);
          await this.delay(1000 * (attempt + 1)); // Exponential backoff
          continue;
        }

        const duration = Date.now() - startTime;
        this.updateStats(toolName, false, duration);

        return {
          success: false, output: '',
          error: `Tool ${toolName} failed: ${lastError}`,
          duration_ms: duration,
        };
      }
    }

    // Should never reach here, but TypeScript requires it
    return { success: false, output: '', error: `Tool ${toolName} failed: ${lastError}` };
  }

  private isTransientError(err: any): boolean {
    const msg = (err.message || '').toLowerCase();
    return msg.includes('timeout') ||
      msg.includes('econnreset') ||
      msg.includes('econnrefused') ||
      msg.includes('etimedout') ||
      msg.includes('rate limit') ||
      msg.includes('429') ||
      msg.includes('503');
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ==========================================================================
  // STATISTICS
  // ==========================================================================

  private updateStats(toolName: string, success: boolean, durationMs: number): void {
    const stats = this.stats.get(toolName);
    if (!stats) return;

    stats.calls++;
    if (success) stats.successes++;
    else stats.failures++;
    stats.totalDurationMs += durationMs;
    stats.avgDurationMs = stats.totalDurationMs / stats.calls;
    stats.lastUsed = Date.now();
  }

  /** Get usage statistics for all tools */
  getStats(): ToolStats[] {
    return [...this.stats.values()].sort((a, b) => b.calls - a.calls);
  }

  /** Get stats for a specific tool */
  getToolStats(name: string): ToolStats | undefined {
    return this.stats.get(name);
  }

  /** Reset all statistics */
  resetStats(): void {
    for (const stats of this.stats.values()) {
      stats.calls = 0;
      stats.successes = 0;
      stats.failures = 0;
      stats.avgDurationMs = 0;
      stats.totalDurationMs = 0;
      stats.lastUsed = 0;
    }
  }

  // ==========================================================================
  // VALIDATION
  // ==========================================================================

  /** Validate all tool definitions against OpenAI function calling spec */
  validate(): { valid: string[]; invalid: Array<{ name: string; errors: string[] }> } {
    const valid: string[] = [];
    const invalid: Array<{ name: string; errors: string[] }> = [];

    for (const [name, tool] of this.tools) {
      const errors: string[] = [];

      if (!tool.definition?.function?.name) {
        errors.push('Missing function name');
      }
      if (!tool.definition?.function?.description) {
        errors.push('Missing function description');
      }
      if (!tool.definition?.function?.parameters) {
        errors.push('Missing parameters schema');
      } else {
        const params = tool.definition.function.parameters;
        if (params.type !== 'object') {
          errors.push('Parameters type must be "object"');
        }
        if (!params.properties || typeof params.properties !== 'object') {
          errors.push('Missing or invalid parameters.properties');
        }
      }

      if (errors.length > 0) {
        invalid.push({ name, errors });
      } else {
        valid.push(name);
      }
    }

    return { valid, invalid };
  }
}
