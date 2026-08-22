/**
 * Michaelangelo Agent System - Lifecycle Manager
 * 
 * Manages the execution of lifecycle hooks across all registered plugins.
 * Hooks fire in registration order. Errors in one plugin don't block others.
 */

import { AgentPlugin, HookContext, LifecycleHook } from './types';

export class LifecycleManager {
  private plugins: AgentPlugin[] = [];

  /** Register a plugin */
  register(plugin: AgentPlugin): void {
    this.plugins.push(plugin);
    console.log(`[Lifecycle] Registered plugin: ${plugin.name}`);
  }

  /** Unregister a plugin by name */
  unregister(name: string): void {
    this.plugins = this.plugins.filter(p => p.name !== name);
    console.log(`[Lifecycle] Unregistered plugin: ${name}`);
  }

  /** Get all registered plugins */
  getPlugins(): AgentPlugin[] {
    return [...this.plugins];
  }

  /**
   * Fire a lifecycle hook across all enabled plugins.
   * Runs plugins sequentially but catches errors per-plugin.
   */
  async fire(hook: LifecycleHook, ctx: HookContext): Promise<void> {
    const enabledPlugins = this.plugins.filter(p => p.enabled && p.hooks[hook]);

    if (enabledPlugins.length === 0) return;

    console.log(`[Lifecycle] Firing ${hook} (${enabledPlugins.length} plugins)`);

    for (const plugin of enabledPlugins) {
      try {
        const handler = plugin.hooks[hook]!;
        await handler(ctx);
        console.log(`[Lifecycle] ${plugin.name}.${hook} completed`);
      } catch (err: any) {
        console.error(`[Lifecycle] ${plugin.name}.${hook} failed:`, err.message);
        // Don't throw — allow other plugins to continue
      }
    }
  }

  /**
   * Fire a hook and collect results from plugins.
   * Used for hooks that need to return data (e.g., injecting into system prompt).
   */
  async fireWithResult<T>(hook: LifecycleHook, ctx: HookContext, transform: (ctx: HookContext) => T): Promise<T[]> {
    const results: T[] = [];
    const enabledPlugins = this.plugins.filter(p => p.enabled && p.hooks[hook]);

    for (const plugin of enabledPlugins) {
      try {
        await plugin.hooks[hook]!(ctx);
        results.push(transform(ctx));
      } catch (err: any) {
        console.error(`[Lifecycle] ${plugin.name}.${hook} error:`, err.message);
      }
    }

    return results;
  }
}
