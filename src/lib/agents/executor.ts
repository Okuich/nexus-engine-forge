/**
 * Autonomous Agent Executor
 *
 * Executes an AgentPlan step-by-step with:
 *   - Dependency-ordered execution
 *   - Retry logic with exponential backoff
 *   - Confidence-gated execution (skip low-confidence steps)
 *   - Fallback to human escalation on repeated failure
 *   - Memory storage of outcomes for learning
 *
 * Architecture:
 *   Plan → Dependency Sort → Execute Steps → Verify → Store to Memory
 *         ↑                                    │
 *         └── retry on failure ←───────────────┘
 */

import { executeTool } from '@/lib/tools';
import { storeIssueResolution } from '@/lib/memory';
import type { ToolResult } from '@/lib/tools';
import type { AgentPlan, PlanStep, StepStatus } from './planner';

// ─── Types ──────────────────────────────────────────────────────

export interface ExecutionConfig {
  /** Minimum confidence to execute a step (default 0.3) */
  minConfidence: number;
  /** Base retry delay in ms (default 500) */
  baseRetryDelayMs: number;
  /** Maximum total execution time in ms (default 30000) */
  maxExecutionTimeMs: number;
  /** Auto-escalate after N total failures (default 3) */
  autoEscalateAfterFailures: number;
  /** Tenant ID for memory storage */
  tenantId?: string;
  /** Callback for step status changes */
  onStepUpdate?: (step: PlanStep, result?: ToolResult) => void;
}

export const DEFAULT_EXECUTION_CONFIG: ExecutionConfig = {
  minConfidence: 0.3,
  baseRetryDelayMs: 500,
  maxExecutionTimeMs: 30_000,
  autoEscalateAfterFailures: 3,
};

export interface ExecutionReport {
  planId: string;
  goal: string;
  status: 'completed' | 'partial' | 'failed' | 'escalated';
  steps: PlanStep[];
  results: Map<string, ToolResult>;
  totalDurationMs: number;
  successCount: number;
  failureCount: number;
  skippedCount: number;
  escalated: boolean;
  escalationReason?: string;
  overallConfidence: number;
}

// ─── Dependency Resolution ──────────────────────────────────────

function getReadySteps(steps: PlanStep[]): PlanStep[] {
  const completed = new Set(
    steps.filter(s => s.status === 'completed' || s.status === 'skipped').map(s => s.id),
  );

  return steps.filter(s =>
    s.status === 'pending' &&
    s.dependsOn.every(dep => completed.has(dep)),
  );
}

function allDepsSucceeded(step: PlanStep, steps: PlanStep[]): boolean {
  return step.dependsOn.every(depId => {
    const dep = steps.find(s => s.id === depId);
    return dep?.status === 'completed';
  });
}

// ─── Retry with Backoff ─────────────────────────────────────────

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function executeWithRetry(
  step: PlanStep,
  config: ExecutionConfig,
  onUpdate?: (step: PlanStep, result?: ToolResult) => void,
): Promise<ToolResult> {
  let lastResult: ToolResult | null = null;

  for (let attempt = 0; attempt <= step.maxRetries; attempt++) {
    if (attempt > 0) {
      step.retryCount = attempt;
      const delay = config.baseRetryDelayMs * Math.pow(2, attempt - 1);
      await sleep(Math.min(delay, 5000));
    }

    step.status = 'running';
    onUpdate?.(step);

    const start = performance.now();

    try {
      lastResult = await executeTool(step.tool, step.parameters);
      step.durationMs = Math.round(performance.now() - start);

      if (lastResult.success) {
        step.status = 'completed';
        step.result = lastResult.data;
        onUpdate?.(step, lastResult);
        return lastResult;
      }

      // Tool returned success=false — might be recoverable
      step.error = JSON.stringify(lastResult.data);
    } catch (err) {
      step.durationMs = Math.round(performance.now() - start);
      step.error = (err as Error).message;
    }
  }

  // All retries exhausted
  step.status = 'failed';
  onUpdate?.(step, lastResult ?? undefined);

  return lastResult ?? {
    tool: step.tool,
    success: false,
    data: { error: step.error ?? 'Unknown error after retries' },
    warnings: [],
    durationMs: step.durationMs ?? 0,
  };
}

// ─── Auto-Escalation ────────────────────────────────────────────

async function autoEscalate(
  plan: AgentPlan,
  reason: string,
  config: ExecutionConfig,
): Promise<ToolResult> {
  return executeTool('escalate', {
    issueType: plan.analysis.category === 'refund_request' ? 'pricing'
      : plan.analysis.category === 'order_issue' ? 'delivery'
      : 'other',
    description: `Auto-escalation: ${reason}. Original goal: ${plan.goal}`,
    priority: 'high',
    orderId: plan.analysis.entities.orderIds[0],
  });
}

// ─── Main Executor ──────────────────────────────────────────────

/**
 * Execute an AgentPlan with dependency ordering, retry logic,
 * confidence gating, and automatic human escalation fallback.
 */
