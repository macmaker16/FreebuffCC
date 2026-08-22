/**
 * Michaelangelo Agent - Built-in Skills
 * Repeatable workflows callable by the model or user
 */

import { SkillDefinition } from '../types';

export const BUILTIN_SKILLS: SkillDefinition[] = [
  {
    name: 'review-pr',
    description: 'Review all staged changes, check for bugs, style issues, and provide a code review summary',
    trigger: '/review-pr',
    parameters: [],
    steps: [
      { action: 'run_command', args: { command: 'git diff --staged' }, description: 'Get staged changes' },
      { action: 'read_file', args: { file_path: '{{changed_file}}' }, description: 'Read changed files for context' },
    ],
  },
  {
    name: 'fix-bugs',
    description: 'Find and fix bugs by analyzing error output, reading relevant files, and applying fixes',
    trigger: '/fix-bugs',
    parameters: [
      { name: 'error_message', type: 'string', description: 'The error message or description of the bug', required: false },
    ],
    steps: [
      { action: 'search_files', args: { pattern: '{{error_message}}' }, description: 'Search for error references' },
    ],
  },
  {
    name: 'explain',
    description: 'Explain the current project structure, dependencies, and architecture',
    trigger: '/explain',
    parameters: [],
    steps: [
      { action: 'list_files', args: { dir_path: '.', max_depth: '2' }, description: 'List project structure' },
      { action: 'read_file', args: { file_path: 'package.json' }, description: 'Read package config' },
    ],
  },
  {
    name: 'test-all',
    description: 'Run all tests in the project and report results',
    trigger: '/test-all',
    parameters: [],
    steps: [
      { action: 'run_command', args: { command: 'npm test 2>&1 || yarn test 2>&1 || echo "No test script found"' }, description: 'Run tests' },
    ],
  },
  {
    name: 'clean-build',
    description: 'Clean and rebuild the project from scratch',
    trigger: '/clean-build',
    parameters: [],
    steps: [
      { action: 'run_command', args: { command: 'rm -rf node_modules dist build' }, description: 'Clean build artifacts' },
      { action: 'run_command', args: { command: 'npm install' }, description: 'Reinstall dependencies' },
      { action: 'run_command', args: { command: 'npm run build' }, description: 'Build project' },
    ],
  },
];

/**
 * Parse user input to detect skill triggers
 * e.g., "/review-pr" or "/fix-bugs TypeError: cannot read property"
 */
export function detectSkillTrigger(input: string): { skill: SkillDefinition; args: Record<string, string> } | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith('/')) return null;

  const parts = trimmed.split(/\s+/);
  const trigger = parts[0].toLowerCase();
  const remaining = parts.slice(1).join(' ');

  for (const skill of BUILTIN_SKILLS) {
    if (skill.trigger === trigger) {
      const args: Record<string, string> = {};
      if (remaining && skill.parameters.length > 0) {
        args[skill.parameters[0].name] = remaining;
      }
      return { skill, args };
    }
  }
  return null;
}

/**
 * Expand skill step templates with actual arguments
 */
export function expandSkillArgs(template: Record<string, string>, args: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(template)) {
    result[key] = value.replace(/\{\{(\w+)\}\}/g, (_, name) => args[name] || '');
  }
  return result;
}
