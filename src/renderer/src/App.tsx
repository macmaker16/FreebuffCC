/**
 * Michaelangelo - Main App Component
 * 
 * Root component providing compact sidebar navigation and view switching.
 * Handles model auto-testing on mount and model fallback logic.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Cpu, MessageSquare, Settings, Zap, Circle } from 'lucide-react';
import ModelManager from './components/ModelManager';
import ChatView from './components/ChatView';
import SettingsView from './components/SettingsView';
import { Model, ModelStatus } from './types';
import { initAPI, fetchModels, testModel } from './services/api';

const NAV_ITEMS = [
  { id: 'models', label: 'Models', icon: Cpu },
  { id: 'chat', label: 'Chat', icon: MessageSquare },
  { id: 'settings', label: 'Settings', icon: Settings },
];

function App() {
  const [activeView, setActiveView] = useState('chat');
  const [models, setModels] = useState<Model[]>([]);
  const [activeModel, setActiveModel] = useState<Model | null>(null);
  const [apiReady, setApiReady] = useState(false);
  const [modelStatuses, setModelStatuses] = useState<Map<string, ModelStatus>>(new Map());
  const [autoTestRunning, setAutoTestRunning] = useState(false);
  const autoTestDone = useRef(false);
  const fallbackNotification = useRef<string | null>(null);
  const [fallbackMsg, setFallbackMsg] = useState<string | null>(null);

  // Initialize API on mount
  useEffect(() => {
    initAPI().then(() => setApiReady(true)).catch(console.error);
  }, []);

  // Fetch models when API is ready
  useEffect(() => {
    if (!apiReady) return;
    fetchModels().then(setModels).catch(console.error);
  }, [apiReady]);

  // Auto-test all models once when models are loaded
  const autoTestAll = useCallback(async (modelList: Model[]) => {
    if (autoTestDone.current || modelList.length === 0) return;
    autoTestDone.current = true;
    setAutoTestRunning(true);

    for (const model of modelList) {
      // Mark as testing
      setModelStatuses(prev => {
        const next = new Map(prev);
        next.set(model.id, { status: 'testing' });
        return next;
      });

      try {
        const result = await testModel(model.id);
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
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 mt-7 overflow-hidden">
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
        {activeView === 'chat' && (
          <ChatView
            activeModel={activeModel}
            modelStatuses={modelStatuses}
            fallbackMsg={fallbackMsg}
          />
        )}
        {activeView === 'settings' && (
          <SettingsView onSettingsSaved={() => { autoTestDone.current = false; fetchModels().then(setModels); }} />
        )}
      </main>
    </div>
  );
}

export default App;
