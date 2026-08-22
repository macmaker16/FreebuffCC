/**
 * Michaelangelo Agent System - Memory Store
 * 
 * In-memory storage for session observations and summaries.
 * In production, this would be backed by SQLite or a vector database.
 * For now, we use a JSON file for persistence across sessions.
 */

import { MemoryEntry, MemorySearchResult } from '../types';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { dirname, join } from 'path';

export class MemoryStore {
  private entries: MemoryEntry[] = [];
  private storagePath: string;
  private loaded: boolean = false;

  constructor(storagePath: string) {
    this.storagePath = storagePath;
  }

  /** Load entries from disk */
  async load(): Promise<void> {
    if (this.loaded) return;

    try {
      await mkdir(dirname(this.storagePath), { recursive: true });
      const data = await readFile(this.storagePath, 'utf-8');
      this.entries = JSON.parse(data);
    } catch {
      this.entries = [];
    }

    this.loaded = true;
    console.log(`[Memory] Loaded ${this.entries.length} entries`);
  }

  /** Save entries to disk */
  async save(): Promise<void> {
    await mkdir(dirname(this.storagePath), { recursive: true });
    await writeFile(this.storagePath, JSON.stringify(this.entries, null, 2), 'utf-8');
  }

  /** Add a new entry */
  async add(entry: Omit<MemoryEntry, 'id' | 'timestamp'>): Promise<MemoryEntry> {
    const newEntry: MemoryEntry = {
      ...entry,
      id: `mem_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: Date.now(),
    };

    this.entries.push(newEntry);
    await this.save();
    return newEntry;
  }

  /** Get all entries for a session */
  getBySession(sessionId: string): MemoryEntry[] {
    return this.entries.filter(e => e.sessionId === sessionId);
  }

  /** Get entries by type */
  getByType(type: MemoryEntry['type']): MemoryEntry[] {
    return this.entries.filter(e => e.type === type);
  }

  /** Search entries by keyword */
  search(query: string, limit: number = 10): MemorySearchResult[] {
    const queryLower = query.toLowerCase();
    const words = queryLower.split(/\s+/);

    return this.entries
      .map(entry => {
        const content = entry.content.toLowerCase();
        let score = 0;
        for (const word of words) {
          if (content.includes(word)) score += 1;
        }
        return { entry, relevance: score / words.length };
      })
      .filter(r => r.relevance > 0)
      .sort((a, b) => b.relevance - a.relevance)
      .slice(0, limit);
  }

  /** Get recent entries */
  getRecent(count: number): MemoryEntry[] {
    return this.entries.slice(-count);
  }

  /** Get all entries */
  getAll(): MemoryEntry[] {
    return [...this.entries];
  }

  /** Clear all entries */
  async clear(): Promise<void> {
    this.entries = [];
    await this.save();
  }
}
