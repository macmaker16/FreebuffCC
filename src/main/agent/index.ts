/**
 * Michaelangelo Agent System - Main Export
 */

export { Orchestrator } from './orchestrator';
export { LifecycleManager } from './lifecycle';
export { PluginRegistry } from './plugins/registry';
export { MemoryPlugin } from './plugins/memory-plugin';
export { MCPClientManager } from './mcp/client';
export { SubAgentManager } from './subagent/manager';
export { ContextCompressionEngine } from './context-compression';
export { MultiModelRouter } from './multi-model-router';
export { TerminalSkill } from './skills/terminal';
export { FileSystemSkill } from './skills/filesystem';
export { GitSkill } from './skills/git';
export { WorkflowMetaTools } from './skills/workflow';
export { BUILTIN_SKILLS, detectSkillTrigger } from './skills/builtin-skills';
export { loadProjectInstructions } from './memory/instructions';
export type * from './types';
