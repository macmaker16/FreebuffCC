/**
 * Michaelangelo Agent System - Main Export
 */

export { Orchestrator } from './orchestrator';
export { LifecycleManager } from './lifecycle';
export { PluginRegistry } from './plugins/registry';
export { MemoryPlugin } from './plugins/memory-plugin';
export { ErrorRecoveryPlugin } from './plugins/error-recovery';
export { LinterHookPlugin } from './plugins/linter-hook';
export { MCPClientManager } from './mcp/client';
export { MCPSSEClient } from './mcp/sse-client';
export { SubAgentManager } from './subagent/manager';
export { ToolRegistry } from './tools/registry';
export { ContextCompressionEngine } from './context-compression';
export { MultiModelRouter } from './multi-model-router';
export { TerminalSkill } from './skills/terminal';
export { FileSystemSkill } from './skills/filesystem';
export { GitSkill } from './skills/git';
export { WorkflowMetaTools } from './skills/workflow';
export { SemanticCodeSearchSkill } from './skills/semantic-search';
export { BUILTIN_SKILLS, detectSkillTrigger } from './skills/builtin-skills';
export { loadProjectInstructions } from './memory/instructions';
export type * from './types';
