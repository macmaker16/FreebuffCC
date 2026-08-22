/**
 * Michaelangelo - Chat View Component
 * 
 * Compact chat interface with smaller text and bigger chat area.
 * Shows model status, workspace selector, and fallback notifications.
 */

import React, { useState, useEffect, useRef } from 'react';
import { Send, Bot, User, Trash2, AlertCircle, FolderOpen, Folder, Check, Wifi, WifiOff } from 'lucide-react';
import { Model, ModelStatus, ChatMessage } from '../types';
import { sendChat, generateId } from '../services/api';

interface Props {
  activeModel: Model | null;
  modelStatuses: Map<string, ModelStatus>;
  fallbackMsg: string | null;
}

export default function ChatView({ activeModel, modelStatuses, fallbackMsg }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [workspace, setWorkspace] = useState('');
  const [workspaceSaved, setWorkspaceSaved] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    window.electronAPI.getWorkspace().then(setWorkspace).catch(() => {});
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSelectFolder = async () => {
    const folder = await window.electronAPI.selectFolder();
    if (folder) {
      setWorkspace(folder);
      await window.electronAPI.setWorkspace(folder);
      setWorkspaceSaved(true);
      setTimeout(() => setWorkspaceSaved(false), 2000);
    }
  };

  const handleSend = async () => {
    const text = input.trim();
    if (!text || !activeModel || loading) return;

    const userMsg: ChatMessage = {
      id: generateId(), role: 'user', content: text, timestamp: Date.now(),
    };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      const apiMessages = [...messages, userMsg].map(m => ({ role: m.role, content: m.content }));
      const res = await sendChat(apiMessages, activeModel.id);
      const content = res.choices?.[0]?.message?.content || 'No response';
      const assistantMsg: ChatMessage = {
        id: generateId(), role: 'assistant', content, timestamp: Date.now(),
      };
      setMessages(prev => [...prev, assistantMsg]);
    } catch (err: any) {
      const errMsg: ChatMessage = {
        id: generateId(), role: 'assistant',
        content: `Error: ${err.message || 'Failed to get response'}`,
        timestamp: Date.now(),
      };
      setMessages(prev => [...prev, errMsg]);
    }
    setLoading(false);
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleClear = () => { setMessages([]); };

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    e.target.style.height = 'auto';
    e.target.style.height = Math.min(e.target.scrollHeight, 100) + 'px';
  };

  const activeModelStatus = activeModel ? modelStatuses.get(activeModel.id) : null;
  const isModelOnline = activeModelStatus?.status === 'online';

  return (
    <div className="h-full flex flex-col">
      {/* Header — compact */}
      <div className="px-4 py-2 border-b border-dark-700 flex items-center justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex items-center gap-1.5 min-w-0">
            {activeModel ? (
              <>
                <div className={`w-2 h-2 rounded-full flex-shrink-0 ${isModelOnline ? 'bg-green-500' : 'bg-red-500'}`} />
                <span className="text-xs font-medium truncate">{activeModel.name}</span>
                <span className="text-[10px] text-dark-500">
                  {activeModel.provider === 'openrouter' ? 'OR' : 'NIM'}
                </span>
              </>
            ) : (
              <span className="text-xs text-yellow-500">No model — Models tab</span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Workspace */}
          <div className="flex items-center gap-1">
            <Folder size={10} className="text-purple-400" />
            <span className="text-[10px] text-dark-500 max-w-[120px] truncate" title={workspace}>
              {workspace || 'No folder'}
            </span>
            <button
              onClick={handleSelectFolder}
              className="text-[10px] px-1.5 py-0.5 bg-dark-800 hover:bg-dark-700 border border-dark-600 rounded transition-colors"
            >
              {workspaceSaved ? <Check size={9} className="text-green-400" /> : <FolderOpen size={9} />}
            </button>
          </div>

          {/* Clear */}
          <button onClick={handleClear} disabled={messages.length === 0}
            className="p-1 hover:bg-dark-800 rounded transition-colors text-dark-500 hover:text-white disabled:opacity-30" title="Clear">
            <Trash2 size={12} />
          </button>
        </div>
      </div>

      {/* Fallback notification */}
      {fallbackMsg && (
        <div className="px-4 py-1.5 bg-yellow-500/10 border-b border-yellow-500/30 text-yellow-400 text-[11px] flex items-center gap-1.5 animate-fade-in">
          <WifiOff size={12} />
          {fallbackMsg}
        </div>
      )}

      {/* Messages — big area, smaller text */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2 min-h-0">
        {messages.length === 0 && !loading ? (
          <div className="flex flex-col items-center justify-center h-full text-dark-500">
            <Bot size={40} className="mb-2 opacity-30" />
            <p className="text-xs">Start a conversation</p>
            <p className="text-[10px]">
              {activeModel ? 'Type below' : 'Select a model first'}
            </p>
          </div>
        ) : (
          <>
            {messages.map(msg => (
              <div key={msg.id} className={`flex gap-2 animate-fade-in ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                {msg.role === 'assistant' && (
                  <div className="w-5 h-5 rounded bg-brand-600/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <Bot size={11} className="text-brand-400" />
                  </div>
                )}
                <div className={`max-w-[80%] rounded-lg px-3 py-2 ${msg.role === 'user' ? 'bg-brand-600 text-white' : 'bg-dark-800 text-dark-100'}`}>
                  <p className="whitespace-pre-wrap text-xs leading-relaxed">{msg.content}</p>
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
                  <Bot size={11} className="text-brand-400" />
                </div>
                <div className="rounded-lg px-3 py-2 bg-dark-800">
                  <div className="flex gap-0.5">
                    <div className="w-1.5 h-1.5 bg-dark-500 rounded-full typing-dot" />
                    <div className="w-1.5 h-1.5 bg-dark-500 rounded-full typing-dot" />
                    <div className="w-1.5 h-1.5 bg-dark-500 rounded-full typing-dot" />
                  </div>
                </div>
              </div>
            )}
          </>
        )}
        <div ref={endRef} />
      </div>

      {/* Input — compact */}
      <div className="px-4 py-2 border-t border-dark-700">
        {!activeModel && (
          <div className="flex items-center gap-1 text-yellow-500 text-[10px] mb-1">
            <AlertCircle size={10} />
            <span>Select a model in Models tab</span>
          </div>
        )}
        <div className="flex gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            placeholder={activeModel ? 'Message... (Enter)' : 'Select model...'}
            disabled={!activeModel || loading}
            rows={1}
            className="flex-1 px-3 py-1.5 bg-dark-900 border border-dark-700 rounded-lg text-xs text-white placeholder-dark-500 resize-none focus:outline-none focus:border-brand-500 disabled:opacity-50"
          />
          <button onClick={handleSend} disabled={!activeModel || loading || !input.trim()}
            className="px-3 py-1.5 bg-brand-600 hover:bg-brand-700 disabled:bg-brand-600/50 rounded-lg transition-colors">
            <Send size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
