/**
 * ROI Gating — Type Definitions
 *
 * Unified facade over the five metric-space capabilities. Enforces a
 * strict priority order so high-ROI / low-difficulty insights are
 * surfaced first and downstream capabilities only fire when the data
 * actually merits the additional compute.
 *
 *   1. Operational State Space         (Very High ROI / Low)
 *   2. Manufacturability Space         (Very High ROI / Medium)
 *   3. Physics-Constrained Space       (High ROI / Medium)
 *   4. Optimization Geometry           (Extremely High ROI / High)
 *   5. Autonomous Navigation           (Transformational / Very High)
 */

import type {
  FeasibilityResult,
  PhysicsSnapshot,
} from '@/lib/physicsConstrained';
import type {
  CadModel,
  ManufacturabilityEvaluation,
} from '@/lib/manufacturability';
import type {
  NearestNeighborResult,
  OperationalSnapshot,
} from '@/lib/operationalState';
import type {
  OptimalPath,
  OptimizationGoal,
} from '@/lib/optimizationGeometry';
import type {
  NavigationRecommendation,
  RegionHit,
} from '@/lib/autonomousNavigation';

export type CapabilityId =
  | 'operational-state'
  | 'manufacturability'
  | 'physics-constrained'
  | 'optimization-geometry'
  | 'autonomous-navigation';

export type RoiTier = 'very-high' | 'high' | 'extremely-high' | 'transformational';
export type Difficulty = 'low' | 'medium' | 'high' | 'very-high';

export interface CapabilityDescriptor {
  id: CapabilityId;
  priority: 1 | 2 | 3 | 4 | 5;
  title: string;
  roi: RoiTier;
  difficulty: Difficulty;
}

export const CAPABILITY_ORDER: CapabilityDescriptor[] = [
  { id: 'operational-state',     priority: 1, title: 'Operational State Space',   roi: 'very-high',       difficulty: 'low' },
  { id: 'manufacturability',     priority: 2, title: 'Manufacturability Space',   roi: 'very-high',       difficulty: 'medium' },
  { id: 'physics-constrained',   priority: 3, title: 'Physics-Constrained Space', roi: 'high',            difficulty: 'medium' },
  { id: 'optimization-geometry', priority: 4, title: 'Optimization Geometry',     roi: 'extremely-high',  difficulty: 'high' },
  { id: 'autonomous-navigation', priority: 5, title: 'Autonomous Navigation',     roi: 'transformational',difficulty: 'very-high' },
];

// ─── Inputs ────────────────────────────────────────────────────

export interface RoiGateInputs {
  tenantId: string;
  /** Current operational snapshot (priority 1). */
  current?: OperationalSnapshot;
  /** Optional desired target snapshot for explicit optimization. */
  target?: OperationalSnapshot;
  /** Optional historical operational snapshots used to seed the manifold. */
  history?: OperationalSnapshot[];
  /** Optional CAD parts to evaluate (priority 2). */
  parts?: CadModel[];
  /** Optional physics snapshots (priority 3). */
  physics?: PhysicsSnapshot[];
  /** Goal hint for optimization / autonomous recommendations. */
  goal?: OptimizationGoal;
}

export interface RoiGateOptions {
  /** Inclusive maximum priority to evaluate. Defaults to 5. */
  maxPriority?: 1 | 2 | 3 | 4 | 5;
  /** Skip downstream capabilities once a higher-tier recommendation is found. */
  shortCircuit?: boolean;
  /** Minimum ROI uplift required to surface a tier (0..1). */
  minRoi?: number;
  /** Maximum number of recommendations returned per tier. */
  perTierLimit?: number;
}

// ─── Outputs ──────────────────────────────────────────────────

export type GatePayload =
  | { kind: 'operational-state'; similar: NearestNeighborResult[]; rationale: string }
  | { kind: 'manufacturability'; evaluation: ManufacturabilityEvaluation }
  | { kind: 'physics-constrained'; feasibility: FeasibilityResult }
  | { kind: 'optimization-geometry'; path: OptimalPath; goal: OptimizationGoal }
  | { kind: 'autonomous-navigation'; recommendation: NavigationRecommendation; target: RegionHit | null };

export interface GatedRecommendation {
  capability: CapabilityDescriptor;
  /** Title/headline for this recommendation. */
  title: string;
  /** Short rationale shown to the user. */
  rationale: string;
  /** Estimated ROI uplift in [0,1]. */
  roiScore: number;
  /** Confidence in [0,1]. */
  confidence: number;
  /** Capability-specific payload for downstream rendering. */
  payload: GatePayload;
  /** True when this recommendation gates downstream tiers from firing. */
  blocksDownstream: boolean;
}

export interface RoiGateResult {
  tenantId: string;
  generatedAt: string;
  recommendations: GatedRecommendation[];
  /** Capabilities that were skipped, with the reason. */
  skipped: { capability: CapabilityId; reason: string }[];
  /** True if downstream tiers were short-circuited. */
  shortCircuited: boolean;
}
