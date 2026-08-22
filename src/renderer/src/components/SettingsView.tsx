/**
 * Michaelangelo - Settings View Component
 * 
 * Compact form for entering and saving OpenRouter and Nvidia NIM API keys.
 * Keys are persisted via electron-store and read by the Express proxy.
 */

import React, { useState, useEffect } from 'react';
import { Save, Eye, EyeOff, Key, Globe, Server, CheckCircle } from 'lucide-react';

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
    <div className="h-full overflow-y-auto p-4">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-base font-bold">Settings</h2>
          <p className="text-[11px] text-dark-400">Configure API keys</p>
        </div>
        <button onClick={handleSave}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-brand-600 hover:bg-brand-700 rounded-lg transition-colors text-xs">
          <Save size={12} />
          {saved ? '✓ Saved!' : 'Save'}
        </button>
      </div>

      <div className="max-w-xl space-y-3">
        <div className="bg-brand-600/10 border border-brand-500/30 rounded-lg p-3">
          <p className="text-[11px] text-brand-300">
            Keys stored locally. Never sent anywhere except directly to provider APIs.
          </p>
        </div>

        {/* OpenRouter */}
        <section className="bg-dark-900 rounded-lg border border-dark-700 p-3">
          <div className="flex items-center gap-2 mb-2">
            <Globe size={14} className="text-blue-400" />
            <h3 className="text-xs font-semibold">OpenRouter</h3>
          </div>
          <p className="text-[10px] text-dark-400 mb-2">
            Free key at <span className="text-brand-400">openrouter.ai/keys</span> — GPT-4, Claude, Llama, 200+ models
          </p>
          <div className="relative">
            <Key size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-dark-500" />
            <input
              type={showOR ? 'text' : 'password'}
              value={form.openrouterApiKey}
              onChange={e => handleChange('openrouterApiKey', e.target.value)}
              placeholder="sk-or-v1-..."
              className="w-full pl-8 pr-8 py-2 bg-dark-800 border border-dark-700 rounded font-mono text-[11px] focus:outline-none focus:border-brand-500"
            />
            <button onClick={() => setShowOR(!showOR)}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-dark-500 hover:text-white">
              {showOR ? <EyeOff size={12} /> : <Eye size={12} />}
            </button>
          </div>
        </section>

        {/* Nvidia NIM */}
        <section className="bg-dark-900 rounded-lg border border-dark-700 p-3">
          <div className="flex items-center gap-2 mb-2">
            <Server size={14} className="text-green-400" />
            <h3 className="text-xs font-semibold">Nvidia NIM</h3>
          </div>
          <p className="text-[10px] text-dark-400 mb-2">
            Free key at <span className="text-brand-400">build.nvidia.com</span> — 1000 free credits/month
          </p>
          <div className="relative">
            <Key size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-dark-500" />
            <input
              type={showNIM ? 'text' : 'password'}
              value={form.nvidiaNimApiKey}
              onChange={e => handleChange('nvidiaNimApiKey', e.target.value)}
              placeholder="nvapi-..."
              className="w-full pl-8 pr-8 py-2 bg-dark-800 border border-dark-700 rounded font-mono text-[11px] focus:outline-none focus:border-brand-500"
            />
            <button onClick={() => setShowNIM(!showNIM)}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-dark-500 hover:text-white">
              {showNIM ? <EyeOff size={12} /> : <Eye size={12} />}
            </button>
          </div>
        </section>

        {/* Status */}
        <section className="bg-dark-900 rounded-lg border border-dark-700 p-3">
          <h3 className="text-xs font-semibold mb-2">Status</h3>
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              {form.openrouterApiKey ? (
                <CheckCircle size={12} className="text-green-500" />
              ) : (
                <div className="w-3 h-3 rounded-full border border-dark-600" />
              )}
              <span className={`text-[11px] ${form.openrouterApiKey ? 'text-green-400' : 'text-dark-500'}`}>
                OpenRouter {form.openrouterApiKey ? '✓' : '—'}
              </span>
            </div>
            <div className="flex items-center gap-2">
              {form.nvidiaNimApiKey ? (
                <CheckCircle size={12} className="text-green-500" />
              ) : (
                <div className="w-3 h-3 rounded-full border border-dark-600" />
              )}
              <span className={`text-[11px] ${form.nvidiaNimApiKey ? 'text-green-400' : 'text-dark-500'}`}>
                Nvidia NIM {form.nvidiaNimApiKey ? '✓' : '—'}
              </span>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
