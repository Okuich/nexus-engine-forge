/**
 * Self-Learning Loop — Type Definitions
 *
 * Captures outcomes, computes reinforcement signals,
 * and adapts agent strategy weights over time.
 */

// ─── Outcome Capture ────────────────────────────────────────────

export interface ExecutionOutcome {
  executionId: string;
  goal: string;
  toolsCalled: string[];
  agentsUsed: string[];
  durationMs: number;
  stepResults: StepOutcome[];
  finalResponse: string;
  timestamp: string;
}

export interface StepOutcome {
  stepId: string;
  tool: string;
  agent: string;
  success: boolean;
  durationMs: number;
  cached: boolean;
  retries: number;
  error?: string;
}

// ─── Feedback Signal ────────────────────────────────────────────

export type FeedbackSource = 'explicit' | 'implicit' | 'automated';

export interface OutcomeFeedback {
  executionId: string;
  source: FeedbackSource;
  rating: number;          // -1 to 1 (negative = bad, 0 = neutral, positive = good)
  userSatisfied?: boolean;
  notes?: string;
  timestamp: string;
}

// ─── Reinforcement Signal ───────────────────────────────────────

export interface RewardSignal {
  executionId: string;
  reward: number;          // -1 to 1
  components: RewardComponents;
  timestamp: string;
}

export interface RewardComponents {
  taskCompletion: number;   // did all steps succeed?
  efficiency: number;       // speed relative to baseline
  accuracy: number;         // from user feedback
  cacheUtilization: number; // did it use cached results?
  retryPenalty: number;     // penalty for retries
  userSatisfaction: number; // explicit user rating
}

// ─── Strategy Weights (what the agent learns) ───────────────────

export interface StrategyWeights {
  /** Per-tool reliability scores (0-1) */
  toolReliability: Record<string, number>;
  /** Per-agent effectiveness scores (0-1) */
  agentEffectiveness: Record<string, number>;
  /** Tool-pair affinity: tools that work well together */
  toolPairAffinity: Record<string, number>;
  /** Preferred tool ordering patterns */
  toolOrderPreference: Record<string, number>;
  /** Baseline duration per tool for efficiency scoring */
  baselineDurations: Record<string, number>;
  /** Last updated timestamp */
  updatedAt: string;
  /** Total learning episodes */
  episodeCount: number;
}

// ─── Learning Episode ───────────────────────────────────────────

export interface LearningEpisode {
  outcome: ExecutionOutcome;
  feedback: OutcomeFeedback | null;
  reward: RewardSignal;
  weightsApplied: Partial<StrategyWeights>;
}

// ─── Learning Stats ─────────────────────────────────────────────

export interface LearningStats {
  totalEpisodes: number;
  avgReward: number;
  rewardTrend: number[];      // last N rewards
  topTools: { tool: string; reliability: number }[];
  topAgents: { agent: string; effectiveness: number }[];
  improvementRate: number;    // % improvement over first 10 vs last 10 episodes
}
