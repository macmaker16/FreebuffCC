/**
 * Michaelangelo Agent - Project Instructions Loader
 * Reads APP_INSTRUCTIONS.md (or CLAUDE.md) from the workspace root
 * to automatically load project-specific coding standards and rules.
 */

import { readFile, access } from 'fs/promises';
import { join } from 'path';

const INSTRUCTION_FILES = [
  'APP_INSTRUCTIONS.md',
  'CLAUDE.md',
  '.michaelangelo.md',
  '.cursorrules',
  '.github/copilot-instructions.md',
];

/**
 * Load project instructions from the workspace root.
 * Tries multiple file names in priority order.
 * Returns null if no instruction file is found.
 */
export async function loadProjectInstructions(workspace: string): Promise<string | null> {
  for (const filename of INSTRUCTION_FILES) {
    const filePath = join(workspace, filename);
    try {
      await access(filePath);
      const content = await readFile(filePath, 'utf-8');
      if (content.trim().length > 0) {
        console.log(`[Instructions] Loaded ${filename} (${content.length} bytes)`);
        return content;
      }
    } catch {
      // File doesn't exist, try next
    }
  }
  return null;
}

/**
 * Create a sample APP_INSTRUCTIONS.md in the workspace if none exists.
 */
export async function createSampleInstructions(workspace: string): Promise<boolean> {
  const filePath = join(workspace, 'APP_INSTRUCTIONS.md');
  try {
    await access(filePath);
    return false; // Already exists
  } catch {
    // Create it
    const sample = `# Project Instructions for Michaelangelo

## Coding Standards
- Use TypeScript with strict mode
- Prefer functional patterns over classes
- Use descriptive variable names
- Add JSDoc comments to public functions

## Architecture
- Frontend: React + TypeScript
- Backend: Express.js
- State: React hooks (no Redux)

## Testing
- Write tests for all new features
- Run \`npm test\` before committing

## Git
- Use conventional commits: feat:, fix:, refactor:, docs:
- One logical change per commit
- Never commit directly to main

## Dependencies
- Minimize external dependencies
- Prefer built-in Node.js APIs
`;
    const { writeFile, mkdir } = require('fs/promises');
    const { dirname } = require('path');
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, sample, 'utf-8');
    console.log(`[Instructions] Created sample APP_INSTRUCTIONS.md`);
    return true;
  }
}
