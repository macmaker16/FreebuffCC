/**
 * Michaelangelo - Skills View
 *
 * Displays all available built-in and custom skills.
 * Users can browse, search, and run skills directly from this view.
 */

import React, { useState, useEffect } from 'react';
import { Wrench, Play, Search, ChevronRight, Zap, Terminal, FileCode, Bug, TestTube, Broom, Shield, Globe } from 'lucide-react';

interface Skill {
  name: string;
  description: string;
  trigger: string;
  category: string;
  icon?: string;
}

const BUILTIN_SKILLS: Skill[] = [
  // Claude Code Superpowers
  { name: 'tdd', description: 'Test-Driven Development: Red-Green-Refactor loop. Write failing test first, minimal code to pass, refactor.', trigger: '/tdd', category: 'superpower', icon: '🔴' },
  { name: 'diagnosing-bugs', description: 'Six-phase bug diagnosis: repro, minimize, hypotheses, instrument, fix, regression test.', trigger: '/diagnose', category: 'superpower', icon: '🔬' },
  { name: 'code-review', description: 'Deep code review: spec compliance, repo standards, error handling, performance, security.', trigger: '/review', category: 'superpower', icon: '📋' },
  { name: 'improve-architecture', description: 'Analyze and improve codebase architecture: coupling, modules, separation of concerns.', trigger: '/architect', category: 'superpower', icon: '🏗️' },
  { name: 'debug', description: 'Systematic debugging: reproduce, isolate, hypothesis-test, fix, verify. Never guess.', trigger: '/debug', category: 'superpower', icon: '🔍' },
  { name: 'verify', description: 'Verification before completion: types, tests, lint, build, requirements check.', trigger: '/verify', category: 'superpower', icon: '✅' },
  { name: 'write-plan', description: 'Create structured execution plan before coding. Forces thinking before action.', trigger: '/plan', category: 'superpower', icon: '📝' },
  { name: 'execute-plan', description: 'Execute a plan step by step with progress tracking and verification.', trigger: '/execute', category: 'superpower', icon: '⚡' },
  { name: 'grill-with-docs', description: 'Deep-dive into codebase with documentation lookup. Trace flows, understand patterns.', trigger: '/grill', category: 'superpower', icon: '🔎' },
  { name: 'subagent-dispatch', description: 'Spawn isolated sub-agents for parallel research tasks.', trigger: '/dispatch', category: 'superpower', icon: '🤖' },
  // Standard Skills
  { name: 'review-pr', description: 'Review all staged changes, check for bugs, style issues, and provide a code review summary', trigger: '/review-pr', category: 'code-quality', icon: '🔍' },
  { name: 'fix-bugs', description: 'Find and fix bugs by analyzing error output, reading relevant files, and applying fixes', trigger: '/fix-bugs', category: 'debugging', icon: '🐛' },
  { name: 'explain', description: 'Explain the current project structure, dependencies, and architecture', trigger: '/explain', category: 'learning', icon: '📖' },
  { name: 'test-all', description: 'Run all tests in the project and report results', trigger: '/test-all', category: 'testing', icon: '🧪' },
  { name: 'clean-build', description: 'Clean and rebuild the project from scratch', trigger: '/clean-build', category: 'devops', icon: '🔨' },
];

const CATEGORY_COLORS: Record<string, string> = {
  'superpower': 'bg-gradient-to-r from-purple-500/20 to-pink-500/20 text-purple-300 border border-purple-500/30',
  'code-quality': 'bg-blue-500/20 text-blue-400',
  'debugging': 'bg-red-500/20 text-red-400',
  'learning': 'bg-green-500/20 text-green-400',
  'testing': 'bg-yellow-500/20 text-yellow-400',
  'devops': 'bg-purple-500/20 text-purple-400',
  'security': 'bg-orange-500/20 text-orange-400',
  'automation': 'bg-cyan-500/20 text-cyan-400',
};

