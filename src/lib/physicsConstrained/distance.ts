/**
 * Distance functions for the Physics-Constrained Metric Space.
 *
 *   feasibilityDistance(a, b) — Euclidean distance in vector space
 *     plus a non-negative penalty proportional to the candidate's
 *     physical violations. Infeasible candidates are pushed far away.
 *
 *   stableDistance(query, stable)  — distance to a known-stable point
 *   failureDistance(query, failed) — distance to a known-failure point
 *
 * Penalties are additive so unsafe candidates can never appear at
 * distance 0 even if their vectors match exactly.
 */

import { PHYSICS_VECTOR_DIM } from './types';

export function vectorDistance(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < PHYSICS_VECTOR_DIM; i++) {
    const d = a[i] - b[i];
    s += d * d;
  }
  return Math.sqrt(s);
}

export interface FeasibilityDistanceParams {
  /** Penalty of the *candidate* (other) state */
  candidatePenalty?: number;
  /** Whether the candidate is hard-infeasible */
  candidateFeasible?: boolean;
  /** Multiplier for candidate penalty in distance, default 1.0 */
  penaltyWeight?: number;
  /** Extra distance added if candidate is infeasible, default 5.0 */
  infeasibilityBarrier?: number;
}

export function feasibilityDistance(
  query: Float32Array,
  candidate: Float32Array,
  params: FeasibilityDistanceParams = {},
): number {
  const base = vectorDistance(query, candidate);
  const w = params.penaltyWeight ?? 1.0;
  const barrier = params.infeasibilityBarrier ?? 5.0;
  let extra = w * Math.max(0, params.candidatePenalty ?? 0);
  if (params.candidateFeasible === false) extra += barrier;
  return base + extra;
}

/** Distance to a known-stable reference state. Lighter weighting. */
export function stableDistance(
  query: Float32Array,
  stable: Float32Array,
  stablePenalty = 0,
): number {
  return vectorDistance(query, stable) + 0.25 * stablePenalty;
}

/**
 * Distance to a known-failure reference state. Subtracts a small
 * "danger pull" so closer-to-failure candidates rank as more
 * concerning when ranking failure neighborhoods.
 */
export function failureDistance(
  query: Float32Array,
  failure: Float32Array,
  failurePenalty = 0,
): number {
  return vectorDistance(query, failure) + 0.1 * failurePenalty;
}
