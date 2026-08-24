/**
 * Michaelangelo - TerminalPanel Component
 *
 * Live terminal output panel showing:
 * - Real-time tool executions (read_file, write_file, run_command, etc.)
 * - Command stdout/stderr streaming
 * - Iteration progress
 * - Collapsible per-tool output
 *
 * Sits in the right pane of the split-pane ChatView.
 */

import React, { useState, useEffect, useRef } from 'react';
import { Terminal, ChevronDown, ChevronRight, CheckCircle, XCircle, Clock, FileText, Play, Pause, Trash2 } from 'lucide-react';

interface ToolEvent {
  id: string;
  tool: string;
  args: Record<string, any>;
  status: 'running' | 'completed' | 'failed';
  output?: string;
  duration?: number;
  iteration: number;
  timestamp: number;
}

interface Props {
  toolEvents: ToolEvent[];
  iteration: number;
  maxIterations: number;
  isRunning: boolean;
}

const TOOL_ICONS: Record<string, typeof Terminal> = {
  write_file: FileText,
  read_file: FileText,
  edit_file: FileText,
  run_command: Terminal,
  list_files: FileText,
  search_files: FileText,
  glob_files: FileText,
};

function summarizeToolCall(tool: string, args: Record<string, any>): string {
  if (!args) return tool;
  switch (tool) {
    case 'write_file': return `write ${args.file_path || '?'}`;
    case 'read_file': return `read ${args.file_path || '?'}`;
    case 'edit_file': return `edit ${args.file_path || '?'}`;
    case 'run_command': return `$ ${args.command || '?'}`;
    case 'list_files': return `ls ${args.dir_path || '.'}`;
    case 'search_files': return `rg "${args.pattern || '?'}"`;
    case 'glob_files': return `glob ${args.pattern || '?'}`;
    default: return `${tool}`;
  }
}

export default function TerminalPanel({ toolEvents, iteration, maxIterations, isRunning }: Props) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [autoScroll, setAutoScroll] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showAll, setShowAll] = useState(true);

  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [toolEvents, autoScroll]);

  const handleScroll = () => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    setAutoScroll(scrollHeight - scrollTop - clientHeight < 50);
  };

  const toggleExpanded = (id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const filteredEvents = showAll ? toolEvents : toolEvents.filter(e => e.status !== 'completed' || e.tool === 'run_command');

  return (
    <div className="flex flex-col h-full bg-dark-950">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-dark-700 bg-dark-900/50 flex-shrink-0">
        <div className="flex items-center gap-2">
          <Terminal size={12} className="text-dark-400" />
          <span className="text-[13px] font-medium text-dark-200">Tool Activity</span>
          {isRunning && (
            <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-brand-600/10 text-brand-400 text-[10.5px]">
              <div className="w-1.5 h-1.5 rounded-full bg-brand-400 animate-pulse" />
              {iteration}/{maxIterations}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setShowAll(!showAll)}
            className={`px-1.5 py-0.5 rounded text-[10.5px] transition-colors ${showAll ? 'bg-dark-700 text-dark-300' : 'text-dark-500 hover:text-dark-300'}`}
          >
            All
          </button>
          <button
            onClick={() => setExpandedIds(new Set())}
            className="p-1 rounded hover:bg-dark-700 transition-colors"
            title="Collapse all"
          >
            <Pause size={10} className="text-dark-400" />
          </button>
        </div>
      </div>

      {/* Tool Events */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-1.5 space-y-0.5" onScroll={handleScroll}>
        {filteredEvents.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-dark-500 text-[12px]">
            <Terminal size={20} className="opacity-20 mb-1" />
            <p>Tool activity will appear here</p>
          </div>
        )}

        {filteredEvents.map((event) => {
          const Icon = TOOL_ICONS[event.tool] || Terminal;
          const isExpanded = expandedIds.has(event.id);
          const summary = summarizeToolCall(event.tool, event.args);

          return (
            <div key={event.id} className="rounded border border-dark-700/50 overflow-hidden">
              {/* Event header */}
              <button
                onClick={() => toggleExpanded(event.id)}
                className="w-full flex items-center gap-1.5 px-2 py-1 hover:bg-dark-800/50 transition-colors text-left"
              >
                {event.status === 'running' ? (
                  <div className="w-2 h-2 rounded-full border border-yellow-400 border-t-transparent animate-spin" />
                ) : event.status === 'completed' ? (
                  <CheckCircle size={10} className="text-green-400 flex-shrink-0" />
                ) : (
                  <XCircle size={10} className="text-red-400 flex-shrink-0" />
                )}

                <Icon size={10} className="text-dark-400 flex-shrink-0" />

                <span className="text-[12px] text-dark-300 truncate flex-1 font-mono">
                  {summary}
                </span>

                {event.duration && (
                  <span className="text-[10.5px] text-dark-500 flex-shrink-0">{event.duration}ms</span>
                )}

                {event.output && (
                  isExpanded ? <ChevronDown size={10} className="text-dark-500 flex-shrink-0" /> :
                    <ChevronRight size={10} className="text-dark-500 flex-shrink-0" />
                )}
              </button>

              {/* Expanded output */}
              {isExpanded && event.output && (
                <div className="px-2 pb-1.5 border-t border-dark-700/30">
                  <pre className="text-[12px] text-dark-300 whitespace-pre-wrap break-all max-h-48 overflow-y-auto bg-dark-950 rounded p-1.5 mt-1 font-mono">
                    {event.output}
                  </pre>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
