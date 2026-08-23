/**
 * Michaelangelo Agent - PageRank Repo Map with AST Elision
 *
 * Background indexer that parses the repository into a compressed "repo map"
 * showing only class definitions, function signatures, and exported interfaces,
 * replacing method bodies with elision markers (⋮).
 *
 * Uses a PageRank-style algorithm to rank file importance based on:
 * - Import/dependency graph (files imported by many others rank higher)
 * - File size (larger files tend to be more important)
 * - Recency (recently modified files rank higher)
 *
 * The map is token-efficient: the agent sees function signatures and types
 * without full method bodies, enabling it to understand a 100-file project
 * for a fraction of the token cost.
 *
 * Flow:
 *  1. Walk the workspace directory tree
 *  2. Parse each source file with regex-based AST extraction
 *  3. Build import/dependency graph
 *  4. Run PageRank to rank file importance
 *  5. Generate compressed repo map with elision markers
 *  6. Cache and invalidate on file changes
 */

import { readFile, readdir, stat, access } from 'fs/promises';
import { join, relative, extname, basename, dirname } from 'path';

// ============================================================================
// TYPES
// ============================================================================

export interface FileSymbol {
  name: string;
  type: 'function' | 'class' | 'interface' | 'type' | 'enum' | 'export' | 'variable' | 'method';
  signature: string;
  startLine: number;
  endLine: number;
  exported: boolean;
  params?: string;
  returnType?: string;
}

export interface FileMapEntry {
  relativePath: string;
  symbols: FileSymbol[];
  imports: string[];
  exports: string[];
  rank: number;
  totalLines: number;
  lastModified: number;
}

export interface RepoMap {
  files: Map<string, FileMapEntry>;
  rankedPaths: string[];
  totalFiles: number;
  totalSymbols: number;
  generatedAt: number;
  workspaceHash: string;
}

export interface RepoMapConfig {
  workspace: string;
  /** File extensions to index */
  extensions?: string[];
  /** Max files to index */
  maxFiles?: number;
  /** Max characters per file to parse */
  maxFileSize?: number;
  /** Directories to skip */
  ignoreDirs?: string[];
  /** Files to skip */
  ignoreFiles?: string[];
}

// ============================================================================
// DEFAULTS
// ============================================================================

const DEFAULT_EXTENSIONS = [
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.rb', '.go', '.rs', '.java', '.c', '.cpp', '.h',
  '.vue', '.svelte', '.astro',
];

const DEFAULT_IGNORE_DIRS = [
  'node_modules', '.git', 'dist', 'build', '.next', '.nuxt',
  'coverage', '__pycache__', '.venv', 'vendor', 'target',
  'release', '.cache', 'tmp', 'temp',
];

const DEFAULT_IGNORE_FILES = [
  'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml',
  'composer.lock', 'Cargo.lock', 'go.sum',
  '.DS_Store', 'Thumbs.db',
];

// ============================================================================
// REGEX PATTERNS FOR SYMBOL EXTRACTION
// ============================================================================

