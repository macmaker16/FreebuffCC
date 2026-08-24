/**
 * Michaelangelo - Update Notification Component
 *
 * Shows a modal dialog when a new version is available, with:
 * - Version info and release notes
 * - Download progress bar
 * - Restart to install button
 * - "Up to date" toast that auto-dismisses
 */

import React, { useEffect, useState } from 'react';
import { Download, RefreshCw, Check, X, ExternalLink, ArrowUp } from 'lucide-react';

export interface UpdateInfo {
  status: 'checking' | 'available' | 'downloading' | 'ready' | 'up-to-date' | 'error';
  version?: string;
  releaseDate?: string;
  releaseNotes?: string;
  percent?: number;
  bytesPerSecond?: number;
  transferred?: number;
  total?: number;
  message?: string;
}

interface Props {
  updateInfo: UpdateInfo | null;
  onCheck: () => void;
  onInstall: () => void;
  onDismiss: () => void;
  currentVersion?: string;
}

export default function UpdateNotification({ updateInfo, onCheck, onInstall, onDismiss, currentVersion }: Props) {
  const [showUpToDate, setShowUpToDate] = useState(false);

  useEffect(() => {
    if (updateInfo?.status === 'up-to-date') {
      setShowUpToDate(true);
      const timer = setTimeout(() => setShowUpToDate(false), 3000);
      return () => clearTimeout(timer);
    }
  }, [updateInfo?.status]);

  // Don't render anything if no update activity
  if (!updateInfo && !showUpToDate) return null;

  // Up to date toast
  if (showUpToDate && (!updateInfo || updateInfo.status === 'up-to-date')) {
    return (
      <div className="fixed top-4 right-4 z-50 animate-slide-in">
        <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-green-900/30 border border-green-700/30 text-green-400 shadow-lg backdrop-blur-sm">
          <Check size={14} />
          <span className="text-[13px] font-medium">You're up to date! (v{currentVersion || '?'})</span>
        </div>
      </div>
    );
  }

  // Checking for updates
  if (updateInfo?.status === 'checking') {
    return (
      <div className="fixed top-4 right-4 z-50 animate-slide-in">
        <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-dark-800 border border-dark-600 text-dark-200 shadow-lg backdrop-blur-sm">
          <RefreshCw size={14} className="animate-spin text-blue-400" />
          <span className="text-[13px]">Checking for updates...</span>
        </div>
      </div>
    );
  }

  // Error toast
  if (updateInfo?.status === 'error') {
    return (
      <div className="fixed top-4 right-4 z-50 animate-slide-in">
        <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-red-900/30 border border-red-700/30 text-red-400 shadow-lg backdrop-blur-sm">
          <X size={14} />
          <span className="text-[13px]">Update check failed — {updateInfo.message || 'network error'}</span>
          <button onClick={onDismiss} className="ml-2 hover:text-red-300"><X size={12} /></button>
        </div>
      </div>
    );
  }

  // Available — show modal
  if (updateInfo?.status === 'available') {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
        <div className="w-[420px] max-w-[90vw] bg-dark-900 border border-dark-600 rounded-xl shadow-2xl overflow-hidden animate-scale-in">
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-dark-700">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-brand-600/20 flex items-center justify-center">
                <ArrowUp size={18} className="text-brand-400" />
              </div>
              <div>
                <h3 className="text-[15px] font-semibold text-white">Update Available</h3>
                <p className="text-[12px] text-dark-400">
                  v{currentVersion || '?'} → v{updateInfo.version}
                </p>
              </div>
            </div>
            <button onClick={onDismiss} className="text-dark-500 hover:text-white transition-colors">
              <X size={16} />
            </button>
          </div>

          {/* Release Notes */}
          {updateInfo.releaseNotes && (
            <div className="px-5 py-3 max-h-48 overflow-y-auto">
              <p className="text-[12px] text-dark-400 mb-1">Release Notes</p>
              <div className="text-[13px] text-dark-200 whitespace-pre-wrap leading-relaxed">
                {updateInfo.releaseNotes}
              </div>
            </div>
          )}

          {/* Release Date */}
          {updateInfo.releaseDate && (
            <div className="px-5 py-2">
              <p className="text-[11px] text-dark-500">
                Released: {new Date(updateInfo.releaseDate).toLocaleDateString()}
              </p>
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center gap-3 px-5 py-4 border-t border-dark-700 bg-dark-800/50">
            <button
              onClick={onDismiss}
              className="flex-1 px-4 py-2 rounded-lg text-[13px] font-medium text-dark-400 hover:text-white hover:bg-dark-700 transition-colors"
            >
              Skip This Version
            </button>
            <button
              onClick={() => {
                onDismiss();
                // Trigger the auto-download — the updater will handle it
                window.electronAPI.checkForUpdates();
              }}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-brand-600 hover:bg-brand-500 text-white text-[13px] font-medium transition-colors"
            >
              <Download size={14} />
              Download Update
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Downloading — show progress modal
  if (updateInfo?.status === 'downloading') {
    const percent = updateInfo.percent || 0;
    const mbTransferred = updateInfo.transferred ? (updateInfo.transferred / 1024 / 1024).toFixed(1) : '?';
    const mbTotal = updateInfo.total ? (updateInfo.total / 1024 / 1024).toFixed(1) : '?';
    const speedMbps = updateInfo.bytesPerSecond
      ? (updateInfo.bytesPerSecond / 1024 / 1024).toFixed(1)
      : '?';

    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
        <div className="w-[380px] max-w-[90vw] bg-dark-900 border border-dark-600 rounded-xl shadow-2xl overflow-hidden animate-scale-in">
          {/* Header */}
          <div className="flex items-center gap-3 px-5 py-4 border-b border-dark-700">
            <div className="w-9 h-9 rounded-lg bg-blue-600/20 flex items-center justify-center">
              <RefreshCw size={18} className="text-blue-400 animate-spin" />
            </div>
            <div>
              <h3 className="text-[15px] font-semibold text-white">Downloading Update</h3>
              <p className="text-[12px] text-dark-400">v{updateInfo.version}</p>
            </div>
          </div>

          {/* Progress */}
          <div className="px-5 py-5">
            {/* Progress bar */}
            <div className="flex items-center justify-between mb-2">
              <span className="text-[22px] font-bold text-white">{Math.round(percent)}%</span>
              <span className="text-[12px] text-dark-400">{speedMbps} MB/s</span>
            </div>
            <div className="h-2 bg-dark-700 rounded-full overflow-hidden mb-3">
              <div
                className="h-full bg-gradient-to-r from-blue-500 to-brand-400 rounded-full transition-all duration-500 ease-out"
                style={{ width: `${percent}%` }}
              />
            </div>
            <div className="flex justify-between text-[11px] text-dark-500">
              <span>{mbTransferred} MB / {mbTotal} MB</span>
              <span>Downloading v{updateInfo.version}</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Ready to install — show modal
  if (updateInfo?.status === 'ready') {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
        <div className="w-[380px] max-w-[90vw] bg-dark-900 border border-dark-600 rounded-xl shadow-2xl overflow-hidden animate-scale-in">
          {/* Header */}
          <div className="flex items-center gap-3 px-5 py-4 border-b border-dark-700">
            <div className="w-9 h-9 rounded-lg bg-green-600/20 flex items-center justify-center">
              <Check size={18} className="text-green-400" />
            </div>
            <div>
              <h3 className="text-[15px] font-semibold text-white">Update Ready</h3>
              <p className="text-[12px] text-dark-400">v{updateInfo.version} has been downloaded</p>
            </div>
          </div>

          {/* Info */}
          <div className="px-5 py-4">
            <p className="text-[13px] text-dark-300 leading-relaxed">
              The update will be applied when you restart Michaelangelo.
              Any unsaved work will be preserved.
            </p>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-3 px-5 py-4 border-t border-dark-700 bg-dark-800/50">
            <button
              onClick={onDismiss}
              className="flex-1 px-4 py-2 rounded-lg text-[13px] font-medium text-dark-400 hover:text-white hover:bg-dark-700 transition-colors"
            >
              Later
            </button>
            <button
              onClick={onInstall}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-green-600 hover:bg-green-500 text-white text-[13px] font-medium transition-colors"
            >
              <RefreshCw size={14} />
              Restart & Install
            </button>
          </div>
        </div>
      </div>
    );
  }

  return null;
}
