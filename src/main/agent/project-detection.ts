/**
 * Michaelangelo - Auto Project Detection
 *
 * Detects project type, framework, and configuration automatically.
 * Loads .michaelangelo.md / CLAUDE.md project instructions.
 * Scans project structure for context.
 */

import { readFile, access, readdir } from 'fs/promises';
import { join, basename } from 'path';

// ============================================================================
// TYPES
// ============================================================================

export interface ProjectInfo {
  /** Detected project type */
  type: string;
  /** Framework detected */
  framework: string;
  /** Programming language(s) */
  languages: string[];
  /** Package manager */
  packageManager: string;
  /** Build command */
  buildCommand: string;
  /** Test command */
  testCommand: string;
  /** Lint command */
  lintCommand: string;
  /** Dev command */
  devCommand: string;
  /** Has TypeScript */
  hasTypeScript: boolean;
  /** Has git */
  hasGit: boolean;
  /** Has Docker */
  hasDocker: boolean;
  /** Root config files */
  configFiles: string[];
  /** Project instructions loaded from .michaelangelo.md or CLAUDE.md */
  instructions: string;
  /** Key directories */
  directories: string[];
  /** Total source files (approximate) */
  fileCount: number;
}

// ============================================================================
// DETECTION RULES
// ============================================================================

interface DetectionRule {
  file: string;
  type: string;
  framework: string;
  language: string;
  packageManager?: string;
  buildCmd?: string;
  testCmd?: string;
  lintCmd?: string;
  devCmd?: string;
}

const DETECTION_RULES: DetectionRule[] = [
  // Node.js / JavaScript / TypeScript
  { file: 'package.json', type: 'node', framework: 'node', language: 'JavaScript' },
  { file: 'tsconfig.json', type: 'typescript', framework: 'node', language: 'TypeScript' },
  { file: 'next.config.js', type: 'nextjs', framework: 'Next.js', language: 'TypeScript', buildCmd: 'npm run build', devCmd: 'npm run dev' },
  { file: 'next.config.mjs', type: 'nextjs', framework: 'Next.js', language: 'TypeScript', buildCmd: 'npm run build', devCmd: 'npm run dev' },
  { file: 'vite.config.ts', type: 'vite', framework: 'Vite', language: 'TypeScript', devCmd: 'npm run dev' },
  { file: 'vite.config.js', type: 'vite', framework: 'Vite', language: 'JavaScript', devCmd: 'npm run dev' },
  { file: 'nuxt.config.ts', type: 'nuxt', framework: 'Nuxt', language: 'TypeScript', devCmd: 'npm run dev' },
  { file: 'angular.json', type: 'angular', framework: 'Angular', language: 'TypeScript', buildCmd: 'ng build', devCmd: 'ng serve', testCmd: 'ng test' },
  { file: 'svelte.config.js', type: 'svelte', framework: 'SvelteKit', language: 'TypeScript', devCmd: 'npm run dev' },
  { file: 'remix.config.js', type: 'remix', framework: 'Remix', language: 'TypeScript', devCmd: 'npm run dev' },
  { file: 'express.js', type: 'express', framework: 'Express', language: 'JavaScript' },
  { file: 'fastify.config.js', type: 'fastify', framework: 'Fastify', language: 'JavaScript' },

  // Python
  { file: 'pyproject.toml', type: 'python', framework: 'python', language: 'Python', testCmd: 'pytest', lintCmd: 'ruff check' },
  { file: 'setup.py', type: 'python', framework: 'python', language: 'Python', testCmd: 'pytest' },
  { file: 'setup.cfg', type: 'python', framework: 'python', language: 'Python', testCmd: 'pytest' },
  { file: 'requirements.txt', type: 'python', framework: 'python', language: 'Python', testCmd: 'pytest' },
  { file: 'Pipfile', type: 'python', framework: 'python', language: 'Python', packageManager: 'pipenv' },
  { file: 'manage.py', type: 'django', framework: 'Django', language: 'Python', devCmd: 'python manage.py runserver', testCmd: 'python manage.py test' },
  { file: 'app.py', type: 'flask', framework: 'Flask', language: 'Python', devCmd: 'flask run' },

  // Rust
  { file: 'Cargo.toml', type: 'rust', framework: 'Rust', language: 'Rust', buildCmd: 'cargo build', testCmd: 'cargo test', lintCmd: 'cargo clippy' },

  // Go
  { file: 'go.mod', type: 'go', framework: 'Go', language: 'Go', buildCmd: 'go build', testCmd: 'go test ./...' },

  // Java
  { file: 'pom.xml', type: 'maven', framework: 'Maven', language: 'Java', buildCmd: 'mvn compile', testCmd: 'mvn test' },
  { file: 'build.gradle', type: 'gradle', framework: 'Gradle', language: 'Java', buildCmd: 'gradle build', testCmd: 'gradle test' },
  { file: 'build.gradle.kts', type: 'gradle', framework: 'Gradle', language: 'Kotlin', buildCmd: 'gradle build', testCmd: 'gradle test' },

  // C# / .NET
  { file: '*.csproj', type: 'dotnet', framework: '.NET', language: 'C#', buildCmd: 'dotnet build', testCmd: 'dotnet test' },

  // Ruby
  { file: 'Gemfile', type: 'ruby', framework: 'Ruby', language: 'Ruby', buildCmd: 'bundle install', testCmd: 'bundle exec rspec' },
  { file: 'Rakefile', type: 'ruby', framework: 'Ruby', language: 'Ruby', testCmd: 'rake test' },

  // Mobile
  { file: 'Podfile', type: 'ios', framework: 'CocoaPods', language: 'Swift' },
  { file: 'build.gradle', type: 'android', framework: 'Android', language: 'Kotlin' },

  // Infrastructure
  { file: 'docker-compose.yml', type: 'docker', framework: 'Docker', language: 'Docker' },
  { file: 'docker-compose.yaml', type: 'docker', framework: 'Docker', language: 'Docker' },
  { file: 'Dockerfile', type: 'docker', framework: 'Docker', language: 'Docker' },
  { file: 'terraform.tf', type: 'terraform', framework: 'Terraform', language: 'HCL' },
  { file: 'Makefile', type: 'make', framework: 'Make', language: 'Make' },
];

