/**
 * Michaelangelo - Model Manager Component
 * 
 * Compact list-mode display of all models.
 * Shows green/red dots for online/offline status.
 * Auto-tests all models on mount.
 * Checkbox-style selection for active model.
 */

import React, { useState, useMemo } from 'react';
import { Search, Loader2, X, RefreshCw, Cpu, Globe, Server, Check } from 'lucide-react';
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

export default function ModelManager({
  models, activeModel, modelStatuses, onModelsChange, onModelSelect, apiReady, autoTestRunning,
}: Props) {
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);

  const filtered = useMemo(() => {
    if (!search) return models;
    const q = search.toLowerCase();
    return models.filter(m =>
      m.id.toLowerCase().includes(q) ||
      m.name.toLowerCase().includes(q) ||
      m.provider.toLowerCase().includes(q)
    );
  }, [models, search]);

  const grouped = useMemo(() => {
    const g: Record<string, Model[]> = {};
    for (const m of filtered) {
      if (!g[m.provider]) g[m.provider] = [];
      g[m.provider].push(m);
    }
    return g;
  }, [filtered]);

  const handleRefresh = async () => {
    setLoading(true);
    try {
      const m = await fetchModels();
      onModelsChange(m);
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  };

  const handleSingleTest = async (modelId: string) => {
    // We don't override auto-test results with manual tests, just trigger
    try {
      const result = await testModel(modelId);
      // Note: modelStatuses are managed by parent (App), so we just log
      console.log(`Test ${modelId}:`, result);
    } catch (e) {
      console.error(e);
    }
  };

  const providerLabel = (key: string) =>
    key === 'openrouter' ? 'OpenRouter' : key === 'nvidia_nim' ? 'Nvidia NIM' : key;

  const providerIcon = (key: string) =>
    key === 'openrouter' ? <Globe size={12} /> : <Server size={12} />;

  const getStatusDot = (modelId: string) => {
    const st = modelStatuses.get(modelId);
    if (!st || st.status === 'untested') return 'bg-dark-600';
    if (st.status === 'testing') return 'bg-yellow-500 animate-pulse';
    if (st.status === 'online') return 'bg-green-500';
    return 'bg-red-500';
  };

  return (
    <div className="h-full flex flex-col p-3">
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-bold">Models</h2>
          <span className="text-[10px] text-dark-500 bg-dark-800 px-1.5 py-0.5 rounded">
            {filtered.length}/{models.length}
          </span>
          {autoTestRunning && (
            <div className="flex items-center gap-1">
              <Loader2 size={10} className="animate-spin text-brand-400" />
              <span className="text-[10px] text-brand-400">Auto-testing...</span>
            </div>
          )}
        </div>
        <button
          onClick={handleRefresh}
          disabled={!apiReady || loading}
          className="flex items-center gap-1 px-2 py-1 bg-dark-800 hover:bg-dark-700 disabled:opacity-50 rounded text-[10px] transition-colors"
        >
          <RefreshCw size={10} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {/* Search */}
      <div className="relative mb-2">
        <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-dark-500" />
        <input
          type="text"
          placeholder="Search..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full pl-7 pr-7 py-1.5 bg-dark-900 border border-dark-700 rounded text-xs text-white placeholder-dark-500 focus:outline-none focus:border-brand-500"
        />
        {search && (
          <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-dark-500 hover:text-white">
            <X size={12} />
          </button>
        )}
      </div>

      {/* Models List */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {models.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-dark-500">
            <Cpu size={32} className="mb-2 opacity-50" />
            <p className="text-xs">No models loaded</p>
            <p className="text-[10px]">Add API keys in Settings, then Refresh</p>
          </div>
        ) : (
          <div className="space-y-3">
            {Object.entries(grouped).map(([provider, providerModels]) => (
              <div key={provider}>
                {/* Provider header */}
                <div className="flex items-center gap-1.5 mb-1 px-1">
                  {providerIcon(provider)}
                  <h3 className="text-[10px] font-semibold text-dark-400 uppercase tracking-wider">
                    {providerLabel(provider)}
                  </h3>
                  <span className="text-[9px] text-dark-600">{providerModels.length}</span>
                </div>

                {/* Model rows */}
                <div className="space-y-px">
                  {providerModels.map(model => {
                    const st = modelStatuses.get(model.id);
                    const isActive = activeModel?.id === model.id;
                    const isOnline = st?.status === 'online';

                    return (
                      <div
                        key={model.id}
                        className={`flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer transition-all ${
                          isActive
                            ? 'bg-brand-600/15 border border-brand-500/40'
                            : 'hover:bg-dark-800 border border-transparent'
                        }`}
                        onClick={() => isOnline && onModelSelect(model)}
                        title={model.id}
                      >
                        {/* Status dot */}
                        <div className={`w-2 h-2 rounded-full flex-shrink-0 ${getStatusDot(model.id)}`}
                          title={st?.status || 'untested'}
                        />

                        {/* Model info */}
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium truncate">{model.name}</p>
                          <p className="text-[9px] text-dark-500 truncate">{model.id}</p>
                        </div>

                        {/* Selection checkbox */}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (isOnline) onModelSelect(model);
                          }}
                          disabled={!isOnline}
                          className={`w-5 h-5 rounded flex items-center justify-center flex-shrink-0 border transition-colors ${
                            isActive
                              ? 'bg-brand-600 border-brand-500'
                              : isOnline
                                ? 'border-dark-600 hover:border-brand-500'
                                : 'border-dark-700 opacity-30 cursor-not-allowed'
                          }`}
                          title={isActive ? 'Active model' : isOnline ? 'Select model' : 'Model offline'}
                        >
                          {isActive && <Check size={12} className="text-white" />}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
