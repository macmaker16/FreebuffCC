/**
 * Michaelangelo - Main App Component
 * 
 * Root component providing compact sidebar navigation and view switching.
 * Handles model auto-testing on mount and model fallback logic.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Cpu, MessageSquare, Settings, Zap, Circle, Activity, Download, Check, RefreshCw, AlertCircle } from 'lucide-react';
import ModelManager from './components/ModelManager';
import ChatView from './components/ChatView';
import SettingsView from './components/SettingsView';
import AgentDashboard from './components/AgentDashboard';
import { Model, ModelStatus } from './types';
import { initAPI, fetchModels, testModel } from './services/api';

const NAV_ITEMS = [
  { id: 'chat', label: 'Chat', icon: MessageSquare },
  { id: 'models', label: 'Models', icon: Cpu },
  { id: 'dashboard', label: 'Dashboard', icon: Activity },
  { id: 'settings', label: 'Settings', icon: Settings },
];

function App() {
  const [activeView, setActiveView] = useState('chat');
  const [models, setModels] = useState<Model[]>([]);
  const [activeModel, setActiveModel] = useState<Model | null>(null);
  const [apiReady, setApiReady] = useState(false);
  const [serverPort, setServerPort] = useState<number | null>(null);
  const [modelStatuses, setModelStatuses] = useState<Map<string, ModelStatus>>(new Map());
  const [autoTestRunning, setAutoTestRunning] = useState(false);
  const autoTestDone = useRef(false);
  const fallbackNotification = useRef<string | null>(null);
  const [fallbackMsg, setFallbackMsg] = useState<string | null>(null);
  const [updateStatus, setUpdateStatus] = useState<any>(null);

  // Initialize API on mount
  useEffect(() => {
    initAPI().then(async () => {
      setApiReady(true);
      const port = await window.electronAPI.getServerPort();
      setServerPort(port);
    }).catch(console.error);

    // Listen for auto-update events
    window.electronAPI.onUpdateStatus((status) => {
      setUpdateStatus(status);
    });
  }, []);

  // Fetch models when API is ready
  useEffect(() => {
    if (!apiReady) return;
    fetchModels().then(setModels).catch(console.error);
  }, [apiReady]);

  // Auto-test all models in parallel (batches of 10 to avoid flooding)
  const autoTestAll = useCallback(async (modelList: Model[]) => {
    if (autoTestDone.current || modelList.length === 0) return;
    autoTestDone.current = true;
    setAutoTestRunning(true);

    // Mark all as testing
    setModelStatuses(prev => {
      const next = new Map(prev);
      for (const m of modelList) next.set(m.id, { status: 'testing' });
      return next;
    });

    // Test in parallel batches of 10
    const BATCH = 10;
    for (let i = 0; i < modelList.length; i += BATCH) {
      const batch = modelList.slice(i, i + BATCH);
      await Promise.allSettled(batch.map(async (model) => {
        try {
          const result = await testModel(model.id, model.provider);
          setModelStatuses(prev => {
            const next = new Map(prev);
            next.set(model.id, {
              status: result.success ? 'online' : 'offline',
              lastTested: Date.now(),
              error: result.error,
            });
            return next;
          });
        } catch {
          setModelStatuses(prev => {
            const next = new Map(prev);
            next.set(model.id, { status: 'offline', lastTested: Date.now(), error: 'Request failed' });
            return next;
          });
        }
      }));
    }
    setAutoTestRunning(false);
  }, []);

  useEffect(() => {
    if (models.length > 0 && !autoTestDone.current) {
      autoTestAll(models);
    }
  }, [models, autoTestAll]);

  // Model fallback: check every 30s if active model went offline
  useEffect(() => {
    if (!activeModel) return;
    const interval = setInterval(async () => {
      const status = modelStatuses.get(activeModel.id);
      if (status && status.status === 'offline') {
        // Find first online model
        const fallback = models.find(m => {
          const s = modelStatuses.get(m.id);
          return s?.status === 'online' && m.id !== activeModel.id;
        });
        if (fallback) {
          setActiveModel(fallback);
          const msg = `⚠️ ${activeModel.name} went offline — switched to ${fallback.name}`;
          setFallbackMsg(msg);
          setTimeout(() => setFallbackMsg(null), 8000);
        }
      }
    }, 30000);
    return () => clearInterval(interval);
  }, [activeModel, modelStatuses, models]);

  const handleModelSelect = (model: Model) => {
    setActiveModel(model);
    setActiveView('chat');
  };

  const onlineCount = [...modelStatuses.values()].filter(s => s.status === 'online').length;

  return (
    <div className="flex h-screen bg-dark-950 text-white overflow-hidden">
      {/* Title Bar */}
      <div className="fixed top-0 left-0 right-0 h-7 bg-dark-900 border-b border-dark-700 titlebar-drag z-50 flex items-center justify-center">
        <span className="text-[11px] font-medium text-dark-200">Michaelangelo</span>
      </div>

      {/* Sidebar */}
      <aside className="w-44 bg-dark-900 border-r border-dark-700 flex flex-col mt-7">
        <div className="p-2 border-b border-dark-700">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-md bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center flex-shrink-0">
              <Zap size={14} />
            </div>
            <div className="min-w-0">
              <h1 className="font-bold text-xs truncate">Michaelangelo</h1>
              <p className="text-[10px] text-dark-400">OpenRouter + NIM</p>
            </div>
          </div>
        </div>

        <nav className="flex-1 p-1.5 space-y-0.5">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = activeView === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveView(item.id)}
                className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md transition-all text-xs ${
                  isActive
                    ? 'bg-brand-600/20 text-brand-400'
                    : 'text-dark-300 hover:bg-dark-800 hover:text-white'
                }`}
              >
                <Icon size={14} />
                <span className="font-medium">{item.label}</span>
              </button>
            );
          })}
        </nav>

        {/* Footer */}
        <div className="p-2 border-t border-dark-700 space-y-1">
          <div className="flex items-center gap-1.5">
            <Circle size={7} className={apiReady ? 'fill-green-500 text-green-500' : 'fill-yellow-500 text-yellow-500'} />
            <span className="text-[10px] text-dark-300">
              {apiReady ? 'Proxy Ready' : 'Init...'}
            </span>
          </div>
          {autoTestRunning && (
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 border border-brand-400 border-t-transparent rounded-full animate-spin" />
              <span className="text-[10px] text-dark-400">Testing models...</span>
            </div>
          )}
          {!autoTestRunning && models.length > 0 && (
            <p className="text-[10px] text-dark-500">
              {onlineCount}/{models.length} online
            </p>
          )}
          {activeModel && (
            <p className="text-[10px] text-dark-400 truncate" title={activeModel.name}>
              → {activeModel.name}
            </p>
          )}
          {/* Auto-Update Indicator */}
          {updateStatus?.status === 'available' && (
            <button
              onClick={() => window.electronAPI.checkForUpdates()}
              className="flex items-center gap-1.5 text-[10px] text-blue-400 hover:text-blue-300 cursor-pointer"
            >
              <Download size={10} />
              <span>v{updateStatus.version} available</span>
            </button>
          )}
          {updateStatus?.status === 'downloading' && (
            <div className="flex items-center gap-1.5">
              <RefreshCw size={10} className="animate-spin text-blue-400" />
              <span className="text-[10px] text-blue-400">Downloading {Math.round(updateStatus.percent || 0)}%</span>
              <div className="flex-1 h-1 bg-dark-700 rounded-full overflow-hidden">
                <div className="h-full bg-blue-500 rounded-full transition-all duration-300" style={{ width: `${updateStatus.percent || 0}%` }} />
              </div>
            </div>
          )}
          {updateStatus?.status === 'ready' && (
            <button
              onClick={() => window.electronAPI.installUpdate()}
              className="flex items-center gap-1.5 text-[10px] text-green-400 hover:text-green-300 cursor-pointer"
            >
              <Check size={10} />
              <span>Restart to update</span>
            </button>
          )}
          {updateStatus?.status === 'up-to-date' && (
            <p className="text-[10px] text-dark-500">Up to date</p>
          )}
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 mt-7 overflow-hidden">
        {/* ChatView is always mounted (hidden via CSS) to preserve state when switching tabs */}
        <div style={{ display: activeView === 'chat' ? 'flex' : 'none', flexDirection: 'column', height: '100%' }}>
          <ChatView
            activeModel={activeModel}
            modelStatuses={modelStatuses}
            fallbackMsg={fallbackMsg}
          />
        </div>
        {activeView === 'models' && (
          <ModelManager
            models={models}
            activeModel={activeModel}
            modelStatuses={modelStatuses}
            onModelsChange={setModels}
            onModelSelect={handleModelSelect}
            apiReady={apiReady}
            autoTestRunning={autoTestRunning}
          />
        )}
        {activeView === 'dashboard' && (
          <AgentDashboard serverPort={serverPort} />
        )}
        {activeView === 'settings' && (
          <SettingsView onSettingsSaved={() => { autoTestDone.current = false; fetchModels().then(setModels); }} />
        )}
      </main>
    </div>
  );
}

export default App;