// ============================================================================
// PROJECT DETECTOR
// ============================================================================

export class ProjectDetector {
  private workspace: string;

  constructor(workspace: string) {
    this.workspace = workspace;
  }

  /** Full project scan */
  async detect(): Promise<ProjectInfo> {
    const info: ProjectInfo = {
      type: 'unknown',
      framework: 'unknown',
      languages: [],
      packageManager: 'npm',
      buildCommand: '',
      testCommand: '',
      lintCommand: '',
      devCommand: '',
      hasTypeScript: false,
      hasGit: false,
      hasDocker: false,
      configFiles: [],
      instructions: '',
      directories: [],
      fileCount: 0,
    };

    // Scan root files
    try {
      const entries = await readdir(this.workspace, { withFileTypes: true });
      const files = entries.filter(e => e.isFile()).map(e => e.name);
      const dirs = entries.filter(e => e.isDirectory()).map(e => e.name);

      info.configFiles = files.filter(f => !f.startsWith('.') && f.length < 30);
      info.directories = dirs.filter(d => !d.startsWith('.') && d !== 'node_modules');

      // Count source files (rough estimate)
      info.fileCount = await this.countSourceFiles(this.workspace, 0);
    } catch { /* ignore */ }

    // Run detection rules
    const detectedLanguages = new Set<string>();
    for (const rule of DETECTION_RULES) {
      try {
        // Check for exact file or glob pattern
        if (rule.file.includes('*')) {
          // Simple glob: check if any file matches
          const pattern = rule.file.replace('*', '');
          if (info.configFiles.some(f => f.endsWith(pattern))) {
            this.applyRule(info, rule, detectedLanguages);
          }
        } else {
          await access(join(this.workspace, rule.file));
          this.applyRule(info, rule, detectedLanguages);
        }
      } catch { /* file doesn't exist */ }
    }

    info.languages = [...detectedLanguages];

    // Detect TypeScript
    info.hasTypeScript = info.configFiles.some(f => f.includes('tsconfig'));

    // Detect Git
    try {
      await access(join(this.workspace, '.git'));
      info.hasGit = true;
    } catch { /* no git */ }

    // Detect Docker
    info.hasDocker = info.configFiles.some(f => f.toLowerCase().includes('docker'));

    // Detect package manager
    info.packageManager = await this.detectPackageManager();

    // Load project instructions
    info.instructions = await this.loadInstructions();

    return info;
  }

