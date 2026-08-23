/**
 * Michaelangelo Plugin Marketplace Registry
 *
 * Manages available plugins, installation state, and tool registration.
 * Plugins extend the agent's capabilities with new tools and workflows.
 */

import Store from 'electron-store';

// ============================================================================
// TYPES
// ============================================================================

export interface PluginDefinition {
  id: string;
  name: string;
  description: string;
  author: string;
  version: string;
  category: 'productivity' | 'development' | 'devops' | 'ai' | 'data' | 'security';
  icon: string;
  downloads: number;
  tools: PluginTool[];
  dependencies?: string[];
}

export interface PluginTool {
  name: string;
  description: string;
  parameters: Record<string, any>;
}

export interface InstalledPlugin {
  id: string;
  installedAt: number;
  enabled: boolean;
}

// ============================================================================
// BUILT-IN PLUGIN CATALOG
// ============================================================================

const PLUGIN_CATALOG: PluginDefinition[] = [
  {
    id: 'github-integration',
    name: 'GitHub Integration',
    description: 'Create repos, open PRs, manage issues, and review code directly from the agent.',
    author: 'michaelangelo',
    version: '1.0.0',
    category: 'development',
    icon: '🐙',
    downloads: 12400,
    tools: [
      { name: 'gh_create_repo', description: 'Create a new GitHub repository', parameters: { name: { type: 'string' }, description: { type: 'string' }, private: { type: 'boolean' } } },
      { name: 'gh_open_pr', description: 'Open a pull request', parameters: { title: { type: 'string' }, body: { type: 'string' }, branch: { type: 'string' } } },
      { name: 'gh_list_issues', description: 'List repository issues', parameters: { state: { type: 'string' }, labels: { type: 'string' } } },
      { name: 'gh_review_pr', description: 'Review a pull request with comments', parameters: { pr_number: { type: 'number' }, review: { type: 'string' } } },
    ],
  },
  {
    id: 'docker-manager',
    name: 'Docker Manager',
    description: 'Build, run, and manage Docker containers and compose stacks.',
    author: 'michaelangelo',
    version: '1.0.0',
    category: 'devops',
    icon: '🐳',
    downloads: 8200,
    tools: [
      { name: 'docker_build', description: 'Build a Docker image', parameters: { tag: { type: 'string' }, dockerfile: { type: 'string' }, context: { type: 'string' } } },
      { name: 'docker_run', description: 'Run a Docker container', parameters: { image: { type: 'string' }, ports: { type: 'string' }, env: { type: 'string' } } },
      { name: 'docker_compose', description: 'Run docker-compose commands', parameters: { action: { type: 'string' }, service: { type: 'string' } } },
      { name: 'docker_logs', description: 'Get container logs', parameters: { container: { type: 'string' }, tail: { type: 'number' } } },
    ],
  },
  {
    id: 'database-tools',
    name: 'Database Tools',
    description: 'Query databases, run migrations, and manage schemas for Postgres, MySQL, SQLite.',
    author: 'community',
    version: '2.1.0',
    category: 'data',
    icon: '🗄️',
    downloads: 15600,
    tools: [
      { name: 'db_query', description: 'Run a SQL query', parameters: { connection: { type: 'string' }, query: { type: 'string' } } },
      { name: 'db_migrate', description: 'Run database migrations', parameters: { direction: { type: 'string' }, steps: { type: 'number' } } },
      { name: 'db_schema', description: 'Show database schema', parameters: { table: { type: 'string' } } },
    ],
  },
  {
    id: 'test-runner',
    name: 'Test Runner',
    description: 'Run tests across Jest, Vitest, Pytest, Go test with smart filtering and coverage.',
    author: 'michaelangelo',
    version: '1.2.0',
    category: 'development',
    icon: '🧪',
    downloads: 22100,
    tools: [
      { name: 'test_run', description: 'Run test suite with optional file/pattern filter', parameters: { pattern: { type: 'string' }, coverage: { type: 'boolean' } } },
      { name: 'test_watch', description: 'Run tests in watch mode', parameters: { pattern: { type: 'string' } } },
      { name: 'test_report', description: 'Generate test report', parameters: { format: { type: 'string' } } },
    ],
  },
  {
    id: 'security-scanner',
    name: 'Security Scanner',
    description: 'Scan dependencies for vulnerabilities, check for secrets in code, and audit configurations.',
    author: 'community',
    version: '1.5.0',
    category: 'security',
    icon: '🛡️',
    downloads: 9800,
    tools: [
      { name: 'scan_deps', description: 'Scan dependencies for known vulnerabilities', parameters: {} },
      { name: 'scan_secrets', description: 'Check codebase for hardcoded secrets and API keys', parameters: { directory: { type: 'string' } } },
      { name: 'scan_config', description: 'Audit security configuration', parameters: { type: { type: 'string' } } },
    ],
  },
  {
    id: 'api-testing',
    name: 'API Testing',
    description: 'Test REST and GraphQL APIs with automated request builders and response validation.',
    author: 'community',
    version: '1.3.0',
    category: 'development',
    icon: '🔌',
    downloads: 11200,
    tools: [
      { name: 'api_request', description: 'Send an HTTP request', parameters: { method: { type: 'string' }, url: { type: 'string' }, body: { type: 'string' }, headers: { type: 'string' } } },
      { name: 'api_validate', description: 'Validate API response against schema', parameters: { url: { type: 'string' }, schema: { type: 'string' } } },
    ],
  },
  {
    id: 'code-metrics',
    name: 'Code Metrics',
    description: 'Measure code complexity, coverage, duplication, and maintainability scores.',
    author: 'community',
    version: '1.0.0',
    category: 'productivity',
    icon: '📊',
    downloads: 6400,
    tools: [
      { name: 'metrics_complexity', description: 'Measure cyclomatic complexity of files', parameters: { files: { type: 'string' } } },
      { name: 'metrics_coverage', description: 'Show test coverage report', parameters: {} },
      { name: 'metrics_duplication', description: 'Find duplicated code blocks', parameters: { threshold: { type: 'number' } } },
    ],
  },
  {
    id: 'aws-tools',
    name: 'AWS Tools',
    description: 'Manage S3 buckets, Lambda functions, EC2 instances, and CloudFormation stacks.',
    author: 'community',
    version: '2.0.0',
    category: 'devops',
    icon: '☁️',
    downloads: 7300,
    tools: [
      { name: 'aws_s3_ls', description: 'List S3 bucket contents', parameters: { bucket: { type: 'string' }, prefix: { type: 'string' } } },
      { name: 'aws_lambda_invoke', description: 'Invoke a Lambda function', parameters: { function_name: { type: 'string' }, payload: { type: 'string' } } },
      { name: 'aws_cf_deploy', description: 'Deploy CloudFormation stack', parameters: { stack_name: { type: 'string' }, template: { type: 'string' } } },
    ],
  },
];

