/**
 * FreebuffCC - Settings View Component
 * 
 * Form for entering and saving OpenRouter and Nvidia NIM API keys.
 * Keys are persisted via electron-store and read by the Express proxy.
 */

import React, { useState, useEffect } from 'react';
import { Save, Eye, EyeOff, Key, Globe, Server, CheckCircle } from 'lucide-react';

/** Settings interface */
interface Settings {
  openrouterApiKey: string;
  nvidiaNimApiKey: string;
}

interface Props {
  onSettingsSaved: () => void;
}

export default function SettingsView({ onSettingsSaved }: Props) {
  const [form, setForm] = useState<Settings>({ openrouterApiKey: '', nvidiaNimApiKey: '' });
  const [showOR, setShowOR] = useState(false);
  const [showNIM, setShowNIM] = useState(false);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);

  // Load settings from electron-store via IPC on mount
  useEffect(() => {
    window.electronAPI.getApiKeys().then(keys => {
      setForm(keys);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const handleChange = (key: keyof Settings, value: string) => {
    setForm(prev => ({ ...prev, [key]: value }));
    setSaved(false);
  };

  const handleSave = async () => {
    await window.electronAPI.setApiKeys(form);
    setSaved(true);
    onSettingsSaved();
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold mb-2">Settings</h2>
          <p className="text-dark-400">Configure API keys for model providers</p>
        </div>
        <button onClick={handleSave}
          className="flex items-center gap-2 px-4 py-2 bg-brand-600 hover:bg-brand-700 rounded-lg transition-colors">
          <Save size={16} />
          {saved ? '✓ Saved!' : 'Save Settings'}
        </button>
      </div>

      <div className="max-w-2xl space-y-6">
        {/* Info */}
        <div className="bg-brand-600/10 border border-brand-500/30 rounded-xl p-4">
          <p className="text-sm text-brand-300">
            API keys are stored locally on your machine and never sent anywhere except directly to the provider APIs.
            The internal Express proxy uses these keys to make requests on your behalf.
          </p>
        </div>

        {/* OpenRouter */}
        <section className="bg-dark-900 rounded-xl border border-dark-700 p-6">
          <div className="flex items-center gap-2 mb-4">
            <Globe size={20} className="text-blue-400" />
            <h3 className="text-lg font-semibold">OpenRouter API Key</h3>
          </div>
          <p className="text-sm text-dark-400 mb-4">
            Get a free key at <span className="text-brand-400">openrouter.ai/keys</span>. Gives access to GPT-4, Claude, Llama, Mistral, and 200+ models.
          </p>
          <div className="relative">
            <Key size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-dark-500" />
            <input
              type={showOR ? 'text' : 'password'}
              value={form.openrouterApiKey}
              onChange={e => handleChange('openrouterApiKey', e.target.value)}
              placeholder="sk-or-v1-..."
              className="w-full pl-10 pr-10 py-3 bg-dark-800 border border-dark-700 rounded-lg font-mono text-sm focus:outline-none focus:border-brand-500"
            />
            <button onClick={() => setShowOR(!showOR)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-dark-500 hover:text-white">
              {showOR ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </section>

        {/* Nvidia NIM */}
        <section className="bg-dark-900 rounded-xl border border-dark-700 p-6">
          <div className="flex items-center gap-2 mb-4">
            <Server size={20} className="text-green-400" />
            <h3 className="text-lg font-semibold">Nvidia NIM API Key</h3>
          </div>
          <p className="text-sm text-dark-400 mb-4">
            Get a free key at <span className="text-brand-400">build.nvidia.com</span>. Includes 1000 free API credits/month for Nemotron, Llama, Mistral, and more.
          </p>
          <div className="relative">
            <Key size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-dark-500" />
            <input
              type={showNIM ? 'text' : 'password'}
              value={form.nvidiaNimApiKey}
              onChange={e => handleChange('nvidiaNimApiKey', e.target.value)}
              placeholder="nvapi-..."
              className="w-full pl-10 pr-10 py-3 bg-dark-800 border border-dark-700 rounded-lg font-mono text-sm focus:outline-none focus:border-brand-500"
            />
            <button onClick={() => setShowNIM(!showNIM)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-dark-500 hover:text-white">
              {showNIM ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </section>

        {/* Status */}
        <section className="bg-dark-900 rounded-xl border border-dark-700 p-6">
          <h3 className="text-lg font-semibold mb-4">Configuration Status</h3>
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              {form.openrouterApiKey ? (
                <CheckCircle size={18} className="text-green-500" />
              ) : (
                <div className="w-[18px] h-[18px] rounded-full border-2 border-dark-600" />
              )}
              <span className={form.openrouterApiKey ? 'text-green-400' : 'text-dark-500'}>
                OpenRouter {form.openrouterApiKey ? 'configured' : 'not configured'}
              </span>
            </div>
            <div className="flex items-center gap-3">
              {form.nvidiaNimApiKey ? (
                <CheckCircle size={18} className="text-green-500" />
              ) : (
                <div className="w-[18px] h-[18px] rounded-full border-2 border-dark-600" />
              )}
              <span className={form.nvidiaNimApiKey ? 'text-green-400' : 'text-dark-500'}>
                Nvidia NIM {form.nvidiaNimApiKey ? 'configured' : 'not configured'}
              </span>
            </div>
          </div>
          <p className="text-xs text-dark-500 mt-4">
            At least one API key is required to use models. Changes take effect after saving and refreshing the Models tab.
          </p>
        </section>
      </div>
    </div>
  );
}
