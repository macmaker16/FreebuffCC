/**
 * Michaelangelo Agent - MCP Client Manager
 * Connects to external Model Context Protocol servers.
 * Dynamically loads tools from MCP servers into the agent's tool pool.
 */

import { MCPServerConfig, MCPTool, ToolDefinition } from '../types';
import { spawn, ChildProcess } from 'child_process';

interface MCPConnection {
  config: MCPServerConfig;
  process?: ChildProcess;
  tools: MCPTool[];
  connected: boolean;
  requestId: number;
  pendingRequests: Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>;
}

export class MCPClientManager {
  private connections: Map<string, MCPConnection> = new Map();

  /** Connect to an MCP server */
  async connect(config: MCPServerConfig): Promise<void> {
    console.log(`[MCP] Connecting to ${config.name} (${config.transport})`);

    if (config.transport === 'stdio') {
      await this.connectStdio(config);
    } else if (config.transport === 'sse') {
      await this.connectSSE(config);
    }
  }

  /** Connect via stdio (spawns a child process) */
  private async connectStdio(config: MCPServerConfig): Promise<void> {
    if (!config.command) throw new Error('stdio transport requires a command');

    const proc = spawn(config.command, config.args || [], {
      env: { ...process.env, ...config.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const conn: MCPConnection = {
      config,
      process: proc,
      tools: [],
      connected: true,
      requestId: 0,
      pendingRequests: new Map(),
    };

    this.connections.set(config.name, conn);

    // Handle stdout (JSON-RPC responses)
    let buffer = '';
    proc.stdout?.on('data', (data: Buffer) => {
      buffer += data.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (line.trim()) this.handleMessage(config.name, line.trim());
      }
    });

    proc.stderr?.on('data', (data: Buffer) => {
      console.error(`[MCP:${config.name}] stderr: ${data.toString().trim()}`);
    });

    proc.on('close', () => {
      conn.connected = false;
      console.log(`[MCP:${config.name}] Disconnected`);
    });

    // Initialize handshake
    await this.sendRequest(config.name, 'initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'Michaelangelo', version: '1.0.0' },
    });

    // Notify initialized
    await this.sendNotification(config.name, 'notifications/initialized', {});

    // Discover tools
    await this.discoverTools(config.name);
  }

  /** Connect via SSE (Server-Sent Events) */
  private async connectSSE(config: MCPServerConfig): Promise<void> {
    if (!config.url) throw new Error('SSE transport requires a URL');
    console.log(`[MCP:${config.name}] SSE transport not yet fully implemented, using HTTP fallback`);
    // SSE implementation would use EventSource or fetch with streaming
    // For now, mark as connected with no tools
    this.connections.set(config.name, {
      config,
      tools: [],
      connected: true,
      requestId: 0,
      pendingRequests: new Map(),
    });
  }

  /** Send a JSON-RPC request and wait for response */
  private sendRequest(serverId: string, method: string, params: any): Promise<any> {
    return new Promise((resolve, reject) => {
      const conn = this.connections.get(serverId);
      if (!conn || !conn.process) return reject(new Error('Not connected'));

      const id = ++conn.requestId;
      conn.pendingRequests.set(id, { resolve, reject });

      const request = JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n';
      conn.process.stdin?.write(request);

      // Timeout after 30s
      setTimeout(() => {
        if (conn.pendingRequests.has(id)) {
          conn.pendingRequests.delete(id);
          reject(new Error(`Request timeout: ${method}`));
        }
      }, 30000);
    });
  }

  /** Send a JSON-RPC notification (no response expected) */
  private sendNotification(serverId: string, method: string, params: any): void {
    const conn = this.connections.get(serverId);
    if (!conn || !conn.process) return;
    const notification = JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n';
    conn.process.stdin?.write(notification);
  }

  /** Handle incoming JSON-RPC message */
  private handleMessage(serverId: string, raw: string): void {
    try {
      const msg = JSON.parse(raw);
      if (msg.id !== undefined && connHas(serverId, this.connections)) {
        const conn = this.connections.get(serverId)!;
        const pending = conn.pendingRequests.get(msg.id);
        if (pending) {
          conn.pendingRequests.delete(msg.id);
          if (msg.error) pending.reject(new Error(msg.error.message));
          else pending.resolve(msg.result);
        }
      }
    } catch { /* ignore parse errors */ }
  }

  /** Discover tools from an MCP server */
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

      console.log(`[MCP:${serverId}] Discovered ${conn.tools.length} tools`);
    } catch (err: any) {
      console.error(`[MCP:${serverId}] Tool discovery failed:`, err.message);
    }
  }

  /** Call an MCP tool */
  async callTool(serverId: string, toolName: string, args: Record<string, any>): Promise<string> {
    const conn = this.connections.get(serverId);
    if (!conn || !conn.connected) throw new Error(`MCP server ${serverId} not connected`);

    const result = await this.sendRequest(serverId, 'tools/call', {
      name: toolName,
      arguments: args,
    });
    return result.content?.map((c: any) => c.text).join('\n') || JSON.stringify(result);
  }

  /** Get all tools from all connected MCP servers */
  getAllTools(): MCPTool[] {
    const tools: MCPTool[] = [];
    for (const conn of this.connections.values()) {
      if (conn.connected) tools.push(...conn.tools);
    }
    return tools;
  }

  /** Disconnect from an MCP server */
  async disconnect(serverId: string): Promise<void> {
    const conn = this.connections.get(serverId);
    if (!conn) return;
    conn.connected = false;
    conn.process?.kill();
    this.connections.delete(serverId);
    console.log(`[MCP:${serverId}] Disconnected`);
  }

  /** Disconnect from all MCP servers */
  async disconnectAll(): Promise<void> {
    for (const id of [...this.connections.keys()]) {
      await this.disconnect(id);
    }
  }
}

function connHas(id: string, map: Map<string, MCPConnection>): boolean {
  return map.has(id);
}
