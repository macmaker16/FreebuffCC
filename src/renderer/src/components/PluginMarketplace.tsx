/**
 * Michaelangelo - Plugin Marketplace Component
 *
 * Browse, search, install, and manage agent plugins.
 * Plugins extend the agent's capabilities with new tools and workflows.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Puzzle, Search, Download, Check, Trash2, Power, PowerOff, Package, Shield, Code, Cloud, Database, TestTube, BarChart3, Plug } from 'lucide-react';

interface Plugin {
  id: string;
  name: string;
  description: string;
  author: string;
  version: string;
  category: string;
  icon: string;
  downloads: number;
  tools: { name: string; description: string }[];
  installed: boolean;
  enabled: boolean;
}

interface PluginStats {
  total: number;
  installed: number;
  enabled: number;
  totalTools: number;
}

const CATEGORIES = [
  { id: 'all', label: 'All', icon: Package },
  { id: 'development', label: 'Dev', icon: Code },
  { id: 'devops', label: 'DevOps', icon: Cloud },
  { id: 'data', label: 'Data', icon: Database },
  { id: 'security', label: 'Security', icon: Shield },
  { id: 'productivity', label: 'Productivity', icon: BarChart3 },
];

export default function PluginMarketplace() {
  const [plugins, setPlugins] = useState<Plugin[]>([]);
  const [stats, setStats] = useState<PluginStats>({ total: 0, installed: 0, enabled: 0, totalTools: 0 });
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [loading, setLoading] = useState(true);

  const fetchPlugins = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (search) params.set('q', search);
      if (category !== 'all') params.set('category', category);
      const res = await fetch(`/api/plugins?${params}`);
      const data = await res.json();
      setPlugins(data.plugins || []);
      setStats(data.stats || { total: 0, installed: 0, enabled: 0, totalTools: 0 });
    } catch { /* ignore */ }
    setLoading(false);
  }, [search, category]);

  useEffect(() => { fetchPlugins(); }, [fetchPlugins]);

  const handleInstall = async (pluginId: string) => {
    await fetch('/api/plugins/install', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pluginId }),
    });
    fetchPlugins();
  };

  const handleUninstall = async (pluginId: string) => {
    await fetch('/api/plugins/uninstall', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pluginId }),
    });
    fetchPlugins();
  };

  const handleToggle = async (pluginId: string) => {
    await fetch('/api/plugins/toggle', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pluginId }),
    });
    fetchPlugins();
  };

  return (
    <div className="h-full flex flex-col bg-dark-950">
      {/* Header */}
      <div className="px-4 py-3 border-b border-dark-700">
        <div className="flex items-center gap-2 mb-2">
          <Puzzle size={16} className="text-brand-400" />
          <h2 className="text-sm font-bold">Plugin Marketplace</h2>
          <span className="text-[10px] text-dark-500 ml-auto">
            {stats.installed} installed · {stats.totalTools} tools active
          </span>
        </div>
        <div className="relative">
          <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-dark-500" />
          <input
            type="text" placeholder="Search plugins..." value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-7 pr-3 py-1.5 bg-dark-900 border border-dark-700 rounded text-xs text-white placeholder-dark-500 focus:outline-none focus:border-brand-500"
          />
        </div>
      </div>

      {/* Category Tabs */}
      <div className="px-4 py-2 border-b border-dark-700 flex gap-1 overflow-x-auto">
        {CATEGORIES.map(cat => {
          const Icon = cat.icon;
          return (
            <button key={cat.id} onClick={() => setCategory(cat.id)}
              className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] whitespace-nowrap transition-colors ${
                category === cat.id ? 'bg-brand-600/20 text-brand-400' : 'text-dark-500 hover:text-dark-300 hover:bg-dark-800'
              }`}>
              <Icon size={10} />
              {cat.label}
            </button>
          );
        })}
      </div>

      {/* Plugin List */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {loading ? (
          <div className="flex items-center justify-center h-32 text-dark-500 text-xs">Loading...</div>
        ) : plugins.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-dark-500">
            <Plug size={24} className="mb-2 opacity-30" />
            <p className="text-xs">No plugins found</p>
          </div>
        ) : (
          plugins.map(plugin => (
            <div key={plugin.id} className="bg-dark-900 border border-dark-700 rounded-lg p-3 hover:border-dark-600 transition-colors">
              <div className="flex items-start gap-3">
                <span className="text-2xl">{plugin.icon}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="text-xs font-bold text-white">{plugin.name}</h3>
                    <span className="text-[9px] px-1.5 py-0.5 bg-dark-800 rounded text-dark-400">v{plugin.version}</span>
                    {plugin.installed && (
                      <span className="text-[9px] px-1.5 py-0.5 bg-green-900/30 text-green-400 rounded">Installed</span>
                    )}
                  </div>
                  <p className="text-[10px] text-dark-400 mt-0.5">{plugin.description}</p>
                  <div className="flex items-center gap-3 mt-1.5">
                    <span className="text-[9px] text-dark-500">{plugin.author}</span>
                    <span className="text-[9px] text-dark-500">{plugin.downloads.toLocaleString()} downloads</span>
                    <span className="text-[9px] text-dark-500">{plugin.tools.length} tools</span>
                  </div>
                  {/* Tool list */}
                  {plugin.installed && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {plugin.tools.map(tool => (
                        <span key={tool.name} className="text-[9px] px-1.5 py-0.5 bg-dark-800 rounded text-dark-400 font-mono">
                          {tool.name}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                {/* Actions */}
                <div className="flex flex-col gap-1 flex-shrink-0">
                  {plugin.installed ? (
                    <>
                      <button onClick={() => handleToggle(plugin.id)}
                        className={`px-2 py-1 rounded text-[10px] font-medium transition-colors ${
                          plugin.enabled ? 'bg-green-600/20 text-green-400 hover:bg-green-600/30' : 'bg-dark-800 text-dark-500 hover:text-dark-300'
                        }`}>
                        {plugin.enabled ? <Power size={10} className="inline mr-1" /> : <PowerOff size={10} className="inline mr-1" />}
                        {plugin.enabled ? 'On' : 'Off'}
                      </button>
                      <button onClick={() => handleUninstall(plugin.id)}
                        className="px-2 py-1 rounded text-[10px] bg-red-900/20 text-red-400 hover:bg-red-900/30 transition-colors">
                        <Trash2 size={10} className="inline mr-1" />Remove
                      </button>
                    </>
                  ) : (
                    <button onClick={() => handleInstall(plugin.id)}
                      className="px-3 py-1.5 rounded text-[10px] font-medium bg-brand-600 text-white hover:bg-brand-500 transition-colors">
                      <Download size={10} className="inline mr-1" />Install
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