// ============================================================================
// PLUGIN REGISTRY
// ============================================================================

// ============================================================================
// ORIGINAL PLUGIN REGISTRY (used by Orchestrator for lifecycle hooks)
// ============================================================================

import { AgentPlugin, HookContext } from '../types';
import { LifecycleManager } from '../lifecycle';

export class PluginRegistry {
  private plugins: Map<string, AgentPlugin> = new Map();
  private lifecycle: LifecycleManager;

  constructor(lifecycle: LifecycleManager) {
    this.lifecycle = lifecycle;
  }

  add(plugin: AgentPlugin): void {
    this.plugins.set(plugin.name, plugin);
    // LifecycleManager uses register() — it calls fire() for each hook
    this.lifecycle.register(plugin);
    console.log(`[PluginRegistry] Added: ${plugin.name} v${plugin.version}`);
  }

  remove(name: string): void {
    this.plugins.delete(name);
  }

  get(name: string): AgentPlugin | undefined {
    return this.plugins.get(name);
  }

  getAll(): AgentPlugin[] {
    return Array.from(this.plugins.values());
  }

  enable(name: string): void {
    const p = this.plugins.get(name);
    if (p) p.enabled = true;
  }

  disable(name: string): void {
    const p = this.plugins.get(name);
    if (p) p.enabled = false;
  }
}


