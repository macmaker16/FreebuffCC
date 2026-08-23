/**
 * Michaelangelo Agent - Semantic Code Search Skill
 *
 * Provides AST-aware code navigation without external parser dependencies.
 * Uses regex-based pattern matching to identify function/class definitions,
 * references, and implementations across the codebase.
 *
 * Tools:
 *   - find_definitions: Find where a symbol is defined (function, class, const, etc.)
 *   - find_references: Find every file/line that references a symbol
 *   - find_implementations: Find implementations of an interface or abstract class
 *   - call_graph: Show what functions a given function calls and what calls it
 */

import { readFile, readdir } from 'fs/promises';
import { join, relative, extname } from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { AgentSkill, ExecutionContext, ToolResult } from '../types';

const execAsync = promisify(exec);

// ============================================================================
// PATTERN DEFINITIONS — regex-based AST for JS/TS/Python/Go
// ============================================================================

interface SymbolPattern {
  /** Language extension(s) this pattern applies to */
  extensions: string[];
  /** Regex groups: name group must be named (?P<name>...) or captured */
  definitionPatterns: RegExp[];
  /** Patterns that indicate a usage/reference */
  referencePatterns: RegExp[];
}

const LANG_PATTERNS: SymbolPattern[] = [
  // TypeScript / JavaScript
  {
    extensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'],
    definitionPatterns: [
      // function declarations
      /(?:export\s+)?(?:async\s+)?function\s+(?<name>\w+)/g,
      // class declarations
      /(?:export\s+)?(?:abstract\s+)?class\s+(?<name>\w+)/g,
      // const/let/var arrow functions and values
      /(?:export\s+)?(?:const|let|var)\s+(?<name>\w+)\s*=\s*(?:async\s+)?(?:\(|function|{)/g,
      // interface declarations
      /(?:export\s+)?interface\s+(?<name>\w+)/g,
      // type alias declarations
      /(?:export\s+)?type\s+(?<name>\w+)\s*=/g,
      // enum declarations
      /(?:export\s+)?(?:const\s+)?enum\s+(?<name>\w+)/g,
      // method definitions (class methods)
      /(?<name>\w+)\s*\([^)]*\)\s*(?::\s*\w+)?\s*\{/g,
      // export default
      /export\s+default\s+(?:class|function)\s+(?<name>\w+)/g,
    ],
    referencePatterns: [
      // function calls
      /\b(?<name>\w+)\s*\(/g,
      // property access
      /\.\s*(?<name>\w+)/g,
      // type annotations
      /:\s*(?<name>\w+)/g,
      // imports
      /import\s+.*?\bfrom\s+['"].*?['"]/g,
      // extends/implements
      /(?:extends|implements)\s+(?<name>\w+)/g,
    ],
  },
  // Python
  {
    extensions: ['.py', '.pyi'],
    definitionPatterns: [
      /(?:async\s+)?def\s+(?<name>\w+)/g,
      /class\s+(?<name>\w+)/g,
      /(?<name>\w+)\s*=\s*(?:lambda|property)/g,
    ],
    referencePatterns: [
      /\b(?<name>\w+)\s*\(/g,
      /\.\s*(?<name>\w+)/g,
      /:\s*(?<name>\w+)/g,
    ],
  },
  // Go
  {
    extensions: ['.go'],
    definitionPatterns: [
      /func\s+(?:\([^)]+\)\s+)?(?<name>\w+)/g,
      /type\s+(?<name>\w+)\s+(?:struct|interface)/g,
      /var\s+(?<name>\w+)/g,
    ],
    referencePatterns: [
      /\b(?<name>\w+)\s*\(/g,
      /\.\s*(?<name>\w+)/g,
    ],
  },
  // Rust
  {
    extensions: ['.rs'],
    definitionPatterns: [
      /(?:pub\s+)?(?:async\s+)?fn\s+(?<name>\w+)/g,
      /(?:pub\s+)?struct\s+(?<name>\w+)/g,
      /(?:pub\s+)?trait\s+(?<name>\w+)/g,
      /(?:pub\s+)?enum\s+(?<name>\w+)/g,
    ],
    referencePatterns: [
      /\b(?<name>\w+)\s*\(/g,
      /\.\s*(?<name>\w+)/g,
    ],
  },
];

// ============================================================================
// FILE DISCOVERY
// ============================================================================

const IGNORED_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '__pycache__', '.next',
  '.cache', 'coverage', '.michaelangelo', 'vendor', 'target',
]);

async function discoverSourceFiles(workspace: string, maxFiles = 500): Promise<string[]> {
  const files: string[] = [];

  async function walk(dir: string, depth = 0): Promise<void> {
    if (depth > 8 || files.length >= maxFiles) return;
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (IGNORED_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(fullPath, depth + 1);
        } else {
          const ext = extname(entry.name).toLowerCase();
          const isSource = LANG_PATTERNS.some(p => p.extensions.includes(ext));
          if (isSource) {
            files.push(fullPath);
          }
        }
      }
    } catch { /* ignore permission errors */ }
  }

  await walk(workspace);
  return files;
}

function getPatternsForFile(filePath: string): SymbolPattern | null {
  const ext = extname(filePath).toLowerCase();
  return LANG_PATTERNS.find(p => p.extensions.includes(ext)) || null;
}

// ============================================================================
// SEARCH ENGINE
// ============================================================================

interface SymbolMatch {
  file: string;
  line: number;
  column: number;
  name: string;
  context: string; // The actual line content
  type: 'definition' | 'reference';
}

async function searchSymbol(
  workspace: string,
  symbolName: string,
  mode: 'definitions' | 'references' | 'implementations',
  maxResults = 50,
): Promise<SymbolMatch[]> {
  const files = await discoverSourceFiles(workspace);
  const matches: SymbolMatch[] = [];

  for (const filePath of files) {
    if (matches.length >= maxResults) break;

    const pattern = getPatternsForFile(filePath);
    if (!pattern) continue;

    let content: string;
    try {
      content = await readFile(filePath, 'utf-8');
    } catch { continue; }

    const lines = content.split('\n');
    const relPath = relative(workspace, filePath);

    const patternsToUse = mode === 'definitions'
      ? pattern.definitionPatterns
      : mode === 'implementations'
        ? [...pattern.definitionPatterns, ...pattern.referencePatterns]
        : pattern.referencePatterns;

    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
      if (matches.length >= maxResults) break;
      const line = lines[lineIdx];

      for (const regex of patternsToUse) {
        // Reset lastIndex for global regexes
        regex.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = regex.exec(line)) !== null) {
          // Extract the captured group named 'name' or group 1
          const capturedName = m.groups?.name || m[1];
          if (!capturedName) continue;

          if (capturedName === symbolName || capturedName.toLowerCase() === symbolName.toLowerCase()) {
            const isDef = mode === 'definitions' && pattern.definitionPatterns.includes(regex);
            const isImpl = mode === 'implementations' && pattern.definitionPatterns.includes(regex);

            // For references mode, skip if it's a definition line (we want usages)
            if (mode === 'references' && isDef) continue;

            matches.push({
              file: relPath,
              line: lineIdx + 1,
              column: m.index,
              name: capturedName,
              context: line.trim(),
              type: (isDef || isImpl) ? 'definition' : 'reference',
            });
          }
        }
      }
    }
  }

  return matches;
}