export default function SkillsView() {
  const [search, setSearch] = useState('');
  const [skills, setSkills] = useState<Skill[]>(BUILTIN_SKILLS);
  const [runningSkill, setRunningSkill] = useState<string | null>(null);

  // Load custom skills from workspace
  useEffect(() => {
    fetch('http://127.0.0.1:0/api/skills')
      .then(r => r.json())
      .then(data => {
        if (data.skills) setSkills([...BUILTIN_SKILLS, ...data.skills]);
      })
      .catch(() => {});
  }, []);

  const filtered = skills.filter(s =>
    s.name.toLowerCase().includes(search.toLowerCase()) ||
    s.description.toLowerCase().includes(search.toLowerCase()) ||
    s.trigger.toLowerCase().includes(search.toLowerCase())
  );

  const handleRunSkill = async (skill: Skill) => {
    setRunningSkill(skill.trigger);
    // Send the skill trigger as a chat message
    try {
      const res = await fetch('http://127.0.0.1:0/api/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'auto',
          messages: [{ role: 'user', content: skill.trigger }],
        }),
      });
      await res.json();
    } catch {}
    setTimeout(() => setRunningSkill(null), 2000);
  };

  return (
    <div className="h-full flex flex-col bg-dark-950">
      {/* Header */}
      <div className="px-4 py-3 border-b border-dark-700">
        <div className="flex items-center gap-2 mb-2">
          <Wrench size={16} className="text-brand-400" />
          <h2 className="text-sm font-bold">Skills</h2>
          <span className="text-[12px] text-dark-500">{skills.length} available</span>
        </div>
        <p className="text-[12px] text-dark-400 mb-2">
          Reusable workflows that chain multiple tools together. Type the trigger command in chat to run.
        </p>
        <div className="relative">
          <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-dark-500" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search skills..."
            className="w-full pl-7 pr-3 py-1.5 bg-dark-800 border border-dark-700 rounded text-[13px] focus:outline-none focus:border-brand-500"
          />
        </div>
      </div>

      {/* Skills List */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {filtered.map(skill => (
          <div key={skill.trigger}
            className="bg-dark-900 border border-dark-700 rounded-lg p-3 hover:border-dark-600 transition-colors">
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-base">{skill.icon || '⚡'}</span>
                  <h3 className="text-xs font-semibold text-white">{skill.name}</h3>
                  <span className={`text-[10.5px] px-1.5 py-0.5 rounded ${CATEGORY_COLORS[skill.category] || 'bg-dark-700 text-dark-400'}`}>
                    {skill.category}
                  </span>
                </div>
                <p className="text-[12px] text-dark-400 mb-2">{skill.description}</p>
                <div className="flex items-center gap-2">
                  <code className="text-[12px] text-brand-400 bg-dark-800 px-1.5 py-0.5 rounded font-mono">
                    {skill.trigger}
                  </code>
                  <ChevronRight size={10} className="text-dark-600" />
                </div>
              </div>
              <button
                onClick={() => handleRunSkill(skill)}
                disabled={runningSkill === skill.trigger}
                className="flex items-center gap-1 px-2.5 py-1.5 bg-brand-600 hover:bg-brand-700 disabled:bg-dark-700 rounded text-[12px] text-white font-medium transition-colors ml-3"
              >
                {runningSkill === skill.trigger ? (
                  <div className="w-3 h-3 border border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  <Play size={10} />
                )}
                Run
              </button>
            </div>
          </div>
        ))}

        {filtered.length === 0 && (
          <div className="text-center py-8 text-dark-500">
            <Wrench size={24} className="mx-auto mb-2 opacity-50" />
            <p className="text-[13px]">No skills match "{search}"</p>
          </div>
        )}
      </div>

      {/* Create Custom Skill */}
      <div className="px-3 py-2 border-t border-dark-700">
        <p className="text-[10.5px] text-dark-500">
          Create custom skills: place a .json file in <code>.michaelangelo/skills/</code>
        </p>
      </div>
    </div>
  );
}
