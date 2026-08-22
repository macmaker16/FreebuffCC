/**
 * Michaelangelo Agent - Sub-Agent Manager
 * Spawns parallel background agents for concurrent task execution.
 * The "Lead Agent" architecture: spawn sub-agents, collect results, merge.
 */

import { SubAgentTask, OrchestratorConfig, ChatMessage } from '../types';
import { Orchestrator } from '../orchestrator';

export class SubAgentManager {
  private activeTasks: Map<string, { task: SubAgentTask; controller: AbortController }> = new Map();
  private config: OrchestratorConfig;

  constructor(config: OrchestratorConfig) {
    this.config = config;
  }

  /**
   * Spawn a sub-agent to work on a specific task.
   * Returns immediately with a task ID.
   */
  spawnSubAgent(
    description: string,
    prompt: string,
    workspace: string,
  ): string {
    const taskId = `sub_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    const controller = new AbortController();

    const task: SubAgentTask = {
      id: taskId,
      description,
      prompt,
      workspace,
      model: this.config.model,
      parentSessionId: this.config.model, // Will be set by caller
    };

    this.activeTasks.set(taskId, { task, controller });
    console.log(`[SubAgent] Spawned: ${taskId} — ${description}`);

    // Run in background (don't await)
    this.runSubAgent(taskId, controller).catch(err => {
      console.error(`[SubAgent] ${taskId} failed:`, err.message);
    });

    return taskId;
  }

  /** Execute a sub-agent task */
  private async runSubAgent(taskId: string, controller: AbortController): Promise<void> {
    const entry = this.activeTasks.get(taskId);
    if (!entry) return;

    const { task } = entry;
    const startTime = Date.now();

    try {
      const orchestrator = new Orchestrator({
        model: task.model,
        baseUrl: this.config.baseUrl,
        apiKey: this.config.apiKey,
        authPrefix: this.config.authPrefix,
        workspace: task.workspace,
        maxIterations: 15,
        enableMemory: false,
        enableMCP: false,
      });

      await orchestrator.init();

      const messages: ChatMessage[] = [
        { role: 'user', content: task.prompt },
      ];

      const result = await orchestrator.execute(messages);
      await orchestrator.shutdown();

      const finalContent = result.messages
        .filter(m => m.role === 'assistant' && m.content)
        .pop()?.content || 'Task completed';

      console.log(`[SubAgent] ${taskId} completed in ${Date.now() - startTime}ms`);
      // Store result (in a real implementation, this would be persisted)
    } catch (err: any) {
      console.error(`[SubAgent] ${taskId} error:`, err.message);
    } finally {
      this.activeTasks.delete(taskId);
    }
  }

  /** Cancel a running sub-agent */
  cancel(taskId: string): boolean {
    const entry = this.activeTasks.get(taskId);
    if (!entry) return false;
    entry.controller.abort();
    this.activeTasks.delete(taskId);
    console.log(`[SubAgent] Cancelled: ${taskId}`);
    return true;
  }

  /** Cancel all running sub-agents */
  cancelAll(): void {
    for (const [id, entry] of this.activeTasks) {
      entry.controller.abort();
      console.log(`[SubAgent] Cancelled: ${id}`);
    }
    this.activeTasks.clear();
  }

  /** Get status of all active sub-agents */
  getActiveTasks(): { id: string; description: string }[] {
    return [...this.activeTasks.values()].map(e => ({
      id: e.task.id,
      description: e.task.description,
    }));
  }

  /** Check if any sub-agents are running */
  hasActiveTasks(): boolean {
    return this.activeTasks.size > 0;
  }
}
