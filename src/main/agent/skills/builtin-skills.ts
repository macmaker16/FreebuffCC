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
  // UI/UX Design Skills
  {
    name: 'design-landing',
    description: 'Create a stunning, conversion-optimized landing page with hero, features, testimonials, CTA, and footer',
    trigger: '/design-landing',
    parameters: [
      { name: 'product_name', type: 'string', description: 'Name of the product or service', required: false },
      { name: 'style', type: 'string', description: 'Style: modern, minimal, bold, corporate, playful', required: false },
    ],
    steps: [
      { action: 'read_file', args: { file_path: 'package.json' }, description: 'Check project dependencies' },
      { action: 'write_file', args: { file_path: 'src/components/Hero.tsx', content: '{{hero_component}}' }, description: 'Create hero section' },
      { action: 'write_file', args: { file_path: 'src/components/Features.tsx', content: '{{features_component}}' }, description: 'Create features section' },
      { action: 'write_file', args: { file_path: 'src/components/Testimonials.tsx', content: '{{testimonials_component}}' }, description: 'Create testimonials section' },
      { action: 'write_file', args: { file_path: 'src/components/CTA.tsx', content: '{{cta_component}}' }, description: 'Create call-to-action section' },
      { action: 'write_file', args: { file_path: 'src/components/Footer.tsx', content: '{{footer_component}}' }, description: 'Create footer section' },
    ],
  },
  {
    name: 'design-dashboard',
    description: 'Create a professional admin dashboard with sidebar, charts, tables, and stats cards',
    trigger: '/design-dashboard',
    parameters: [
      { name: 'app_name', type: 'string', description: 'Name of the dashboard', required: false },
      { name: 'theme', type: 'string', description: 'Theme: dark, light, gradient', required: false },
    ],
    steps: [
      { action: 'write_file', args: { file_path: 'src/components/Sidebar.tsx', content: '{{sidebar_component}}' }, description: 'Create sidebar navigation' },
      { action: 'write_file', args: { file_path: 'src/components/StatsCard.tsx', content: '{{stats_component}}' }, description: 'Create stats cards' },
      { action: 'write_file', args: { file_path: 'src/components/DataTable.tsx', content: '{{table_component}}' }, description: 'Create data table' },
      { action: 'write_file', args: { file_path: 'src/components/Chart.tsx', content: '{{chart_component}}' }, description: 'Create chart component' },
    ],
  },
  {
    name: 'design-form',
    description: 'Create a beautiful, accessible form with validation, error states, and micro-interactions',
    trigger: '/design-form',
    parameters: [
      { name: 'form_type', type: 'string', description: 'Type: login, signup, contact, checkout, profile', required: false },
    ],
    steps: [
      { action: 'write_file', args: { file_path: 'src/components/Form.tsx', content: '{{form_component}}' }, description: 'Create form component' },
      { action: 'write_file', args: { file_path: 'src/components/FormField.tsx', content: '{{formfield_component}}' }, description: 'Create form field component' },
    ],
  },
  {
    name: 'design-card',
    description: 'Create a beautiful card component with hover effects, gradients, and animations',
    trigger: '/design-card',
    parameters: [
      { name: 'card_type', type: 'string', description: 'Type: product, profile, pricing, feature, blog', required: false },
    ],
    steps: [
      { action: 'write_file', args: { file_path: 'src/components/Card.tsx', content: '{{card_component}}' }, description: 'Create card component' },
    ],
  },
  {
    name: 'design-theme',
    description: 'Generate a complete design system with colors, typography, spacing, and component tokens',
    trigger: '/design-theme',
    parameters: [
      { name: 'style', type: 'string', description: 'Style: modern, minimal, corporate, playful, elegant', required: false },
      { name: 'primary_color', type: 'string', description: 'Primary color (e.g., #6366f1, blue, purple)', required: false },
    ],
    steps: [
      { action: 'write_file', args: { file_path: 'src/styles/theme.ts', content: '{{theme_file}}' }, description: 'Create theme tokens' },
      { action: 'write_file', args: { file_path: 'src/styles/globals.css', content: '{{global_styles}}' }, description: 'Create global styles' },
    ],
  },
  {
    name: 'design-responsive',
    description: 'Audit and fix responsive design issues across all breakpoints',
    trigger: '/design-responsive',
    parameters: [],
    steps: [
      { action: 'run_command', args: { command: 'browser_navigate http://localhost:3000' }, description: 'Open the app' },
      { action: 'run_command', args: { command: 'browser_emulate iPhone 14' }, description: 'Test mobile view' },
      { action: 'run_command', args: { command: 'browser_screenshot' }, description: 'Capture mobile screenshot' },
      { action: 'run_command', args: { command: 'browser_emulate iPad' }, description: 'Test tablet view' },
      { action: 'run_command', args: { command: 'browser_screenshot' }, description: 'Capture tablet screenshot' },
    ],
  },
  {
    name: 'design-accessibility',
    description: 'Check and fix accessibility issues (WCAG 2.1 AA compliance)',
    trigger: '/design-accessibility',
    parameters: [],
    steps: [
      { action: 'run_command', args: { command: 'browser_navigate http://localhost:3000' }, description: 'Open the app' },
      { action: 'run_command', args: { command: 'browser_evaluate document.querySelectorAll("[aria-label]").length + " aria labels found"' }, description: 'Check ARIA labels' },
      { action: 'run_command', args: { command: 'browser_evaluate document.querySelectorAll("img:not([alt])").length + " images missing alt text"' }, description: 'Check alt text' },
      { action: 'run_command', args: { command: 'browser_evaluate Array.from(document.querySelectorAll("button, a, input")).filter(el => !el.getAttribute("aria-label") && !el.textContent.trim()).length + " interactive elements without labels"' }, description: 'Check interactive labels' },
    ],
  },
  {
    name: 'design-animation',
    description: 'Add smooth animations and micro-interactions to existing components',
    trigger: '/design-animation',
    parameters: [
      { name: 'target', type: 'string', description: 'Target component or page', required: false },
    ],
    steps: [
      { action: 'search_files', args: { pattern: 'className', file_pattern: '*.tsx' }, description: 'Find components with classes' },
    ],
  },
  // Claude Code Superpower Skills
  {
    name: 'tdd',
    description: 'Test-Driven Development: Red-Green-Refactor loop. Write a failing test first, then minimal code to pass, then refactor.',
    trigger: '/tdd',
    parameters: [
      { name: 'feature', type: 'string', description: 'Feature or bug to build test-first', required: false },
    ],
    steps: [
      { action: 'search_files', args: { pattern: 'describe\(|test\(|it\(' }, description: 'Find existing test patterns' },
      { action: 'read_file', args: { file_path: 'package.json' }, description: 'Check test framework' },
      { action: 'run_command', args: { command: 'npm test -- --listTests 2>/dev/null | head -5' }, description: 'Verify test runner works' },
    ],
  },
  {
    name: 'diagnosing-bugs',
    description: 'Six-phase bug diagnosis: build repro, minimize, rank hypotheses, instrument, fix with regression test, clean up.',
    trigger: '/diagnose',
    parameters: [
      { name: 'bug_description', type: 'string', description: 'Description of the bug or error', required: false },
    ],
    steps: [
      { action: 'search_files', args: { pattern: '{{bug_description}}' }, description: 'Search for error references' },
      { action: 'run_command', args: { command: 'git log --oneline -10' }, description: 'Check recent changes' },
      { action: 'run_command', args: { command: 'git diff HEAD~3 --stat' }, description: 'See what changed recently' },
    ],
  },
  {
    name: 'code-review',
    description: 'Deep code review: check spec compliance, repo standards, error handling, performance, and security.',
    trigger: '/review',
    parameters: [
      { name: 'scope', type: 'string', description: 'File or directory to review', required: false },
    ],
    steps: [
      { action: 'run_command', args: { command: 'git diff --staged --stat' }, description: 'Check staged changes' },
      { action: 'run_command', args: { command: 'git diff --stat' }, description: 'Check unstaged changes' },
      { action: 'search_files', args: { pattern: 'TODO|FIXME|HACK|XXX' }, description: 'Find TODO markers' },
    ],
  },
  {
    name: 'improve-architecture',
    description: 'Analyze and improve codebase architecture: identify coupling, suggest modules, improve separation of concerns.',
    trigger: '/architect',
    parameters: [],
    steps: [
      { action: 'list_files', args: { dir_path: 'src', max_depth: '3' }, description: 'Map project structure' },
      { action: 'search_files', args: { pattern: 'import.*from', file_pattern: '*.ts' }, description: 'Analyze import graph' },
      { action: 'run_command', args: { command: 'find src -name "*.ts" | wc -l' }, description: 'Count source files' },
    ],
  },
  {
    name: 'debug',
    description: 'Systematic debugging: reproduce, isolate, hypothesis-test, fix, verify. Never guess — always reproduce first.',
    trigger: '/debug',
    parameters: [
      { name: 'issue', type: 'string', description: 'The issue to debug', required: false },
    ],
    steps: [
      { action: 'run_command', args: { command: 'git status' }, description: 'Check working state' },
      { action: 'search_files', args: { pattern: '{{issue}}' }, description: 'Search for issue references' },
      { action: 'run_command', args: { command: 'npm test 2>&1 | tail -20' }, description: 'Run tests to see failures' },
    ],
  },
  {
    name: 'verify',
    description: 'Verification before completion: run tests, check types, lint, build, and confirm all requirements are met.',
    trigger: '/verify',
    parameters: [],
    steps: [
      { action: 'run_command', args: { command: 'npx tsc --noEmit 2>&1 | tail -10' }, description: 'Type check' },
      { action: 'run_command', args: { command: 'npm test 2>&1 | tail -20' }, description: 'Run tests' },
      { action: 'run_command', args: { command: 'npm run build 2>&1 | tail -10' }, description: 'Build project' },
    ],
  },
  {
    name: 'write-plan',
    description: 'Create a structured execution plan before starting work. Forces thinking before coding.',
    trigger: '/plan',
    parameters: [
      { name: 'goal', type: 'string', description: 'What you want to accomplish', required: false },
    ],
    steps: [
      { action: 'list_files', args: { dir_path: '.', max_depth: '2' }, description: 'Understand project structure' },
      { action: 'read_file', args: { file_path: 'README.md' }, description: 'Read project docs' },
    ],
  },
  {
    name: 'execute-plan',
    description: 'Execute a plan step by step, tracking progress and verifying each step before moving on.',
    trigger: '/execute',
    parameters: [
      { name: 'plan', type: 'string', description: 'Plan to execute (or reference to saved plan)', required: false },
    ],
    steps: [
      { action: 'run_command', args: { command: 'git status --short' }, description: 'Check current state' },
    ],
  },
  {
    name: 'grill-with-docs',
    description: 'Deep-dive into a specific part of the codebase with documentation lookup. Ask questions, trace flows, understand patterns.',
    trigger: '/grill',
    parameters: [
      { name: 'topic', type: 'string', description: 'Topic or module to investigate', required: false },
    ],
    steps: [
      { action: 'search_files', args: { pattern: '{{topic}}' }, description: 'Find all references' },
      { action: 'list_files', args: { dir_path: 'src', max_depth: '2' }, description: 'Map related files' },
    ],
  },
  {
    name: 'subagent-dispatch',
    description: 'Spawn isolated sub-agents for parallel research tasks. Each gets its own context window.',
    trigger: '/dispatch',
    parameters: [
      { name: 'task', type: 'string', description: 'Task for the sub-agent', required: false },
    ],
    steps: [],
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
