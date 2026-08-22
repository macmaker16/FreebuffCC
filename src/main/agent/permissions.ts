/**
 * Michaelangelo Agent - Permission System
 * Human-in-the-loop: prompts user for approval before destructive actions.
 * Blocks execution until approved or denied.
 */

export type PermissionAction = 'approve' | 'deny';

export interface PermissionRequest {
  id: string;
  timestamp: number;
  type: 'bash' | 'write' | 'edit' | 'delete' | 'git';
  description: string;
  command?: string;
  filePath?: string;
  oldContent?: string;
  newContent?: string;
}

export interface PermissionResponse {
  requestId: string;
  action: PermissionAction;
  alwaysAllow?: boolean; // Remember this choice for similar operations
}

/** Tools that require permission before execution */
const REQUIRES_PERMISSION: Record<string, PermissionAction | null> = {
  // Bash commands — always require permission unless whitelisted
  run_command: null, // null = always check
  // File writes — require permission
  write_file: null,
  edit_file: null,
  // Git destructive operations
  git_commit: null,
  git_branch: null,
};

/** Bash commands that are safe and don't require permission */
const SAFE_BASH_PATTERNS = [
  /^ls\b/,
  /^pwd\b/,
  /^cat\b/,
  /^echo\b/,
  /^head\b/,
  /^tail\b/,
  /^wc\b/,
  /^find\b/,
  /^which\b/,
  /^node --version/,
  /^npm --version/,
  /^python --version/,
  /^git status/,
  /^git log/,
  /^git diff/,
  /^git branch/,
  /^npm test\b/,
  /^npx test\b/,
  /^npm run build\b/,
  /^npm run dev\b/,
  /^npx tsc\b/,
  /^npx eslint\b/,
  /^npx prettier\b/,
];

export class PermissionManager {
  private pendingRequests: Map<string, {
    request: PermissionRequest;
    resolve: (response: PermissionResponse) => void;
  }> = new Map();
  private approvedCommands: Set<string> = new Set();
  private deniedCommands: Set<string> = new Set();
  private onPermissionRequest?: (request: PermissionRequest) => void;

  /** Set callback for when a permission request is created */
  setRequestHandler(handler: (request: PermissionRequest) => void): void {
    this.onPermissionRequest = handler;
  }

  /** Check if a tool call requires permission */
  requiresPermission(toolName: string, args: Record<string, any>): boolean {
    if (!(toolName in REQUIRES_PERMISSION)) return false;

    // Bash: check if it's a safe command
    if (toolName === 'run_command' && args.command) {
      const cmd = args.command.trim();
      // Check against safe patterns
      for (const pattern of SAFE_BASH_PATTERNS) {
        if (pattern.test(cmd)) return false;
      }
      // Check if previously approved
      if (this.approvedCommands.has(cmd)) return false;
      if (this.deniedCommands.has(cmd)) return false; // Will be blocked
      return true;
    }

    // File operations
    if (toolName === 'write_file' || toolName === 'edit_file') {
      return true;
    }

    // Git destructive
    if (toolName === 'git_commit' || toolName === 'git_branch') {
      return true;
    }

    return true;
  }

  /** Request permission from the user. Auto-approve if no handler set (e.g., API calls). */
  async requestPermission(toolName: string, args: Record<string, any>): Promise<PermissionResponse> {
    // If no handler set, auto-approve (for API/CLI usage)
    if (!this.onPermissionRequest) {
      return { requestId: 'auto', action: 'approve' };
    }
    const id = `perm_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;

    let description = '';
    let type: PermissionRequest['type'] = 'bash';

    if (toolName === 'run_command') {
      type = 'bash';
      description = `Execute: ${args.command}`;
    } else if (toolName === 'write_file') {
      type = 'write';
      description = `Write file: ${args.file_path}`;
    } else if (toolName === 'edit_file') {
      type = 'edit';
      description = `Edit file: ${args.file_path}`;
    } else if (toolName === 'git_commit') {
      type = 'git';
      description = `Git commit: ${args.message}`;
    } else if (toolName === 'git_branch') {
      type = 'git';
      description = `Git branch: ${args.name}`;
    } else {
      description = `Execute: ${toolName}`;
    }

    const request: PermissionRequest = {
      id,
      timestamp: Date.now(),
      type,
      description,
      command: args.command,
      filePath: args.file_path,
    };

    return new Promise((resolve) => {
      this.pendingRequests.set(id, { request, resolve });

      // Notify the frontend
      if (this.onPermissionRequest) {
        this.onPermissionRequest(request);
      }

      console.log(`[Permission] Requesting: ${description}`);
    });
  }

  /** Resolve a pending permission request (called from IPC handler) */
  resolvePermission(response: PermissionResponse): void {
    const pending = this.pendingRequests.get(response.requestId);
    if (!pending) return;

    this.pendingRequests.delete(response.requestId);

    // Remember the choice
    if (response.alwaysAllow && response.action === 'approve') {
      if (pending.request.command) {
        this.approvedCommands.add(pending.request.command);
      }
    } else if (response.action === 'deny') {
      if (pending.request.command) {
        this.deniedCommands.add(pending.request.command);
      }
    }

    console.log(`[Permission] ${response.action}: ${pending.request.description}`);
    pending.resolve(response);
  }

  /** Get all pending requests */
  getPendingRequests(): PermissionRequest[] {
    return [...this.pendingRequests.values()].map(p => p.request);
  }

  /** Check if a specific command was denied */
  isDenied(command: string): boolean {
    return this.deniedCommands.has(command);
  }
}
