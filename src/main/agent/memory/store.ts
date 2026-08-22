/**
 * Michaelangelo Agent - Enhanced Memory Store
 * Persistent memory across sessions with semantic search.
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';

export interface MemoryEntry {
  id: string;
  timestamp: number;
  sessionId: string;
  type: string;
  content: string;
  metadata?: Record<string, any>;
}

export interface SessionSummary {
  sessionId: string;
  timestamp: number;
  model: string;
  title: string;
  summary: string;
  tasksCompleted: string[];
  learnings: string[];
  toolsUsed: string[];
}

export class MemoryStore {
  private entries: MemoryEntry[] = [];
  private sessions: SessionSummary[] = [];
  private memoryDir: string;

  constructor(workspace: string) {
    this.memoryDir = join(workspace, '.michaelangelo', 'memory');
  }

  async init(): Promise<void> {
    try {
      await mkdir(this.memoryDir, { recursive: true });
      await this.load();
    } catch (err: any) {
      console.error('[Memory] Init error:', err.message);
    }
  }

  /** Load entries and sessions from disk */
  async load(): Promise<void> {
    try {
      const entriesFile = join(this.memoryDir, 'entries.json');
      const sessionsFile = join(this.memoryDir, 'sessions.json');
      try { this.entries = JSON.parse(await readFile(entriesFile, 'utf-8')); } catch { this.entries = []; }
      try { this.sessions = JSON.parse(await readFile(sessionsFile, 'utf-8')); } catch { this.sessions = []; }
    } catch { /* first run */ }
  }

  async save(): Promise<void> {
    try {
      await writeFile(join(this.memoryDir, 'entries.json'), JSON.stringify(this.entries, null, 2));
      await writeFile(join(this.memoryDir, 'sessions.json'), JSON.stringify(this.sessions, null, 2));
    } catch (err: any) {
      console.error('[Memory] Save error:', err.message);
    }
  }

  /** Add an entry (compatible with plugin's .add() call) */
  async add(data: { sessionId: string; type: string; content: string; metadata?: Record<string, any> }): Promise<void> {
    this.entries.push({
      id: `mem_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      timestamp: Date.now(),
      ...data,
    });
  }

  addEntry(entry: Omit<MemoryEntry, 'id' | 'timestamp'>): void {
    this.entries.push({
      ...entry,
      id: `mem_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      timestamp: Date.now(),
    });
  }

  addSession(summary: SessionSummary): void {
    this.sessions.push(summary);
  }

  /** Get recent entries (used by plugin onSessionStart) */
  getRecent(limit = 10): MemoryEntry[] {
    return this.entries.slice(-limit);
  }

  /** 3-Tier Search */
  search(query: string, layer: 1 | 2 | 3 = 1, maxResults = 10): string {
    const q = query.toLowerCase();
    const matches = this.entries.filter(e =>
      e.content.toLowerCase().includes(q)
    ).slice(-maxResults);

    if (matches.length === 0) return 'No relevant memories found.';

    switch (layer) {
      case 1:
        return matches.map((m, i) => `${i + 1}. [${m.type}] ${m.content.substring(0, 80)}...`).join('\n');
      case 2:
        return matches.map(m => `[${new Date(m.timestamp).toISOString().split('T')[0]}] [${m.type}] ${m.content.substring(0, 200)}`).join('\n\n');
      case 3:
        return matches.map(m => `---\nType: ${m.type}\nDate: ${new Date(m.timestamp).toISOString()}\n\n${m.content}\n`).join('\n');
    }
  }

  getRecentContext(maxSessions = 3): string {
    const recent = this.sessions.slice(-maxSessions);
    if (recent.length === 0) return '';
    return recent.map(s =>
      `${s.title}: ${s.summary}`
    ).join('\n\n');
  }

  getAll(): MemoryEntry[] { return [...this.entries]; }
  getEntries(): MemoryEntry[] { return [...this.entries]; }
  getSessions(): SessionSummary[] { return [...this.sessions]; }
}
