/**
 * Michaelangelo Agent - Event Bus
 *
 * Central event bus for broadcasting agent activity to the WebSocket dashboard.
 * All agent subsystems emit events here; the WebSocket server forwards them to clients.
 *
 * Event Types:
 * - agent_start / agent_end          — session lifecycle
 * - phase_change                     — 4-phase loop transitions
 * - tool_start / tool_complete       — individual tool executions
 * - llm_call / llm_response          — LLM API round-trips
 * - context_compression              — context window management
 * - error                            — errors and failures
 * - token_usage                      — token/cost tracking per iteration
 * - message                          — plain log messages
 */

export type AgentEventType =
  | 'agent_start' | 'agent_end'
  | 'phase_change'
  | 'tool_start' | 'tool_complete'
  | 'llm_call' | 'llm_response'
  | 'context_compression'
  | 'error'
  | 'token_usage'
  | 'message';

export interface AgentEvent {
  type: AgentEventType;
  timestamp: number;
  sessionId: string;
  data: Record<string, any>;
}

export type AgentEventListener = (event: AgentEvent) => void;

class AgentEventBus {
  private listeners: Map<AgentEventType | '*', AgentEventListener[]> = new Map();
  private recentEvents: AgentEvent[] = [];
  private maxRecent = 200;

  /** Subscribe to a specific event type or '*' for all events */
  on(type: AgentEventType | '*', listener: AgentEventListener): () => void {
    const list = this.listeners.get(type) || [];
    list.push(listener);
    this.listeners.set(type, list);
    return () => {
      const idx = list.indexOf(listener);
      if (idx >= 0) list.splice(idx, 1);
    };
  }

  /** Emit an event to all matching listeners */
  emit(type: AgentEventType, sessionId: string, data: Record<string, any> = {}): void {
    const event: AgentEvent = { type, timestamp: Date.now(), sessionId, data };

    // Store in recent buffer
    this.recentEvents.push(event);
    if (this.recentEvents.length > this.maxRecent) {
      this.recentEvents = this.recentEvents.slice(-this.maxRecent);
    }

    // Notify typed listeners
    const typed = this.listeners.get(type) || [];
    for (const fn of typed) {
      try { fn(event); } catch (err) { console.error(`[EventBus] Listener error:`, err); }
    }

    // Notify wildcard listeners
    const wildcard = this.listeners.get('*') || [];
    for (const fn of wildcard) {
      try { fn(event); } catch (err) { console.error(`[EventBus] Wildcard listener error:`, err); }
    }
  }

  /** Get recent events (for late-joining WebSocket clients) */
  getRecent(count = 50): AgentEvent[] {
    return this.recentEvents.slice(-count);
  }

  /** Clear recent events buffer */
  clear(): void {
    this.recentEvents = [];
  }
}

// Singleton
export const agentEventBus = new AgentEventBus();
