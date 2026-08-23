/**
 * Michaelangelo Agent - MCP SSE Transport Client
 *
 * Implements the MCP SSE (Server-Sent Events) transport for connecting
 * to HTTP-based MCP servers. Handles the SSE event stream for server→client
 * messages and HTTP POST for client→server messages.
 *
 * MCP SSE Protocol:
 * 1. Client connects to server's SSE endpoint (GET /sse)
 * 2. Server sends an "endpoint" event with the POST URL
 * 3. Client sends JSON-RPC requests via POST to that endpoint
 * 4. Server sends JSON-RPC responses back via SSE stream
 */

import { MCPServerConfig, MCPTool, ToolDefinition } from '../types';
import { EventEmitter } from 'events';

// ============================================================================
// SSE CLIENT
// ============================================================================

export interface SSEConnection {
  config: MCPServerConfig;
  tools: MCPTool[];
  connected: boolean;
  requestId: number;
  endpointUrl: string;
  pendingRequests: Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>;
  abortController?: AbortController;
}

export class MCPSSEClient {
  private connections: Map<string, SSEConnection> = new Map();
  private events = new EventEmitter();

  /** Connect to an MCP server via SSE */
  async connect(config: MCPServerConfig): Promise<SSEConnection> {
    if (!config.url) throw new Error('SSE transport requires a URL');

    console.log(`[MCP-SSE] Connecting to ${config.name} at ${config.url}`);

    const conn: SSEConnection = {
      config,
      tools: [],
      connected: false,
      requestId: 0,
      endpointUrl: '',
      pendingRequests: new Map(),
    };

    this.connections.set(config.name, conn);

    // Start SSE connection
    const abortController = new AbortController();
    conn.abortController = abortController;

    try {
      const sseUrl = config.url.endsWith('/') ? `${config.url}sse` : `${config.url}/sse`;
      const response = await fetch(sseUrl, {
        signal: abortController.signal,
        headers: {
          'Accept': 'text/event-stream',
          'Cache-Control': 'no-cache',
        },
      });

      if (!response.ok) {
        throw new Error(`SSE connection failed: ${response.status} ${response.statusText}`);
      }

      conn.connected = true;

      // Process SSE stream
      this.processSSEStream(conn, response).catch(err => {
        console.error(`[MCP-SSE:${config.name}] Stream error:`, err.message);
        conn.connected = false;
      });

      // Wait for endpoint event (should arrive within 5 seconds)
      const endpointReceived = await new Promise<boolean>((resolve) => {
        const timeout = setTimeout(() => resolve(false), 5000);
        conn.pendingRequests.set(-1, {
          resolve: () => { clearTimeout(timeout); resolve(true); },
          reject: () => { clearTimeout(timeout); resolve(false); },
        });
      });

      if (!endpointReceived || !conn.endpointUrl) {
        throw new Error('SSE endpoint event not received within timeout');
      }

      console.log(`[MCP-SSE:${config.name}] Connected, endpoint: ${conn.endpointUrl}`);

      // Initialize handshake
      await this.sendRequest(config.name, 'initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'Michaelangelo', version: '1.0.0' },
      });

      // Notify initialized
      this.sendNotification(config.name, 'notifications/initialized', {});

      // Discover tools
      await this.discoverTools(config.name);

      return conn;
    } catch (err) {
      conn.connected = false;
      throw err;
    }
  }

  /** Process the SSE event stream */
  private async processSSEStream(conn: SSEConnection, response: Response): Promise<void> {
    const reader = response.body?.getReader();
    if (!reader) return;

    const decoder = new TextDecoder();
    let buffer = '';
    let eventType = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('event: ')) {
            eventType = line.substring(7).trim();
          } else if (line.startsWith('data: ')) {
            const data = line.substring(6);
            this.handleSSEEvent(conn, eventType, data);
            eventType = '';
          } else if (line.trim() === '') {
            // Empty line = end of event
            eventType = '';
          }
        }
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        console.error(`[MCP-SSE:${conn.config.name}] Stream read error:`, err.message);
      }
    }
  }

  /** Handle a parsed SSE event */
  private handleSSEEvent(conn: SSEConnection, eventType: string, data: string): void {
    try {
      if (eventType === 'endpoint') {
        // Server sends the POST endpoint URL
        conn.endpointUrl = data.trim();
        // Resolve the endpoint waiter
        const waiter = conn.pendingRequests.get(-1);
        if (waiter) {
          conn.pendingRequests.delete(-1);
          waiter.resolve(undefined);
        }
      } else {
        // JSON-RPC message
        const msg = JSON.parse(data);
        if (msg.id !== undefined) {
          const pending = conn.pendingRequests.get(msg.id);
          if (pending) {
            conn.pendingRequests.delete(msg.id);
            if (msg.error) pending.reject(new Error(msg.error.message));
            else pending.resolve(msg.result);
          }
        }
        // Handle notifications from server
        if (msg.method) {
          this.events.emit(`${conn.config.name}:${msg.method}`, msg.params);
        }
      }
    } catch { /* ignore parse errors */ }
  }

  /** Send a JSON-RPC request via POST */
  private async sendRequest(serverId: string, method: string, params: any): Promise<any> {
    const conn = this.connections.get(serverId);
    if (!conn || !conn.connected || !conn.endpointUrl) {
      throw new Error(`MCP server ${serverId} not connected`);
    }

    return new Promise((resolve, reject) => {
      const id = ++conn.requestId;
      conn.pendingRequests.set(id, { resolve, reject });

      // POST the JSON-RPC request to the endpoint
      fetch(conn.endpointUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
      }).catch(err => {
        conn.pendingRequests.delete(id);
        reject(err);
      });

      // Timeout after 30s
      setTimeout(() => {
        if (conn.pendingRequests.has(id)) {
          conn.pendingRequests.delete(id);
          reject(new Error(`Request timeout: ${method}`));
        }
      }, 30000);
    });
  }

  /** Send a JSON-RPC notification (no response) */
  private sendNotification(serverId: string, method: string, params: any): void {
    const conn = this.connections.get(serverId);
    if (!conn || !conn.connected || !conn.endpointUrl) return;

    fetch(conn.endpointUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method, params }),
    }).catch(err => {
      console.error(`[MCP-SSE] Notification failed:`, err.message);
    });
  }

  /** Discover tools from the server */
  private async discoverTools(serverId: string): Promise<void> {
    try {
      const result = await this.sendRequest(serverId, 'tools/list', {});
      const conn = this.connections.get(serverId);
      if (!conn) return;

      conn.tools = (result.tools || []).map((t: any) => ({
        serverId,
        function: {
          type: 'function' as const,
          function: {
            name: `${serverId}__${t.name}`,
            description: t.description || '',
            parameters: t.inputSchema || { type: 'object', properties: {}, required: [] },
          },
        },
      }));

      console.log(`[MCP-SSE:${serverId}] Discovered ${conn.tools.length} tools`);
    } catch (err: any) {
      console.error(`[MCP-SSE:${serverId}] Tool discovery failed:`, err.message);
    }
  }

  /** Call an MCP tool via SSE */
  async callTool(serverId: string, toolName: string, args: Record<string, any>): Promise<string> {
    const conn = this.connections.get(serverId);
    if (!conn || !conn.connected) throw new Error(`MCP server ${serverId} not connected`);

    const result = await this.sendRequest(serverId, 'tools/call', {
      name: toolName,
      arguments: args,
    });
    return result.content?.map((c: any) => c.text).join('\n') || JSON.stringify(result);
  }

  /** Get all tools from all connected SSE servers */
  getAllTools(): MCPTool[] {
    const tools: MCPTool[] = [];
    for (const conn of this.connections.values()) {
      if (conn.connected) tools.push(...conn.tools);
    }
    return tools;
  }

  /** Disconnect from a server */
  async disconnect(serverId: string): Promise<void> {
    const conn = this.connections.get(serverId);
    if (!conn) return;
    conn.connected = false;
    conn.abortController?.abort();
    conn.pendingRequests.forEach(p => p.reject(new Error('Disconnected')));
    conn.pendingRequests.clear();
    this.connections.delete(serverId);
    console.log(`[MCP-SSE:${serverId}] Disconnected`);
  }

  /** Disconnect from all servers */
  async disconnectAll(): Promise<void> {
    for (const id of [...this.connections.keys()]) {
      await this.disconnect(id);
    }
  }

  /** Get event emitter for server notifications */
  getEvents(): EventEmitter {
    return this.events;
  }
}
