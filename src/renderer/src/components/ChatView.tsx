/**
 * Michaelangelo - Chat View Component
 * 
 * Main chat interface with streaming support.
 * Shows the active model/provider at the top.
 * Messages are sent through the Express proxy.
 */

import React, { useState, useEffect, useRef } from 'react';
import { Send, Bot, User, Trash2, AlertCircle, FolderOpen, Folder, Check } from 'lucide-react';
import { Model, ChatMessage } from '../types';
import { sendChat, generateId } from '../services/api';

interface Props {
  activeModel: Model | null;
}

export default function ChatView({ activeModel }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [workspace, setWorkspace] = useState('');
  const [workspaceSaved, setWorkspaceSaved] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Load workspace on mount
  useEffect(() => {
    window.electronAPI.getWorkspace().then(setWorkspace).catch(() => {});
  }, []);

  // Auto-scroll
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

    // Add user message
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

  // Auto-resize textarea
  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    e.target.style.height = 'auto';
    e.target.style.height = Math.min(e.target.scrollHeight, 150) + 'px';
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-6 py-4 border-b border-dark-700">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-xl font-bold">Chat</h2>
            {activeModel ? (
              <p className="text-sm text-dark-400">
                <span className="text-brand-400">{activeModel.name}</span>
                <span className="text-dark-600 mx-2">•</span>
                <span>{activeModel.provider === 'openrouter' ? 'OpenRouter' : 'Nvidia NIM'}</span>
              </p>
            ) : (
              <p className="text-sm text-yellow-500">No model selected — go to Models tab</p>
            )}
          </div>
          <button onClick={handleClear} disabled={messages.length === 0}
            className="p-2 hover:bg-dark-800 rounded-lg transition-colors text-dark-400 hover:text-white disabled:opacity-50" title="Clear chat">
            <Trash2 size={18} />
          </button>
        </div>

        {/* Workspace Selector */}
        <div className="flex items-center gap-2">
          <Folder size={14} className="text-purple-400" />
          <span className="text-xs text-dark-500">Workspace:</span>
          <div className="flex-1 flex items-center gap-2">
            <span className="text-xs font-mono text-dark-300 truncate max-w-[300px]">
              {workspace || 'Not set — click Browse to select'}</span>
            <button
              onClick={handleSelectFolder}
              className="flex items-center gap-1 px-2 py-1 text-xs bg-dark-800 hover:bg-dark-700 border border-dark-600 rounded transition-colors"
            >
              {workspaceSaved ? <><Check size={12} className="text-green-400" /> Saved</> : <><FolderOpen size={12} /> Browse</>}
            </button>
          </div>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-6 space-y-4 min-h-0">
        {messages.length === 0 && !loading ? (
          <div className="flex flex-col items-center justify-center h-full text-dark-500">
            <Bot size={64} className="mb-4 opacity-50" />
            <p className="text-lg">Start a conversation</p>
            <p className="text-sm">
              {activeModel ? 'Type a message below' : 'Select a model first'}
            </p>
          </div>
        ) : (
          <>
            {messages.map(msg => (
              <div key={msg.id} className={`flex gap-3 animate-fade-in ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                {msg.role === 'assistant' && (
                  <div className="w-8 h-8 rounded-lg bg-brand-600/20 flex items-center justify-center flex-shrink-0">
                    <Bot size={18} className="text-brand-400" />
                  </div>
                )}
                <div className={`max-w-[70%] rounded-xl px-4 py-3 ${msg.role === 'user' ? 'bg-brand-600 text-white' : 'bg-dark-800 text-dark-100'}`}>
                  <p className="whitespace-pre-wrap">{msg.content}</p>
                </div>
                {msg.role === 'user' && (
                  <div className="w-8 h-8 rounded-lg bg-dark-700 flex items-center justify-center flex-shrink-0">
                    <User size={18} />
                  </div>
                )}
              </div>
            ))}
            {loading && (
              <div className="flex gap-3 justify-start">
                <div className="w-8 h-8 rounded-lg bg-brand-600/20 flex items-center justify-center flex-shrink-0">
                  <Bot size={18} className="text-brand-400" />
                </div>
                <div className="rounded-xl px-4 py-3 bg-dark-800">
                  <div className="flex gap-1">
                    <div className="w-2 h-2 bg-dark-500 rounded-full typing-dot" />
                    <div className="w-2 h-2 bg-dark-500 rounded-full typing-dot" />
                    <div className="w-2 h-2 bg-dark-500 rounded-full typing-dot" />
                  </div>
                </div>
              </div>
            )}
          </>
        )}
        <div ref={endRef} />
      </div>

      {/* Input */}
      <div className="px-6 py-4 border-t border-dark-700">
        {!activeModel && (
          <div className="flex items-center gap-2 text-yellow-500 text-sm mb-3">
            <AlertCircle size={16} />
            <span>Select a model in the Models tab</span>
          </div>
        )}
        <div className="flex gap-3">
          <textarea
            ref={inputRef}
            value={input}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            placeholder={activeModel ? 'Type your message... (Enter to send)' : 'Select a model first...'}
            disabled={!activeModel || loading}
            rows={1}
            className="flex-1 px-4 py-3 bg-dark-900 border border-dark-700 rounded-xl text-white placeholder-dark-500 resize-none focus:outline-none focus:border-brand-500 disabled:opacity-50"
          />
          <button onClick={handleSend} disabled={!activeModel || loading || !input.trim()}
            className="px-4 py-3 bg-brand-600 hover:bg-brand-700 disabled:bg-brand-600/50 rounded-xl transition-colors">
            <Send size={20} />
          </button>
        </div>
      </div>
    </div>
  );
}
