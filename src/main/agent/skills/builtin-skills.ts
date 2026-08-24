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
