/**
 * Autonomous Agent Planner
 *
 * Analyzes a user's issue, retrieves similar past cases from memory,
 * decomposes the problem into an ordered plan of tool invocations,
 * and assigns confidence scores to each step.
 *
 * Architecture:
 *   User Goal → Memory Lookup → Issue Analysis → Step Decomposition → Plan
 *
 * The planner is deterministic and does NOT call an LLM — it uses
 * pattern matching and keyword extraction to build plans. An LLM
 * planner can be layered on top by replacing `analyzeProblem`.
 */

import { findSimilarIssues } from '@/lib/memory';
import type { MemorySearchResult } from '@/lib/memory';
import { MARKETPLACE_TOOL_DEFS } from '@/lib/tools';

// ─── Types ──────────────────────────────────────────────────────

export type StepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

export interface PlanStep {
  id: string;
  tool: string;
  description: string;
  parameters: Record<string, unknown>;
  dependsOn: string[];
  status: StepStatus;
  result?: unknown;
  error?: string;
  retryCount: number;
  maxRetries: number;
  confidence: number;
  durationMs?: number;
}

export interface AgentPlan {
  id: string;
  goal: string;
  analysis: ProblemAnalysis;
  steps: PlanStep[];
  similarCases: MemorySearchResult[];
  overallConfidence: number;
  status: 'planned' | 'executing' | 'completed' | 'failed' | 'escalated';
  createdAt: string;
}

export interface ProblemAnalysis {
  category: 'order_issue' | 'pricing_issue' | 'supplier_match' | 'refund_request' | 'general_inquiry';
  entities: ExtractedEntities;
  intent: string;
  complexity: 'simple' | 'moderate' | 'complex';
  requiresHumanReview: boolean;
}

export interface ExtractedEntities {
  orderIds: string[];
  rfqIds: string[];
  supplierIds: string[];
  amounts: number[];
  materials: string[];
  issueTypes: string[];
}

export interface PlannerConfig {
  maxSteps: number;
  maxRetries: number;
  minConfidence: number;
  enableMemoryLookup: boolean;
  tenantId?: string;
}

export const DEFAULT_PLANNER_CONFIG: PlannerConfig = {
  maxSteps: 8,
  maxRetries: 2,
  minConfidence: 0.3,
  enableMemoryLookup: true,
};

// ─── Entity Extraction ──────────────────────────────────────────

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const AMOUNT_RE = /\$?\d+(?:,\d{3})*(?:\.\d{1,2})?/g;

function extractEntities(text: string): ExtractedEntities {
  const lc = text.toLowerCase();
  const uuids = text.match(UUID_RE) ?? [];

  // Classify UUIDs by surrounding context
  const orderIds: string[] = [];
  const rfqIds: string[] = [];
  const supplierIds: string[] = [];

  for (const uuid of uuids) {
    const idx = lc.indexOf(uuid.toLowerCase());
    const context = lc.slice(Math.max(0, idx - 30), idx + uuid.length + 30);
    if (context.includes('order')) orderIds.push(uuid);
    else if (context.includes('rfq') || context.includes('quote')) rfqIds.push(uuid);
    else if (context.includes('supplier')) supplierIds.push(uuid);
    else orderIds.push(uuid); // default to order
  }

  const amounts = (text.match(AMOUNT_RE) ?? [])
    .map(s => parseFloat(s.replace(/[$,]/g, '')))
    .filter(n => !isNaN(n) && n > 0);

  const materials: string[] = [];
  const materialKeywords = ['aluminum', 'steel', 'titanium', 'inconel', 'abs', 'plastic', 'al-6061', 'al-7075', 'ss-304', 'ss-316', 'ti-6al4v'];
  for (const kw of materialKeywords) {
    if (lc.includes(kw)) materials.push(kw);
  }

  const issueTypes: string[] = [];
  if (lc.includes('quality')) issueTypes.push('quality');
  if (lc.includes('delivery') || lc.includes('late') || lc.includes('delay')) issueTypes.push('delivery');
  if (lc.includes('price') || lc.includes('pricing') || lc.includes('cost')) issueTypes.push('pricing');
  if (lc.includes('dispute')) issueTypes.push('dispute');
  if (lc.includes('refund') || lc.includes('return')) issueTypes.push('refund');

  return { orderIds, rfqIds, supplierIds, amounts, materials, issueTypes };
}

// ─── Problem Analysis ───────────────────────────────────────────

