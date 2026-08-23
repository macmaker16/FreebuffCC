/**
 * Michaelangelo - DiffViewer Component
 *
 * Git-style unified diff viewer with:
 * - Color-coded additions (green) and removals (red)
 * - Line numbers for both old and new
 * - Inline syntax highlighting
 * - Compact/expanded toggle
 */

import React, { useState } from 'react';
import { ChevronDown, ChevronRight, Copy, CheckCheck } from 'lucide-react';

interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  changes: Array<{
    type: 'added' | 'removed' | 'context';
    oldLineNumber: number | null;
    newLineNumber: number | null;
    content: string;
  }>;
}

interface DiffResult {
  filePath: string;
  hunks: DiffHunk[];
  stats: { additions: number; deletions: number; changes: number };
}

interface Props {
  diff: DiffResult;
  compact?: boolean;
}

export default function DiffViewer({ diff, compact = false }: Props) {
  const [expanded, setExpanded] = useState(!compact);
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    const text = diff.hunks.flatMap(h =>
      h.changes.map(c => {
        if (c.type === 'added') return `+${c.content}`;
        if (c.type === 'removed') return `-${c.content}`;
        return ` ${c.content}`;
      })
    ).join('\n');
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="rounded-md border border-dark-600 overflow-hidden text-[11px] font-mono">
      {/* Header */}
      <div
        className="flex items-center justify-between px-3 py-1.5 bg-dark-800/50 cursor-pointer select-none"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-2">
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          <span className="text-dark-200 font-medium">{diff.filePath}</span>
          <span className="text-green-400">+{diff.stats.additions}</span>
          <span className="text-red-400">-{diff.stats.deletions}</span>
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); handleCopy(); }}
          className="p-1 rounded hover:bg-dark-700 transition-colors"
          title="Copy diff"
        >
          {copied ? <CheckCheck size={12} className="text-green-400" /> : <Copy size={12} className="text-dark-400" />}
        </button>
      </div>

      {/* Diff Content */}
      {expanded && (
        <div className="max-h-96 overflow-y-auto">
          {diff.hunks.map((hunk, hi) => (
            <div key={hi}>
              {/* Hunk header */}
              <div className="px-3 py-1 bg-dark-800/30 text-dark-400 text-[10px] border-t border-dark-700">
                @@ -{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines} @@
              </div>
              {/* Changes */}
              {hunk.changes.map((change, ci) => (
                <div
                  key={ci}
                  className={`flex ${change.type === 'added' ? 'bg-green-900/15 text-green-300' : change.type === 'removed' ? 'bg-red-900/15 text-red-300' : 'text-dark-300'}`}
                >
                  {/* Line numbers */}
                  <span className="w-12 text-right pr-2 text-dark-500 select-none flex-shrink-0 text-[10px]">
                    {change.oldLineNumber ?? ''}
                  </span>
                  <span className="w-12 text-right pr-2 text-dark-500 select-none flex-shrink-0 text-[10px]">
                    {change.newLineNumber ?? ''}
                  </span>
                  {/* Prefix */}
                  <span className={`w-5 text-center flex-shrink-0 select-none font-bold ${change.type === 'added' ? 'text-green-400' : change.type === 'removed' ? 'text-red-400' : 'text-dark-600'}`}>
                    {change.type === 'added' ? '+' : change.type === 'removed' ? '-' : ' '}
                  </span>
                  {/* Content */}
                  <span className="flex-1 whitespace-pre-wrap break-all py-px">{change.content || ' '}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
