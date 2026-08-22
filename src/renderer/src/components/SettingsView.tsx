/**
 * Michaelangelo - Settings View Component
 * API key management for all providers.
 */

import React, { useState, useEffect } from 'react';
import { Save, Eye, EyeOff, Key, Globe, Server, CheckCircle } from 'lucide-react';

interface Props {
  onSettingsSaved: () => void;
}

const PROVIDERS = [
  { key: 'openrouterApiKey', label: 'OpenRouter', color: 'blue', url: 'openrouter.ai/keys', desc: 'GPT-4, Claude, Llama, 200+ models', placeholder: 'sk-or-v1-...' },
  { key: 'nvidiaNimApiKey', label: 'NVIDIA NIM', color: 'green', url: 'build.nvidia.com', desc: '1000 free credits/month', placeholder: 'nvapi-...' },
  { key: 'openaiApiKey', label: 'OpenAI', color: 'emerald', url: 'platform.openai.com/api-keys', desc: 'GPT-4o, GPT-4, o1, o3', placeholder: 'sk-...' },
  { key: 'anthropicApiKey', label: 'Anthropic', color: 'orange', url: 'console.anthropic.com/keys', desc: 'Claude 4, Claude 3.5', placeholder: 'sk-ant-...' },
  { key: 'deepseekApiKey', label: 'DeepSeek', color: 'cyan', url: 'platform.deepseek.com/keys', desc: 'DeepSeek V3, Coder', placeholder: 'sk-...' },
  { key: 'geminiApiKey', label: 'Google Gemini', color: 'yellow', url: 'aistudio.google.com/apikey', desc: 'Gemini 2.5, 2.0 Flash', placeholder: 'AIza...' },
  { key: 'groqApiKey', label: 'Groq', color: 'purple', url: 'console.groq.com/keys', desc: 'Ultra-fast Llama, Mixtral', placeholder: 'gsk_...' },
  { key: 'togetherApiKey', label: 'Together AI', color: 'pink', url: 'api.together.xyz/settings/api-keys', desc: 'Open-source models, fine-tuning', placeholder: '' },
  { key: 'mistralApiKey', label: 'Mistral AI', color: 'red', url: 'console.mistral.ai/api-keys', desc: 'Mistral Large, Codestral', placeholder: '' },
  { key: 'cohereApiKey', label: 'Cohere', color: 'teal', url: 'dashboard.cohere.com/api-keys', desc: 'Command R+, Command R', placeholder: '' },
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
          <p className="text-[11px] text-dark-400">Configure API keys for model providers</p>
        </div>
        <button onClick={handleSave}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-brand-600 hover:bg-brand-700 rounded-lg transition-colors text-xs">
          <Save size={12} />
          {saved ? '✓ Saved!' : 'Save All'}
        </button>
      </div>

      <div className="bg-brand-600/10 border border-brand-500/30 rounded-lg p-3 mb-4">
        <p className="text-[11px] text-brand-300">
          Keys stored locally on your machine. Never sent anywhere except directly to provider APIs.
        </p>
      </div>

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