function analyzeProblem(goal: string): ProblemAnalysis {
  const lc = goal.toLowerCase();
  const entities = extractEntities(goal);

  // Determine category
  let category: ProblemAnalysis['category'] = 'general_inquiry';
  if (entities.issueTypes.includes('refund') || lc.includes('refund')) {
    category = 'refund_request';
  } else if (lc.includes('supplier') || lc.includes('match') || lc.includes('find')) {
    category = 'supplier_match';
  } else if (entities.issueTypes.includes('pricing') || lc.includes('requote') || lc.includes('recompute')) {
    category = 'pricing_issue';
  } else if (entities.orderIds.length > 0 || lc.includes('order') || lc.includes('status')) {
    category = 'order_issue';
  }

  // Determine intent
  let intent = 'investigate';
  if (lc.includes('refund')) intent = 'process_refund';
  else if (lc.includes('requote') || lc.includes('recompute')) intent = 'recompute_pricing';
  else if (lc.includes('match') || lc.includes('find supplier')) intent = 'match_suppliers';
  else if (lc.includes('status') || lc.includes('check')) intent = 'check_status';
  else if (lc.includes('escalat')) intent = 'escalate';

  // Complexity
  const stepCount = estimateStepCount(category, entities);
  const complexity: ProblemAnalysis['complexity'] =
    stepCount <= 2 ? 'simple' : stepCount <= 4 ? 'moderate' : 'complex';

  // Requires human review if: large refund, dispute, or complex multi-entity
  const requiresHumanReview =
    (category === 'refund_request' && entities.amounts.some(a => a > 5000)) ||
    entities.issueTypes.includes('dispute') ||
    (entities.orderIds.length > 2);

  return { category, entities, intent, complexity, requiresHumanReview };
}

function estimateStepCount(category: ProblemAnalysis['category'], entities: ExtractedEntities): number {
  switch (category) {
    case 'order_issue': return 1 + (entities.issueTypes.length > 0 ? 1 : 0);
    case 'pricing_issue': return 2;
    case 'supplier_match': return 2;
    case 'refund_request': return 3; // check → refund → verify
    case 'general_inquiry': return 1;
  }
}

// ─── Step Generation ────────────────────────────────────────────

let _stepCounter = 0;
function stepId(): string {
  return `step-${++_stepCounter}-${Date.now().toString(36)}`;
}

function generateSteps(
  analysis: ProblemAnalysis,
  goal: string,
  config: PlannerConfig,
): PlanStep[] {
  const steps: PlanStep[] = [];
  const { category, entities } = analysis;

  switch (category) {
    case 'order_issue': {
      const orderId = entities.orderIds[0] ?? 'unknown';
      steps.push({
        id: stepId(),
        tool: 'check_order',
        description: `Look up order ${orderId} status and details`,
        parameters: { orderId },
        dependsOn: [],
        status: 'pending',
        retryCount: 0,
        maxRetries: config.maxRetries,
        confidence: orderId !== 'unknown' ? 0.9 : 0.4,
      });

      if (entities.issueTypes.includes('pricing')) {
        const rfqId = entities.rfqIds[0];
        if (rfqId) {
          steps.push({
            id: stepId(),
            tool: 'recompute_quote',
            description: `Recompute pricing for RFQ ${rfqId}`,
            parameters: { rfqId },
            dependsOn: [steps[0].id],
            status: 'pending',
            retryCount: 0,
            maxRetries: config.maxRetries,
            confidence: 0.8,
          });
        }
      }

      if (entities.issueTypes.includes('quality') || entities.issueTypes.includes('delivery')) {
        steps.push({
          id: stepId(),
          tool: 'escalate',
          description: `Escalate ${entities.issueTypes[0]} issue for order ${orderId}`,
          parameters: {
            orderId,
            issueType: entities.issueTypes[0] ?? 'other',
            description: goal,
            priority: entities.issueTypes.includes('quality') ? 'high' : 'medium',
          },
          dependsOn: [steps[0].id],
          status: 'pending',
          retryCount: 0,
          maxRetries: 1,
          confidence: 0.85,
        });
      }
      break;
    }

    case 'pricing_issue': {
      const rfqId = entities.rfqIds[0] ?? entities.orderIds[0] ?? 'unknown';
      steps.push({
        id: stepId(),
        tool: 'recompute_quote',
        description: `Recompute quote for RFQ ${rfqId}`,
        parameters: {
          rfqId,
          supplierId: entities.supplierIds[0],
          quantity: entities.amounts[0],
        },
        dependsOn: [],
        status: 'pending',
        retryCount: 0,
        maxRetries: config.maxRetries,
        confidence: rfqId !== 'unknown' ? 0.85 : 0.4,
      });

      if (entities.supplierIds.length === 0) {
        steps.push({
          id: stepId(),
          tool: 'match_suppliers',
          description: 'Find best matching suppliers for requoting',
          parameters: {
            material: entities.materials[0] ?? 'al-6061',
            process: 'cnc-milling',
          },
          dependsOn: [],
          status: 'pending',
          retryCount: 0,
          maxRetries: config.maxRetries,
          confidence: 0.7,
        });
      }
      break;
    }

    case 'supplier_match': {
      steps.push({
        id: stepId(),
        tool: 'match_suppliers',
        description: `Find suppliers matching: ${entities.materials.join(', ') || 'general manufacturing'}`,
        parameters: {
          material: entities.materials[0] ?? 'al-6061',
          process: 'cnc-milling',
        },
        dependsOn: [],
        status: 'pending',
        retryCount: 0,
        maxRetries: config.maxRetries,
        confidence: 0.8,
      });
      break;
    }

    case 'refund_request': {
      const orderId = entities.orderIds[0] ?? 'unknown';

      // Step 1: Check the order first
      const checkStep: PlanStep = {
        id: stepId(),
        tool: 'check_order',
        description: `Verify order ${orderId} before processing refund`,
        parameters: { orderId },
        dependsOn: [],
        status: 'pending',
        retryCount: 0,
        maxRetries: config.maxRetries,
        confidence: orderId !== 'unknown' ? 0.9 : 0.3,
      };
      steps.push(checkStep);

      // Step 2: Process refund
      const refundStep: PlanStep = {
        id: stepId(),
        tool: 'refund',
        description: `Process refund for order ${orderId}`,
        parameters: {
          orderId,
          reason: goal,
          amountUsd: entities.amounts[0],
        },
        dependsOn: [checkStep.id],
        status: 'pending',
        retryCount: 0,
        maxRetries: 1, // refunds get fewer retries
        confidence: 0.75,
      };
      steps.push(refundStep);

      // Step 3: Escalate if high-value or flagged
      if (analysis.requiresHumanReview) {
        steps.push({
          id: stepId(),
          tool: 'escalate',
          description: 'Escalate high-value refund for manual approval',
          parameters: {
            orderId,
            issueType: 'pricing',
            description: `High-value refund request: ${goal}`,
            priority: 'high',
          },
          dependsOn: [refundStep.id],
          status: 'pending',
          retryCount: 0,
          maxRetries: 1,
          confidence: 0.9,
        });
      }
      break;
    }

    case 'general_inquiry':
    default: {
      // If we have an order ID, check it
      if (entities.orderIds.length > 0) {
        steps.push({
          id: stepId(),
          tool: 'check_order',
          description: `Look up order ${entities.orderIds[0]}`,
          parameters: { orderId: entities.orderIds[0] },
          dependsOn: [],
          status: 'pending',
          retryCount: 0,
          maxRetries: config.maxRetries,
          confidence: 0.7,
        });
      } else {
        // Escalate to human
        steps.push({
          id: stepId(),
          tool: 'escalate',
          description: 'Route to human support — unable to automatically resolve',
          parameters: {
            issueType: 'other',
            description: goal,
            priority: 'medium',
          },
          dependsOn: [],
          status: 'pending',
          retryCount: 0,
          maxRetries: 1,
          confidence: 0.5,
        });
      }
      break;
    }
  }

  return steps.slice(0, config.maxSteps);
}

