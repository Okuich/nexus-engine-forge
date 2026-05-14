/**
 * Collision & Interference Analysis Engine — Types
 *
 * Multi-part assembly intersection detection with tolerance analysis,
 * motion sweeping, and tier gating.
 */

import type { AABB, RawMesh, Vec3 } from '../types';

export type CollisionTier = 'starter' | 'professional' | 'enterprise';

/** Affine transform: 3x3 rotation + translation (column-major rows). */
export interface Transform {
  /** Row-major 3x3 rotation/scale matrix. Identity by default. */
  rotation?: [number, number, number, number, number, number, number, number, number];
  translation?: Vec3;
}

export interface AssemblyPart {
  id: string;
  mesh: RawMesh;
  transform?: Transform;
  /** Optional manufacturing tolerance band (model units). */
  tolerance?: number;
  /** Optional logical group; pairs in the same group can be excluded. */
  group?: string;
}

/** Time-keyed transform sample for moving assemblies. */
export interface MotionKeyframe {
  /** Normalized time in [0,1] or absolute seconds — caller's choice. */
  t: number;
  transform: Transform;
}

export interface MovingPart extends AssemblyPart {
  motion: MotionKeyframe[];
}

export interface CollisionDetectionOptions {
  /** Skip pairs that share this group. */
  excludeSameGroup?: boolean;
  /** Stop after this many pairs (perf cap). */
  maxPairs?: number;
  /** Stop after this many tri-tri intersections per pair. */
  maxIntersectionsPerPair?: number;
  /** Global tolerance band (added to per-part tolerance). */
  globalTolerance?: number;
  /** Soft time budget (ms). Default 250. */
  timeBudgetMs?: number;
}

export interface CollisionPair {
  partA: string;
  partB: string;
  /** AABB overlap volume (proxy for severity). */
  overlapVolume: number;
  /** Triangle-triangle intersections found (capped). */
  intersectionCount: number;
  /** Sample intersection points (first few). */
  samplePoints: Vec3[];
  /** True if separation distance is within tolerance band. */
  withinTolerance: boolean;
  /** Min separation across the pair AABB. Negative = penetration depth. */
  minSeparation: number;
}

export interface InterferenceReport {
  pairs: CollisionPair[];
  totalPairsEvaluated: number;
  totalPairsSkipped: number;
  elapsedMs: number;
  /** Aggregate severity score (sum of penetration × overlap). */
  severityScore: number;
}

export interface MotionSweepOptions extends CollisionDetectionOptions {
  /** Number of samples along the motion path. Default 16. */
  samples?: number;
}

export interface MotionSweepResult {
  /** Per-sample interference report. */
  timeline: Array<{ t: number; report: InterferenceReport }>;
  /** First time-of-impact across the whole sweep, or null. */
  firstContactT: number | null;
  /** Pair IDs that contact at any point in the sweep. */
  contactPairs: Array<[string, string]>;
  elapsedMs: number;
}

export interface CollisionGatingContext {
  tier: CollisionTier;
  partCount: number;
  /** Total triangle count across all parts. */
  totalTriangles: number;
  /** Whether this is part of an assembly workflow. */
  assemblyWorkflow?: boolean;
  /** Whether this customer is enterprise manufacturing. */
  enterpriseManufacturing?: boolean;
}

export interface CollisionGatingDecision {
  allowed: boolean;
  reason?: string;
  maxParts: number;
  maxTriangles: number;
}

export class CollisionGateError extends Error {
  constructor(public decision: CollisionGatingDecision) {
    super(decision.reason || 'Collision analysis gated');
    this.name = 'CollisionGateError';
  }
}

export type { AABB, Vec3 };
