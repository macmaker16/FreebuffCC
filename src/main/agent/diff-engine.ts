/**
 * Michaelangelo Agent - Diff Engine
 *
 * Generates unified diffs for Edit tool operations.
 * Produces structured diff data for the UI's interactive diff viewer.
 */

export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  changes: DiffChange[];
}

export interface DiffChange {
  type: 'added' | 'removed' | 'context';
  oldLineNumber: number | null;
  newLineNumber: number | null;
  content: string;
}

export interface DiffResult {
  filePath: string;
  oldContent: string;
  newContent: string;
  hunks: DiffHunk[];
  stats: { additions: number; deletions: number; changes: number };
  unifiedDiff: string;
}

/**
 * Generate a unified diff between two strings.
 * Uses a simple LCS-based approach for line-level diffing.
 */
export function generateDiff(filePath: string, oldContent: string, newContent: string): DiffResult {
  const oldLines = oldContent.split('\n');
  const newLines = newContent.split('\n');

  // Simple LCS-based diff
  const lcs = computeLCS(oldLines, newLines);
  const changes = buildChanges(oldLines, newLines, lcs);

  // Group into hunks
  const hunks = groupIntoHunks(changes);

  // Generate unified diff string
  const unifiedDiff = generateUnifiedDiff(filePath, hunks);

  // Stats
  let additions = 0;
  let deletions = 0;
  for (const change of changes) {
    if (change.type === 'added') additions++;
    if (change.type === 'removed') deletions++;
  }

  return {
    filePath,
    oldContent,
    newContent,
    hunks,
    stats: { additions, deletions, changes: additions + deletions },
    unifiedDiff,
  };
}

/**
 * Compute Longest Common Subsequence of two string arrays.
 * Used to identify which lines are unchanged.
 */
function computeLCS(a: string[], b: string[]): number[][] {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  return dp;
}

/**
 * Backtrack through the LCS matrix to produce a list of changes.
 */
function buildChanges(oldLines: string[], newLines: string[], dp: number[][]): DiffChange[] {
  const changes: DiffChange[] = [];
  let i = oldLines.length;
  let j = newLines.length;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      changes.unshift({
        type: 'context',
        oldLineNumber: i,
        newLineNumber: j,
        content: oldLines[i - 1],
      });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      changes.unshift({
        type: 'added',
        oldLineNumber: null,
        newLineNumber: j,
        content: newLines[j - 1],
      });
      j--;
    } else {
      changes.unshift({
        type: 'removed',
        oldLineNumber: i,
        newLineNumber: null,
        content: oldLines[i - 1],
      });
      i--;
    }
  }

  return changes;
}

/**
 * Group consecutive changes into hunks with context lines.
 * Each hunk shows removed/added lines with surrounding context.
 */
function groupIntoHunks(changes: DiffChange[], contextLines = 3): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  let currentHunk: DiffHunk | null = null;

  let lastRelevantIdx = -contextLines - 1;

  for (let idx = 0; idx < changes.length; idx++) {
    const change = changes[idx];
    const isRelevant = change.type !== 'context';

    if (isRelevant || idx - lastRelevantIdx <= contextLines) {
      if (!currentHunk) {
        currentHunk = {
          oldStart: Math.max(1, (change.oldLineNumber || 1) - contextLines),
          oldLines: 0,
          newStart: Math.max(1, (change.newLineNumber || 1) - contextLines),
          newLines: 0,
          changes: [],
        };
        hunks.push(currentHunk);
      }
      currentHunk.changes.push(change);
      if (change.type === 'removed' || change.type === 'context') currentHunk.oldLines++;
      if (change.type === 'added' || change.type === 'context') currentHunk.newLines++;
      if (isRelevant) lastRelevantIdx = idx;
    } else {
      currentHunk = null;
    }
  }

  return hunks;
}

/**
 * Generate a unified diff string (standard patch format).
 */
function generateUnifiedDiff(filePath: string, hunks: DiffHunk[]): string {
  const lines: string[] = [`--- a/${filePath}`, `+++ b/${filePath}`, `@@ -0,0 +1 @@`];

  for (const hunk of hunks) {
    lines.push(`@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`);
    for (const change of hunk.changes) {
      switch (change.type) {
        case 'added': lines.push(`+${change.content}`); break;
        case 'removed': lines.push(`-${change.content}`); break;
        case 'context': lines.push(` ${change.content}`); break;
      }
    }
  }

  return lines.join('\n');
}

/**
 * Find the first occurrence of a string in file content with line number.
 * Returns { line, column } or null if not found.
 */
export function findStringLocation(content: string, searchStr: string): { line: number; column: number } | null {
  const idx = content.indexOf(searchStr);
  if (idx === -1) return null;

  const beforeSearch = content.substring(0, idx);
  const line = beforeSearch.split('\n').length;
  const lastNewline = beforeSearch.lastIndexOf('\n');
  const column = idx - lastNewline;

  return { line, column };
}
