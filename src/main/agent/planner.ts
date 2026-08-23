/**
 * Michaelangelo Agent - Cascading Planner (Windsurf/Aider style)
 *
 * Separates planning from execution. Before making any file changes,
 * the agent enters a read-only research state to explore the codebase
 * and output a structured Execution Plan.
 *
 * Flow:
 *  1. User sends a prompt
 *  2. Agent enters PLANNING mode (read-only tools only)
 *  3. Agent explores codebase via repo map, read_file, search_files
 *  4. Agent outputs a structured ExecutionPlan with numbered steps
 *  5. GUI pauses the ReAct loop and presents plan for user approval
 *  6. User approves → agent enters EXECUTION mode
 *  7. Agent executes steps sequentially, reporting progress
 */

// ============================================================================
// TYPES
// ============================================================================

export type PlanStatus = 'drafting' | 'pending_approval' | 'approved' | 'executing' | 'completed' | 'rejected';

export interface PlanStep {
  id: number;
  description: string;
  tool: string;           // Which tool will be used
  target?: string;        // Target file/path
  args?: Record<string, any>;
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped';
  result?: string;
}

export interface ExecutionPlan {
  id: string;
  status: PlanStatus;
  goal: string;
  steps: PlanStep[];
  createdAt: number;
  approvedAt?: number;
  completedAt?: number;
  estimatedTokens?: number;
  reasoning: string;      // Why this plan was chosen
}

export interface PlannerConfig {
  /** Max steps in a plan */
  maxSteps?: number;
  /** Auto-approve plans under this step count (0 = never auto-approve) */
  autoApproveThreshold?: number;
}

// ============================================================================
// PLANNER
// ============================================================================

export class CascadingPlanner {
  private currentPlan: ExecutionPlan | null = null;
  private planHistory: ExecutionPlan[] = [];
  private config: Required<PlannerConfig>;

  constructor(config?: PlannerConfig) {
    this.config = {
      maxSteps: 20,
      autoApproveThreshold: 0,
      ...config,
    };
  }

