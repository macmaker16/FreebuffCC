/**
 * Michaelangelo Agent - Headless CI/CD Mode
 *
 * CLI entry point that runs the agent without a GUI:
 *   npm run agent:headless -- --branch feature/x --workspace /path/to/repo
 *
 * Capabilities:
 *   1. Automatically review a git diff (PR or branch comparison)
 *   2. Run the project's test suite
 *   3. If tests fail, enter the autonomous loop to fix them
 *   4. Push a new commit with fixes
 *
 * Usage:
 *   node dist/main/headless.js --branch <branch> --workspace <dir>
 *   node dist/main/headless.js --pr <number> --workspace <dir>
 *   node dist/main/headless.js --review --workspace <dir>
 *   node dist/main/headless.js --fix --workspace <dir>
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { readFile, access } from 'fs/promises';
import { join, resolve } from 'path';
import { Orchestrator } from './agent';
import { ChatMessage, OrchestratorConfig } from './agent/types';

const execAsync = promisify(exec);

// ============================================================================
// CLI ARGUMENT PARSING
// ============================================================================

interface HeadlessConfig {
  branch?: string;
  pr?: number;
  workspace: string;
  review: boolean;
  fix: boolean;
  commit: boolean;
  push: boolean;
  model: string;
  maxIterations: number;
  provider?: string;
}

function parseArgs(): HeadlessConfig {
  const args = process.argv.slice(2);
  const config: HeadlessConfig = {
    workspace: process.cwd(),
    review: false,
    fix: false,
    commit: true,
    push: false,
    model: 'meta/llama-3.1-8b-instruct',
    maxIterations: 15,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--branch':
      case '-b':
        config.branch = args[++i];
        break;
      case '--pr':
        config.pr = parseInt(args[++i], 10);
        break;
      case '--workspace':
      case '-w':
        config.workspace = resolve(args[++i]);
        break;
      case '--review':
        config.review = true;
        break;
      case '--fix':
        config.fix = true;
        break;
      case '--no-commit':
        config.commit = false;
        break;
      case '--push':
        config.push = true;
        break;
      case '--model':
      case '-m':
        config.model = args[++i];
        break;
      case '--max-iterations':
        config.maxIterations = parseInt(args[++i], 10);
        break;
      case '--provider':
        config.provider = args[++i];
        break;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
    }
  }

  // Default to --fix if nothing specified
  if (!config.review && !config.fix && !config.branch && !config.pr) {
    config.fix = true;
  }

  return config;
}

function printHelp(): void {
  console.log(`
Michaelangelo Headless CI/CD Agent

Usage:
  michaelangelo-headless [options]

Options:
  --branch, -b <name>    Branch to review/fix (compares against main)
  --pr <number>          PR number to review
  --workspace, -w <path> Working directory (default: cwd)
  --review               Only review code (no changes)
  --fix                  Review and attempt to fix issues (default)
  --no-commit            Don't commit fixes
  --push                 Push after committing
  --model, -m <model>    Model to use (default: meta/llama-3.1-8b-instruct)
  --max-iterations <n>   Max agent loop iterations (default: 15)
  --provider <key>       Provider key (e.g., nvidia_nim, openrouter)
  --help, -h             Show this help

Examples:
  michaelangelo-headless --fix --workspace ./my-project
  michaelangelo-headless --branch feature/auth --fix --push
  michaelangelo-headless --pr 42 --review
`);
}

// ============================================================================
// GIT OPERATIONS
// ============================================================================

async function git(cmd: string, cwd: string): Promise<string> {
  try {
    const { stdout } = await execAsync(`git ${cmd}`, {
      cwd,
      timeout: 30000,
      maxBuffer: 5 * 1024 * 1024,
      env: { ...process.env, FORCE_COLOR: '0' },
    });
    return stdout.trim();
  } catch (err: any) {
    const stderr = err.stderr || '';
    throw new Error(`git ${cmd} failed: ${stderr || err.message}`);
  }
}

/**
 * Get the diff between the current branch and main/master.
 */
