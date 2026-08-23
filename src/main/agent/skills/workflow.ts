/**
 * Michaelangelo Agent - Workflow Meta-Tools
 *
 * High-level Git and Issue Tracker tools for the agent:
 *   - create_branch: Create and switch to a new branch
 *   - commit_changes: Stage all changes and commit with a message
 *   - open_pull_request: Create a PR via GitHub CLI (gh) or Git
 *   - update_ticket_status: Update issue/ticket status via GitHub CLI
 *
 * These tools let the agent operate at a higher level than raw git commands,
 * wrapping complex multi-step workflows into single tool calls.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { AgentSkill, ExecutionContext, ToolResult } from '../types';

const execAsync = promisify(exec);

async function git(cmd: string, cwd: string): Promise<{ stdout: string; stderr: string }> {
  return execAsync(`git ${cmd}`, {
    cwd,
    timeout: 30000,
    maxBuffer: 5 * 1024 * 1024,
    env: { ...process.env, FORCE_COLOR: '0' },
  });
}

async function gh(args: string, cwd: string): Promise<{ stdout: string; stderr: string }> {
  return execAsync(`gh ${args}`, {
    cwd,
    timeout: 30000,
    maxBuffer: 5 * 1024 * 1024,
    env: { ...process.env, FORCE_COLOR: '0' },
  });
}

// ============================================================================
// WORKFLOW META-TOOLS
// ============================================================================

export const WorkflowMetaTools: AgentSkill = {
  name: 'workflow',
  description: 'High-level Git workflows: branching, committing, PRs, and tickets',
  tools: [
    {
      type: 'function',
      function: {
        name: 'create_branch',
        description:
          'Create a new git branch and switch to it. If the branch already exists, switch to it.',
        parameters: {
          type: 'object',
          properties: {
            branch_name: {
              type: 'string',
              description: 'Name of the branch to create (e.g., "feature/auth", "fix/memory-leak")',
            },
          },
          required: ['branch_name'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'commit_changes',
        description:
          'Stage all modified/new files and create a git commit with the given message. ' +
          'This follows conventional commit format automatically.',
        parameters: {
          type: 'object',
          properties: {
            message: {
              type: 'string',
              description:
                'Commit message describing the changes. Use imperative mood (e.g., "add user authentication").',
            },
            files: {
              type: 'string',
              description:
                'Optional: specific files to stage (space-separated). If omitted, stages all changes.',
            },
          },
          required: ['message'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'open_pull_request',
        description:
          'Create a GitHub Pull Request for the current branch. Uses `gh` CLI if available, otherwise uses git push. ' +
          'Automatically generates a PR title and description from the commit history.',
        parameters: {
          type: 'object',
          properties: {
            title: {
              type: 'string',
              description: 'PR title (optional — auto-generated from commits if omitted)',
            },
            description: {
              type: 'string',
              description: 'PR body/description (optional — auto-generated if omitted)',
            },
            base_branch: {
              type: 'string',
              description: 'Target branch to merge into (default: main)',
            },
          },
          required: [],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'update_ticket_status',
        description:
          'Update the status of a GitHub Issue or pull request. ' +
          'Can add labels, close issues, or add comments. Requires `gh` CLI.',
        parameters: {
          type: 'object',
          properties: {
            issue_number: {
              type: 'number',
              description: 'Issue or PR number',
            },
            action: {
              type: 'string',
              description: 'Action to perform: "close", "reopen", "label", "comment"',
              enum: ['close', 'reopen', 'label', 'comment'],
            },
            comment: {
              type: 'string',
              description: 'Comment text (required if action is "comment")',
            },
            labels: {
              type: 'string',
              description: 'Comma-separated labels (required if action is "label")',
            },
          },
          required: ['issue_number', 'action'],
        },
      },
    },
  ],

  async execute(toolName: string, args: Record<string, any>, ctx: ExecutionContext): Promise<ToolResult> {
    const startTime = Date.now();
    const cwd = ctx.workspace;

    try {
      switch (toolName) {
        case 'create_branch': {
          const { branch_name } = args;
          if (!branch_name) {
            return { success: false, output: '', error: 'branch_name is required', duration_ms: Date.now() - startTime };
          }

          // Check if branch exists
          let branchExists = false;
          try {
            const { stdout } = await git('branch --list ' + branch_name, cwd);
            branchExists = stdout.trim().length > 0;
          } catch { /* branch doesn't exist */ }

          if (branchExists) {
            await git(`checkout ${branch_name}`, cwd);
            return {
              success: true,
              output: `Switched to existing branch: ${branch_name}`,
              duration_ms: Date.now() - startTime,
            };
          }

          // Create and switch
          await git(`checkout -b ${branch_name}`, cwd);
          return {
            success: true,
            output: `Created and switched to branch: ${branch_name}`,
            duration_ms: Date.now() - startTime,
          };
        }

        case 'commit_changes': {
          const { message, files } = args;
          if (!message) {
            return { success: false, output: '', error: 'message is required', duration_ms: Date.now() - startTime };
          }

          // Stage files
          if (files) {
            await git(`add ${files}`, cwd);
          } else {
            await git('add -A', cwd);
          }

          // Check if there are staged changes
          let hasStaged = false;
          try {
            const { stdout } = await git('diff --cached --stat', cwd);
            hasStaged = stdout.trim().length > 0;
          } catch { /* no staged */ }

          if (!hasStaged) {
            return {
              success: true,
              output: 'No changes to commit (working tree clean)',
              duration_ms: Date.now() - startTime,
            };
          }

          // Commit with conventional format
          const formattedMsg = message.startsWith('fix:') || message.startsWith('feat:')
            ? message
            : `feat: ${message}`;

          const { stdout } = await git(
            `commit -m "${formattedMsg.replace(/"/g, '\\"')}"`,
            cwd,
          );

          // Get commit info
          const shortHash = await git('rev-parse --short HEAD', cwd);
          const stats = await git('diff HEAD~1 --stat', cwd);

          return {
            success: true,
            output: `Committed as ${shortHash.stdout.trim()}\n\n${stdout}\n\n${stats.stdout}`,
            duration_ms: Date.now() - startTime,
          };
        }

        case 'open_pull_request': {
          const { title, description, base_branch = 'main' } = args;

          // Get current branch
          const currentBranch = (await git('branch --show-current', cwd)).stdout.trim();

          if (currentBranch === base_branch) {
            return {
              success: false,
              output: '',
              error: `Cannot create PR: already on ${base_branch}`,
              duration_ms: Date.now() - startTime,
            };
          }

          // Push branch first
          try {
            await git(`push -u origin ${currentBranch}`, cwd);
          } catch {
            // May need upstream tracking
            try {
              await git(`push --set-upstream origin ${currentBranch}`, cwd);
            } catch (err: any) {
              return {
                success: false,
                output: '',
                error: `Failed to push branch: ${err.message}`,
                duration_ms: Date.now() - startTime,
              };
            }
          }

          // Try gh CLI first
          try {
            const prTitle = title || `feat: changes from ${currentBranch}`;
            const prBody = description || await generatePRDescription(cwd, base_branch);

            const { stdout } = await gh(
              `pr create --base ${base_branch} --head ${currentBranch} --title "${prTitle.replace(/"/g, '\\"')}" --body "${prBody.replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`,
              cwd,
            );

            return {
              success: true,
              output: `Pull Request created!\n${stdout}`,
              duration_ms: Date.now() - startTime,
            };
          } catch {
            // gh CLI not available — provide manual instructions
            const remoteUrl = (await git('remote get-url origin', cwd)).stdout.trim();
            return {
              success: true,
              output:
                `Branch pushed to origin/${currentBranch}\n\n` +
                `To create the PR manually:\n` +
                `1. Go to: ${remoteUrl}\n` +
                `2. Create PR: ${currentBranch} → ${base_branch}\n\n` +
                `Or install GitHub CLI (gh) for automatic PR creation.`,
              duration_ms: Date.now() - startTime,
            };
          }
        }

        case 'update_ticket_status': {
          const { issue_number, action, comment, labels } = args;

          if (!issue_number) {
            return { success: false, output: '', error: 'issue_number is required', duration_ms: Date.now() - startTime };
          }

          switch (action) {
            case 'close': {
              const { stdout } = await gh(`issue close ${issue_number}`, cwd);
              return { success: true, output: stdout || `Issue #${issue_number} closed`, duration_ms: Date.now() - startTime };
            }
            case 'reopen': {
              const { stdout } = await gh(`issue reopen ${issue_number}`, cwd);
              return { success: true, output: stdout || `Issue #${issue_number} reopened`, duration_ms: Date.now() - startTime };
            }
            case 'label': {
              if (!labels) {
                return { success: false, output: '', error: 'labels is required for label action', duration_ms: Date.now() - startTime };
              }
              const labelList = labels.split(',').map((l: string) => l.trim()).join(',');
              const { stdout } = await gh(`issue edit ${issue_number} --add-label "${labelList}"`, cwd);
              return { success: true, output: stdout || `Labels added to #${issue_number}: ${labelList}`, duration_ms: Date.now() - startTime };
            }
            case 'comment': {
              if (!comment) {
                return { success: false, output: '', error: 'comment is required for comment action', duration_ms: Date.now() - startTime };
              }
              const { stdout } = await gh(`issue comment ${issue_number} --body "${comment.replace(/"/g, '\\"')}"`, cwd);
              return { success: true, output: stdout || `Comment added to #${issue_number}`, duration_ms: Date.now() - startTime };
            }
            default:
              return { success: false, output: '', error: `Unknown action: ${action}`, duration_ms: Date.now() - startTime };
          }
        }

        default:
          return { success: false, output: '', error: `Unknown workflow tool: ${toolName}`, duration_ms: Date.now() - startTime };
      }
    } catch (err: any) {
      return {
        success: false,
        output: '',
        error: `${toolName} failed: ${err.message}`,
        duration_ms: Date.now() - startTime,
      };
    }
  },
};

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Generate a PR description from commit history.
 */
async function generatePRDescription(cwd: string, baseBranch: string): Promise<string> {
  try {
    const { stdout: log } = await git(`log ${baseBranch}..HEAD --oneline`, cwd);
    const commits = log.trim().split('\n').filter(Boolean);

    const description = [
      '## Changes',
      '',
      commits.map((c) => `- ${c}`).join('\n'),
      '',
      `**Commits:** ${commits.length}`,
      '',
      '---',
      '*Generated by Michaelangelo Agent*',
    ];

    return description.join('\n');
  } catch {
    return '## Changes\n\nAuto-generated PR by Michaelangelo Agent.';
  }
}
