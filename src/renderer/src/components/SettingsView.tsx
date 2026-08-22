/**
 * Michaelangelo - Settings View Component
 * API key management for all providers + Local LLM endpoint config.
 */

import React, { useState, useEffect } from 'react';
import { Save, Eye, EyeOff, Key, Globe, Server, CheckCircle, Monitor } from 'lucide-react';

interface Props {
  onSettingsSaved: () => void;
}

const PROVIDERS = [
  { key: 'openrouterApiKey', label: 'OpenRouter', url: 'openrouter.ai/keys', desc: 'GPT-4, Claude, Llama, 200+ models', placeholder: 'sk-or-v1-...' },
  { key: 'nvidiaNimApiKey', label: 'NVIDIA NIM', url: 'build.nvidia.com', desc: '1000 free credits/month', placeholder: 'nvapi-...' },
  { key: 'openaiApiKey', label: 'OpenAI', url: 'platform.openai.com/api-keys', desc: 'GPT-4o, GPT-4, o1, o3', placeholder: 'sk-...' },
  { key: 'anthropicApiKey', label: 'Anthropic', url: 'console.anthropic.com/keys', desc: 'Claude 4, Claude 3.5', placeholder: 'sk-ant-...' },
  { key: 'deepseekApiKey', label: 'DeepSeek', url: 'platform.deepseek.com/keys', desc: 'DeepSeek V3, Coder', placeholder: 'sk-...' },
  { key: 'geminiApiKey', label: 'Google Gemini', url: 'aistudio.google.com/apikey', desc: 'Gemini 2.5, 2.0 Flash', placeholder: 'AIza...' },
  { key: 'groqApiKey', label: 'Groq', url: 'console.groq.com/keys', desc: 'Ultra-fast Llama, Mixtral', placeholder: 'gsk_...' },
  { key: 'togetherApiKey', label: 'Together AI', url: 'api.together.xyz/settings/api-keys', desc: 'Open-source models, fine-tuning', placeholder: '' },
  { key: 'mistralApiKey', label: 'Mistral AI', url: 'console.mistral.ai/api-keys', desc: 'Mistral Large, Codestral', placeholder: '' },
  { key: 'cohereApiKey', label: 'Cohere', url: 'dashboard.cohere.com/api-keys', desc: 'Command R+, Command R', placeholder: '' },
];

export default function SettingsView({ onSettingsSaved }: Props) {
  const [form, setForm] = useState<Record<string, string>>({});
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    window.electronAPI.getApiKeys().then(keys => {
      setForm(keys);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const handleChange = (key: string, value: string) => {
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
          <p className="text-[11px] text-dark-400">Configure API keys and local LLM</p>
        </div>
        <button onClick={handleSave}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-brand-600 hover:bg-brand-700 rounded-lg transition-colors text-xs">
          <Save size={12} />
          {saved ? '✓ Saved!' : 'Save All'}
        </button>
      </div>

      <div className="bg-brand-600/10 border border-brand-500/30 rounded-lg p-3 mb-4">
        <p className="text-[11px] text-brand-300">
          Keys stored locally. Never sent anywhere except directly to provider APIs.
        </p>
      </div>

      {/* Local LLM Section */}
      <section className="bg-dark-900 rounded-lg border border-green-500/30 p-3 mb-3">
        <div className="flex items-center gap-2 mb-2">
          <Monitor size={14} className="text-green-400" />
          <h3 className="text-xs font-semibold">Local LLM (Ollama / llama.cpp / LM Studio)</h3>
        </div>
        <p className="text-[10px] text-dark-400 mb-2">
          Connect to any OpenAI-compatible local server. Ollama default: <span className="text-green-400">http://localhost:11434/v1</span>
        </p>
        <div className="space-y-2">
          <div>
            <label className="text-[10px] text-dark-500 mb-0.5 block">Endpoint URL</label>
            <input
              type="text"
              value={form.localLlmEndpoint || ''}
              onChange={e => handleChange('localLlmEndpoint', e.target.value)}
              placeholder="http://localhost:11434/v1"
              className="w-full px-3 py-2 bg-dark-800 border border-dark-700 rounded font-mono text-[11px] focus:outline-none focus:border-green-500"
            />
          </div>
          <div>
            <label className="text-[10px] text-dark-500 mb-0.5 block">API Key (usually "ollama" or empty)</label>
            <div className="relative">
              <Key size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-dark-500" />
              <input
                type={showKeys['localLlmApiKey'] ? 'text' : 'password'}
                value={form.localLlmApiKey || ''}
                onChange={e => handleChange('localLlmApiKey', e.target.value)}
                placeholder="ollama"
                className="w-full pl-8 pr-8 py-2 bg-dark-800 border border-dark-700 rounded font-mono text-[11px] focus:outline-none focus:border-green-500"
              />
              <button onClick={() => setShowKeys(prev => ({ ...prev, localLlmApiKey: !prev.localLlmApiKey }))}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-dark-500 hover:text-white">
                {showKeys['localLlmApiKey'] ? <EyeOff size={12} /> : <Eye size={12} />}
              </button>
            </div>
          </div>
          <div className="flex items-center gap-4 text-[10px] text-dark-500">
            <span>Ollama: <span className="text-dark-300">11434</span></span>
            <span>llama.cpp: <span className="text-dark-300">8080</span></span>
            <span>LM Studio: <span className="text-dark-300">1234</span></span>
            <span>vLLM: <span className="text-dark-300">8000</span></span>
          </div>
        </div>
      </section>

      {/* Cloud Provider Keys */}
      <div className="space-y-2">
        {PROVIDERS.map(p => {
          const hasKey = !!form[p.key];
          return (
            <section key={p.key} className="bg-dark-900 rounded-lg border border-dark-700 p-3">
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-2">
                  {hasKey ? (
                    <CheckCircle size={12} className="text-green-500" />
                  ) : (
                    <div className="w-3 h-3 rounded-full border border-dark-600" />
                  )}
                  <h3 className="text-xs font-semibold">{p.label}</h3>
                </div>
                <a href={`https://${p.url}`} target="_blank" rel="noopener noreferrer"
                  className="text-[10px] text-brand-400 hover:underline">{p.url}</a>
              </div>
              <p className="text-[10px] text-dark-400 mb-2">{p.desc}</p>
              <div className="relative">
                <Key size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-dark-500" />
                <input
                  type={showKeys[p.key] ? 'text' : 'password'}
                  value={form[p.key] || ''}
                  onChange={e => handleChange(p.key, e.target.value)}
                  placeholder={p.placeholder || `Enter ${p.label} API key...`}
                  className="w-full pl-8 pr-8 py-2 bg-dark-800 border border-dark-700 rounded font-mono text-[11px] focus:outline-none focus:border-brand-500"
                />
                <button onClick={() => setShowKeys(prev => ({ ...prev, [p.key]: !prev[p.key] }))}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-dark-500 hover:text-white">
                  {showKeys[p.key] ? <EyeOff size={12} /> : <Eye size={12} />}
                </button>
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