export class MarketplaceRegistry {
  private store: Store;
  private installedPlugins: Map<string, InstalledPlugin> = new Map();

  constructor() {
    this.store = new Store({ name: 'michaelangelo-plugins' });
    this.loadInstalled();
  }

  /** Load installed plugins from persistent store */
  private loadInstalled(): void {
    const data = this.store.get('installed', []) as InstalledPlugin[];
    for (const p of data) {
      this.installedPlugins.set(p.id, p);
    }
  }

  /** Save installed plugins to persistent store */
  private saveInstalled(): void {
    this.store.set('installed', Array.from(this.installedPlugins.values()));
  }

  /** Get all available plugins with install status */
  getAll(): (PluginDefinition & { installed: boolean; enabled: boolean })[] {
    return PLUGIN_CATALOG.map(p => {
      const installed = this.installedPlugins.get(p.id);
      return {
        ...p,
        installed: !!installed,
        enabled: installed?.enabled ?? false,
      };
    });
  }

  /** Get plugins filtered by category */
  getByCategory(category: string): (PluginDefinition & { installed: boolean; enabled: boolean })[] {
    return this.getAll().filter(p => p.category === category);
  }

  /** Search plugins by name or description */
  search(query: string): (PluginDefinition & { installed: boolean; enabled: boolean })[] {
    const q = query.toLowerCase();
    return this.getAll().filter(p =>
      p.name.toLowerCase().includes(q) ||
      p.description.toLowerCase().includes(q) ||
      p.category.toLowerCase().includes(q)
    );
  }

  /** Install a plugin */
  install(pluginId: string): boolean {
    const plugin = PLUGIN_CATALOG.find(p => p.id === pluginId);
    if (!plugin) return false;
    if (this.installedPlugins.has(pluginId)) return false;

    this.installedPlugins.set(pluginId, {
      id: pluginId,
      installedAt: Date.now(),
      enabled: true,
    });
    this.saveInstalled();
    console.log(`[PluginRegistry] Installed: ${plugin.name}`);
    return true;
  }

  /** Uninstall a plugin */
  uninstall(pluginId: string): boolean {
    if (!this.installedPlugins.has(pluginId)) return false;
    this.installedPlugins.delete(pluginId);
    this.saveInstalled();
    console.log(`[PluginRegistry] Uninstalled: ${pluginId}`);
    return true;
  }

  /** Toggle plugin enabled/disabled */
  toggle(pluginId: string): boolean {
    const installed = this.installedPlugins.get(pluginId);
    if (!installed) return false;
    installed.enabled = !installed.enabled;
    this.saveInstalled();
    return true;
  }

  /** Get tools from all enabled installed plugins */
  getEnabledTools(): { name: string; description: string; parameters: Record<string, any> }[] {
    const tools: { name: string; description: string; parameters: Record<string, any> }[] = [];
    for (const [id, installed] of this.installedPlugins) {
      if (!installed.enabled) continue;
      const plugin = PLUGIN_CATALOG.find(p => p.id === id);
      if (plugin) {
        for (const tool of plugin.tools) {
          tools.push({ name: tool.name, description: tool.description, parameters: tool.parameters });
        }
      }
    }
    return tools;
  }

  /** Get stats */
  getStats(): { total: number; installed: number; enabled: number; totalTools: number } {
    const all = this.getAll();
    const installed = all.filter(p => p.installed);
    const enabled = installed.filter(p => p.enabled);
    const totalTools = enabled.reduce((sum, p) => {
      const plugin = PLUGIN_CATALOG.find(cp => cp.id === p.id);
      return sum + (plugin?.tools.length || 0);
    }, 0);
    return { total: all.length, installed: installed.length, enabled: enabled.length, totalTools };
  }
}

// ============================================================================
// SINGLETON
// ============================================================================

let instance: MarketplaceRegistry | null = null;

export function getPluginRegistry(): MarketplaceRegistry {
  if (!instance) instance = new MarketplaceRegistry();
  return instance;
}