  /**
   * Create a new plan from the agent's research output.
   * The plan starts in 'drafting' status.
   */
  createPlan(goal: string, reasoning: string): ExecutionPlan {
    const plan: ExecutionPlan = {
      id: `plan_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      status: 'drafting',
      goal,
      steps: [],
      createdAt: Date.now(),
      reasoning,
    };
    this.currentPlan = plan;
    return plan;
  }

  /**
   * Add a step to the current plan.
   */
  addStep(description: string, tool: string, target?: string, args?: Record<string, any>): PlanStep | null {
    if (!this.currentPlan || this.currentPlan.status !== 'drafting') return null;
    if (this.currentPlan.steps.length >= this.config.maxSteps) return null;

    const step: PlanStep = {
      id: this.currentPlan.steps.length + 1,
      description,
      tool,
      target,
      args,
      status: 'pending',
    };
    this.currentPlan.steps.push(step);
    return step;
  }

  /**
   * Finalize the plan and move to pending_approval status.
   * Returns whether the plan was auto-approved.
   */
  finalizePlan(): { plan: ExecutionPlan; autoApproved: boolean } {
    if (!this.currentPlan) throw new Error('No active plan to finalize');

    this.currentPlan.status = 'pending_approval';
    this.currentPlan.estimatedTokens = this.estimatePlanTokens();

    const autoApproved = this.config.autoApproveThreshold > 0 &&
      this.currentPlan.steps.length <= this.config.autoApproveThreshold;

    if (autoApproved) {
      this.currentPlan.status = 'approved';
      this.currentPlan.approvedAt = Date.now();
    }

    return { plan: this.currentPlan, autoApproved };
  }

  /**
   * User approves the plan.
   */
  approvePlan(planId?: string): ExecutionPlan {
    const plan = planId ? this.findPlan(planId) : this.currentPlan;
    if (!plan) throw new Error('Plan not found');
    if (plan.status !== 'pending_approval') throw new Error(`Plan is ${plan.status}, not pending approval`);

    plan.status = 'approved';
    plan.approvedAt = Date.now();
    return plan;
  }

  /**
   * User rejects the plan.
   */
  rejectPlan(planId?: string): ExecutionPlan {
    const plan = planId ? this.findPlan(planId) : this.currentPlan;
    if (!plan) throw new Error('Plan not found');

    plan.status = 'rejected';
    this.planHistory.push(plan);
    if (this.currentPlan === plan) this.currentPlan = null;
    return plan;
  }

  /**
   * Start executing a step.
   */
  startStep(stepId: number): PlanStep | null {
    if (!this.currentPlan || this.currentPlan.status !== 'approved') return null;
    const step = this.currentPlan.steps.find(s => s.id === stepId);
    if (!step) return null;
    step.status = 'in_progress';
    this.currentPlan.status = 'executing';
    return step;
  }

  /**
   * Complete a step with its result.
   */
  completeStep(stepId: number, result: string, success: boolean): PlanStep | null {
    if (!this.currentPlan) return null;
    const step = this.currentPlan.steps.find(s => s.id === stepId);
    if (!step) return null;
    step.status = success ? 'completed' : 'failed';
    step.result = result;

    // Check if all steps are done
    const allDone = this.currentPlan.steps.every(s =>
      s.status === 'completed' || s.status === 'skipped' || s.status === 'failed'
    );
    if (allDone) {
      this.currentPlan.status = 'completed';
      this.currentPlan.completedAt = Date.now();
      this.planHistory.push(this.currentPlan);
    }

    return step;
  }

  /**
   * Get the next pending step.
   */
  getNextStep(): PlanStep | null {
    if (!this.currentPlan) return null;
    return this.currentPlan.steps.find(s => s.status === 'pending') || null;
  }

  /**
   * Get current plan.
   */
  getCurrentPlan(): ExecutionPlan | null {
    return this.currentPlan;
  }

  /**
   * Format plan for LLM consumption (system message injection).
   */
  formatPlanForLLM(plan: ExecutionPlan): string {
    const stepsText = plan.steps.map(s => {
      const statusIcon = {
        pending: '○', in_progress: '◐', completed: '●',
        failed: '✗', skipped: '–',
      }[s.status];
      return `  ${statusIcon} Step ${s.id}: ${s.description} [${s.tool}]${s.target ? ` → ${s.target}` : ''}`;
    }).join('\n');

    return `## Execution Plan (${plan.status})
Goal: ${plan.goal}
Reasoning: ${plan.reasoning}

Steps:
${stepsText}

${plan.status === 'pending_approval' ? '⏸ Waiting for user approval before executing.' : ''}
${plan.status === 'approved' || plan.status === 'executing' ? '▶ Execute the next pending step.' : ''}`;
  }

  /**
   * Format plan for GUI display (JSON).
   */
  formatPlanForGUI(plan: ExecutionPlan): object {
    return {
      id: plan.id,
      status: plan.status,
      goal: plan.goal,
      reasoning: plan.reasoning,
      steps: plan.steps.map(s => ({
        id: s.id,
        description: s.description,
        tool: s.tool,
        target: s.target,
        status: s.status,
        result: s.result,
      })),
      createdAt: plan.createdAt,
      approvedAt: plan.approvedAt,
      completedAt: plan.completedAt,
      estimatedTokens: plan.estimatedTokens,
    };
  }

  /**
   * Get plan history.
   */
  getHistory(): ExecutionPlan[] {
    return [...this.planHistory];
  }

  /**
   * Check if the agent should be in planning mode.
   */
  isPlanning(): boolean {
    return this.currentPlan?.status === 'drafting';
  }

  /**
   * Check if the agent should be executing.
   */
  isExecuting(): boolean {
    return this.currentPlan?.status === 'approved' || this.currentPlan?.status === 'executing';
  }

  /**
   * Check if waiting for user approval.
   */
  isPendingApproval(): boolean {
    return this.currentPlan?.status === 'pending_approval';
  }

  reset(): void {
    this.currentPlan = null;
  }

  // ==========================================================================
  // PRIVATE
  // ==========================================================================

  private findPlan(planId: string): ExecutionPlan | undefined {
    if (this.currentPlan?.id === planId) return this.currentPlan;
    return this.planHistory.find(p => p.id === planId);
  }

  private estimatePlanTokens(): number {
    if (!this.currentPlan) return 0;
    // Rough estimate: ~4 chars per token
    let chars = this.currentPlan.goal.length + this.currentPlan.reasoning.length;
    for (const step of this.currentPlan.steps) {
      chars += step.description.length + (step.target?.length || 0) + 50;
    }
    return Math.ceil(chars / 4);
  }
}
