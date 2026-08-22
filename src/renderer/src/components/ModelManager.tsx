/**
 * Michaelangelo - Model Manager Component
 * 
 * Displays models grouped by provider (OpenRouter / Nvidia NIM).
 * Each model card has a Test button and a Select button.
 */

import React, { useState, useMemo } from 'react';
import { Search, Play, Check, Loader2, X, RefreshCw, Cpu, Globe, Server } from 'lucide-react';
import { Model, ModelState } from '../types';
import { fetchModels, testModel } from '../services/api';

interface Props {
  models: Model[];
  activeModel: Model | null;
  onModelsChange: (models: Model[]) => void;
  onModelSelect: (model: Model) => void;
  apiReady: boolean;
}

export default function ModelManager({ models, activeModel, onModelsChange, onModelSelect, apiReady }: Props) {
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [states, setStates] = useState<Map<string, ModelState>>(new Map());

  // Filter by search
  const filtered = useMemo(() => {
    if (!search) return models;
    const q = search.toLowerCase();
    return models.filter(m =>
      m.id.toLowerCase().includes(q) ||
      m.name.toLowerCase().includes(q) ||
      m.provider.toLowerCase().includes(q)
    );
  }, [models, search]);

  // Group by provider
  const grouped = useMemo(() => {
    const g: Record<string, Model[]> = {};
    for (const m of filtered) {
      const key = m.provider;
      if (!g[key]) g[key] = [];
      g[key].push(m);
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

  const handleTest = async (modelId: string) => {
    setStates(prev => {
      const next = new Map(prev);
      next.set(modelId, { testStatus: 'testing' });
      return next;
    });

    try {
      const result = await testModel(modelId);
      setStates(prev => {
        const next = new Map(prev);
        next.set(modelId, {
          testStatus: result.success ? 'success' : 'failed',
          testResponse: result.response,
          testError: result.error,
        });
        return next;
      });
      // Clear after 5s
      setTimeout(() => {
        setStates(prev => {
          const next = new Map(prev);
          next.set(modelId, { testStatus: 'idle' });
          return next;
        });
      }, 5000);
    } catch {
      setStates(prev => {
        const next = new Map(prev);
        next.set(modelId, { testStatus: 'failed', testError: 'Request failed' });
        return next;
      });
    }
  };

  const providerLabel = (key: string) =>
    key === 'openrouter' ? 'OpenRouter' : key === 'nvidia_nim' ? 'Nvidia NIM' : key;

  const providerIcon = (key: string) =>
    key === 'openrouter' ? <Globe size={14} /> : <Server size={14} />;

  return (
    <div className="h-full flex flex-col p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold mb-2">Model Manager</h2>
          <p className="text-dark-400">{models.length} models available</p>
        </div>
        <button
          onClick={handleRefresh}
          disabled={!apiReady || loading}
          className="flex items-center gap-2 px-4 py-2 bg-dark-800 hover:bg-dark-700 disabled:opacity-50 rounded-lg transition-colors"
        >
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {/* Search */}
      <div className="relative mb-6">
        <Search size={20} className="absolute left-3 top-1/2 -translate-y-1/2 text-dark-500" />
        <input
          type="text"
          placeholder="Search models..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full pl-10 pr-10 py-3 bg-dark-900 border border-dark-700 rounded-lg text-white placeholder-dark-500 focus:outline-none focus:border-brand-500"
        />
        {search && (
          <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-dark-500 hover:text-white">
            <X size={16} />
          </button>
        )}
      </div>

      {/* Models */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {models.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-dark-500">
            <Cpu size={64} className="mb-4 opacity-50" />
            <p className="text-lg mb-2">No models loaded</p>
            <p className="text-sm">Add API keys in Settings, then click Refresh</p>
          </div>
        ) : (
          <div className="space-y-8">
            {Object.entries(grouped).map(([provider, providerModels]) => (
              <div key={provider}>
                <div className="flex items-center gap-2 mb-3">
                  {providerIcon(provider)}
                  <h3 className="text-sm font-semibold text-dark-300 uppercase tracking-wider">
                    {providerLabel(provider)}
                  </h3>
                  <span className="text-xs text-dark-500 bg-dark-800 px-2 py-0.5 rounded">
                    {providerModels.length}
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {providerModels.map(model => {
                    const st = states.get(model.id);
                    const isActive = activeModel?.id === model.id;
                    return (
                      <div
                        key={model.id}
                        className={`p-4 rounded-xl border transition-all ${
                          isActive
                            ? 'bg-brand-600/10 border-brand-500'
                            : 'bg-dark-900 border-dark-700 hover:border-dark-500'
                        }`}
                      >
                        <h4 className="font-medium truncate mb-1" title={model.id}>
                          {model.name}
                        </h4>
                        <p className="text-xs text-dark-500 truncate mb-3">{model.id}</p>

                        {/* Test result */}
                        {st?.testStatus === 'success' && (
                          <div className="mb-3 p-2 bg-green-500/10 border border-green-500/30 rounded text-xs text-green-400 truncate">
                            ✓ {st.testResponse}
                          </div>
                        )}
                        {st?.testStatus === 'failed' && (
                          <div className="mb-3 p-2 bg-red-500/10 border border-red-500/30 rounded text-xs text-red-400 truncate">
                            ✗ {st.testError}
                          </div>
                        )}

                        <div className="flex gap-2">
                          <button
                            onClick={() => handleTest(model.id)}
                            disabled={st?.testStatus === 'testing'}
                            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-dark-800 hover:bg-dark-700 disabled:opacity-50 rounded-lg text-sm transition-colors"
                          >
                            {st?.testStatus === 'testing' ? (
                              <Loader2 size={14} className="animate-spin" />
                            ) : (
                              <Play size={14} />
                            )}
                            Test
                          </button>
                          <button
                            onClick={() => onModelSelect(model)}
                            className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-sm transition-colors ${
                              isActive ? 'bg-green-600 text-white' : 'bg-dark-800 hover:bg-dark-700'
                            }`}
                          >
                            {isActive ? <><Check size={14} /> Active</> : 'Select'}
                          </button>
                        </div>
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
