/**
 * FreebuffCC Agent System - Plugin Registry
 * 
 * Central registry for managing plugins.
 * Provides methods to register, enable, disable, and list plugins.
 */

import { AgentPlugin } from '../types';
import { LifecycleManager } from '../lifecycle';

export class PluginRegistry {
  private manager: LifecycleManager;
  private plugins: Map<string, AgentPlugin> = new Map();

  constructor(manager: LifecycleManager) {
    this.manager = manager;
  }

  /** Register a plugin with the lifecycle manager */
  add(plugin: AgentPlugin): void {
    if (this.plugins.has(plugin.name)) {
      console.warn(`[PluginRegistry] Plugin "${plugin.name}" already registered, replacing`);
    }
    this.plugins.set(plugin.name, plugin);
    this.manager.register(plugin);
  }

  /** Remove a plugin */
  remove(name: string): void {
    this.plugins.delete(name);
    this.manager.unregister(name);
  }

  /** Enable a plugin by name */
  enable(name: string): void {
    const plugin = this.plugins.get(name);
    if (plugin) {
      plugin.enabled = true;
      console.log(`[PluginRegistry] Enabled: ${name}`);
    }
  }

  /** Disable a plugin by name */
  disable(name: string): void {
    const plugin = this.plugins.get(name);
    if (plugin) {
      plugin.enabled = false;
      console.log(`[PluginRegistry] Disabled: ${name}`);
    }
  }

  /** Get all registered plugins */
  getAll(): AgentPlugin[] {
    return Array.from(this.plugins.values());
  }

  /** Get a plugin by name */
  get(name: string): AgentPlugin | undefined {
    return this.plugins.get(name);
  }

  /** Load all built-in plugins */
  loadBuiltins(): void {
    // Built-in plugins will be registered here as they're created
    console.log(`[PluginRegistry] Built-in plugins loaded (${this.plugins.size} total)`);
  }
}
