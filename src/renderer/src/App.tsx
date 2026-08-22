/**
 * Michaelangelo - Main App Component
 * 
 * Root component providing sidebar navigation and view switching.
 * Initializes the API service on mount.
 */

import React, { useState, useEffect } from 'react';
import { Cpu, MessageSquare, Settings, Zap } from 'lucide-react';
import ModelManager from './components/ModelManager';
import ChatView from './components/ChatView';
import SettingsView from './components/SettingsView';
import { Model } from './types';
import { initAPI, fetchModels } from './services/api';

const NAV_ITEMS = [
  { id: 'models', label: 'Models', icon: Cpu },
  { id: 'chat', label: 'Chat', icon: MessageSquare },
  { id: 'settings', label: 'Settings', icon: Settings },
];

function App() {
  const [activeView, setActiveView] = useState('models');
  const [models, setModels] = useState<Model[]>([]);
  const [activeModel, setActiveModel] = useState<Model | null>(null);
  const [apiReady, setApiReady] = useState(false);

  // Initialize API on mount
  useEffect(() => {
    initAPI().then(() => setApiReady(true)).catch(console.error);
  }, []);

  // Fetch models when API is ready
  useEffect(() => {
    if (!apiReady) return;
    fetchModels().then(setModels).catch(console.error);
  }, [apiReady]);

  const handleModelSelect = (model: Model) => {
    setActiveModel(model);
    setActiveView('chat');
  };

  return (
    <div className="flex h-screen bg-dark-950 text-white overflow-hidden">
      {/* Title Bar */}
      <div className="fixed top-0 left-0 right-0 h-10 bg-dark-900 border-b border-dark-700 titlebar-drag z-50 flex items-center justify-center">
        <span className="text-sm font-medium text-dark-200">Michaelangelo</span>
      </div>

      {/* Sidebar */}
      <aside className="w-64 bg-dark-900 border-r border-dark-700 flex flex-col mt-10">
        <div className="p-4 border-b border-dark-700">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center">
              <Zap size={24} />
            </div>
            <div>
              <h1 className="font-bold text-lg">Michaelangelo</h1>
              <p className="text-xs text-dark-400">OpenRouter + NIM</p>
            </div>
          </div>
        </div>

        <nav className="flex-1 p-3 space-y-1">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = activeView === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveView(item.id)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all ${
                  isActive
                    ? 'bg-brand-600/20 text-brand-400'
                    : 'text-dark-300 hover:bg-dark-800 hover:text-white'
                }`}
              >
                <Icon size={20} />
                <span className="font-medium">{item.label}</span>
              </button>
            );
          })}
        </nav>

        {/* Footer */}
        <div className="p-4 border-t border-dark-700">
          <div className="flex items-center gap-2">
            <div className={`w-2.5 h-2.5 rounded-full ${apiReady ? 'bg-green-500 pulse-glow' : 'bg-yellow-500'}`} />
            <span className="text-sm text-dark-300">
              {apiReady ? 'Proxy Ready' : 'Initializing...'}
            </span>
          </div>
          {activeModel && (
            <p className="text-xs text-dark-500 mt-1 truncate">
              Active: {activeModel.name}
            </p>
          )}
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 mt-10 overflow-hidden">
        {activeView === 'models' && (
          <ModelManager
            models={models}
            activeModel={activeModel}
            onModelsChange={setModels}
            onModelSelect={handleModelSelect}
            apiReady={apiReady}
          />
        )}
        {activeView === 'chat' && (
          <ChatView activeModel={activeModel} />
        )}
        {activeView === 'settings' && (
          <SettingsView onSettingsSaved={() => fetchModels().then(setModels)} />
        )}
      </main>
    </div>
  );
}

export default App;