async function getDiff(workspace: string, branch?: string): Promise<string> {
  // Find default branch
  let baseBranch = 'main';
  try {
    const branches = await git('branch -r', workspace);
    if (!branches.includes('origin/main')) {
      baseBranch = 'master';
    }
  } catch {
    // If no remote, try local branches
    try {
      const branches = await git('branch', workspace);
      if (!branches.includes('main')) {
        baseBranch = 'master';
      }
    } catch {
      // Use main as default
    }
  }

  const ref = branch || 'HEAD';
  try {
    return await git(`diff ${baseBranch}...${ref} --stat`, workspace);
  } catch {
    // Fallback: diff against HEAD
    return await git(`diff HEAD~1 --stat`, workspace);
  }
}

/**
 * Get the full diff content.
 */
async function getFullDiff(workspace: string, branch?: string): Promise<string> {
  let baseBranch = 'main';
  try {
    const branches = await git('branch -r', workspace);
    if (!branches.includes('origin/main')) {
      baseBranch = 'master';
    }
  } catch {
    try {
      const branches = await git('branch', workspace);
      if (!branches.includes('main')) baseBranch = 'master';
    } catch { /* use main */ }
  }

  const ref = branch || 'HEAD';
  try {
    return await git(`diff ${baseBranch}...${ref}`, workspace);
  } catch {
    return await git(`diff HEAD~1`, workspace);
  }
}

/**
 * Get changed files in the diff.
 */