// ============================================================================
// CALL GRAPH ANALYSIS
// ============================================================================

interface CallGraphEntry {
  function: string;
  file: string;
  line: number;
  calls: string[];
  calledBy: string[];
}

async function buildCallGraph(
  workspace: string,
  functionName: string,
): Promise<CallGraphEntry | null> {
  // First find the definition
  const defs = await searchSymbol(workspace, functionName, 'definitions', 5);
  if (defs.length === 0) return null;

  const def = defs[0];
  const filePath = join(workspace, def.file);
  let content: string;
  try {
    content = await readFile(filePath, 'utf-8');
  } catch { return null; }

  const lines = content.split('\n');

  // Find the function body: from the definition line to the matching closing brace
  let startLine = def.line - 1;
  let braceDepth = 0;
  let endLine = startLine;
  let foundOpenBrace = false;

  for (let i = startLine; i < Math.min(lines.length, startLine + 200); i++) {
    const line = lines[i];
    for (const ch of line) {
      if (ch === '{') { braceDepth++; foundOpenBrace = true; }
      if (ch === '}') braceDepth--;
    }
    endLine = i;
    if (foundOpenBrace && braceDepth <= 0) break;
  }

  // Extract function body
  const body = lines.slice(startLine, endLine + 1).join('\n');

  // Find function calls within the body
  const calls: string[] = [];
  const callPattern = /\b(\w+)\s*\(/g;
  let m: RegExpExecArray | null;
  const seen = new Set<string>();
  while ((m = callPattern.exec(body)) !== null) {
    const called = m[1];
    // Skip keywords and the function itself
    if (called === functionName || ['if', 'for', 'while', 'switch', 'catch', 'return', 'new', 'typeof', 'require', 'import'].includes(called)) continue;
    if (!seen.has(called)) {
      seen.add(called);
      calls.push(called);
    }
  }

  // Find what calls this function
  const callers = await searchSymbol(workspace, functionName, 'references', 30);
  const calledBy = callers
    .filter(c => !(c.file === def.file && c.line === def.line)) // exclude the definition
    .map(c => `${c.file}:${c.line}`);

  return {
    function: functionName,
    file: def.file,
    line: def.line,
    calls,
    calledBy,
  };
}

// ============================================================================
// SKILL IMPLEMENTATION
// ============================================================================

export const SemanticCodeSearchSkill: AgentSkill = {
  name: 'semantic-search',
  description: 'AST-aware code navigation: find definitions, references, implementations, and call graphs',
  tools: [
    {
      type: 'function',
      function: {
        name: 'find_definitions',
        description: 'Find where a symbol (function, class, const, type, interface) is defined in the codebase. Returns file paths, line numbers, and context.',
        parameters: {
          type: 'object',
          properties: {
            symbol: { type: 'string', description: 'The symbol name to find (e.g., "UserService", "handleClick", "MyClass")' },
            max_results: { type: 'number', description: 'Maximum results (default 20)' },
          },
          required: ['symbol'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'find_references',
        description: 'Find every file and line that references/uses a given symbol. Returns file paths, line numbers, and context lines.',
        parameters: {
          type: 'object',
          properties: {
            symbol: { type: 'string', description: 'The symbol name to search for (e.g., "handleClick", "UserService")' },
            max_results: { type: 'number', description: 'Maximum results (default 30)' },
          },
          required: ['symbol'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'find_implementations',
        description: 'Find implementations of a class, interface, or trait. Useful for finding all classes that implement a given interface.',
        parameters: {
          type: 'object',
          properties: {
            symbol: { type: 'string', description: 'The interface/class/trait name to find implementations of' },
            max_results: { type: 'number', description: 'Maximum results (default 20)' },
          },
          required: ['symbol'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'call_graph',
        description: 'Show what functions a given function calls, and what other functions call it. Returns a local dependency graph.',
        parameters: {
          type: 'object',
          properties: {
            function: { type: 'string', description: 'The function name to analyze' },
          },
          required: ['function'],
        },
      },
    },
  ],

  async execute(toolName: string, args: Record<string, any>, ctx: ExecutionContext): Promise<ToolResult> {
    const startTime = Date.now();

    try {
      switch (toolName) {
        case 'find_definitions': {
          const { symbol, max_results = 20 } = args;
          if (!symbol) return { success: false, output: '', error: 'symbol is required', duration_ms: Date.now() - startTime };

          const matches = await searchSymbol(ctx.workspace, symbol, 'definitions', max_results);
          if (matches.length === 0) {
            return { success: true, output: `No definitions found for "${symbol}"`, duration_ms: Date.now() - startTime };
          }

          const output = matches.map((m, i) =>
            `${i + 1}. ${m.file}:${m.line}:${m.column}\n   ${m.context}`,
          ).join('\n\n');

          return {
            success: true,
            output: `Found ${matches.length} definition(s) for "${symbol}":\n\n${output}`,
            duration_ms: Date.now() - startTime,
          };
        }

        case 'find_references': {
          const { symbol, max_results = 30 } = args;
          if (!symbol) return { success: false, output: '', error: 'symbol is required', duration_ms: Date.now() - startTime };

          const matches = await searchSymbol(ctx.workspace, symbol, 'references', max_results);
          if (matches.length === 0) {
            return { success: true, output: `No references found for "${symbol}"`, duration_ms: Date.now() - startTime };
          }

          // Group by file
          const byFile = new Map<string, typeof matches>();
          for (const m of matches) {
            if (!byFile.has(m.file)) byFile.set(m.file, []);
            byFile.get(m.file)!.push(m);
          }

          const output = [...byFile.entries()].map(([file, fileMatches]) =>
            `${file}:\n${fileMatches.map(m => `  L${m.line}: ${m.context}`).join('\n')}`,
          ).join('\n\n');

          return {
            success: true,
            output: `Found ${matches.length} reference(s) to "${symbol}" in ${byFile.size} file(s):\n\n${output}`,
            duration_ms: Date.now() - startTime,
          };
        }

        case 'find_implementations': {
          const { symbol, max_results = 20 } = args;
          if (!symbol) return { success: false, output: '', error: 'symbol is required', duration_ms: Date.now() - startTime };

          const matches = await searchSymbol(ctx.workspace, symbol, 'implementations', max_results);
          if (matches.length === 0) {
            return { success: true, output: `No implementations found for "${symbol}"`, duration_ms: Date.now() - startTime };
          }

          const output = matches.map((m, i) =>
            `${i + 1}. ${m.file}:${m.line} — ${m.context}`,
          ).join('\n\n');

          return {
            success: true,
            output: `Found ${matches.length} implementation(s) for "${symbol}":\n\n${output}`,
            duration_ms: Date.now() - startTime,
          };
        }

        case 'call_graph': {
          const { function: funcName } = args;
          if (!funcName) return { success: false, output: '', error: 'function name is required', duration_ms: Date.now() - startTime };

          const graph = await buildCallGraph(ctx.workspace, funcName);
          if (!graph) {
            return { success: true, output: `Function "${funcName}" not found`, duration_ms: Date.now() - startTime };
          }

          const output = [
            `Function: ${graph.function}`,
            `Defined in: ${graph.file}:${graph.line}`,
            '',
            `Calls (${graph.calls.length}):`,
            ...graph.calls.map(c => `  → ${c}`),
            '',
            `Called by (${graph.calledBy.length}):`,
            ...graph.calledBy.map(c => `  ← ${c}`),
          ].join('\n');

          return { success: true, output, duration_ms: Date.now() - startTime };
        }

        default:
          return { success: false, output: '', error: `Unknown semantic search tool: ${toolName}`, duration_ms: Date.now() - startTime };
      }
    } catch (err: any) {
      return { success: false, output: '', error: `Semantic search failed: ${err.message}`, duration_ms: Date.now() - startTime };
    }
  },
};