  private applyRule(info: ProjectInfo, rule: DetectionRule, languages: Set<string>): void {
    if (info.type === 'unknown') info.type = rule.type;
    if (info.framework === 'unknown') info.framework = rule.framework;
    if (rule.language) languages.add(rule.language);
    if (rule.packageManager) info.packageManager = rule.packageManager;
    if (rule.buildCmd && !info.buildCommand) info.buildCommand = rule.buildCmd;
    if (rule.testCmd && !info.testCommand) info.testCommand = rule.testCmd;
    if (rule.lintCmd && !info.lintCommand) info.lintCommand = rule.lintCmd;
    if (rule.devCmd && !info.devCommand) info.devCommand = rule.devCmd;
  }

  private async detectPackageManager(): Promise<string> {
    try {
      await access(join(this.workspace, 'pnpm-lock.yaml'));
      return 'pnpm';
    } catch { /* not pnpm */ }
    try {
      await access(join(this.workspace, 'yarn.lock'));
      return 'yarn';
    } catch { /* not yarn */ }
    try {
      await access(join(this.workspace, 'bun.lockb'));
      return 'bun';
    } catch { /* not bun */ }
    return 'npm';
  }

  private async loadInstructions(): Promise<string> {
    const instructionFiles = [
      '.michaelangelo.md',
      'CLAUDE.md',
      '.cursorrules',
      '.github/copilot-instructions.md',
      'APP_INSTRUCTIONS.md',
    ];

    for (const file of instructionFiles) {
      try {
        const content = await readFile(join(this.workspace, file), 'utf-8');
        console.log(`[Project] Loaded instructions from ${file}`);
        return content;
      } catch { /* continue */ }
    }

    return '';
  }

  private async countSourceFiles(dir: string, depth: number): Promise<number> {
    if (depth > 4) return 0;
    let count = 0;
    const ignored = new Set(['node_modules', '.git', 'dist', 'build', '__pycache__', '.next', 'coverage', '.michaelangelo', 'vendor', 'target']);

    try {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (ignored.has(entry.name) || entry.name.startsWith('.')) continue;
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          count += await this.countSourceFiles(fullPath, depth + 1);
        } else {
          const ext = entry.name.split('.').pop()?.toLowerCase() || '';
          if (['ts', 'tsx', 'js', 'jsx', 'py', 'rs', 'go', 'java', 'rb', 'cs', 'cpp', 'c', 'h', 'vue', 'svelte'].includes(ext)) {
            count++;
          }
        }
      }
    } catch { /* ignore */ }
    return count;
  }

  /** Format project info as a readable string for the system prompt */
  formatForPrompt(info: ProjectInfo): string {
    const lines: string[] = ['## Project Context\n'];

    lines.push(`- **Type:** ${info.type} (${info.framework})`);
    lines.push(`- **Languages:** ${info.languages.join(', ') || 'Unknown'}`);
    lines.push(`- **Package Manager:** ${info.packageManager}`);
    lines.push(`- **TypeScript:** ${info.hasTypeScript ? 'Yes' : 'No'}`);
    lines.push(`- **Git:** ${info.hasGit ? 'Yes' : 'No'}`);
    lines.push(`- **Docker:** ${info.hasDocker ? 'Yes' : 'No'}`);
    lines.push(`- **Source Files:** ~${info.fileCount}`);

    if (info.buildCommand) lines.push(`- **Build:** \`${info.buildCommand}\``);
    if (info.testCommand) lines.push(`- **Test:** \`${info.testCommand}\``);
    if (info.lintCommand) lines.push(`- **Lint:** \`${info.lintCommand}\``);
    if (info.devCommand) lines.push(`- **Dev:** \`${info.devCommand}\``);

    if (info.directories.length > 0) {
      lines.push(`\n### Project Structure`);
      for (const d of info.directories.slice(0, 15)) {
        lines.push(`  - ${d}/`);
      }
    }

    if (info.instructions) {
      lines.push(`\n### Project Instructions`);
      lines.push(info.instructions);
    }

    return lines.join('\n');
  }
}
