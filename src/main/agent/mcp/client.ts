/**
 * FreebuffCC Agent System - MCP Client Manager
 * 
 * Connects to external MCP servers via stdio or SSE,
 * discovers their tools, and routes tool calls to them.
 * 
 * MCP (Model Context Protocol) allows extending the agent
 * with tools from external servers.
 */

import { spawn, ChildProcess } from 'child_process';
import { MCPServerConfig, MCPServerState, ToolDefinition, ToolResult } from '../types';

/** JSON-RPC request */
interface JSONRPCRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: any;
}

/** JSON-RPC response */
interface JSONRPCResponse {
  jsonrpc: '2.0';
  id: number;
  result?: any;
  error?: { code: number; message: string; data?: any };
}

export class MCPClientManager {
  private servers: Map<string, MCPServerState> = new Map();
  private processes: Map<string, ChildProcess> = new Map();
  private pendingRequests: Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }> = new Map();
  private requestId: number = 0;

  /**
   * Connect to an MCP server.
   * Handles the initialize handshake and tool discovery.
   */
  async connect(config: MCPServerConfig): Promise<void> {
    console.log(`[MCP] Connecting to ${config.name} (${config.transport})...`);
    
    this.servers.set(config.id, {
      id: config.id,
      status: 'connecting',
      tools: [],
    });

    try {
      if (config.transport === 'stdio') {
        await this.connectStdio(config);
      } else {
        await this.connectSSE(config);
      }

      // Initialize handshake
      await this.sendRequest(config.id, 'initialize', {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        clientInfo: { name: 'FreebuffCC', version: '1.0.0' },
      });

      // Notify initialized
      await this.sendRequest(config.id, 'notifications/initialized', {});

      // List tools
      const result = await this.sendRequest(config.id, 'tools/list', {});
      const tools = (result?.tools || []).map((t: any) => ({
        type: 'function' as const,
        function: {
          name: t.name,
          description: t.description || '',
          parameters: t.inputSchema || { type: 'object', properties: {}, required: [] },
        },
      }));

      const state = this.servers.get(config.id)!;
      state.status = 'connected';
      state.tools = tools;

      console.log(`[MCP] Connected to ${config.name}: ${tools.length} tools discovered`);
    } catch (err: any) {
      const state = this.servers.get(config.id)!;
      state.status = 'error';
      state.error = err.message;
      console.error(`[MCP] Failed to connect to ${config.name}:`, err.message);
      throw err;
    }
  }

  /** Connect via stdio (spawn a child process) */
  private async connectStdio(config: MCPServerConfig): Promise<void> {
    if (!config.command) throw new Error('stdio transport requires a command');

    const proc = spawn(config.command, config.args || [], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...config.env },
    });

    this.processes.set(config.id, proc);

    // Handle stdout (JSON-RPC responses)
    let buffer = '';
    proc.stdout?.on('data', (data: Buffer) => {
      buffer += data.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const response = JSON.parse(line) as JSONRPCResponse;
          const pending = this.pendingRequests.get(response.id);
          if (pending) {
            this.pendingRequests.delete(response.id);
            if (response.error) {
              pending.reject(new Error(response.error.message));
            } else {
              pending.resolve(response.result);
            }
          }
        } catch {
          // Not JSON, might be stderr mixed in
        }
      }
    });

    // Handle stderr
    proc.stderr?.on('data', (data: Buffer) => {
      console.error(`[MCP:${config.id}] stderr:`, data.toString().trim());
    });

    // Handle exit
    proc.on('exit', (code) => {
      console.log(`[MCP:${config.id}] Process exited with code ${code}`);
      const state = this.servers.get(config.id);
      if (state) state.status = 'disconnected';
    });

    // Wait a bit for the process to start
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  /** Connect via SSE (Server-Sent Events) */
  private async connectSSE(config: MCPServerConfig): Promise<void> {
    if (!config.url) throw new Error('SSE transport requires a URL');
    // SSE connection would use EventSource or similar
    // For now, we use fetch-based polling
    console.log(`[MCP] SSE transport not yet fully implemented for ${config.name}`);
  }

  /** Send a JSON-RPC request to an MCP server */
  private async sendRequest(serverId: string, method: string, params: any): Promise<any> {
    const proc = this.processes.get(serverId);
    if (!proc || !proc.stdin) {
      throw new Error(`MCP server ${serverId} not connected`);
    }

    const id = ++this.requestId;
    const request: JSONRPCRequest = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    };

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });

      // Timeout after 30 seconds
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`MCP request ${method} timed out`));
        }
      }, 30000);

      const requestStr = JSON.stringify(request) + '\n';
      proc.stdin!.write(requestStr);
    });
  }

  /** Call a tool on an MCP server */
  async callTool(serverId: string, toolName: string, args: Record<string, any>): Promise<ToolResult> {
    const startTime = Date.now();

    try {
      const result = await this.sendRequest(serverId, 'tools/call', {
        name: toolName,
        arguments: args,
      });

      const content = result?.content || [];
      const text = content
        .filter((c: any) => c.type === 'text')
        .map((c: any) => c.text)
        .join('\n');

      return {
        success: true,
        output: text || JSON.stringify(result),
        duration_ms: Date.now() - startTime,
      };
    } catch (err: any) {
      return {
        success: false,
        output: '',
        error: err.message,
        duration_ms: Date.now() - startTime,
      };
    }
  }

  /** Get all tools from all connected MCP servers */
  getAllTools(): Array<ToolDefinition & { serverId: string }> {
    const tools: Array<ToolDefinition & { serverId: string }> = [];

    for (const [serverId, state] of this.servers) {
      if (state.status === 'connected') {
        for (const tool of state.tools) {
          tools.push({ ...tool, serverId });
        }
      }
    }

    return tools;
  }

  /** Get connection state for all servers */
  getServerStates(): MCPServerState[] {
    return Array.from(this.servers.values());
  }

  /** Disconnect from all MCP servers */
  async disconnectAll(): Promise<void> {
    for (const [serverId, proc] of this.processes) {
      console.log(`[MCP] Disconnecting from ${serverId}`);
      proc.kill();
      this.processes.delete(serverId);
    }
    this.servers.clear();
    this.pendingRequests.clear();
  }
}
