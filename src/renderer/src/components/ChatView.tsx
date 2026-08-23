/**
 * Michaelangelo - Chat View Component
 * Full Claude Code-style chat interface with:
 * - Sessions sidebar (load/save/search conversations)
 * - Slash commands (/compact, /clear, /help, /cost, /model, etc.)
 * - Permission approval UI for tool calls
 * - Token/cost display
 * - Auto-project detection
 * - Markdown rendering for responses
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Send, Bot, User, Trash2, AlertCircle, FolderOpen, Folder, Check, Wifi, WifiOff, MessageSquare, Search, Clock, Coins, ChevronDown, ChevronRight, X, Copy, CheckCheck, Terminal, FileCode, Zap, History, PanelRight } from 'lucide-react';
import { Model, ModelStatus, ChatMessage } from '../types';
import { sendAgentMessage, sendAgentMessageStream, generateId, fetchConversations, getConversation, deleteConversation, searchConversations, ConversationSummary, detectProject, getStats } from '../services/api';
import TerminalPanel from './TerminalPanel';
import PermissionDialog from './PermissionDialog';
import DiffViewer from './DiffViewer';

interface Props {
  activeModel: Model | null;
  modelStatuses: Map<string, ModelStatus>;
  fallbackMsg: string | null;
}

type ViewMode = 'chat' | 'sessions' | 'help' | 'project';

export default function ChatView({ activeModel, modelStatuses, fallbackMsg }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [workspace, setWorkspace] = useState('');
  const [workspaceSaved, setWorkspaceSaved] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('chat');
  const [sessions, setSessions] = useState<ConversationSummary[]>([]);
  const [sessionSearch, setSessionSearch] = useState('');
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [projectInfo, setProjectInfo] = useState<any>(null);
  const [stats, setStats] = useState<any>(null);
  const [pendingPermission, setPendingPermission] = useState<{ id: string; description: string; type: string } | null>(null);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const [tokenInfo, setTokenInfo] = useState<{ tokens: number; cost: number } | null>(null);
  const [toolActivity, setToolActivity] = useState<Array<{ name: string; status: string; detail?: string }>>([]);
  const [toolEvents, setToolEvents] = useState<Array<{ id: string; tool: string; args: Record<string, any>; status: 'running' | 'completed' | 'failed'; output?: string; duration?: number; iteration: number; timestamp: number }>>([]);
  const [currentIteration, setCurrentIteration] = useState(0);
  const [showContextPanel, setShowContextPanel] = useState(true);
  const [contextPanelTab, setContextPanelTab] = useState<'terminal' | 'diff'>('terminal');
  const [lastDiff, setLastDiff] = useState<any>(null);
  const [contextPanelWidth, setContextPanelWidth] = useState(380);
  const isDragging = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);

  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Initialize
  useEffect(() => {
    window.electronAPI.getWorkspace().then(setWorkspace).catch(() => {});
    // Listen for permission requests
    window.electronAPI.onPermissionRequest((request) => {
      setPendingPermission(request);
    });
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, toolActivity]);

  // Load sessions when switching to sessions view
  useEffect(() => {
    if (viewMode === 'sessions') {
      if (sessionSearch) {
        searchConversations(sessionSearch).then(setSessions).catch(() => {});
      } else {
        fetchConversations().then(setSessions).catch(() => {});
      }
    }
  }, [viewMode, sessionSearch]);

  // Load project info
  useEffect(() => {
    if (viewMode === 'project') {
      detectProject().then(setProjectInfo).catch(() => {});
      getStats().then(setStats).catch(() => {});
    }
  }, [viewMode]);

  const handleSelectFolder = async () => {
    const folder = await window.electronAPI.selectFolder();
    if (folder) {
      setWorkspace(folder);
      await window.electronAPI.setWorkspace(folder);
      setWorkspaceSaved(true);
      setTimeout(() => setWorkspaceSaved(false), 2000);
    }
  };

  // ============================================================================
  // SEND MESSAGE (with slash command support)
  // ============================================================================

  const handleSend = async () => {
    const text = input.trim();
    if (!text || !activeModel || loading) return;

    // Check for slash commands
    if (text.startsWith('/')) {
      const commandResult = await handleSlashCommand(text);
      if (commandResult.handled) {
        setInput('');
        return;
      }
    }

    const userMsg: ChatMessage = {
      id: generateId(), role: 'user', content: text, timestamp: Date.now(),
    };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setLoading(true);
    setToolActivity([]);

    try {
      const apiMessages = [...messages, userMsg].map(m => ({ role: m.role, content: m.content }));

      // Add a placeholder assistant message that we'll stream into
      const assistantId = generateId();
      setMessages(prev => [...prev, { id: assistantId, role: 'assistant', content: '', timestamp: Date.now() }]);

      let streamedContent = '';
      let abortRef: (() => void) | null = null;

      const { abort } = sendAgentMessageStream(
        apiMessages, activeModel.id, activeModel.provider, activeConversationId || undefined,
        {
          onToken: (token) => {
            streamedContent += token;
            setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: streamedContent } : m));
          },
          onToolStart: (tool, args, iteration) => {
            setToolActivity(prev => [...prev, { name: tool, status: 'running', detail: iteration.toString() }]);
            const eventId = generateId();
            setToolEvents(prev => [...prev, { id: eventId, tool, args: args || {}, status: 'running', iteration, timestamp: Date.now() }]);
            setCurrentIteration(iteration);
            setContextPanelTab('terminal');
          },
          onToolComplete: (tool, success, output, iteration, diff) => {
            setToolActivity(prev => prev.map(t => t.status === 'running' && t.name === tool ? { ...t, status: success ? 'completed' : 'failed' } : t));
            setToolEvents(prev => {
              const updated = [...prev];
              for (let i = updated.length - 1; i >= 0; i--) {
                if (updated[i].tool === tool && updated[i].status === 'running') {
                  updated[i] = { ...updated[i], status: success ? 'completed' : 'failed', output: output || '' };
                  break;
                }
              }
              return updated;
            });
            // Capture diff for the DiffViewer panel
            if (diff && tool === 'edit_file') {
              setLastDiff(diff);
              setContextPanelTab('diff');
            }
          },
          onIterationStart: (iteration, max) => {
            setToolActivity(prev => [...prev, { name: `Iteration ${iteration}/${max}`, status: 'running' }]);
            setCurrentIteration(iteration);
          },
          onMetadata: (meta) => {
            if (meta) {
              setToolActivity([
                { name: `${meta.iterations} iterations`, status: 'completed' },
                { name: `${meta.totalToolCalls} tool calls`, status: 'completed' },
                ...(meta.tokens ? [{ name: `${meta.tokens.prompt + meta.tokens.completion} tokens`, status: 'info' as const }] : []),
                ...(meta.cost ? [{ name: `$${meta.cost.toFixed(4)}`, status: 'info' as const }] : []),
              ]);
              setTokenInfo({ tokens: meta.tokens?.prompt + meta.tokens?.completion || 0, cost: meta.cost || 0 });
              setActiveConversationId(meta.conversationId || activeConversationId);
            }
          },
          onError: (msg) => {
            setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: `Error: ${msg}` } : m));
          },
          onDone: () => {
            setLoading(false);
            setToolActivity([]);
          },
        },
      );
      abortRef = abort;
    } catch (err: any) {
      setMessages(prev => [...prev, {
        id: generateId(), role: 'assistant', content: `Error: ${err.message || 'Failed'}`, timestamp: Date.now(),
      }]);
      setLoading(false);
      setToolActivity([]);
    }
    inputRef.current?.focus();
  };

  // ============================================================================
  // SLASH COMMANDS
  // ============================================================================

  const handleSlashCommand = async (text: string): Promise<{ handled: boolean }> => {
    const parts = text.split(/\s+/);
    const cmd = parts[0].toLowerCase();
    const args = parts.slice(1).join(' ');

    switch (cmd) {
      case '/help':
        setMessages(prev => [...prev, {
          id: generateId(), role: 'assistant', content: HELP_TEXT, timestamp: Date.now(),
        }]);
        return { handled: true };

      case '/clear':
        setMessages([]);
        setActiveConversationId(null);
        return { handled: true };

      case '/cost':
        if (tokenInfo) {
          setMessages(prev => [...prev, {
            id: generateId(), role: 'assistant',
            content: `**Session Usage**\n- Tokens: ${tokenInfo.tokens.toLocaleString()}\n- Cost: $${tokenInfo.cost.toFixed(4)}\n\nType \`/stats\` for all-time usage.`,
            timestamp: Date.now(),
          }]);
        } else {
          setMessages(prev => [...prev, {
            id: generateId(), role: 'assistant', content: 'No token usage recorded yet this session.', timestamp: Date.now(),
          }]);
        }
        return { handled: true };

      case '/sessions':
        setViewMode('sessions');
        setSessionSearch(args);
        return { handled: true };

      case '/project':
        setViewMode('project');
        return { handled: true };

      case '/compact': {
        // Compress the conversation by summarizing tool outputs
        const compressed: ChatMessage[] = [];
        let skippedTools = 0;
        for (const msg of messages) {
          if (msg.role === 'assistant' && msg.content.includes('[tool calls')) {
            // Skip meta-suffixes
            skippedTools++;
            continue;
          }
          compressed.push(msg);
        }
        setMessages(compressed);
        setMessages(prev => [...prev, {
          id: generateId(), role: 'assistant',
          content: `Context compacted. Removed ${skippedTools} tool summary messages.`,
          timestamp: Date.now(),
        }]);
        return { handled: true };
      }

      case '/model':
        if (args) {
          setMessages(prev => [...prev, {
            id: generateId(), role: 'assistant',
            content: `To switch models, go to the **Models** tab and select "${args}".`,
            timestamp: Date.now(),
          }]);
        } else {
          setMessages(prev => [...prev, {
            id: generateId(), role: 'assistant',
            content: activeModel ? `Current model: **${activeModel.name}** (${activeModel.provider})` : 'No model selected. Go to Models tab.',
            timestamp: Date.now(),
          }]);
        }
        return { handled: true };

      case '/stats':
        try {
          const s = await getStats();
          setMessages(prev => [...prev, {
            id: generateId(), role: 'assistant',
            content: `**All-time Stats**\n- Conversations: ${s.conversations?.totalConversations || 0}\n- Total tokens: ${(s.conversations?.totalTokens || 0).toLocaleString()}\n- Total cost: $${(s.conversations?.totalCost || 0).toFixed(4)}\n- Total tool calls: ${s.conversations?.totalToolCalls || 0}`,
            timestamp: Date.now(),
          }]);
        } catch { /* ignore */ }
        return { handled: true };

      case '/approve':
      case '/allow': {
        if (pendingPermission) {
          const always = args.toLowerCase() === 'always' || args.toLowerCase() === 'session';
          await handlePermission('approve', always);
          setMessages(prev => [...prev, {
            id: generateId(), role: 'assistant',
            content: `Approved: ${pendingPermission.description}${always ? ' (always for this session)' : ''}`,
            timestamp: Date.now(),
          }]);
        } else {
          setMessages(prev => [...prev, {
            id: generateId(), role: 'assistant',
            content: 'No pending permission to approve.', timestamp: Date.now(),
          }]);
        }
        return { handled: true };
      }

      case '/deny':
      case '/reject': {
        if (pendingPermission) {
          const desc = pendingPermission.description;
          await handlePermission('deny');
          setMessages(prev => [...prev, {
            id: generateId(), role: 'assistant',
            content: `Denied: ${desc}`, timestamp: Date.now(),
          }]);
        } else {
          setMessages(prev => [...prev, {
            id: generateId(), role: 'assistant',
            content: 'No pending permission to deny.', timestamp: Date.now(),
          }]);
        }
        return { handled: true };
      }

      default:
        return { handled: false };
    }
  };

  // ============================================================================
  // PERMISSION HANDLING
  // ============================================================================

  const handlePermission = async (action: 'approve' | 'deny', alwaysAllow = false) => {
    if (!pendingPermission) return;
    await window.electronAPI.respondPermission({
      requestId: pendingPermission.id, action, alwaysAllow,
    });
    setPendingPermission(null);
  };

  // ============================================================================
  // LOAD SESSION
  // ============================================================================

  const loadSession = async (id: string) => {
    const conv = await getConversation(id);
    if (conv) {
      const convMessages: ChatMessage[] = conv.messages.map(m => ({
        id: m.id || generateId(), role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content, timestamp: m.timestamp,
      }));
      setMessages(convMessages);
      setActiveConversationId(id);
      setViewMode('chat');
    }
  };

  // ============================================================================
  // COPY MESSAGE
  // ============================================================================

  const copyMessage = (content: string, idx: number) => {
    navigator.clipboard.writeText(content);
    setCopiedIdx(idx);
    setTimeout(() => setCopiedIdx(null), 2000);
  };

  // ============================================================================
  // SPLITTER DRAG HANDLERS
  // ============================================================================

  const handleSplitterMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;
    startX.current = e.clientX;
    startWidth.current = contextPanelWidth;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const handleMouseMove = (ev: MouseEvent) => {
      if (!isDragging.current) return;
      const dx = startX.current - ev.clientX; // dragging left = wider panel
      const newWidth = Math.min(Math.max(startWidth.current + dx, 240), 700);
      setContextPanelWidth(newWidth);
    };

    const handleMouseUp = () => {
      isDragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [contextPanelWidth]);

  // ============================================================================
  // RENDER
  // ============================================================================

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    e.target.style.height = 'auto';
    e.target.style.height = Math.min(e.target.scrollHeight, 100) + 'px';
  };

  const activeModelStatus = activeModel ? modelStatuses.get(activeModel.id) : null;
  const isOnline = activeModelStatus?.status === 'online';

  return (
    <div className="h-full flex">
      {/* Sessions Sidebar (toggleable) */}
      {viewMode === 'sessions' && (
        <div className="w-64 border-r border-dark-700 bg-dark-900 flex flex-col">
          <div className="p-3 border-b border-dark-700 flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <History size={12} className="text-brand-400" />
              <span className="text-xs font-bold">Sessions</span>
            </div>
            <button onClick={() => setViewMode('chat')} className="text-dark-500 hover:text-white">
              <X size={12} />
            </button>
          </div>
          <div className="p-2">
            <div className="relative">
              <Search size={10} className="absolute left-2 top-1/2 -translate-y-1/2 text-dark-500" />
              <input type="text" placeholder="Search..." value={sessionSearch} onChange={e => setSessionSearch(e.target.value)}
                className="w-full pl-6 pr-2 py-1 bg-dark-800 border border-dark-700 rounded text-[10px] text-white focus:outline-none focus:border-brand-500" />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {sessions.length === 0 ? (
              <p className="text-[10px] text-dark-500 text-center mt-4">No sessions yet</p>
            ) : sessions.map(s => (
              <button key={s.id} onClick={() => loadSession(s.id)}
                className={`w-full text-left p-2 rounded text-[10px] transition-colors ${activeConversationId === s.id ? 'bg-brand-600/20 border border-brand-500/40' : 'hover:bg-dark-800 border border-transparent'}`}>
                <p className="font-medium truncate">{s.title}</p>
                <p className="text-dark-500 truncate">
                  {new Date(s.updatedAt).toLocaleDateString()} · {s.messageCount} msgs · {s.toolCallCount} tools
                </p>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Project Info Panel (toggleable) */}
      {viewMode === 'project' && (
        <div className="w-64 border-r border-dark-700 bg-dark-900 flex flex-col">
          <div className="p-3 border-b border-dark-700 flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <FileCode size={12} className="text-green-400" />
              <span className="text-xs font-bold">Project</span>
            </div>
            <button onClick={() => setViewMode('chat')} className="text-dark-500 hover:text-white">
              <X size={12} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-3 text-[10px] space-y-2">
            {projectInfo ? (
              <>
                <InfoRow label="Type" value={`${projectInfo.type} (${projectInfo.framework})`} />
                <InfoRow label="Languages" value={projectInfo.languages?.join(', ') || 'Unknown'} />
                <InfoRow label="Package Mgr" value={projectInfo.packageManager} />
                <InfoRow label="TypeScript" value={projectInfo.hasTypeScript ? 'Yes' : 'No'} />
                <InfoRow label="Git" value={projectInfo.hasGit ? 'Yes' : 'No'} />
                <InfoRow label="Files" value={`~${projectInfo.fileCount}`} />
                {projectInfo.buildCommand && <InfoRow label="Build" value={projectInfo.buildCommand} mono />}
                {projectInfo.testCommand && <InfoRow label="Test" value={projectInfo.testCommand} mono />}
                {projectInfo.devCommand && <InfoRow label="Dev" value={projectInfo.devCommand} mono />}
                {projectInfo.directories?.length > 0 && (
                  <div className="mt-2">
                    <p className="text-dark-500 mb-1">Directories:</p>
                    {projectInfo.directories.slice(0, 10).map((d: string) => (
                      <p key={d} className="text-dark-300 pl-2">📁 {d}/</p>
                    ))}
                  </div>
                )}
                {stats && (
                  <div className="mt-3 pt-2 border-t border-dark-700">
                    <p className="text-dark-500 mb-1">All-time Stats:</p>
                    <InfoRow label="Conversations" value={String(stats.conversations?.totalConversations || 0)} />
                    <InfoRow label="Tokens" value={(stats.conversations?.totalTokens || 0).toLocaleString()} />
                    <InfoRow label="Cost" value={`$${(stats.conversations?.totalCost || 0).toFixed(4)}`} />
                  </div>
                )}
              </>
            ) : (
              <p className="text-dark-500 text-center mt-4">Loading project info...</p>
            )}
          </div>
        </div>
      )}

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <div className="px-4 py-2 border-b border-dark-700 flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex items-center gap-1.5 min-w-0">
              {activeModel ? (
                <>
                  <div className={`w-2 h-2 rounded-full flex-shrink-0 ${isOnline ? 'bg-green-500' : 'bg-red-500'}`} />
                  <span className="text-xs font-medium truncate">{activeModel.name}</span>
                  <span className="text-[10px] text-dark-500">{activeModel.provider}</span>
                </>
              ) : (
                <span className="text-xs text-yellow-500">No model — Models tab</span>
              )}
            </div>
            {tokenInfo && (
              <div className="flex items-center gap-2 text-[10px] text-dark-500">
                <span>{tokenInfo.tokens.toLocaleString()} tokens</span>
                <span>${tokenInfo.cost.toFixed(4)}</span>
              </div>
            )}
          </div>

          <div className="flex items-center gap-1">
            <button onClick={() => setViewMode(viewMode === 'sessions' ? 'chat' : 'sessions')}
              className={`p-1.5 rounded transition-colors ${viewMode === 'sessions' ? 'bg-brand-600/20 text-brand-400' : 'text-dark-500 hover:text-white hover:bg-dark-800'}`} title="Sessions">
              <History size={12} />
            </button>
            <button onClick={() => setViewMode(viewMode === 'project' ? 'chat' : 'project')}
              className={`p-1.5 rounded transition-colors ${viewMode === 'project' ? 'bg-brand-600/20 text-brand-400' : 'text-dark-500 hover:text-white hover:bg-dark-800'}`} title="Project Info">
              <FileCode size={12} />
            </button>
            <button onClick={() => setShowContextPanel(!showContextPanel)}
              className={`p-1.5 rounded transition-colors ${showContextPanel ? 'bg-brand-600/20 text-brand-400' : 'text-dark-500 hover:text-white hover:bg-dark-800'}`} title="Toggle Context Panel">
              <PanelRight size={12} />
            </button>
            <div className="flex items-center gap-1 ml-1">
              <Folder size={10} className="text-purple-400" />
              <span className="text-[10px] text-dark-500 max-w-[100px] truncate" title={workspace}>{workspace || 'No folder'}</span>
              <button onClick={handleSelectFolder}
                className="text-[10px] px-1 py-0.5 bg-dark-800 hover:bg-dark-700 border border-dark-600 rounded transition-colors">
                {workspaceSaved ? <Check size={8} className="text-green-400" /> : <FolderOpen size={8} />}
              </button>
            </div>
            <button onClick={() => { setMessages([]); setActiveConversationId(null); }} disabled={messages.length === 0}
              className="p-1.5 hover:bg-dark-800 rounded transition-colors text-dark-500 hover:text-white disabled:opacity-30 ml-1" title="New Chat">
              <Trash2 size={12} />
            </button>
          </div>
        </div>

        {/* Fallback notification */}
        {fallbackMsg && (
          <div className="px-4 py-1.5 bg-yellow-500/10 border-b border-yellow-500/30 text-yellow-400 text-[11px] flex items-center gap-1.5">
            <WifiOff size={12} />
            {fallbackMsg}
          </div>
        )}

        {/* Permission Request Banner */}
        {pendingPermission && (
          <div className="px-4 py-2 bg-orange-500/10 border-b border-orange-500/30 flex items-center justify-between animate-fade-in">
            <div className="flex items-center gap-2">
              <AlertCircle size={14} className="text-orange-400" />
              <div>
                <p className="text-[11px] font-medium text-orange-300">Permission Required</p>
                <p className="text-[10px] text-dark-400">{pendingPermission.description}</p>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <button onClick={() => handlePermission('approve', true)}
                className="px-2 py-1 bg-green-600 hover:bg-green-700 rounded text-[10px] text-white font-medium transition-colors">
                Always Allow
              </button>
              <button onClick={() => handlePermission('approve')}
                className="px-2 py-1 bg-brand-600 hover:bg-brand-700 rounded text-[10px] text-white font-medium transition-colors">
                Allow
              </button>
              <button onClick={() => handlePermission('deny')}
                className="px-2 py-1 bg-red-600 hover:bg-red-700 rounded text-[10px] text-white font-medium transition-colors">
                Deny
              </button>
            </div>
          </div>
        )}

        {/* Tool Activity Bar */}
        {toolActivity.length > 0 && (
          <div className="px-4 py-1.5 bg-dark-800/50 border-b border-dark-700 flex items-center gap-3 overflow-x-auto">
            <Terminal size={10} className="text-dark-400 flex-shrink-0" />
            {toolActivity.map((ta, i) => (
              <span key={i} className={`text-[9px] whitespace-nowrap ${ta.status === 'completed' ? 'text-green-400' : ta.status === 'error' ? 'text-red-400' : 'text-dark-400'}`}>
                {ta.name}
              </span>
            ))}
          </div>
        )}

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2 min-h-0">
          {messages.length === 0 && !loading ? (
            <div className="flex flex-col items-center justify-center h-full text-dark-500">
              <Bot size={40} className="mb-2 opacity-30" />
              <p className="text-xs font-medium">Michaelangelo</p>
              <p className="text-[10px] mt-1">
                {activeModel ? `Using ${activeModel.name}` : 'Select a model in Models tab'}
              </p>
              <div className="mt-4 text-center space-y-1">
                <p className="text-[10px] text-dark-600">Type `/help` for available commands</p>
                <p className="text-[10px] text-dark-600">Or just describe what you want to build</p>
              </div>
            </div>
          ) : (
            <>
              {messages.map((msg, idx) => (
                <div key={msg.id} className={`flex gap-2 animate-fade-in group ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  {msg.role === 'assistant' && (
                    <div className="w-5 h-5 rounded bg-brand-600/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <Bot size={11} className="text-brand-400" />
                    </div>
                  )}
                  <div className={`max-w-[80%] rounded-lg px-3 py-2 relative ${msg.role === 'user' ? 'bg-brand-600 text-white' : 'bg-dark-800 text-dark-100'}`}>
                    <p className="whitespace-pre-wrap text-xs leading-relaxed">{msg.content}</p>
                    {msg.role === 'assistant' && (
                      <button onClick={() => copyMessage(msg.content, idx)}
                        className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-dark-700">
                        {copiedIdx === idx ? <CheckCheck size={10} className="text-green-400" /> : <Copy size={10} className="text-dark-500" />}
                      </button>
                    )}
                  </div>
                  {msg.role === 'user' && (
                    <div className="w-5 h-5 rounded bg-dark-700 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <User size={11} />
                    </div>
                  )}
                </div>
              ))}
              {loading && (
                <div className="flex gap-2 justify-start">
                  <div className="w-5 h-5 rounded bg-brand-600/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <Bot size={11} className="text-brand-400 animate-pulse" />
                  </div>
                  <div className="rounded-lg px-3 py-2 bg-dark-800">
                    <p className="text-[10px] text-dark-400 mb-1 flex items-center gap-1">
                      <Zap size={10} className="text-brand-400 animate-pulse" />
                      Agent working...
                    </p>
                    <div className="flex gap-0.5">
                      <div className="w-1.5 h-1.5 bg-brand-400 rounded-full typing-dot" />
                      <div className="w-1.5 h-1.5 bg-brand-400 rounded-full typing-dot" />
                      <div className="w-1.5 h-1.5 bg-brand-400 rounded-full typing-dot" />
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
          <div ref={endRef} />
        </div>

        {/* Input */}
        <div className="px-4 py-2 border-t border-dark-700">
          {pendingPermission && (
            <div className="flex items-center gap-2 text-orange-400 text-[10px] mb-1">
              <AlertCircle size={10} className="animate-pulse" />
              <span>Permission pending — type <code className="bg-dark-800 px-1 rounded">/approve</code> or <code className="bg-dark-800 px-1 rounded">/deny</code></span>
            </div>
          )}
          {!activeModel && (
            <div className="flex items-center gap-1 text-yellow-500 text-[10px] mb-1">
              <AlertCircle size={10} />
              <span>Select a model in Models tab</span>
            </div>
          )}
          <div className="flex gap-2">
            <textarea
              ref={inputRef} value={input} onChange={handleInput} onKeyDown={handleKeyDown}
              placeholder={pendingPermission ? '/approve or /deny — or type a message' : activeModel ? 'Message... (Enter) | /help for commands' : 'Select model...'}
              disabled={(!activeModel && !pendingPermission) || (loading && !pendingPermission)} rows={1}
              className="flex-1 px-3 py-1.5 bg-dark-900 border border-dark-700 rounded-lg text-xs text-white placeholder-dark-500 resize-none focus:outline-none focus:border-brand-500 disabled:opacity-50"
            />
            <button onClick={handleSend} disabled={(!activeModel && !pendingPermission) || (loading && !pendingPermission) || !input.trim()}
              className="px-3 py-1.5 bg-brand-600 hover:bg-brand-700 disabled:bg-brand-600/50 rounded-lg transition-colors">
              <Send size={14} />
            </button>
          </div>
        </div>
      </div>

      {/* Drag-to-resize Splitter + Context Panel (right side) */}
      {showContextPanel && (
        <>
          {/* Splitter handle */}
          <div
            onMouseDown={handleSplitterMouseDown}
            className="w-1 flex-shrink-0 cursor-col-resize group hover:bg-brand-500/40 transition-colors relative"
          >
            {/* Visible grip dots */}
            <div className="absolute inset-y-0 -left-0.5 w-2 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
              <div className="flex flex-col gap-0.5">
                <div className="w-0.5 h-0.5 bg-dark-400 rounded-full" />
                <div className="w-0.5 h-0.5 bg-dark-400 rounded-full" />
                <div className="w-0.5 h-0.5 bg-dark-400 rounded-full" />
                <div className="w-0.5 h-0.5 bg-dark-400 rounded-full" />
                <div className="w-0.5 h-0.5 bg-dark-400 rounded-full" />
              </div>
            </div>
          </div>

          {/* Context Panel */}
          <div style={{ width: contextPanelWidth }} className="border-l border-dark-700 bg-dark-900 flex flex-col flex-shrink-0 min-w-[200px] max-w-[700px]">
            {/* Context Panel Header */}
            <div className="px-3 py-2 border-b border-dark-700 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <button onClick={() => setContextPanelTab('terminal')}
                  className={`px-2 py-0.5 text-[10px] rounded font-medium transition-colors ${contextPanelTab === 'terminal' ? 'bg-brand-600/20 text-brand-400' : 'text-dark-500 hover:text-white'}`}>
                  <Terminal size={10} className="inline mr-1" />Activity
                </button>
                <button onClick={() => setContextPanelTab('diff')}
                  className={`px-2 py-0.5 text-[10px] rounded font-medium transition-colors ${contextPanelTab === 'diff' ? 'bg-brand-600/20 text-brand-400' : 'text-dark-500 hover:text-white'}`}>
                  <FileCode size={10} className="inline mr-1" />Diff
                </button>
              </div>
              <button onClick={() => setShowContextPanel(false)} className="text-dark-500 hover:text-white">
                <X size={12} />
              </button>
            </div>
            {/* Context Panel Content */}
            <div className="flex-1 overflow-hidden">
              {contextPanelTab === 'terminal' ? (
                <TerminalPanel toolEvents={toolEvents} iteration={currentIteration} maxIterations={20} isRunning={loading} />
              ) : lastDiff ? (
                <DiffViewer diff={lastDiff} />
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-dark-500">
                  <FileCode size={24} className="mb-2 opacity-30" />
                  <p className="text-[10px]">No diffs yet</p>
                  <p className="text-[9px] mt-1">File edits will show side-by-side diffs here</p>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ============================================================================
// SUB-COMPONENTS
// ============================================================================

function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between">
      <span className="text-dark-500">{label}</span>
      <span className={`text-dark-300 text-right ${mono ? 'font-mono' : ''}`}>{value}</span>
    </div>
  );
}

// ============================================================================
// CONSTANTS
// ============================================================================

const HELP_TEXT = `## Slash Commands

**Session:**
\`/compact\` — Compress context to save tokens
\`/clear\` — Clear conversation and start fresh
\`/cost\` — Show token usage and cost estimates
\`/sessions [query]\` — List or search past sessions
\`/resume <id>\` — Resume a previous session
\`/export\` — Export conversation as markdown

**Permissions:**
\`/approve\` — Approve the pending tool call (also: \`/allow\`)
\`/approve always\` — Approve and always allow similar operations
\`/deny\` — Deny the pending tool call (also: \`/reject\`)

**Project:**
\`/project\` — Show project info and auto-detection
\`/config\` — Show current configuration
\`/init\` — Create .michaelangelo.md project instructions

**Agent:**
\`/model [id]\` — Show or switch active model
\`/stats\` — Show all-time usage statistics

**Tips:**
- Press Enter to send, Shift+Enter for newline
- The agent automatically reads .michaelangelo.md for project context
- Tool calls require approval for destructive operations
- Use \`/approve\` or \`/deny\` instead of clicking the modal buttons`;
