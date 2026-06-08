/**
 * Operational Optimization Geometry — Type Definitions
 *
 * Treats operations as movement through the Operational State Metric
 * Space. Every state is a graph node, edges connect metrically-close
 * states, and pathfinding produces an actionable trajectory of
 * changes to reach a target operational state.
 */

import type {
  NearestNeighborResult,
  OperationalSnapshot,
  OperationalStateVector,
  StateIntervention,
} from '@/lib/operationalState';

export type OptimizationGoal =
  | 'production-scaling'
  | 'downtime-reduction'
  | 'throughput-improvement'
  | 'inventory-optimization'
  | 'custom';

// ─── Cost ─────────────────────────────────────────────────────────

/** Multi-objective cost weights. Sum need not equal 1. */
export interface CostWeights {
  time: number;
  energy: number;
  waste: number;
  downtime: number;
  risk: number;
}

export const DEFAULT_WEIGHTS: CostWeights = {
  time: 1.0,
  energy: 0.6,
  waste: 0.8,
  downtime: 1.2,
  risk: 1.0,
};

/** Breakdown of edge cost into operational dimensions. */
export interface EdgeCost {
  /** Estimated hours to transition */
  time: number;
  /** Energy delta in kWh */
  energy: number;
  /** Estimated material waste (relative units) */
  waste: number;
  /** Downtime hours incurred by the transition */
  downtime: number;
  /** Risk score 0..1 */
  risk: number;
  /** Weighted scalar cost used by the planner */
  total: number;
}

// ─── Graph ────────────────────────────────────────────────────────

export interface OptimizationNode {
  id: string;
  /** Underlying state vector */
  vector: OperationalStateVector;
  /** Original snapshot (kept for action inference) */
  snapshot: OperationalSnapshot;
  /** Optional label for visualisation */
  label?: string;
}

export interface OptimizationEdge {
  fromId: string;
  toId: string;
  /** Metric distance between vectors (Euclidean in normalized space) */
  distance: number;
  cost: EdgeCost;
  /** Inferred action this edge represents */
  action: TrajectoryAction;
}

export interface OptimizationGraph {
  nodes: Map<string, OptimizationNode>;
  /** Adjacency list: fromId → outgoing edges */
  adjacency: Map<string, OptimizationEdge[]>;
}

// ─── Actions / Trajectory ─────────────────────────────────────────

export type ActionKind =
  | 'increase-throughput'
  | 'reduce-downtime'
  | 'adjust-inventory'
  | 'reschedule-queue'
  | 'rebalance-tools'
  | 'energy-tune'
  | 'improve-quality'
  | 'scale-production'
  | 'maintain';

export interface TrajectoryAction {
  kind: ActionKind;
  description: string;
  /** Largest dimension deltas, sorted by absolute magnitude desc */
  deltas: ActionDelta[];
  /** Estimated risk 0..1 */
  risk: number;
  /** Estimated time in hours */
  etaHours: number;
}

export interface ActionDelta {
  /** Dimension name from STATE_DIMENSIONS */
  dimension: string;
  /** From → To values (normalized) */
  from: number;
  to: number;
  delta: number;
}

export interface PredictedOutcome {
  /** Throughput change in parts/hour */
  throughputDelta: number;
  /** Scrap rate change */
  scrapDelta: number;
  /** OEE change 0..1 */
  oeeDelta: number;
  /** Inventory health change 0..1 */
  inventoryHealthDelta: number;
  /** Backlog change in open orders */
  backlogDelta: number;
}

export interface RiskEstimate {
  /** Overall risk 0..1 */
  overall: number;
  /** Risk per-step */
  perStep: number[];
  /** Worst single-step risk */
  worstStep: number;
  /** Human-readable risk drivers */
  drivers: string[];
}

export interface OptimalPath {
  /** Ordered node IDs from current → target (inclusive) */
  nodeIds: string[];
  /** One TrajectoryAction per edge along the path */
  actions: TrajectoryAction[];
  /** Total cost breakdown along the path */
  totalCost: EdgeCost;
  /** Predicted outcome at the end of the trajectory */
  predictedOutcome: PredictedOutcome;
  /** Aggregate risk estimate for the trajectory */
  risk: RiskEstimate;
  /** Number of states explored by the planner */
  exploredNodes: number;
  /** Did the planner reach the target? */
  reached: boolean;
}

export interface FindPathOptions {
  /** Optimization weights override */
  weights?: Partial<CostWeights>;
  /** Goal hint — adjusts default weights when no override */
  goal?: OptimizationGoal;
  /** Maximum edge distance for graph connectivity (in [0,1]-normalized space) */
  connectivityRadius?: number;
  /** Max neighbors per node (k-NN style sparsification) */
  maxDegree?: number;
  /** Hard cap on nodes explored by A* */
  maxExpansions?: number;
}

export type PathStep = NearestNeighborResult & {
  action: TrajectoryAction;
  cost: EdgeCost;
};

// Re-export to make this module self-sufficient for callers.
export type { StateIntervention };
