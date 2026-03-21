/**
 * Learning Loop Service — Orchestrates the self-learning cycle
 *
 * Flow: Capture Outcome → Compute Reward → Update Weights →
 *       Store Resolution → Build Context for Future Responses
 */

import { supabase } from '@/integrations/supabase/client';
import { storeIssueResolution, findSimilarIssues, recordFeedback } from '@/lib/memory/service';
import { computeReward, updateWeights, createDefaultWeights } from './reinforcementEngine';
import type {
  ExecutionOutcome,
  OutcomeFeedback,
  RewardSignal,
  StrategyWeights,
  LearningEpisode,
  LearningStats,
} from './types';

// ─── Weight Storage Key ─────────────────────────────────────────

const WEIGHTS_KEY = 'strategy_weights:global';

// ─── Load / Save Weights ────────────────────────────────────────

export async function loadWeights(tenantId?: string): Promise<StrategyWeights> {
  const { data } = await supabase
    .from('agent_memory')
    .select('*')
    .eq('key', WEIGHTS_KEY)
    .eq('memory_type', 'learned_pattern')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (data?.value) {
    const val = data.value as Record<string, unknown>;
    if (val.toolReliability) return val as unknown as StrategyWeights;
  }

  return createDefaultWeights();
}

async function saveWeights(weights: StrategyWeights, tenantId?: string): Promise<void> {
  await supabase.from('agent_memory').insert({
    tenant_id: tenantId ?? null,
    memory_type: 'learned_pattern',
    key: WEIGHTS_KEY,
    value: weights as any,
    ttl_seconds: null,
    expires_at: null,
  });
}

// ─── Core Learning Loop ─────────────────────────────────────────

/**
 * Process an execution outcome through the full learning loop:
 * 1. Compute reward signal from outcome + optional feedback
 * 2. Update strategy weights via reinforcement
 * 3. Store successful resolutions in memory for future retrieval
 * 4. Return the learning episode for logging
 */
export async function processOutcome(
  outcome: ExecutionOutcome,
  feedback: OutcomeFeedback | null = null,
  tenantId?: string,
): Promise<LearningEpisode> {
  // 1. Load current weights
  const currentWeights = await loadWeights(tenantId);

  // 2. Compute reward
  const reward = computeReward(outcome, feedback, currentWeights);

  // 3. Update weights via reinforcement
  const newWeights = updateWeights(currentWeights, outcome, reward);

  // 4. Persist updated weights
  await saveWeights(newWeights, tenantId);

  // 5. Store successful resolutions in memory for future similarity search
  const allSucceeded = outcome.stepResults.every((s) => s.success);
  const mostSucceeded = outcome.stepResults.filter((s) => s.success).length / (outcome.stepResults.length || 1) > 0.7;

  if (allSucceeded || (mostSucceeded && reward.reward > 0.3)) {
    await storeIssueResolution(
      outcome.goal,
      outcome.finalResponse,
      {
        toolsUsed: outcome.toolsCalled,
        agentTypes: outcome.agentsUsed,
        tags: deriveTagsFromOutcome(outcome),
        success: true,
        confidence: Math.max(0, reward.reward),
        durationMs: outcome.durationMs,
        tenantId,
      },
    );
  }

  // 6. Also store failures so we can learn what NOT to do
  if (!allSucceeded && reward.reward < -0.2) {
    await storeIssueResolution(
      outcome.goal,
      `FAILED: ${outcome.stepResults.filter((s) => !s.success).map((s) => s.error ?? s.tool).join('; ')}`,
      {
        toolsUsed: outcome.toolsCalled,
        agentTypes: outcome.agentsUsed,
        tags: ['failure', ...deriveTagsFromOutcome(outcome)],
        success: false,
        confidence: 0,
        durationMs: outcome.durationMs,
        tenantId,
      },
    );
  }

  // 7. Log to audit
  await supabase.from('audit_logs').insert({
    tenant_id: tenantId ?? null,
    action: 'learning_episode',
    resource_type: 'learning',
    resource_id: outcome.executionId,
    metadata: {
      reward: reward.reward,
      components: reward.components,
      episode_number: newWeights.episodeCount,
      tools: outcome.toolsCalled,
    } as any,
  });

  const weightsApplied: Partial<StrategyWeights> = {
    toolReliability: pick(newWeights.toolReliability, outcome.toolsCalled),
    agentEffectiveness: pick(newWeights.agentEffectiveness, outcome.agentsUsed),
  };

  return { outcome, feedback, reward, weightsApplied };
}

// ─── Explicit Feedback Entry Point ──────────────────────────────

/**
 * Record user feedback for a past execution and re-run reinforcement.
 */
