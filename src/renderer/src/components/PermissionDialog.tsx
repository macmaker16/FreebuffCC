/**
 * Michaelangelo - PermissionDialog Component
 *
 * Windows-style modal dialog for human-in-the-loop approval.
 * Appears when the agent tries to run bash commands or edit files.
 *
 * Three options:
 * - Allow Once: Approve this single operation
 * - Always Allow: Remember this command for the session
 * - Deny: Block the operation
 */

import React from 'react';
import { AlertTriangle, Terminal, FileEdit, Shield, X } from 'lucide-react';

interface PermissionRequest {
  id: string;
  type: 'bash' | 'write' | 'edit' | 'delete' | 'git';
  description: string;
  command?: string;
  filePath?: string;
}

interface Props {
  request: PermissionRequest;
  onApprove: (alwaysAllow: boolean) => void;
  onDeny: () => void;
}

const TYPE_CONFIG: Record<string, { icon: typeof Terminal; color: string; label: string; bg: string }> = {
  bash: { icon: Terminal, color: 'text-yellow-400', label: 'Shell Command', bg: 'bg-yellow-400/10 border-yellow-400/20' },
  write: { icon: FileEdit, color: 'text-blue-400', label: 'File Write', bg: 'bg-blue-400/10 border-blue-400/20' },
  edit: { icon: FileEdit, color: 'text-purple-400', label: 'File Edit', bg: 'bg-purple-400/10 border-purple-400/20' },
  delete: { icon: AlertTriangle, color: 'text-red-400', label: 'File Delete', bg: 'bg-red-400/10 border-red-400/20' },
  git: { icon: Shield, color: 'text-cyan-400', label: 'Git Operation', bg: 'bg-cyan-400/10 border-cyan-400/20' },
};

export default function PermissionDialog({ request, onApprove, onDeny }: Props) {
  const config = TYPE_CONFIG[request.type] || TYPE_CONFIG.bash;
  const Icon = config.icon;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-dark-900 border border-dark-600 rounded-lg shadow-2xl w-full max-w-md mx-4 overflow-hidden">
        {/* Header */}
        <div className={`flex items-center gap-3 px-4 py-3 border-b ${config.bg}`}>
          <div className={`p-2 rounded-lg ${config.bg}`}>
            <Icon size={18} className={config.color} />
          </div>
          <div className="flex-1">
            <h3 className="text-sm font-semibold text-white">Permission Required</h3>
            <p className="text-[13px] text-dark-300">{config.label}</p>
          </div>
          <button onClick={onDeny} className="p-1 rounded hover:bg-dark-700 transition-colors">
            <X size={14} className="text-dark-400" />
          </button>
        </div>

        {/* Body */}
        <div className="px-4 py-3 space-y-3">
          <div className="bg-dark-800 rounded-md p-3 border border-dark-600">
            <p className="text-[13px] text-dark-300 mb-1">The agent wants to execute:</p>
            <p className="text-xs text-white font-mono break-all">{request.description}</p>
          </div>

          {request.command && (
            <div className="bg-dark-950 rounded-md p-2 border border-dark-700">
              <code className="text-[13px] text-yellow-300 font-mono">{request.command}</code>
            </div>
          )}

          {request.filePath && (
            <p className="text-[13px] text-dark-400">
              File: <span className="text-dark-200 font-mono">{request.filePath}</span>
            </p>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-2 px-4 py-3 border-t border-dark-700 bg-dark-800/30">
          <button
            onClick={onDeny}
            className="flex-1 px-3 py-2 rounded-md text-xs font-medium bg-dark-700 text-dark-300 hover:bg-dark-600 hover:text-white transition-colors"
          >
            Deny
          </button>
          <button
            onClick={() => onApprove(true)}
            className="flex-1 px-3 py-2 rounded-md text-xs font-medium bg-dark-700 text-dark-300 hover:bg-dark-600 hover:text-white transition-colors"
          >
            Always Allow
          </button>
          <button
            onClick={() => onApprove(false)}
            className="flex-1 px-3 py-2 rounded-md text-xs font-medium bg-brand-600 text-white hover:bg-brand-500 transition-colors"
          >
            Allow Once
          </button>
        </div>
      </div>
    </div>
  );
}