// ─── Confidence Scoring ─────────────────────────────────────────

function computeOverallConfidence(
  steps: PlanStep[],
  similarCases: MemorySearchResult[],
  analysis: ProblemAnalysis,
): number {
  if (steps.length === 0) return 0;

  // Base: average step confidence
  const avgStepConf = steps.reduce((s, st) => s + st.confidence, 0) / steps.length;

  // Boost from similar past cases
  const memoryBoost = similarCases.length > 0
    ? Math.min(0.15, similarCases[0].similarity * 0.2)
    : 0;

  // Penalty for complexity
  const complexityPenalty = analysis.complexity === 'complex' ? 0.1
    : analysis.complexity === 'moderate' ? 0.05 : 0;

  // Penalty if human review needed
  const humanPenalty = analysis.requiresHumanReview ? 0.1 : 0;

  return Math.max(0.1, Math.min(0.95, avgStepConf + memoryBoost - complexityPenalty - humanPenalty));
}

// ─── Public API ─────────────────────────────────────────────────

/**
 * Create an execution plan for a user's issue/goal.
 *
 * 1. Analyze the problem (extract entities, classify)
 * 2. Search memory for similar past cases
 * 3. Generate ordered tool invocation steps
 * 4. Score overall confidence
 */
export async function createPlan(
  goal: string,
  config: Partial<PlannerConfig> = {},
): Promise<AgentPlan> {
  const cfg: PlannerConfig = { ...DEFAULT_PLANNER_CONFIG, ...config };

  // Step 1: Analyze
  const analysis = analyzeProblem(goal);

  // Step 2: Memory lookup
  let similarCases: MemorySearchResult[] = [];
  if (cfg.enableMemoryLookup) {
    try {
      similarCases = await findSimilarIssues(goal, {
        tenantId: cfg.tenantId,
        limit: 3,
        successOnly: true,
      });
    } catch {
      // Non-blocking — memory is advisory
    }
  }

  // Step 3: Generate steps
  const steps = generateSteps(analysis, goal, cfg);

  // Step 4: Confidence
  const overallConfidence = computeOverallConfidence(steps, similarCases, analysis);

  return {
    id: `plan-${Date.now().toString(36)}`,
    goal,
    analysis,
    steps,
    similarCases,
    overallConfidence,
    status: 'planned',
    createdAt: new Date().toISOString(),
  };
}

export { analyzeProblem, extractEntities, generateSteps, computeOverallConfidence };
