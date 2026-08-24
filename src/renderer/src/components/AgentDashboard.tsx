/**
 * Michaelangelo - Agent Dashboard
 *
 * Real-time dashboard showing:
 * - App overview stats (models, tools, plugins, skills)
 * - Token usage and cost tracking
 * - Agent session history
 * - Live WebSocket event stream
 * - Model status overview
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Activity, Play, CheckCircle, XCircle, Clock, Zap, ArrowRight, Terminal, FileText, Search, Globe, Trash2, Cpu, MessageSquare, Puzzle, Wrench, TrendingUp, DollarSign, BarChart3 } from 'lucide-react';

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

interface DashboardStats {
  totalSessions: number;
  totalToolCalls: number;
  totalTokens: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalCost: number;
  activePhase: string;
}

interface ConversationSummary {
  id: string;
  title: string;
  model: string;
  messageCount: number;
  tokenCount: number;
  createdAt: number;
  updatedAt: number;
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
  if (toolName.includes('git')) return Activity;
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
  const [activeTab, setActiveTab] = useState<'overview' | 'activity'>('overview');
  const wsRef = useRef<WebSocket | null>(null);
  const eventsEndRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [selectedEvent, setSelectedEvent] = useState<EventEntry | null>(null);
  const eventCounter = useRef(0);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);

  // Stats
  const [stats, setStats] = useState<DashboardStats>({
    totalSessions: 0,
    totalToolCalls: 0,
    totalTokens: 0,
    totalPromptTokens: 0,
    totalCompletionTokens: 0,
    totalCost: 0,
    activePhase: '',
  });

  // Fetch conversation history
  useEffect(() => {
    fetch('/api/conversations')
      .then(r => r.json())
      .then(data => setConversations(data.conversations || []))
      .catch(() => {});
  }, []);

  // Fetch token stats
  useEffect(() => {
    fetch('/api/token-stats')
      .then(r => r.json())
      .then(data => {
        if (data) {
          setStats(prev => ({
            ...prev,
            totalPromptTokens: data.promptTokens || 0,
            totalCompletionTokens: data.completionTokens || 0,
            totalTokens: (data.promptTokens || 0) + (data.completionTokens || 0),
            totalCost: data.totalCost || 0,
          }));
        }
      })
      .catch(() => {});
  }, []);

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

        if (data.type === 'init' && Array.isArray(data.events)) {
          const entries = data.events.map((e: AgentEvent) => ({
            id: `evt_${++eventCounter.current}`,
            event: e,
          }));
          setEvents(entries);
          const latest = data.events[data.events.length - 1];
          if (latest?.sessionId) {
            setStats(prev => ({ ...prev, totalSessions: data.events.filter((e: AgentEvent) => e.type === 'agent_start').length }));
          }
          return;
        }

        const event = data as AgentEvent;
        const entry: EventEntry = {
          id: `evt_${++eventCounter.current}`,
          event,
        };

        setEvents(prev => {
          const next = [...prev, entry];
          return next.length > 500 ? next.slice(-500) : next;
        });

        // Update stats
        setStats(prev => {
          const next = { ...prev };
          if (event.type === 'agent_start') next.totalSessions++;
          if (event.type === 'tool_start') next.totalToolCalls++;
          if (event.type === 'token_usage') {
            next.totalPromptTokens += (event.data.totalPrompt || 0);
            next.totalCompletionTokens += (event.data.totalCompletion || 0);
            next.totalTokens = next.totalPromptTokens + next.totalCompletionTokens;
          }
          if (event.type === 'phase_change') next.activePhase = event.data.phase || '';
          if (event.type === 'agent_end') next.activePhase = '';
          return next;
        });

        if (event.sessionId) {
          // refresh conversations list
          fetch('/api/conversations').then(r => r.json()).then(data => setConversations(data.conversations || [])).catch(() => {});
        }

        if (autoScroll) {
          setTimeout(() => eventsEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
        }
      } catch { /* ignore parse errors */ }
    };

    ws.onclose = () => {
      console.log('[Dashboard] WebSocket disconnected');
      setConnected(false);
      wsRef.current = null;
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
          <h2 className="text-sm font-semibold">Dashboard</h2>
          <div className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-medium ${
            connected ? 'bg-green-500/10 text-green-400' : 'bg-yellow-500/10 text-yellow-400'
          }`}>
            <div className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-green-400 animate-pulse' : 'bg-yellow-400'}`} />
            {connected ? 'Live' : 'Waiting...'}
          </div>
        </div>
        {/* Tab Switcher */}
        <div className="flex gap-1">
          <button onClick={() => setActiveTab('overview')}
            className={`px-2.5 py-1 rounded text-[10px] font-medium transition-colors ${activeTab === 'overview' ? 'bg-brand-600/20 text-brand-400' : 'text-dark-400 hover:text-dark-200'}`}>
            <BarChart3 size={10} className="inline mr-1" />Overview
          </button>
          <button onClick={() => setActiveTab('activity')}
            className={`px-2.5 py-1 rounded text-[10px] font-medium transition-colors ${activeTab === 'activity' ? 'bg-brand-600/20 text-brand-400' : 'text-dark-400 hover:text-dark-200'}`}>
            <Activity size={10} className="inline mr-1" />Activity
          </button>
        </div>
      </div>

      {activeTab === 'overview' ? (
        /* ===== OVERVIEW TAB ===== */
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Stats Cards */}
          <div className="grid grid-cols-4 gap-3">
            <StatCard icon={<MessageSquare size={16} />} label="Sessions" value={stats.totalSessions} color="blue" />
            <StatCard icon={<Terminal size={16} />} label="Tool Calls" value={stats.totalToolCalls} color="yellow" />
            <StatCard icon={<Zap size={16} />} label="Tokens Used" value={stats.totalTokens > 1000 ? `${(stats.totalTokens / 1000).toFixed(1)}K` : stats.totalTokens} color="purple" />
            <StatCard icon={<DollarSign size={16} />} label="Est. Cost" value={`$${stats.totalCost.toFixed(4)}`} color="green" />
          </div>

          {/* Token Breakdown */}
          <div className="bg-dark-900 border border-dark-700 rounded-lg p-3">
            <h3 className="text-[11px] font-semibold text-dark-200 mb-3 flex items-center gap-2">
              <TrendingUp size={12} className="text-brand-400" />Token Usage
            </h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-[10px] text-dark-400 mb-1">Prompt Tokens</p>
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-2 bg-dark-800 rounded-full overflow-hidden">
                    <div className="h-full bg-blue-500 rounded-full" style={{ width: `${Math.min(100, (stats.totalPromptTokens / Math.max(1, stats.totalTokens)) * 100)}%` }} />
                  </div>
                  <span className="text-[10px] text-dark-300 w-16 text-right">{(stats.totalPromptTokens / 1000).toFixed(1)}K</span>
                </div>
              </div>
              <div>
                <p className="text-[10px] text-dark-400 mb-1">Completion Tokens</p>
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-2 bg-dark-800 rounded-full overflow-hidden">
                    <div className="h-full bg-purple-500 rounded-full" style={{ width: `${Math.min(100, (stats.totalCompletionTokens / Math.max(1, stats.totalTokens)) * 100)}%` }} />
                  </div>
                  <span className="text-[10px] text-dark-300 w-16 text-right">{(stats.totalCompletionTokens / 1000).toFixed(1)}K</span>
                </div>
              </div>
            </div>
          </div>

          {/* Active Phase */}
          {stats.activePhase && (
            <div className="bg-dark-900 border border-dark-700 rounded-lg p-3">
              <h3 className="text-[11px] font-semibold text-dark-200 mb-2 flex items-center gap-2">
                <Zap size={12} className="text-yellow-400" />Active Phase
              </h3>
              <div className="flex items-center gap-2">
                {Object.entries(PHASE_LABELS).map(([key, label]) => (
                  <div key={key} className={`flex-1 text-center py-2 rounded text-[10px] font-medium transition-all ${
                    stats.activePhase === key
                      ? `${PHASE_COLORS[key] || 'text-dark-300 bg-dark-700'} ring-1 ring-brand-500/30`
                      : 'text-dark-500 bg-dark-800'
                  }`}>
                    {label}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Recent Sessions */}
          <div className="bg-dark-900 border border-dark-700 rounded-lg p-3">
            <h3 className="text-[11px] font-semibold text-dark-200 mb-2 flex items-center gap-2">
              <MessageSquare size={12} className="text-blue-400" />Recent Sessions
            </h3>
            {conversations.length === 0 ? (
              <p className="text-[10px] text-dark-500 py-2">No sessions yet. Start chatting to see history here.</p>
            ) : (
              <div className="space-y-1">
                {conversations.slice(0, 10).map(conv => (
                  <div key={conv.id} className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-dark-800 transition-colors">
                    <div className="flex-1 min-w-0">
                      <p className="text-[10px] text-dark-200 truncate">{conv.title || 'Untitled'}</p>
                      <p className="text-[9px] text-dark-500">{conv.messageCount} messages · {conv.model || 'unknown'}</p>
                    </div>
                    <span className="text-[9px] text-dark-500 ml-2">{new Date(conv.updatedAt).toLocaleDateString()}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* System Info */}
          <div className="bg-dark-900 border border-dark-700 rounded-lg p-3">
            <h3 className="text-[11px] font-semibold text-dark-200 mb-2 flex items-center gap-2">
              <Cpu size={12} className="text-green-400" />System
            </h3>
            <div className="grid grid-cols-3 gap-3 text-[10px]">
              <div>
                <p className="text-dark-500">Server Port</p>
                <p className="text-dark-200 font-mono">{serverPort || 'Starting...'}</p>
              </div>
              <div>
                <p className="text-dark-500">WebSocket</p>
                <p className={connected ? 'text-green-400' : 'text-yellow-400'}>{connected ? 'Connected' : 'Reconnecting...'}</p>
              </div>
              <div>
                <p className="text-dark-500">Events Buffer</p>
                <p className="text-dark-200 font-mono">{events.length} / 500</p>
              </div>
            </div>
          </div>
        </div>
      ) : (
        /* ===== ACTIVITY TAB (Live Event Stream) ===== */
        <>
          {/* Stats bar */}
          <div className="flex items-center justify-between px-4 py-1.5 border-b border-dark-700 bg-dark-900/30 flex-shrink-0 text-[10px] text-dark-400">
            <span>{stats.totalSessions} sessions · {stats.totalToolCalls} tools · {(stats.totalTokens / 1000).toFixed(1)}K tokens</span>
            <div className="flex items-center gap-2">
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
        </>
      )}
    </div>
  );
}

// ============================================================================
// STAT CARD
// ============================================================================

function StatCard({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: string | number; color: string }) {
  const colorMap: Record<string, string> = {
    blue: 'text-blue-400 bg-blue-400/10',
    yellow: 'text-yellow-400 bg-yellow-400/10',
    purple: 'text-purple-400 bg-purple-400/10',
    green: 'text-green-400 bg-green-400/10',
  };
  return (
    <div className="bg-dark-900 border border-dark-700 rounded-lg p-3">
      <div className="flex items-center gap-2 mb-1.5">
        <div className={`p-1.5 rounded ${colorMap[color] || colorMap.blue}`}>{icon}</div>
        <span className="text-[10px] text-dark-400">{label}</span>
      </div>
      <p className="text-lg font-bold text-white">{value}</p>
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
            {event.data.duration && (
              <span className="text-dark-500">{formatDuration(event.data.duration)}</span>
            )}
          </div>
        );

      case 'token_usage':
        return (
          <div className="flex items-center gap-2">
            <Zap size={11} className="text-brand-400" />
            <span className="text-dark-300">Token usage</span>
            <span className="text-dark-500">{event.data.totalPrompt} prompt + {event.data.totalCompletion} completion</span>
          </div>
        );

      case 'context_compression':
        return (
          <div className="flex items-center gap-2">
            <Activity size={11} className="text-orange-400" />
            <span className="text-orange-400">Context compressed</span>
            <span className="text-dark-500">{event.data.originalTokens} → {event.data.compressedTokens} tokens</span>
          </div>
        );

      case 'error':
        return (
          <div className="flex items-center gap-2">
            <XCircle size={11} className="text-red-400" />
            <span className="text-red-400">Error</span>
            <span className="text-dark-500 truncate max-w-[300px]">{event.data.error || event.data.message}</span>
          </div>
        );

      case 'thinking_delta':
        return (
          <div className="flex items-center gap-2">
            <Activity size={11} className="text-dark-400 animate-pulse" />
            <span className="text-dark-400 italic">Thinking...</span>
          </div>
        );

      default:
        return (
          <div className="flex items-center gap-2">
            <Terminal size={11} className="text-dark-400" />
            <span className="text-dark-300">{event.type}</span>
            {event.data && Object.keys(event.data).length > 0 && (
              <span className="text-dark-500 truncate max-w-[300px]">{JSON.stringify(event.data).slice(0, 100)}</span>
            )}
          </div>
        );
    }
  };

  return (
    <div
      className={`flex items-center gap-2 px-2 py-1 rounded cursor-pointer transition-colors ${
        isSelected ? 'bg-brand-600/10 border border-brand-600/20' : 'hover:bg-dark-800/50'
      }`}
      onClick={onSelect}
    >
      <span className="text-[9px] text-dark-600 w-14 flex-shrink-0 font-mono">{formatTime(event.timestamp)}</span>
      <div className="flex-1 min-w-0">{renderContent()}</div>
    </div>
  );
}

// ============================================================================
// TOOL BADGE
// ============================================================================

function ToolBadge({ name }: { name: string }) {
  const colors: Record<string, string> = {
    read_file: 'bg-blue-500/10 text-blue-400',
    write_file: 'bg-green-500/10 text-green-400',
    edit_file: 'bg-yellow-500/10 text-yellow-400',
    run_command: 'bg-purple-500/10 text-purple-400',
    search_files: 'bg-cyan-500/10 text-cyan-400',
    list_files: 'bg-indigo-500/10 text-indigo-400',
    browser_navigate: 'bg-orange-500/10 text-orange-400',
    browser_screenshot: 'bg-pink-500/10 text-pink-400',
    web_search: 'bg-teal-500/10 text-teal-400',
  };
  const color = colors[name] || 'bg-dark-700 text-dark-300';
  return (
    <span className={`px-1.5 py-0.5 rounded text-[9px] font-mono font-medium ${color}`}>
      {name}
    </span>
  );
}

// ============================================================================
// ARGS SUMMARIZER
// ============================================================================

function summarizeArgs(tool: string, args: any): string {
  if (!args) return '';
  switch (tool) {
    case 'read_file': return args.file_path || '';
    case 'write_file': return args.file_path || '';
    case 'edit_file': return args.file_path || '';
    case 'run_command': return args.command?.slice(0, 80) || '';
    case 'search_files': return args.pattern || '';
    case 'list_files': return args.path || '';
    case 'glob_files': return args.pattern || '';
    case 'browser_navigate': return args.url || '';
    case 'web_search': return args.query || '';
    case 'web_fetch': return args.url || '';
    default: return '';
  }
}
