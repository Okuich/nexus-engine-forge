/**
 * Geometry Optimization Engine — Type Definitions
 *
 * Defines the candidate modification system, optimization
 * configuration, and ranked result output.
 */

import type { GeometryFeatureSet, GeometryStats } from '@/lib/geometry/types';
import type { CostBreakdown } from '@/lib/ml/costEngine';

// ─── Modification Types ─────────────────────────────────────────

export type ModificationType =
  | 'thickness_adjustment'
  | 'radius_smoothing'
  | 'feature_simplification'
  | 'surface_consolidation'
  | 'draft_angle_addition';

export interface Modification {
  /** Unique modification ID */
  id: string;
  /** Type of geometric modification */
  type: ModificationType;
  /** Human-readable description */
  description: string;
  /** Which face indices are affected */
  affectedFaces: number[];
  /** Parametric delta applied to features */
  delta: FeatureDelta;
}

/**
 * Parametric adjustments applied to a GeometryFeatureSet.
 * All fields optional — only specified deltas are applied.
 */
export interface FeatureDelta {
  /** Multiply curvature values by this factor (e.g. 0.5 = halve curvatures) */
  curvatureScale?: number;
  /** Add to face areas (mm²) */
  areaOffset?: number;
  /** Replace surface class on affected faces */
  targetSurfaceClass?: 'planar' | 'cylindrical';
  /** Scale complexity score by this factor */
  complexityScale?: number;
  /** Adjust volume (mm³) */
  volumeOffset?: number;
  /** Override freeform face count delta */
  freeformDelta?: number;
}

// ─── Candidate ──────────────────────────────────────────────────

export interface OptimizationCandidate {
  /** Unique candidate ID */
  id: string;
  /** Applied modifications */
  modifications: Modification[];
  /** Modified feature set (virtual — curvatures/stats adjusted) */
  modifiedFeatures: GeometryFeatureSet;
  /** Cost estimate on modified geometry */
  costBreakdown: CostBreakdown;
  /** Manufacturability score (0–100) from rule engine */
  manufacturabilityScore: number;
  /** Cost delta from original ($) */
  costDelta: number;
  /** Manufacturability delta from original */
  manufacturabilityDelta: number;
  /** Combined ranking score (higher = better) */
  rankScore: number;
  /** Iteration this candidate was produced in */
  iteration: number;
}

// ─── Configuration ──────────────────────────────────────────────

export interface OptimizationConfig {
  /** Material ID for cost estimation */
  materialId: string;
  /** Process ID for cost estimation */
  processId: string;
  /** Maximum optimization iterations (default 5) */
  maxIterations: number;
  /** Maximum candidates per iteration (default 6) */
  maxCandidatesPerIteration: number;
  /** Number of top results to return (default 3) */
  topN: number;
  /** Weight for cost reduction in ranking (0–1, default 0.5) */
  costWeight: number;
  /** Weight for manufacturability improvement (0–1, default 0.5) */
  manufacturabilityWeight: number;
  /** Minimum improvement to continue iterating (default 0.01 = 1%) */
  convergenceThreshold: number;
  /** Enable candidate generators */
  enabledGenerators: ModificationType[];
}

export const DEFAULT_OPTIMIZATION_CONFIG: Omit<OptimizationConfig, 'materialId' | 'processId'> = {
  maxIterations: 5,
  maxCandidatesPerIteration: 6,
  topN: 3,
  costWeight: 0.5,
  manufacturabilityWeight: 0.5,
  convergenceThreshold: 0.01,
  enabledGenerators: [
    'thickness_adjustment',
    'radius_smoothing',
    'feature_simplification',
    'surface_consolidation',
    'draft_angle_addition',
  ],
};

// ─── Results ────────────────────────────────────────────────────

export interface OptimizationResult {
  /** Original cost breakdown */
  originalCost: CostBreakdown;
  /** Original manufacturability score */
  originalManufacturability: number;
  /** Top N ranked candidates */
  topCandidates: OptimizationCandidate[];
  /** All candidates evaluated across all iterations */
  totalCandidatesEvaluated: number;
  /** Number of iterations executed */
  iterationsRun: number;
  /** Whether optimization converged (no further improvement) */
  converged: boolean;
  /** Total optimization time in ms */
  durationMs: number;
  /** Expected savings summary */
  savings: SavingsSummary;
}

export interface SavingsSummary {
  /** Best cost reduction ($) */
  maxCostReduction: number;
  /** Best cost reduction (%) */
  maxCostReductionPct: number;
  /** Best manufacturability improvement (points) */
  maxManufacturabilityGain: number;
  /** Average cost reduction across top candidates */
  avgCostReduction: number;
  /** Average manufacturability gain across top candidates */
  avgManufacturabilityGain: number;
}

// ─── Candidate Generator Interface ──────────────────────────────

export interface CandidateGenerator {
  /** Generator type */
  type: ModificationType;
  /** Generate candidate modifications from features */
  generate(
    features: GeometryFeatureSet,
    stats: GeometryStats,
    iteration: number,
  ): Modification[];
}
