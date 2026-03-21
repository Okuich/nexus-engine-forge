/**
 * Reinforcement Engine — Computes reward signals from outcomes
 *
 * Translates raw execution outcomes + user feedback into
 * a scalar reward signal with component breakdown.
 */

import type {
  ExecutionOutcome,
  OutcomeFeedback,
  RewardSignal,
  RewardComponents,
  StrategyWeights,
} from './types';

// ─── Configuration ──────────────────────────────────────────────

const REWARD_WEIGHTS = {
  taskCompletion: 0.30,
  efficiency: 0.15,
  accuracy: 0.25,
  cacheUtilization: 0.10,
  retryPenalty: 0.10,
  userSatisfaction: 0.10,
} as const;

const DEFAULT_BASELINE_MS = 5000;
const MAX_ACCEPTABLE_RETRIES = 3;

// ─── Reward Computation ─────────────────────────────────────────

/**
 * Compute a reward signal from an execution outcome and optional feedback.
 */
export function computeReward(
  outcome: ExecutionOutcome,
  feedback: OutcomeFeedback | null,
  weights: StrategyWeights,
): RewardSignal {
  const components = computeComponents(outcome, feedback, weights);

  const reward = clamp(
    REWARD_WEIGHTS.taskCompletion * components.taskCompletion +
    REWARD_WEIGHTS.efficiency * components.efficiency +
    REWARD_WEIGHTS.accuracy * components.accuracy +
    REWARD_WEIGHTS.cacheUtilization * components.cacheUtilization +
    REWARD_WEIGHTS.retryPenalty * components.retryPenalty +
    REWARD_WEIGHTS.userSatisfaction * components.userSatisfaction,
    -1,
    1,
  );

  return {
    executionId: outcome.executionId,
    reward: Math.round(reward * 1000) / 1000,
    components,
    timestamp: new Date().toISOString(),
  };
}

function computeComponents(
  outcome: ExecutionOutcome,
  feedback: OutcomeFeedback | null,
  weights: StrategyWeights,
): RewardComponents {
  const steps = outcome.stepResults;
  const total = steps.length || 1;

  // Task completion: ratio of successful steps
  const successCount = steps.filter((s) => s.success).length;
  const taskCompletion = successCount / total;

  // Efficiency: compare duration to baseline
  const expectedMs = steps.reduce((sum, s) => {
    const baseline = weights.baselineDurations[s.tool] ?? DEFAULT_BASELINE_MS;
    return sum + baseline;
  }, 0) || DEFAULT_BASELINE_MS;
  const efficiencyRatio = expectedMs / Math.max(outcome.durationMs, 1);
  const efficiency = clamp(efficiencyRatio, 0, 1);

  // Accuracy: from user feedback rating, default to neutral
  const accuracy = feedback ? clamp((feedback.rating + 1) / 2, 0, 1) : 0.5;

  // Cache utilization: reward using cached results
  const cachedSteps = steps.filter((s) => s.cached).length;
  const cacheUtilization = total > 0 ? cachedSteps / total : 0;

  // Retry penalty: penalize excessive retries
  const totalRetries = steps.reduce((sum, s) => sum + s.retries, 0);
  const retryPenalty = clamp(1 - totalRetries / (total * MAX_ACCEPTABLE_RETRIES), -1, 1);

  // User satisfaction: explicit rating
  const userSatisfaction = feedback?.userSatisfied != null
    ? (feedback.userSatisfied ? 1 : -0.5)
    : 0;

  return {
    taskCompletion: round(taskCompletion),
    efficiency: round(efficiency),
    accuracy: round(accuracy),
    cacheUtilization: round(cacheUtilization),
    retryPenalty: round(retryPenalty),
    userSatisfaction: round(userSatisfaction),
  };
}

// ─── Strategy Weight Updates (Exponential Moving Average) ───────

const LEARNING_RATE = 0.15;

/**
 * Update strategy weights based on a reward signal from an episode.
 * Uses exponential moving average so recent outcomes have more influence.
 */
export function updateWeights(
  current: StrategyWeights,
  outcome: ExecutionOutcome,
  reward: RewardSignal,
): StrategyWeights {
  const updated: StrategyWeights = {
    ...current,
    toolReliability: { ...current.toolReliability },
    agentEffectiveness: { ...current.agentEffectiveness },
    toolPairAffinity: { ...current.toolPairAffinity },
    toolOrderPreference: { ...current.toolOrderPreference },
    baselineDurations: { ...current.baselineDurations },
    updatedAt: new Date().toISOString(),
    episodeCount: current.episodeCount + 1,
  };

  // Update tool reliability
  for (const step of outcome.stepResults) {
    const prev = updated.toolReliability[step.tool] ?? 0.5;
    const signal = step.success ? 1 : 0;
    updated.toolReliability[step.tool] = ema(prev, signal, LEARNING_RATE);

    // Update baseline durations
    const prevDur = updated.baselineDurations[step.tool] ?? DEFAULT_BASELINE_MS;
    updated.baselineDurations[step.tool] = ema(prevDur, step.durationMs, LEARNING_RATE * 0.5);
  }

  // Update agent effectiveness
  const agentResults = new Map<string, { success: number; total: number }>();
  for (const step of outcome.stepResults) {
    const entry = agentResults.get(step.agent) ?? { success: 0, total: 0 };
    entry.total++;
    if (step.success) entry.success++;
    agentResults.set(step.agent, entry);
  }
  for (const [agent, { success, total }] of agentResults) {
    const prev = updated.agentEffectiveness[agent] ?? 0.5;
    updated.agentEffectiveness[agent] = ema(prev, success / total, LEARNING_RATE);
  }

  // Update tool-pair affinity
  const successfulTools = outcome.stepResults.filter((s) => s.success).map((s) => s.tool);
  for (let i = 0; i < successfulTools.length; i++) {
    for (let j = i + 1; j < successfulTools.length; j++) {
      const pairKey = [successfulTools[i], successfulTools[j]].sort().join('+');
      const prev = updated.toolPairAffinity[pairKey] ?? 0.5;
      updated.toolPairAffinity[pairKey] = ema(prev, reward.reward > 0 ? 1 : 0, LEARNING_RATE * 0.5);
    }
  }

  // Update tool order preference (sequential pairs)
  for (let i = 0; i < outcome.stepResults.length - 1; i++) {
    const orderKey = `${outcome.stepResults[i].tool}->${outcome.stepResults[i + 1].tool}`;
    const prev = updated.toolOrderPreference[orderKey] ?? 0.5;
    const orderSignal = reward.reward > 0 ? 0.8 : 0.2;
    updated.toolOrderPreference[orderKey] = ema(prev, orderSignal, LEARNING_RATE * 0.3);
  }

  return updated;
}

// ─── Helpers ────────────────────────────────────────────────────

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

function round(val: number): number {
  return Math.round(val * 1000) / 1000;
}

function ema(prev: number, current: number, alpha: number): number {
  return round(prev * (1 - alpha) + current * alpha);
}

// ─── Default Weights ────────────────────────────────────────────

export function createDefaultWeights(): StrategyWeights {
  return {
    toolReliability: {},
    agentEffectiveness: {},
    toolPairAffinity: {},
    toolOrderPreference: {},
    baselineDurations: {},
    updatedAt: new Date().toISOString(),
    episodeCount: 0,
  };
}
