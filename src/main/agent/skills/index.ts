/**
 * FreebuffCC Agent System - Skills Framework
 * 
 * Modular system for built-in capabilities.
 * Each skill exports tool definitions and execution functions.
 */

import { AgentSkill, ExecutionContext, ToolResult } from '../types';

export { TerminalSkill } from './terminal';
export { FileSystemSkill } from './filesystem';
export { MemorySearchSkill } from './memory-search';

/** All built-in skills */
export const BUILTIN_SKILLS: AgentSkill[] = [];