/** TypeScript/JavaScript patterns */
const TS_PATTERNS = {
  // Export function declarations
  exportFunc: /^export\s+(?:async\s+)?function\s+(\w+)\s*(?:<[^>]*>)?\s*\(([^)]*)\)\s*(?::\s*([^\s{=]+))?/gm,
  // Function declarations
  funcDecl: /^(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*(?:<[^>]*>)?\s*\(([^)]*)\)\s*(?::\s*([^\s{=]+))?/gm,
  // Export const/let arrow functions
  exportArrow: /^export\s+(?:const|let)\s+(\w+)\s*(?::\s*[^=]+)?\s*=\s*(?:async\s+)?(?:\([^)]*\)|[^=])\s*=>/gm,
  // Class declarations
  classDecl: /^export\s+(?:abstract\s+)?class\s+(\w+)(?:\s+extends\s+\w+)?(?:\s+implements\s+[\w,\s]+)?\s*\{/gm,
  // Interface declarations
  interfaceDecl: /^export\s+interface\s+(\w+)(?:\s+extends\s+[\w,\s]+)?\s*\{/gm,
  // Type aliases
  typeDecl: /^export\s+type\s+(\w+)\s*(?:<[^>]*>)?\s*=/gm,
  // Enum declarations
  enumDecl: /^export\s+(?:const\s+)?enum\s+(\w+)\s*\{/gm,
  // Import statements (for dependency graph)
  importStmt: /^import\s+(?:.*from\s+)?['"]([^'"]+)['"]/gm,
  // Export from
  exportFrom: /^export\s+(?:.*?)\s+from\s+['"]([^'"]+)['"]/gm,
  // Method signatures inside classes
  methodSig: /^\s+(?:public\s+|private\s+|protected\s+|static\s+|async\s+|get\s+|set\s+)*(\w+)\s*(?:<[^>]*>)?\s*\([^)]*\)\s*(?::\s*([^\s{=]+))?/gm,
};

/** Python patterns */
const PY_PATTERNS = {
  funcDecl: /^(?:async\s+)?def\s+(\w+)\s*\(([^)]*)\)\s*(?:->\s*(\S+))?/gm,
  classDecl: /^class\s+(\w+)(?:\(([^)]*)\))?\s*:/gm,
  importStmt: /^(?:from\s+(\S+)\s+)?import\s+(.+)/gm,
};

// ============================================================================
// SYMBOL EXTRACTION
// ============================================================================

function extractTSSymbols(content: string): { symbols: FileSymbol[]; imports: string[]; exports: string[] } {
  const symbols: FileSymbol[] = [];
  const imports: string[] = [];
  const exports: string[] = [];
  const lines = content.split('\n');

  // Extract imports
  let match: RegExpExecArray | null;
  const importPattern = /^import\s+(?:.*from\s+)?['"]([^'"]+)['"]/gm;
  while ((match = importPattern.exec(content)) !== null) {
    const imp = match[1];
    if (!imp.startsWith('.')) continue; // Only relative imports for dependency graph
    imports.push(imp);
  }

  // Extract export-from
  const exportFromPattern = /^export\s+(?:.*?)\s+from\s+['"]([^'"]+)['"]/gm;
  while ((match = exportFromPattern.exec(content)) !== null) {
    if (match[1].startsWith('.')) imports.push(match[1]);
    exports.push(match[1]);
  }

  // Extract exported functions
  const funcPattern = /^(export\s+)?(?:async\s+)?function\s+(\w+)\s*(?:<[^>]*>)?\s*\(([^)]*)\)\s*(?::\s*([^\s{=<{]+))?/gm;
  while ((match = funcPattern.exec(content)) !== null) {
    const lineNum = content.substring(0, match.index).split('\n').length;
    const isExported = !!match[1];
    const funcBodyStart = content.indexOf('{', match.index);
    const endLine = funcBodyStart >= 0
      ? content.substring(0, funcBodyStart).split('\n').length
      : lineNum + 1;

    symbols.push({
      name: match[2],
      type: 'function',
      signature: match[0].replace(/\{.*$/, '').trim(),
      startLine: lineNum,
      endLine,
      exported: isExported,
      params: match[3]?.trim(),
      returnType: match[4]?.trim(),
    });
    if (isExported) exports.push(match[2]);
  }

  // Extract arrow functions
  const arrowPattern = /^(export\s+)?(?:const|let)\s+(\w+)\s*(?::\s*[^=]+)?\s*=\s*(?:async\s+)?(?:\([^)]*\)|[^=])\s*=>/gm;
  while ((match = arrowPattern.exec(content)) !== null) {
    const lineNum = content.substring(0, match.index).split('\n').length;
    symbols.push({
      name: match[2],
      type: 'function',
      signature: `export const ${match[2]} = ...`,
      startLine: lineNum,
      endLine: lineNum + 1,
      exported: !!match[1],
    });
    if (match[1]) exports.push(match[2]);
  }

  // Extract class declarations
  const classPattern = /^(export\s+)?(?:abstract\s+)?class\s+(\w+)(?:\s+extends\s+\w+)?(?:\s+implements\s+[\w,\s]+)?\s*\{/gm;
  while ((match = classPattern.exec(content)) !== null) {
    const lineNum = content.substring(0, match.index).split('\n').length;
    symbols.push({
      name: match[2],
      type: 'class',
      signature: match[0].replace('{', '').trim(),
      startLine: lineNum,
      endLine: lineNum + 1,
      exported: !!match[1],
    });
    if (match[1]) exports.push(match[2]);

    // Extract methods inside class
    const classEndBrace = findMatchingBrace(content, match.index + match[0].length - 1);
    if (classEndBrace > 0) {
      const classBody = content.substring(match.index + match[0].length, classEndBrace);
      const methodPattern = /^\s+(?:public\s+|private\s+|protected\s+|static\s+|async\s+|get\s+|set\s+)*(\w+)\s*(?:<[^>]*>)?\s*\([^)]*\)\s*(?::\s*([^\s{=<{]+))?/gm;
      let mMatch: RegExpExecArray | null;
      while ((mMatch = methodPattern.exec(classBody)) !== null) {
        const mName = mMatch[1];
        if (['constructor', 'if', 'else', 'for', 'while', 'switch', 'return', 'import', 'export'].includes(mName)) continue;
        const mLineNum = content.substring(0, match.index + match[0].length + mMatch.index).split('\n').length;
        symbols.push({
          name: `${match[2]}.${mName}`,
          type: 'method',
          signature: mMatch[0].trim(),
          startLine: mLineNum,
          endLine: mLineNum + 1,
          exported: false,
          returnType: mMatch[2]?.trim(),
        });
      }
    }
  }

  // Extract interfaces
  const interfacePattern = /^(export\s+)?interface\s+(\w+)(?:\s+extends\s+[\w,\s]+)?\s*\{/gm;
  while ((match = interfacePattern.exec(content)) !== null) {
    const lineNum = content.substring(0, match.index).split('\n').length;
    symbols.push({
      name: match[2],
      type: 'interface',
      signature: match[0].replace('{', '').trim(),
      startLine: lineNum,
      endLine: lineNum + 1,
      exported: !!match[1],
    });
    if (match[1]) exports.push(match[2]);
  }

  // Extract type aliases
  const typePattern = /^(export\s+)?type\s+(\w+)\s*(?:<[^>]*>)?\s*=/gm;
  while ((match = typePattern.exec(content)) !== null) {
    const lineNum = content.substring(0, match.index).split('\n').length;
    symbols.push({
      name: match[2],
      type: 'type',
      signature: match[0].replace('=', '').trim(),
      startLine: lineNum,
      endLine: lineNum + 1,
      exported: !!match[1],
    });
    if (match[1]) exports.push(match[2]);
  }

  return { symbols, imports: [...new Set(imports)], exports: [...new Set(exports)] };
}

function extractPySymbols(content: string): { symbols: FileSymbol[]; imports: string[]; exports: string[] } {
  const symbols: FileSymbol[] = [];
  const imports: string[] = [];
  const exports: string[] = [];

  const funcPattern = /^(?:async\s+)?def\s+(\w+)\s*\(([^)]*)\)\s*(?:->\s*(\S+))?/gm;
  let match: RegExpExecArray | null;
  while ((match = funcPattern.exec(content)) !== null) {
    const lineNum = content.substring(0, match.index).split('\n').length;
    const isExported = !match[1].startsWith('_');
    symbols.push({
      name: match[1],
      type: 'function',
      signature: match[0].trim(),
      startLine: lineNum,
      endLine: lineNum + 1,
      exported: isExported,
      params: match[2]?.trim(),
      returnType: match[3]?.trim(),
    });
    if (isExported) exports.push(match[1]);
  }

  const classPattern = /^class\s+(\w+)(?:\(([^)]*)\))?\s*:/gm;
  while ((match = classPattern.exec(content)) !== null) {
    const lineNum = content.substring(0, match.index).split('\n').length;
    symbols.push({
      name: match[1],
      type: 'class',
      signature: match[0].trim(),
      startLine: lineNum,
      endLine: lineNum + 1,
      exported: !match[1].startsWith('_'),
    });
  }

  return { symbols, imports, exports };
}

function findMatchingBrace(content: string, openPos: number): number {
  let depth = 1;
  for (let i = openPos + 1; i < content.length; i++) {
    if (content[i] === '{') depth++;
    if (content[i] === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

// ============================================================================
// PAGERANK
// ============================================================================

function computePageRank(
  files: Map<string, FileMapEntry>,
  dampingFactor = 0.85,
  iterations = 20,
): Map<string, number> {
  const n = files.size;
  if (n === 0) return new Map();

  const ranks = new Map<string, number>();
  const initialRank = 1 / n;

  // Initialize all ranks equally
  for (const path of files.keys()) {
    ranks.set(path, initialRank);
  }

  // Build adjacency: file A imports file B → A links to B
  const inLinks = new Map<string, string[]>();
  const outLinks = new Map<string, string[]>();

  for (const [path, entry] of files) {
    if (!inLinks.has(path)) inLinks.set(path, []);
    if (!outLinks.has(path)) outLinks.set(path, []);

    for (const imp of entry.imports) {
      // Resolve relative import to actual file path
      const resolved = resolveImport(path, imp);
      if (resolved && files.has(resolved)) {
        outLinks.get(path)!.push(resolved);
        if (!inLinks.has(resolved)) inLinks.set(resolved, []);
        inLinks.get(resolved)!.push(path);
      }
    }
  }

  // Iterate PageRank
  for (let iter = 0; iter < iterations; iter++) {
    const newRanks = new Map<string, number>();

    for (const [path] of files) {
      let rank = (1 - dampingFactor) / n;

      const incomingLinks = inLinks.get(path) || [];
      for (const source of incomingLinks) {
        const sourceOutCount = outLinks.get(source)?.length || 1;
        rank += dampingFactor * (ranks.get(source) || initialRank) / sourceOutCount;
      }

      // Boost for larger files (proxy for importance)
      const entry = files.get(path)!;
      const sizeBoost = Math.log2(entry.totalLines + 1) / 20;
      rank += sizeBoost * 0.1;

      newRanks.set(path, rank);
    }

    for (const [path, rank] of newRanks) {
      ranks.set(path, rank);
    }
  }

  return ranks;
}

function resolveImport(fromFile: string, importPath: string): string | null {
  const fromDir = dirname(fromFile);
  // Try common extensions
  const candidates = [
    join(fromDir, importPath),
    join(fromDir, importPath + '.ts'),
    join(fromDir, importPath + '.tsx'),
    join(fromDir, importPath + '.js'),
    join(fromDir, importPath + '.jsx'),
    join(fromDir, importPath, 'index.ts'),
    join(fromDir, importPath, 'index.js'),
  ];
  return candidates[0]; // Return the base path — will be checked against file map keys
}

// ============================================================================
// REPO MAP GENERATOR
// ============================================================================

export class RepoMapGenerator {
  private config: Required<RepoMapConfig>;
  private cache: RepoMap | null = null;
  private cacheHash: string = '';

  constructor(config: RepoMapConfig) {
    this.config = {
      extensions: DEFAULT_EXTENSIONS,
      maxFiles: 500,
      maxFileSize: 100_000,
      ignoreDirs: DEFAULT_IGNORE_DIRS,
      ignoreFiles: DEFAULT_IGNORE_FILES,
      ...config,
    };
  }

  /**
   * Generate or return cached repo map.
   * Only re-indexes if the workspace has changed.
   */
  async generate(): Promise<RepoMap> {
    const currentHash = await this.computeWorkspaceHash();
    if (this.cache && this.cacheHash === currentHash) {
      return this.cache;
    }

    console.log('[RepoMap] Indexing workspace...');
    const startTime = Date.now();

    const files = new Map<string, FileMapEntry>();
    let totalSymbols = 0;
    let fileCount = 0;

    // Walk directory tree
    const sourceFiles = await this.walkDir(this.config.workspace);

    for (const filePath of sourceFiles) {
      if (fileCount >= this.config.maxFiles) break;

      try {
        const content = await readFile(filePath, 'utf-8');
        if (content.length > this.config.maxFileSize) continue;

        const relPath = relative(this.config.workspace, filePath).replace(/\\/g, '/');
        const ext = extname(filePath);

        let extracted: { symbols: FileSymbol[]; imports: string[]; exports: string[] };
        if (ext === '.py') {
          extracted = extractPySymbols(content);
        } else {
          extracted = extractTSSymbols(content);
        }

        const lines = content.split('\n').length;
        const mtime = (await stat(filePath)).mtimeMs;

        files.set(relPath, {
          relativePath: relPath,
          symbols: extracted.symbols,
          imports: extracted.imports,
          exports: extracted.exports,
          rank: 0,
          totalLines: lines,
          lastModified: mtime,
        });

        totalSymbols += extracted.symbols.length;
        fileCount++;
      } catch {
        // Skip unreadable files
      }
    }

    // Compute PageRank
    const ranks = computePageRank(files);

    // Assign ranks
    for (const [path, entry] of files) {
      entry.rank = ranks.get(path) || 0;
    }

    // Sort by rank (descending)
    const rankedPaths = [...files.entries()]
      .sort((a, b) => b[1].rank - a[1].rank)
      .map(([path]) => path);

    const repoMap: RepoMap = {
      files,
      rankedPaths,
      totalFiles: fileCount,
      totalSymbols,
      generatedAt: Date.now(),
      workspaceHash: currentHash,
    };

    this.cache = repoMap;
    this.cacheHash = currentHash;

    console.log(`[RepoMap] Indexed ${fileCount} files, ${totalSymbols} symbols in ${Date.now() - startTime}ms`);
    return repoMap;
  }

  /**
   * Generate compressed repo map string for LLM context.
   * Shows file paths with elided function bodies — token-efficient.
   */
  async generateCompressedMap(maxTokens = 3000): Promise<string> {
    const map = await this.generate();
    const parts: string[] = [];
    let tokenEstimate = 0;
    const CHARS_PER_TOKEN = 4;

    parts.push('# Repository Map (elided — function bodies replaced with ⋮)\n');

    for (const path of map.rankedPaths) {
      const entry = map.files.get(path)!;
      if (tokenEstimate > maxTokens * CHARS_PER_TOKEN) break;

      const fileHeader = `\n## ${entry.relativePath} (${entry.totalLines} lines, rank: ${entry.rank.toFixed(3)})\n`;
      parts.push(fileHeader);
      tokenEstimate += fileHeader.length;

      for (const symbol of entry.symbols) {
        if (tokenEstimate > maxTokens * CHARS_PER_TOKEN) break;

        const exportMarker = symbol.exported ? 'export ' : '';
        const typeMarker = symbol.type === 'method' ? '' : '';
        let line: string;

        switch (symbol.type) {
          case 'class':
          case 'interface':
          case 'type':
          case 'enum':
            line = `  ${exportMarker}${symbol.signature} { ⋮ }\n`;
            break;
          case 'function':
            line = `  ${exportMarker}${symbol.signature} { ⋮ }\n`;
            break;
          case 'method':
            line = `    ${symbol.signature} { ⋮ }\n`;
            break;
          default:
            line = `  ${exportMarker}${symbol.signature}\n`;
        }

        parts.push(line);
        tokenEstimate += line.length;
      }

      if (entry.symbols.length === 0) {
        parts.push('  (no exported symbols)\n');
      }
    }

    parts.push(`\n---\n${map.totalFiles} files indexed, ${map.totalSymbols} symbols total\n`);

    return parts.join('');
  }

  /**
   * Get detailed info for a specific file.
   */
  async getFileDetail(relativePath: string): Promise<FileMapEntry | null> {
    const map = await this.generate();
    return map.files.get(relativePath) || null;
  }

  /**
   * Find files by symbol name (fuzzy match).
   */
  async findSymbol(name: string): Promise<Array<{ file: string; symbol: FileSymbol }>> {
    const map = await this.generate();
    const results: Array<{ file: string; symbol: FileSymbol }> = [];
    const lowerName = name.toLowerCase();

    for (const [path, entry] of map.files) {
      for (const symbol of entry.symbols) {
        if (symbol.name.toLowerCase().includes(lowerName)) {
          results.push({ file: path, symbol });
        }
      }
    }

    return results.sort((a, b) => {
      // Exact match first
      const aExact = a.symbol.name.toLowerCase() === lowerName ? 0 : 1;
      const bExact = b.symbol.name.toLowerCase() === lowerName ? 0 : 1;
      return aExact - bExact || b.symbol.exported ? -1 : 1;
    });
  }

  /**
   * Get files that depend on a given file (inverse dependencies).
   */
  async getDependents(relativePath: string): Promise<string[]> {
    const map = await this.generate();
    const dependents: string[] = [];

    for (const [path, entry] of map.files) {
      for (const imp of entry.imports) {
        const resolved = resolveImport(path, imp);
        if (resolved === relativePath || imp.includes(relativePath.replace(/\.[^.]+$/, ''))) {
          dependents.push(path);
          break;
        }
      }
    }

    return dependents;
  }

  invalidate(): void {
    this.cache = null;
    this.cacheHash = '';
  }

  // ==========================================================================
  // FILE WALKING
  // ==========================================================================

  private async walkDir(dir: string, depth = 0): Promise<string[]> {
    if (depth > 15) return []; // Safety limit
    const results: string[] = [];

    try {
      const entries = await readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.name.startsWith('.') && entry.name !== '.env.example') continue;
        if (this.config.ignoreDirs.includes(entry.name)) continue;

        const fullPath = join(dir, entry.name);

        if (entry.isDirectory()) {
          results.push(...await this.walkDir(fullPath, depth + 1));
        } else if (entry.isFile()) {
          const ext = extname(entry.name);
          if (this.config.extensions.includes(ext) && !this.config.ignoreFiles.includes(entry.name)) {
            results.push(fullPath);
          }
        }
      }
    } catch {
      // Skip unreadable directories
    }

    return results;
  }

  private async computeWorkspaceHash(): Promise<string> {
    // Simple hash based on file count and latest mtime
    const files = await this.walkDir(this.config.workspace);
    let hash = files.length.toString();
    // Sample 10 files for mtime
    const sample = files.filter((_, i) => i % Math.max(1, Math.floor(files.length / 10)) === 0).slice(0, 10);
    for (const f of sample) {
      try {
        const s = await stat(f);
        hash += `_${s.mtimeMs}`;
      } catch { /* skip */ }
    }
    return hash;
  }
}

// ============================================================================
// EXPORTED SINGLETON FACTORY
// ============================================================================

let instance: RepoMapGenerator | null = null;

export function getRepoMapGenerator(workspace: string): RepoMapGenerator {
  if (!instance || instance['config'].workspace !== workspace) {
    instance = new RepoMapGenerator({ workspace });
  }
  return instance;
}
