/**
 * Michaelangelo - Model Manager Component
 * 
 * Provider-tabbed model list with parallel auto-testing.
 * Shows green/red dots for online/offline status.
 * Checkbox selection for active model.
 */

import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { Search, Loader2, X, RefreshCw, Cpu } from 'lucide-react';
import { Model, ModelStatus } from '../types';
import { fetchModels, testModel } from '../services/api';

interface Props {
  models: Model[];
  activeModel: Model | null;
  modelStatuses: Map<string, ModelStatus>;
  onModelsChange: (models: Model[]) => void;
  onModelSelect: (model: Model) => void;
  apiReady: boolean;
  autoTestRunning: boolean;
}

const PROVIDER_TABS: Record<string, { label: string; color: string }> = {
  openrouter: { label: 'OpenRouter', color: 'blue' },
  nvidia_nim: { label: 'NVIDIA NIM', color: 'green' },
  openai: { label: 'OpenAI', color: 'emerald' },
  anthropic: { label: 'Anthropic', color: 'orange' },
  deepseek: { label: 'DeepSeek', color: 'cyan' },
  gemini: { label: 'Gemini', color: 'yellow' },
  groq: { label: 'Groq', color: 'purple' },
  together: { label: 'Together', color: 'pink' },
  mistral: { label: 'Mistral', color: 'red' },
  cohere: { label: 'Cohere', color: 'teal' },
  local_llm: { label: 'Local', color: 'green' },
};