export async function submitFeedback(
  executionId: string,
  rating: number,
  userSatisfied: boolean,
  notes?: string,
  tenantId?: string,
): Promise<RewardSignal | null> {
  // Fetch the execution record
  const { data: exec } = await supabase
    .from('agent_executions')
    .select('*')
    .eq('id', executionId)
    .maybeSingle();

  if (!exec) return null;

  const feedback: OutcomeFeedback = {
    executionId,
    source: 'explicit',
    rating: Math.max(-1, Math.min(1, rating)),
    userSatisfied,
    notes,
    timestamp: new Date().toISOString(),
  };

  // Reconstruct outcome from stored execution
  const plan = (exec.plan ?? []) as any[];
  const results = (exec.results ?? []) as any[];

  const outcome: ExecutionOutcome = {
    executionId,
    goal: exec.goal,
    toolsCalled: results.map((r: any) => r.tool ?? r.stepId ?? 'unknown'),
    agentsUsed: [...new Set(plan.map((s: any) => s.agent ?? 'unknown'))],
    durationMs: exec.total_duration_ms ?? 0,
    stepResults: results.map((r: any) => ({
      stepId: r.stepId ?? r.id ?? 'unknown',
      tool: r.tool ?? r.stepId ?? 'unknown',
      agent: plan.find((s: any) => s.id === r.stepId)?.agent ?? 'unknown',
      success: r.success ?? true,
      durationMs: r.durationMs ?? 0,
      cached: r.cached ?? false,
      retries: r.retries ?? 0,
      error: r.error,
    })),
    finalResponse: exec.goal,
    timestamp: exec.created_at,
  };

  const episode = await processOutcome(outcome, feedback, tenantId);

  // Also record in the memory feedback system for the most similar resolution
  const similar = await findSimilarIssues(exec.goal, { tenantId, limit: 1, successOnly: false });
  if (similar.length > 0) {
    await recordFeedback({
      memoryId: similar[0].record.id,
      success: userSatisfied,
      notes,
    });
  }

  return episode.reward;
}

// ─── Context Builder ────────────────────────────────────────────

/**
 * Build enhanced context for a new query by searching past resolutions
 * and incorporating learned strategy weights.
 */
export async function buildLearningContext(
  query: string,
  tenantId?: string,
): Promise<{
  similarResolutions: { issue: string; resolution: string; confidence: number; similarity: number }[];
  strategyHints: {
    preferredTools: string[];
    avoidTools: string[];
    preferredAgents: string[];
    toolChains: string[];
  };
}> {
  const [similar, weights] = await Promise.all([
    findSimilarIssues(query, { tenantId, limit: 5, successOnly: true }),
    loadWeights(tenantId),
  ]);

  const similarResolutions = similar.map((s) => {
    const val = s.record.value as any;
    return {
      issue: val.issue ?? s.record.key,
      resolution: val.resolution ?? '',
      confidence: val.confidence ?? s.record.successCount / Math.max(1, s.record.successCount + s.record.failureCount),
      similarity: s.similarity,
    };
  });

  // Derive strategy hints from learned weights
  const reliableTools = Object.entries(weights.toolReliability)
    .sort(([, a], [, b]) => b - a);

  const preferredTools = reliableTools.filter(([, v]) => v > 0.6).map(([k]) => k);
  const avoidTools = reliableTools.filter(([, v]) => v < 0.3).map(([k]) => k);

  const preferredAgents = Object.entries(weights.agentEffectiveness)
    .filter(([, v]) => v > 0.6)
    .sort(([, a], [, b]) => b - a)
    .map(([k]) => k);

  const toolChains = Object.entries(weights.toolOrderPreference)
    .filter(([, v]) => v > 0.6)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
    .map(([k]) => k);

  return { similarResolutions, strategyHints: { preferredTools, avoidTools, preferredAgents, toolChains } };
}

// ─── Stats ──────────────────────────────────────────────────────

export async function getLearningStats(tenantId?: string): Promise<LearningStats> {
  const weights = await loadWeights(tenantId);

  // Fetch recent reward history from audit logs
  let query = supabase
    .from('audit_logs')
    .select('metadata')
    .eq('action', 'learning_episode')
    .order('created_at', { ascending: false })
    .limit(100);

  if (tenantId) query = query.eq('tenant_id', tenantId);

  const { data } = await query;
  const rewards = (data ?? [])
    .map((r) => ((r.metadata as any)?.reward as number) ?? 0);

  const topTools = Object.entries(weights.toolReliability)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10)
    .map(([tool, reliability]) => ({ tool, reliability }));

  const topAgents = Object.entries(weights.agentEffectiveness)
    .sort(([, a], [, b]) => b - a)
    .map(([agent, effectiveness]) => ({ agent, effectiveness }));

  // Improvement rate: compare first 10 vs last 10 episodes
  const firstN = rewards.slice(-10);
  const lastN = rewards.slice(0, 10);
  const avgFirst = firstN.length > 0 ? firstN.reduce((a, b) => a + b, 0) / firstN.length : 0;
  const avgLast = lastN.length > 0 ? lastN.reduce((a, b) => a + b, 0) / lastN.length : 0;
  const improvementRate = avgFirst !== 0
    ? Math.round(((avgLast - avgFirst) / Math.abs(avgFirst)) * 100) / 100
    : 0;

  return {
    totalEpisodes: weights.episodeCount,
    avgReward: rewards.length > 0
      ? Math.round((rewards.reduce((a, b) => a + b, 0) / rewards.length) * 1000) / 1000
      : 0,
    rewardTrend: rewards.slice(0, 20).reverse(),
    topTools,
    topAgents,
    improvementRate,
  };
}

// ─── Helpers ────────────────────────────────────────────────────

function deriveTagsFromOutcome(outcome: ExecutionOutcome): string[] {
  const tags: string[] = [];

  // Extract keywords from goal
  const words = outcome.goal.toLowerCase().split(/\s+/);
  const keywords = ['cost', 'geometry', 'stress', 'thermal', 'quote', 'optimize',
    'workflow', 'material', 'thickness', 'hole', 'draft', 'machining',
    'tolerance', 'fatigue', 'process', 'inspect', 'simulation'];
  for (const w of words) {
    if (keywords.some((k) => w.includes(k))) tags.push(w);
  }

  // Add agent types and tools
  tags.push(...outcome.agentsUsed);

  return [...new Set(tags)];
}

function pick<T>(obj: Record<string, T>, keys: string[]): Record<string, T> {
  const result: Record<string, T> = {};
  for (const k of keys) {
    if (k in obj) result[k] = obj[k];
  }
  return result;
}