export async function executePlan(
  plan: AgentPlan,
  config: Partial<ExecutionConfig> = {},
): Promise<ExecutionReport> {
  const cfg: ExecutionConfig = { ...DEFAULT_EXECUTION_CONFIG, ...config };
  const start = performance.now();
  const results = new Map<string, ToolResult>();

  plan.status = 'executing';

  let totalFailures = 0;
  let escalated = false;
  let escalationReason: string | undefined;

  // Execute steps in dependency order
  while (true) {
    const elapsed = performance.now() - start;
    if (elapsed > cfg.maxExecutionTimeMs) {
      escalationReason = `Execution timeout after ${Math.round(elapsed)}ms`;
      break;
    }

    const ready = getReadySteps(plan.steps);
    if (ready.length === 0) break; // All done or blocked

    // Execute ready steps (sequentially for determinism in this layer)
    for (const step of ready) {
      // Confidence gate
      if (step.confidence < cfg.minConfidence) {
        step.status = 'skipped';
        step.error = `Confidence ${step.confidence} below threshold ${cfg.minConfidence}`;
        cfg.onStepUpdate?.(step);
        continue;
      }

      // Skip if dependencies failed (unless it's an escalation step)
      if (!allDepsSucceeded(step, plan.steps) && step.tool !== 'escalate') {
        step.status = 'skipped';
        step.error = 'Dependency step failed';
        cfg.onStepUpdate?.(step);
        continue;
      }

      const result = await executeWithRetry(step, cfg, cfg.onStepUpdate);
      results.set(step.id, result);

      if (!result.success) {
        totalFailures++;
      }

      // Auto-escalate if too many failures
      if (totalFailures >= cfg.autoEscalateAfterFailures && !escalated) {
        escalated = true;
        escalationReason = `${totalFailures} step failures exceeded threshold`;
        const escResult = await autoEscalate(plan, escalationReason, cfg);
        results.set('auto-escalation', escResult);
        break;
      }
    }

    // Check if we should stop due to escalation
    if (escalated) break;
  }

  const totalDurationMs = Math.round(performance.now() - start);

  // Compute summary
  const successCount = plan.steps.filter(s => s.status === 'completed').length;
  const failureCount = plan.steps.filter(s => s.status === 'failed').length;
  const skippedCount = plan.steps.filter(s => s.status === 'skipped').length;

  const status: ExecutionReport['status'] = escalated ? 'escalated'
    : failureCount === plan.steps.length ? 'failed'
    : failureCount > 0 ? 'partial'
    : 'completed';

  plan.status = status === 'escalated' ? 'escalated'
    : status === 'failed' ? 'failed'
    : 'completed';

  // Recompute confidence based on outcomes
  const overallConfidence = plan.steps.length > 0
    ? successCount / plan.steps.length * plan.overallConfidence
    : 0;

  const report: ExecutionReport = {
    planId: plan.id,
    goal: plan.goal,
    status,
    steps: plan.steps,
    results,
    totalDurationMs,
    successCount,
    failureCount,
    skippedCount,
    escalated,
    escalationReason,
    overallConfidence: +overallConfidence.toFixed(3),
  };

  // Store outcome in memory (non-blocking)
  storeOutcomeToMemory(plan, report, cfg.tenantId).catch(() => {});

  return report;
}

// ─── Memory Storage ─────────────────────────────────────────────

async function storeOutcomeToMemory(
  plan: AgentPlan,
  report: ExecutionReport,
  tenantId?: string,
): Promise<void> {
  const toolsUsed = plan.steps
    .filter(s => s.status === 'completed')
    .map(s => s.tool);

  const resolution = report.status === 'completed'
    ? `Successfully resolved: ${plan.goal}. Used tools: ${toolsUsed.join(', ')}`
    : report.status === 'escalated'
    ? `Escalated to human: ${report.escalationReason}`
    : `Failed to resolve: ${plan.goal}. ${report.failureCount} step(s) failed.`;

  await storeIssueResolution(plan.goal, resolution, {
    toolsUsed,
    agentTypes: ['autonomous'],
    tags: [plan.analysis.category, plan.analysis.intent],
    success: report.status === 'completed',
    confidence: report.overallConfidence,
    durationMs: report.totalDurationMs,
    tenantId,
  });
}

// ─── Convenience: Plan + Execute ────────────────────────────────

import { createPlan } from './planner';
import type { PlannerConfig } from './planner';

export interface AgentRunConfig {
  planner?: Partial<PlannerConfig>;
  executor?: Partial<ExecutionConfig>;
}

/**
 * One-shot: analyze, plan, and execute an autonomous agent run.
 */
export async function runAgent(
  goal: string,
  config: AgentRunConfig = {},
): Promise<{ plan: AgentPlan; report: ExecutionReport }> {
  const plan = await createPlan(goal, config.planner);
  const report = await executePlan(plan, config.executor);
  return { plan, report };
}
