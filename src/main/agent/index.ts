/**
 * Michaelangelo Agent System - Main Export
 * 
 * Re-exports all agent components for easy importing.
 */

export { Orchestrator } from './orchestrator';
export { LifecycleManager } from './lifecycle';
export { PluginRegistry } from './plugins/registry';
export { MCPClientManager } from './mcp/client';
export { MemoryStore } from './memory/store';
export { MemoryPlugin } from './plugins/memory-plugin';

// Skills
export { TerminalSkill } from './skills/terminal';
export { FileSystemSkill } from './skills/filesystem';
export { MemorySearchSkill } from './skills/memory-search';

// Types
export * from './types';