async function getChangedFiles(workspace: string, branch?: string): Promise<string[]> {
  let baseBranch = 'main';
  try {
    const branches = await git('branch -r', workspace);
    if (!branches.includes('origin/main')) baseBranch = 'master';
  } catch {
    try {
      const branches = await git('branch', workspace);
      if (!branches.includes('main')) baseBranch = 'master';
    } catch { /* use main */ }
  }

  const ref = branch || 'HEAD';
  try {
    const output = await git(`diff --name-only ${baseBranch}...${ref}`, workspace);
    return output.split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

// ============================================================================
// TEST RUNNER
// ============================================================================

interface TestResult {
  passed: boolean;
  output: string;
  duration: number;
}

/**
 * Auto-detect and run the project's test suite.
 */
async function runTests(workspace: string): Promise<TestResult> {
  const startTime = Date.now();
  const testCommands = [
    { file: 'package.json', cmd: 'npm test', check: 'test' },
    { file: 'Cargo.toml', cmd: 'cargo test', check: null },
    { file: 'go.mod', cmd: 'go test ./...', check: null },
    { file: 'requirements.txt', cmd: 'pytest', check: null },
    { file: 'pyproject.toml', cmd: 'pytest', check: null },
    { file: 'setup.py', cmd: 'pytest', check: null },
  ];

  // Detect project type and find test command
  let testCmd = 'npm test'; // default
  for (const tc of testCommands) {
    try {
      await access(join(workspace, tc.file));
      if (tc.check) {
        // For package.json, check if test script exists
        const pkg = JSON.parse(await readFile(join(workspace, tc.file), 'utf-8'));
        if (!pkg.scripts?.[tc.check]) continue;
      }
      testCmd = tc.cmd;
      break;
    } catch { /* file doesn't exist, continue */ }
  }

  console.log(`[Headless] Running tests: ${testCmd}`);

  try {
    const { stdout, stderr } = await execAsync(testCmd, {
      cwd: workspace,
      timeout: 5 * 60 * 1000,
      maxBuffer: 5 * 1024 * 1024,
      env: { ...process.env, FORCE_COLOR: '0', CI: '1' },
    });

    const output = stdout + (stderr ? `\n--- STDERR ---\n${stderr}` : '');
    return { passed: true, output, duration: Date.now() - startTime };
  } catch (err: any) {
    const output =
      (err.stdout || '') + (err.stderr ? `\n--- STDERR ---\n${err.stderr}` : '') + `\n--- ERROR ---\n${err.message}`;
    return { passed: false, output: output.substring(0, 10000), duration: Date.now() - startTime };
  }
}

// ============================================================================
// ORCHESTRATOR CONFIG BUILDER
// ============================================================================

function buildOrchestratorConfig(
  workspace: string,
  model: string,
  maxIterations: number,
  provider?: string,
): OrchestratorConfig {
  // Provider defaults
  const PROVIDERS: Record<string, { baseUrl: string; authPrefix: string }> = {
    nvidia_nim: { baseUrl: 'https://integrate.api.nvidia.com/v1', authPrefix: 'Bearer ' },
    openrouter: { baseUrl: 'https://openrouter.ai/api/v1', authPrefix: 'Bearer ' },
    openai: { baseUrl: 'https://api.openai.com/v1', authPrefix: 'Bearer ' },
    groq: { baseUrl: 'https://api.groq.com/openai/v1', authPrefix: 'Bearer ' },
    deepseek: { baseUrl: 'https://api.deepseek.com/v1', authPrefix: 'Bearer ' },
    together: { baseUrl: 'https://api.together.xyz/v1', authPrefix: 'Bearer ' },
    local_llm: { baseUrl: 'http://localhost:11434/v1', authPrefix: 'Bearer ' },
  };

  const providerKey = provider || 'nvidia_nim';
  const providerConfig = PROVIDERS[providerKey] || PROVIDERS.nvidia_nim;

  // Read API key from environment
  const envKeyMap: Record<string, string> = {
    nvidia_nim: 'NVIDIA_NIM_API_KEY',
    openrouter: 'OPENROUTER_API_KEY',
    openai: 'OPENAI_API_KEY',
    groq: 'GROQ_API_KEY',
    deepseek: 'DEEPSEEK_API_KEY',
    together: 'TOGETHER_API_KEY',
  };
  const apiKey = process.env[envKeyMap[providerKey] || ''] || process.env.MICHAELANGELO_API_KEY || '';

  return {
    model,
    baseUrl: providerConfig.baseUrl,
    apiKey,
    authPrefix: providerConfig.authPrefix,
    workspace,
    maxIterations,
    enableMemory: true,
    enableMCP: false,
  };
}

// ============================================================================
// MAIN HEADLESS LOOP
// ============================================================================

export async function runHeadless(): Promise<void> {
  const config = parseArgs();

  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║  Michaelangelo - Headless CI/CD Agent            ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log();
  console.log(`Workspace: ${config.workspace}`);
  console.log(`Model:     ${config.model}`);
  console.log(`Mode:      ${config.review ? 'review' : 'fix'}`);
  if (config.branch) console.log(`Branch:    ${config.branch}`);
  if (config.pr) console.log(`PR:        #${config.pr}`);
  console.log();

  // Step 1: Get diff
  console.log('━━━ Step 1: Analyzing Changes ━━━');
  const diff = await getDiff(config.workspace, config.branch);
  const changedFiles = await getChangedFiles(config.workspace, config.branch);

  if (!diff || diff.trim().length === 0) {
    console.log('No changes detected. Nothing to review.');
    return;
  }

  console.log(`Changed files: ${changedFiles.length}`);
  console.log(`Diff stats:\n${diff}\n`);

  // Step 2: Run tests
  console.log('━━━ Step 2: Running Tests ━━━');
  const testResult = await runTests(config.workspace);
  console.log(`Tests: ${testResult.passed ? '✅ PASSED' : '❌ FAILED'} (${testResult.duration}ms)`);

  if (!testResult.passed) {
    console.log(`\nTest output:\n${testResult.output.substring(0, 2000)}\n`);
  }

  // Step 3: If review-only, output report and exit
  if (config.review) {
    console.log('\n━━━ Review Complete ━━━');
    console.log(`Changed files: ${changedFiles.join(', ')}`);
    console.log(`Tests: ${testResult.passed ? 'PASS' : 'FAIL'}`);
    console.log(`Diff size: ${diff.split('\n').length} lines`);
    return;
  }

  // Step 4: If tests failed or --fix, attempt to fix
  if (!testResult.passed || config.fix) {
    console.log('\n━━━ Step 3: Agent Fix Loop ━━━');

    // Read changed files for context
    const fileContext: string[] = [];
    for (const file of changedFiles) {
      try {
        const content = await readFile(join(config.workspace, file), 'utf-8');
        fileContext.push(`--- ${file} ---\n${content.substring(0, 5000)}`);
      } catch { /* skip unreadable files */ }
    }

    // Build the agent prompt
    const fixPrompt = [
      {
        role: 'user',
        content:
          `I need you to fix the following issues in this project.\n\n` +
          `## Changed Files\n${changedFiles.join(', ')}\n\n` +
          `## Git Diff\n\`\`\`\n${diff.substring(0, 10000)}\n\`\`\`\n\n` +
          `## Test Results\n${testResult.passed ? 'All tests passed.' : `Tests FAILED:\n${testResult.output.substring(0, 5000)}`}\n\n` +
          (fileContext.length > 0 ? `## File Contents\n${fileContext.join('\n\n')}\n\n` : '') +
          `## Instructions\n` +
          `${!testResult.passed
            ? 'The tests are failing. Read the test output, understand why they fail, and fix the code to make them pass. Use edit_file for targeted changes.'
            : 'Review the code changes for bugs, security issues, or improvements. Fix any issues you find.'
          }\n\n` +
          `Workspace: ${config.workspace}\n` +
          `Use read_file, edit_file, write_file, and run_command to make changes.\n` +
          `After making changes, run the tests again to verify.`,
      },
    ];

    // Create orchestrator and run
    const orchConfig = buildOrchestratorConfig(
      config.workspace,
      config.model,
      config.maxIterations,
      config.provider,
    );

    if (!orchConfig.apiKey) {
      console.error('Error: No API key. Set MICHAELANGELO_API_KEY or provider-specific env var.');
      process.exit(1);
    }

    const orchestrator = new Orchestrator(orchConfig);
    await orchestrator.init();

    console.log('[Headless] Starting agent fix loop...');
    const result = await orchestrator.execute(fixPrompt as ChatMessage[]);
    await orchestrator.shutdown();

    // Extract final response
    const finalResponse = result.messages
      .filter((m) => m.role === 'assistant' && m.content)
      .pop()?.content || 'No response';

    console.log(`\n━━━ Agent Response ━━━\n${finalResponse}\n`);
    console.log(`Iterations: ${result.iterations}`);
    console.log(`Tool calls: ${result.toolExecutions.length}`);

    // Re-run tests to verify
    console.log('\n━━━ Step 4: Verification ━━━');
    const verifyResult = await runTests(config.workspace);
    console.log(`Tests: ${verifyResult.passed ? '✅ PASSED' : '❌ STILL FAILING'}`);

    // Step 5: Commit if tests pass
    if (verifyResult.passed && config.commit) {
      console.log('\n━━━ Step 5: Committing ━━━');
      try {
        await git('add -A', config.workspace);
        const commitMsg =
          `fix: agent auto-fixes (${result.toolExecutions.length} tool calls)\n\n` +
          `Automated fix by Michaelangelo CI/CD agent.\n` +
          `Model: ${config.model}\n` +
          `Iterations: ${result.iterations}\n\n` +
          `🤖 Generated with Michaelangelo`;
        await git(`commit -m "${commitMsg}"`, config.workspace);
        console.log('Committed successfully.');

        if (config.push) {
          console.log('Pushing...');
          const branch = config.branch || (await git('branch --show-current', config.workspace));
          await git(`push origin ${branch}`, config.workspace);
          console.log('Pushed successfully.');
        }
      } catch (err: any) {
        console.error(`Commit/push failed: ${err.message}`);
      }
    }
  }

  console.log('\n━━━ Headless Run Complete ━━━');
}

// ============================================================================
// ENTRY POINT
// ============================================================================

if (require.main === module) {
  runHeadless().catch((err) => {
    console.error('[Headless] Fatal error:', err);
    process.exit(1);
  });
}
