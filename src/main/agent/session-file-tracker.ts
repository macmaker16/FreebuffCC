/**
 * Michaelangelo Agent - Session File Tracker
 *
 * Records every file change (write_file, edit_file) during the current session.
 * Used by the /diff slash command to generate a visual side-by-side diff of
 * all files modified in the current session.
 *
 * Each entry stores:
 *   - The file path
 *   - The original content (snapshot before the change)
 *   - The new content (snapshot after the change)
 *   - The type of change ('write' or 'edit')
 *   - Timestamp
 */

import { readFile } from 'fs/promises';
import { resolve, isAbsolute } from 'path';
import { generateDiff, DiffResult } from './diff-engine';

export interface FileChange {
  filePath: string;
  originalContent: string;
  newContent: string;
  changeType: 'write' | 'edit';
  timestamp: number;
}

export interface SessionDiff {
  filePath: string;
  changeType: 'write' | 'edit';
  diff: DiffResult;
  timestamp: number;
}

export class SessionFileTracker {
  private changes: FileChange[] = [];
  private workspace: string;
  private originalSnapshots = new Map<string, string>(); // file path → content before first edit

  constructor(workspace: string) {
    this.workspace = workspace;
  }

  /** Resolve a file path relative to workspace */
  private resolvePath(filePath: string): string {
    return isAbsolute(filePath) ? filePath : resolve(this.workspace, filePath);
  }

  /**
   * Record a file write. If the file already exists, captures its original
   * content as the baseline before overwriting.
   */
  async trackWrite(filePath: string, newContent: string): Promise<void> {
    const fullPath = this.resolvePath(filePath);
    let original = '';

    // If this is the first change to this file, snapshot the original
    if (!this.originalSnapshots.has(fullPath)) {
      try {
        original = await readFile(fullPath, 'utf-8');
      } catch {
        // New file — no original content
        original = '';
      }
      this.originalSnapshots.set(fullPath, original);
    } else {
      // We already have a baseline — use it
      original = this.originalSnapshots.get(fullPath)!;
    }

    this.changes.push({
      filePath,
      originalContent: original,
      newContent,
      changeType: 'write',
      timestamp: Date.now(),
    });
  }

  /**
   * Record a file edit. The caller should pass the old and new content directly
   * since the edit engine already computed them.
   */
  async trackEdit(filePath: string, oldContent: string, newContent: string): Promise<void> {
    const fullPath = this.resolvePath(filePath);

    // Capture the baseline before any edits to this file
    if (!this.originalSnapshots.has(fullPath)) {
      this.originalSnapshots.set(fullPath, oldContent);
    }

    // Use the original snapshot as the baseline, not intermediate edits
    // This way the diff shows the net change from the original
    this.changes.push({
      filePath,
      originalContent: this.originalSnapshots.get(fullPath) || oldContent,
      newContent,
      changeType: 'edit',
      timestamp: Date.now(),
    });
  }

  /**
   * Generate diffs for all tracked changes.
   * Groups by file and returns the NET diff (original → latest) for each file.
   */
  getSessionDiffs(): SessionDiff[] {
    // Group changes by file path, keep only the latest newContent per file
    const fileMap = new Map<string, { change: FileChange; latest: FileChange }>();

    for (const change of this.changes) {
      const existing = fileMap.get(change.filePath);
      if (existing) {
        // Update the latest snapshot, keep the original baseline
        fileMap.set(change.filePath, {
          change: existing.change,
          latest: change,
        });
      } else {
        fileMap.set(change.filePath, { change, latest: change });
      }
    }

    const diffs: SessionDiff[] = [];
    for (const [filePath, { change, latest }] of fileMap) {
      const diff = generateDiff(filePath, change.originalContent, latest.newContent);

      // Skip files with no actual changes
      if (diff.stats.additions === 0 && diff.stats.deletions === 0) continue;

      diffs.push({
        filePath,
        changeType: latest.changeType,
        diff,
        timestamp: latest.timestamp,
      });
    }

    // Sort by timestamp
    diffs.sort((a, b) => a.timestamp - b.timestamp);
    return diffs;
  }

  /**
   * Generate a unified text representation of all session diffs.
   * This is what gets returned in the chat as a markdown code block.
   */
  getSessionDiffText(): string {
    const diffs = this.getSessionDiffs();

    if (diffs.length === 0) {
      return 'No files changed in this session.';
    }

    const totalAdds = diffs.reduce((sum, d) => sum + d.diff.stats.additions, 0);
    const totalDels = diffs.reduce((sum, d) => sum + d.diff.stats.deletions, 0);

    const lines: string[] = [
      `## Session Diff — ${diffs.length} file${diffs.length > 1 ? 's' : ''} changed  (+${totalAdds} / -${totalDels})`,
      '',
    ];

    for (const d of diffs) {
      const icon = d.changeType === 'write' ? '📝' : '✏️';
      lines.push(`### ${icon} ${d.filePath}  (+${d.diff.stats.additions} / -${d.diff.stats.deletions})`);
      lines.push('');

      // Render each hunk
      for (const hunk of d.diff.hunks) {
        lines.push(`@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`);
        for (const change of hunk.changes) {
          if (change.type === 'added') lines.push(`+${change.content}`);
          else if (change.type === 'removed') lines.push(`-${change.content}`);
          else lines.push(` ${change.content}`);
        }
        lines.push('');
      }
    }

    return lines.join('\n');
  }

  /**
   * Get the diffs as structured data (for the frontend to render as visual diffs).
   */
  getSessionDiffsStructured(): DiffResult[] {
    return this.getSessionDiffs().map(d => d.diff);
  }

  /** Get the total number of changed files */
  getChangedFileCount(): number {
    const files = new Set(this.changes.map(c => c.filePath));
    return files.size;
  }

  /** Get total number of individual change operations */
  getChangeCount(): number {
    return this.changes.length;
  }

  /** Reset the tracker (called on new session) */
  clear(): void {
    this.changes = [];
    this.originalSnapshots.clear();
  }

  /** Set workspace path (called when workspace changes) */
  setWorkspace(workspace: string): void {
    this.workspace = workspace;
  }
}
