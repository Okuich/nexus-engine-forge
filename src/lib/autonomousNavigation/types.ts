/**
 * Autonomous Operational Navigation — Type Definitions
 *
 * Continuously navigates a facility's operations through the global
 * state manifold toward higher-value regions, detecting drift,
 * inefficiency, failure, and optimization basins along the way.
 */

import type {
  OperationalSnapshot,
  OperationalStateVector,
  StatePerformanceMetrics,
} from '@/lib/operationalState';
import type { OptimalPath, OptimizationGoal } from '@/lib/optimizationGeometry';

// ─── Manifold + Trajectory ───────────────────────────────────────

export type BasinKind = 'stable' | 'optimal' | 'inefficient' | 'failure';

export interface ManifoldPoint {
  id: string;
  tenantId: string;
  snapshotAt: string;
  vector: OperationalStateVector;
  snapshot: OperationalSnapshot;
  performance: StatePerformanceMetrics;
  /** Aggregate value of this point: higher = more desirable. */
  value: number;
  /** Discovered basin membership (assigned at ingest time). */
  basin: BasinKind;
}

export interface Basin {
  id: string;
  kind: BasinKind;
  /** Centroid of the cluster in normalized state space. */
  centroid: Float32Array;
  /** Average value of points in the basin. */
  meanValue: number;
  /** Average radius (mean distance of members to centroid). */
  radius: number;
  /** Member point ids. */
  members: string[];
}

export interface TrajectoryPoint {
  pointId: string;
  snapshotAt: string;
  value: number;
  basin: BasinKind;
}

export interface OperationalTrajectory {
  tenantId: string;
  points: TrajectoryPoint[];
  /** Mean velocity in normalized state-space units / hour. */
  velocity: number;
  /** Net value change over the trajectory window. */
  valueDelta: number;
}

// ─── Drift Detection ─────────────────────────────────────────────

export type DriftSeverity = 'none' | 'minor' | 'moderate' | 'severe';

export interface DriftReport {
  severity: DriftSeverity;
  /** Distance moved from the recent baseline centroid. */
  magnitude: number;
  /** Direction in dimension space: per-dim drift values. */
  perDimension: Record<string, number>;
  /** Dimensions exceeding the threshold, sorted by magnitude. */
  topDrivers: { dimension: string; delta: number }[];
  /** Did the drift cross a basin boundary? */
  crossedBasin: boolean;
  fromBasin: BasinKind | null;
  toBasin: BasinKind | null;
}

// ─── Region Queries + Recommendations ────────────────────────────

export interface RegionHit {
  basin: Basin;
  distance: number;
  /** Closest point inside the basin. */
  anchor: ManifoldPoint;
}

export interface NavigationRecommendation {
  /** Type of trajectory: recovery (escape failure) or optimization (climb value). */
  kind: 'recovery' | 'optimization' | 'hold';
  /** Why the engine is making this recommendation. */
  rationale: string;
  /** Headline expected value uplift. */
  expectedValueGain: number;
  /** Optimization goal selected by the engine. */
  goal: OptimizationGoal;
  /** The trajectory itself. */
  trajectory: OptimalPath;
  /** Target region the trajectory leads into. */
  target: RegionHit;
  /** Confidence 0..1, derived from corpus density and basin tightness. */
  confidence: number;
  /** Detected drift that prompted the recommendation, if any. */
  drift: DriftReport | null;
}

// ─── Configuration ───────────────────────────────────────────────

export interface ManifoldConfig {
  /** Window of recent points used to compute drift baselines. */
  baselineWindow: number;
  /** Distance threshold above which drift is flagged as moderate. */
  driftModerateThreshold: number;
  /** Distance threshold above which drift is flagged as severe. */
  driftSevereThreshold: number;
  /** Min cluster size to materialize a basin. */
  minBasinSize: number;
  /** Distance threshold for greedy basin clustering. */
  basinRadius: number;
  /** Value percentiles defining inefficient and optimal basins. */
  valueLowPercentile: number;
  valueHighPercentile: number;
  /** Failure indicators (scrapRate, faultRatio) above this trigger 'failure' basin tagging. */
  failureScrapThreshold: number;
  failureFaultThreshold: number;
  /** Exponential moving average factor for online metric updates. */
  metricEma: number;
}

export const DEFAULT_MANIFOLD_CONFIG: ManifoldConfig = {
  baselineWindow: 32,
  driftModerateThreshold: 0.25,
  driftSevereThreshold: 0.5,
  minBasinSize: 3,
  basinRadius: 0.35,
  valueLowPercentile: 0.2,
  valueHighPercentile: 0.8,
  failureScrapThreshold: 0.12,
  failureFaultThreshold: 0.25,
  metricEma: 0.1,
};

// ─── Integration Surface ─────────────────────────────────────────

/**
 * Cross-substrate integration adapters. Each is optional — the engine
 * degrades gracefully when an OS is unavailable. The shape is kept
 * deliberately minimal so substrates can be plugged in incrementally.
 */
export interface IntegrationHooks {
  /** Mathematical Substrate: provide a value contribution for a snapshot. */
  mathValue?: (snapshot: OperationalSnapshot) => number;
  /** Geometry OS: penalty for geometric infeasibility (0..1). */
  geometryPenalty?: (snapshot: OperationalSnapshot) => number;
  /** Physics OS: penalty when physical constraints are violated (0..1). */
  physicsPenalty?: (snapshot: OperationalSnapshot) => number;
  /** Computational Geometry: complexity weighting (0..1). */
  computationalGeometryWeight?: (snapshot: OperationalSnapshot) => number;
  /** Fabrication OS: manufacturability bonus (0..1, higher is better). */
  fabricationBonus?: (snapshot: OperationalSnapshot) => number;
  /** Midwater core: marketplace / pricing value bonus (0..1). */
  midwaterBonus?: (snapshot: OperationalSnapshot) => number;
}
