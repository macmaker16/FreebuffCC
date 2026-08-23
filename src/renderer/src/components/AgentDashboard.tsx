/**
 * Michaelangelo - Agent Dashboard
 *
 * Real-time WebSocket dashboard showing:
 * - Agent lifecycle (start/end)
 * - Phase transitions (gather→plan→execute→verify)
 * - Tool executions with timing and results
 * - Token usage per iteration
 * - Context compression events
 * - Error events
 *
 * Connects to the WebSocket server on the same port as the Express proxy.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Activity, Play, CheckCircle, XCircle, Clock, Zap, ArrowRight, Terminal, FileText, Search, Globe, Trash2 } from 'lucide-react';

// ============================================================================
// TYPES
// ============================================================================

interface AgentEvent {
  type: string;
  timestamp: number;
  sessionId: string;
  data: Record<string, any>;
}

interface EventEntry {
  id: string;
  event: AgentEvent;
}

// ============================================================================
// HELPERS
// ============================================================================

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function getToolIcon(toolName: string): typeof Terminal {
  if (toolName.startsWith('browser_')) return Globe;
  if (toolName.includes('file') || toolName.includes('read') || toolName.includes('write') || toolName.includes('edit') || toolName.includes('list') || toolName.includes('search') || toolName.includes('glob')) return FileText;
  if (toolName.includes('git')) return GitIcon;
  if (toolName.includes('search') || toolName.includes('find')) return Search;
  return Terminal;
}

const GitIcon = Activity;

const PHASE_COLORS: Record<string, string> = {
  gather_context: 'text-blue-400 bg-blue-400/10',
  plan: 'text-purple-400 bg-purple-400/10',
  execute: 'text-yellow-400 bg-yellow-400/10',
  verify_results: 'text-green-400 bg-green-400/10',
};

const PHASE_LABELS: Record<string, string> = {
  gather_context: 'Gather',
  plan: 'Plan',
  execute: 'Execute',
  verify_results: 'Verify',
};

// ============================================================================
// COMPONENT
// ============================================================================

interface AgentDashboardProps {
  serverPort: number | null;
}

export default function AgentDashboard({ serverPort }: AgentDashboardProps) {
  const [events, setEvents] = useState<EventEntry[]>([]);
  const [connected, setConnected] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const eventsEndRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [selectedEvent, setSelectedEvent] = useState<EventEntry | null>(null);
  const eventCounter = useRef(0);

  // Stats
  const [stats, setStats] = useState({
    totalSessions: 0,
    totalToolCalls: 0,
    totalTokens: 0,
    activePhase: '',
  });

  const connect = useCallback(() => {
    if (!serverPort || wsRef.current) return;

    const ws = new WebSocket(`ws://127.0.0.1:${serverPort}`);

    ws.onopen = () => {
      console.log('[Dashboard] WebSocket connected');
      setConnected(true);
    };

    ws.onmessage = (msg) => {
      try {
        const data = JSON.parse(msg.data);

        // Init message with recent events
        if (data.type === 'init' && Array.isArray(data.events)) {
          const entries = data.events.map((e: AgentEvent) => ({
            id: `evt_${++eventCounter.current}`,
            event: e,
          }));
          setEvents(entries);
          // Find latest session
          const latest = data.events[data.events.length - 1];
          if (latest) setSessionId(latest.sessionId);
          return;
        }

        // Regular event
        const event = data as AgentEvent;
        const entry: EventEntry = {
          id: `evt_${++eventCounter.current}`,
          event,
        };

        setEvents(prev => {
          const next = [...prev, entry];
          // Keep last 500 events
          return next.length > 500 ? next.slice(-500) : next;
        });

        if (event.sessionId) setSessionId(event.sessionId);

        // Update stats
        setStats(prev => {
          const next = { ...prev };
          if (event.type === 'agent_start') next.totalSessions++;
          if (event.type === 'tool_start') next.totalToolCalls++;
          if (event.type === 'token_usage') next.totalTokens += (event.data.totalPrompt || 0) + (event.data.totalCompletion || 0);
          if (event.type === 'phase_change') next.activePhase = event.data.phase || '';
          if (event.type === 'agent_end') next.activePhase = '';
          return next;
        });

        // Auto-scroll
        if (autoScroll) {
          setTimeout(() => eventsEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
        }
      } catch { /* ignore parse errors */ }
    };

    ws.onclose = () => {
      console.log('[Dashboard] WebSocket disconnected');
      setConnected(false);
      wsRef.current = null;
      // Reconnect after 3s
      setTimeout(connect, 3000);
    };

    ws.onerror = (err) => {
      console.error('[Dashboard] WebSocket error:', err);
    };

    wsRef.current = ws;
  }, [serverPort, autoScroll]);

  useEffect(() => {
    connect();
    return () => { wsRef.current?.close(); wsRef.current = null; };
  }, [connect]);

  // Scroll detection
  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
    setAutoScroll(atBottom);
  }, []);

  const clearEvents = () => {
    setEvents([]);
    setSelectedEvent(null);
  };

  // =========================================================================
  // RENDER
  // =========================================================================

  return (
    <div className="h-full flex flex-col bg-dark-950 text-white">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-dark-700 bg-dark-900/50 flex-shrink-0">
        <div className="flex items-center gap-3">
          <Activity size={16} className="text-brand-400" />
          <h2 className="text-sm font-semibold">Agent Activity</h2>
          <div className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-medium ${
            connected ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'
          }`}>
            <div className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-green-400 animate-pulse' : 'bg-red-400'}`} />
            {connected ? 'Live' : 'Disconnected'}
          </div>
        </div>
        <div className="flex items-center gap-3 text-[10px] text-dark-400">
          <span>{stats.totalSessions} sessions</span>
          <span>{stats.totalToolCalls} tools</span>
          <span>{(stats.totalTokens / 1000).toFixed(1)}K tokens</span>
          {stats.activePhase && (
            <span className={`px-1.5 py-0.5 rounded text-[9px] font-medium ${PHASE_COLORS[stats.activePhase] || 'text-dark-300'}`}>
              {PHASE_LABELS[stats.activePhase] || stats.activePhase}
            </span>
          )}
          <button onClick={clearEvents} className="p-1 rounded hover:bg-dark-700 transition-colors" title="Clear events">
            <Trash2 size={12} />
          </button>
        </div>
      </div>

      {/* Events List */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1 font-mono text-[11px]" onScroll={handleScroll}>
        {events.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-dark-500 space-y-2">
            <Activity size={32} className="opacity-30" />
            <p className="text-xs">No agent activity yet</p>
            <p className="text-[10px] text-dark-600">Send a message in Chat to see real-time events here</p>
          </div>
        )}

        {events.map((entry) => (
          <EventRow key={entry.id} entry={entry} isSelected={selectedEvent?.id === entry.id} onSelect={() => setSelectedEvent(selectedEvent?.id === entry.id ? null : entry)} />
        ))}
        <div ref={eventsEndRef} />
      </div>

      {/* Event Detail Panel */}
      {selectedEvent && (
        <div className="border-t border-dark-700 bg-dark-900/80 p-3 max-h-48 overflow-y-auto flex-shrink-0">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-semibold text-dark-200 uppercase">{selectedEvent.event.type}</span>
            <button onClick={() => setSelectedEvent(null)} className="text-dark-400 hover:text-white text-xs">✕</button>
          </div>
          <pre className="text-[10px] text-dark-300 whitespace-pre-wrap break-all">
            {JSON.stringify(selectedEvent.event.data, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// EVENT ROW
// ============================================================================

function EventRow({ entry, isSelected, onSelect }: { entry: EventEntry; isSelected: boolean; onSelect: () => void }) {
  const { event } = entry;

  const renderContent = () => {
    switch (event.type) {
      case 'agent_start':
        return (
          <div className="flex items-center gap-2">
            <Play size={11} className="text-green-400" />
            <span className="text-green-400 font-semibold">Agent started</span>
            <span className="text-dark-400">→ {event.data.model}</span>
            {event.data.prompt && <span className="text-dark-500 truncate max-w-[300px]">"{event.data.prompt}"</span>}
          </div>
        );

      case 'agent_end':
        return (
          <div className="flex items-center gap-2">
            <CheckCircle size={11} className="text-green-400" />
            <span className="text-green-400 font-semibold">Agent completed</span>
            <span className="text-dark-400">{event.data.iterations} iterations, {event.data.totalToolCalls} tools</span>
            <span className="text-dark-500">{((event.data.totalPromptTokens + event.data.totalCompletionTokens) / 1000).toFixed(1)}K tokens</span>
          </div>
        );

      case 'phase_change':
        return (
          <div className="flex items-center gap-2">
            <ArrowRight size={11} className="text-purple-400" />
            <span className={`px-1.5 py-0.5 rounded text-[9px] font-medium ${PHASE_COLORS[event.data.phase] || 'text-dark-300 bg-dark-700'}`}>
              {PHASE_LABELS[event.data.phase] || event.data.phase}
            </span>
            <span className="text-dark-500">iter {event.data.iteration}</span>
          </div>
        );

      case 'tool_start':
        return (
          <div className="flex items-center gap-2">
            <Clock size={11} className="text-yellow-400 animate-pulse" />
            <ToolBadge name={event.data.tool} />
            <span className="text-dark-500 truncate max-w-[300px]">
              {summarizeArgs(event.data.tool, event.data.args)}
            </span>
          </div>
        );

      case 'tool_complete':
        return (
          <div className="flex items-center gap-2">
            {event.data.success
              ? <CheckCircle size={11} className="text-green-400" />
              : <XCircle size={11} className="text-red-400" />}
            <ToolBadge name={event.data.tool} />
            <span className={`text-[10px] ${event.data.success ? 'text-green-400/70' : 'text-red-400/70'}`}>
              {event.data.success ? '✓' : '✗'}
            </span>
            <span className="text-dark-500 truncate max-w-[300px]">
              {event.data.outputPreview?.substring(0, 100)}
            </span>
          </div>
        );

      case 'llm_call':
        return (
          <div className="flex items-center gap-2">
            <Zap size={11} className="text-blue-400" />
            <span className="text-dark-400">LLM call</span>
            <span className="text-dark-500">iter {event.data.iteration}, {event.data.toolCount} tools</span>
          </div>
        );

      case 'llm_response':
        return (
          <div className="flex items-center gap-2">
            <Zap size={11} className="text-blue-400/50" />
            <span className="text-dark-400">LLM response</span>
            {event.data.hasToolCalls && <span className="text-yellow-400 text-[10px]">→ tool calls</span>}
          </div>
        );

      case 'token_usage':
        return (
          <div className="flex items-center gap-2">
            <Activity size={11} className="text-cyan-400" />
            <span className="text-dark-400">Tokens:</span>
            <span className="text-dark-300">↑{event.data.prompt} ↓{event.data.completion}</span>
            <span className="text-dark-500">({((event.data.totalPrompt + event.data.totalCompletion) / 1000).toFixed(1)}K total)</span>
          </div>
        );

      case 'context_compression':
        return (
          <div className="flex items-center gap-2">
            <Activity size={11} className="text-orange-400" />
            <span className="text-orange-400">Context compressed</span>
            <span className="text-dark-500">{event.data.tokensBefore}→{event.data.tokensAfter} tokens</span>
          </div>
        );

      case 'error':
        return (
          <div className="flex items-center gap-2">
            <XCircle size={11} className="text-red-400" />
            <span className="text-red-400">Error</span>
            <span className="text-red-400/70 truncate max-w-[400px]">{event.data.message || event.data.error}</span>
          </div>
        );

      case 'message':
        return (
          <div className="flex items-center gap-2">
            <Terminal size={11} className="text-dark-400" />
            <span className="text-dark-300">{event.data.message || event.data.text}</span>
          </div>
        );

      default:
        return (
          <div className="flex items-center gap-2">
            <span className="text-dark-500 text-[10px]">{event.type}</span>
            <span className="text-dark-600 truncate max-w-[400px]">{JSON.stringify(event.data).substring(0, 100)}</span>
          </div>
        );
    }
  };

  return (
    <div
      onClick={onSelect}
      className={`flex items-center gap-2 px-2 py-1 rounded cursor-pointer transition-colors ${
        isSelected ? 'bg-brand-600/10 border border-brand-500/20' : 'hover:bg-dark-800/50'
      }`}
    >
      <span className="text-[9px] text-dark-600 w-14 flex-shrink-0">{formatTime(event.timestamp)}</span>
      {renderContent()}
    </div>
  );
}

// ============================================================================
// TOOL BADGE
// ============================================================================

function ToolBadge({ name }: { name: string }) {
  const Icon = getToolIcon(name);
  const colors: Record<string, string> = {
    write_file: 'bg-green-500/10 text-green-400 border-green-500/20',
    read_file: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
    run_command: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
    browser_navigate: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
    browser_screenshot: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
    browser_get_content: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
    list_files: 'bg-teal-500/10 text-teal-400 border-teal-500/20',
    search_files: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20',
  };
  const color = colors[name] || 'bg-dark-700 text-dark-300 border-dark-600';

  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[9px] font-medium ${color}`}>
      <Icon size={9} />
      {name}
    </span>
  );
}

function summarizeArgs(tool: string, args: Record<string, any>): string {
  if (!args) return '';
  if (tool === 'write_file' || tool === 'read_file' || tool === 'edit_file') return args.file_path || '';
  if (tool === 'run_command') return args.command || '';
  if (tool === 'list_files') return args.dir_path || '.';
  if (tool === 'search_files') return args.pattern || '';
  if (tool === 'browser_navigate') return args.url || '';
  if (tool === 'browser_screenshot') return args.filename || 'viewport';
  return '';
}