export default function ModelManager({
  models, activeModel, modelStatuses, onModelsChange, onModelSelect, apiReady, autoTestRunning,
}: Props) {
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<string | null>(null);

  // Get available providers (only those with models)
  const availableProviders = useMemo(() => {
    const providers = new Set(models.map(m => m.provider));
    return Object.keys(PROVIDER_TABS).filter(p => providers.has(p));
  }, [models]);

  // Auto-select first provider with models
  useEffect(() => {
    if (availableProviders.length > 0 && !activeTab) {
      setActiveTab(availableProviders[0]);
    }
  }, [availableProviders, activeTab]);

  // Filter by tab and search
  const filtered = useMemo(() => {
    let list = models;
    if (activeTab) {
      list = list.filter(m => m.provider === activeTab);
    }
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(m =>
        m.id.toLowerCase().includes(q) ||
        m.name.toLowerCase().includes(q)
      );
    }
    // Sort: active first, then online, then testing, then offline/untested
    return [...list].sort((a, b) => {
      if (activeModel?.id === a.id) return -1;
      if (activeModel?.id === b.id) return 1;
      const sa = modelStatuses.get(a.id);
      const sb = modelStatuses.get(b.id);
      const rank = (s?: ModelStatus) => s?.status === 'online' ? 0 : s?.status === 'testing' ? 1 : s?.status === 'offline' ? 2 : 3;
      return rank(sa) - rank(sb);
    });
  }, [models, activeTab, search, activeModel, modelStatuses]);

  const handleRefresh = async () => {
    setLoading(true);
    try {
      const m = await fetchModels();
      onModelsChange(m);
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  const onlineCount = useMemo(() => {
    if (activeTab) {
      return models.filter(m => m.provider === activeTab && modelStatuses.get(m.id)?.status === 'online').length;
    }
    return [...modelStatuses.values()].filter(s => s.status === 'online').length;
  }, [models, activeTab, modelStatuses]);

  const tabCount = useMemo(() => {
    if (activeTab) return models.filter(m => m.provider === activeTab).length;
    return models.length;
  }, [models, activeTab]);

  return (
    <div className="h-full flex flex-col p-3">
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-bold">Models</h2>
          <span className="text-[10px] text-dark-500 bg-dark-800 px-1.5 py-0.5 rounded">
            {onlineCount}/{tabCount} online
          </span>
          {autoTestRunning && (
            <div className="flex items-center gap-1">
              <Loader2 size={10} className="animate-spin text-brand-400" />
              <span className="text-[10px] text-brand-400">Testing...</span>
            </div>
          )}
        </div>
        <button onClick={handleRefresh} disabled={!apiReady || loading}
          className="flex items-center gap-1 px-2 py-1 bg-dark-800 hover:bg-dark-700 disabled:opacity-50 rounded text-[10px] transition-colors">
          <RefreshCw size={10} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {/* Provider Tabs */}
      <div className="flex gap-0.5 mb-2 overflow-x-auto pb-1 flex-shrink-0">
        <button
          onClick={() => setActiveTab(null)}
          className={`px-2 py-1 rounded text-[10px] font-medium whitespace-nowrap transition-colors ${
            !activeTab ? 'bg-brand-600 text-white' : 'bg-dark-800 text-dark-400 hover:bg-dark-700'
          }`}
        >
          All ({models.length})
        </button>
        {availableProviders.map(p => {
          const tab = PROVIDER_TABS[p];
          const count = models.filter(m => m.provider === p).length;
          return (
            <button key={p} onClick={() => setActiveTab(p)}
              className={`px-2 py-1 rounded text-[10px] font-medium whitespace-nowrap transition-colors ${
                activeTab === p ? 'bg-brand-600 text-white' : 'bg-dark-800 text-dark-400 hover:bg-dark-700'
              }`}
            >
              {tab?.label || p} ({count})
            </button>
          );
        })}
      </div>

      {/* Search */}
      <div className="relative mb-2">
        <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-dark-500" />
        <input type="text" placeholder="Search..." value={search} onChange={e => setSearch(e.target.value)}
          className="w-full pl-7 pr-7 py-1.5 bg-dark-900 border border-dark-700 rounded text-xs text-white placeholder-dark-500 focus:outline-none focus:border-brand-500" />
        {search && (
          <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-dark-500 hover:text-white">
            <X size={12} />
          </button>
        )}
      </div>

      {/* Model List */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {models.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-dark-500">
            <Cpu size={32} className="mb-2 opacity-50" />
            <p className="text-xs">No models loaded</p>
            <p className="text-[10px]">Add API keys in Settings, then Refresh</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-dark-500">
            <p className="text-xs">No models match search</p>
          </div>
        ) : (
          <div className="space-y-px">
            {filtered.map(model => {
              const st = modelStatuses.get(model.id);
              const isActive = activeModel?.id === model.id;
              const isOnline = st?.status === 'online';
              const isTesting = st?.status === 'testing';

              return (
                <div key={model.id}
                  className={`flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer transition-all ${
                    isActive ? 'bg-brand-600/15 border border-brand-500/40' : 'hover:bg-dark-800 border border-transparent'
                  }`}
                  onClick={() => { if (st?.status !== 'offline') onModelSelect(model); }}
                >
                  {/* Status dot */}
                  <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
                    isTesting ? 'bg-yellow-500 animate-pulse' :
                    isOnline ? 'bg-green-500' :
                    st?.status === 'offline' ? 'bg-red-500' : 'bg-dark-600'
                  }`} title={st?.status || 'untested'} />

                  {/* Model info */}
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium truncate">{model.name}</p>
                    <p className="text-[9px] text-dark-500 truncate">{model.id}</p>
                  </div>

                  {/* Provider badge */}
                  <span className="text-[9px] text-dark-600 bg-dark-800 px-1 py-0.5 rounded flex-shrink-0">
                    {PROVIDER_TABS[model.provider]?.label || model.provider}
                  </span>

                  {/* Selection checkbox */}
                  <button
                    onClick={(e) => { e.stopPropagation(); if (st?.status !== 'offline') onModelSelect(model); }}
                    disabled={st?.status === 'offline'}
                    className={`w-5 h-5 rounded flex items-center justify-center flex-shrink-0 border transition-colors ${
                      isActive ? 'bg-brand-600 border-brand-500' :
                      st?.status !== 'offline' ? 'border-dark-600 hover:border-brand-500' :
                      'border-dark-700 opacity-30 cursor-not-allowed'
                    }`}
                    title={isActive ? 'Active' : 'Select model'}
                  >
                    {isActive && <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 6L5 9L10 3" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
