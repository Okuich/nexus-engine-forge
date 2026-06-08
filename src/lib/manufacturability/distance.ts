/**
 * Distances + scoring for the manufacturability metric space.
 */

import { MFG_VECTOR_DIM } from './types';

/** Geometric distance = Euclidean in the normalized vector space. */
export function geometricDistance(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < MFG_VECTOR_DIM; i++) {
    const d = a[i] - b[i];
    s += d * d;
  }
  return Math.sqrt(s);
}

/** Geometric similarity in [0,1]. */
export function geometricSimilarity(a: Float32Array, b: Float32Array): number {
  // Max possible Euclidean distance in unit hypercube = sqrt(D)
  const maxD = Math.sqrt(MFG_VECTOR_DIM);
  return Math.max(0, 1 - geometricDistance(a, b) / maxD);
}

/**
 * Manufacturing-difficulty distance. Weighted Euclidean using the
 * per-dimension difficulty weights — two parts are "close" when the
 * dimensions that drive cost/risk align, regardless of raw geometry.
 */
export function difficultyDistance(
  a: Float32Array,
  b: Float32Array,
  weights: Float32Array,
): number {
  let s = 0;
  for (let i = 0; i < MFG_VECTOR_DIM; i++) {
    const d = a[i] - b[i];
    s += weights[i] * d * d;
  }
  return Math.sqrt(s);
}

/**
 * Overall manufacturability difficulty index in [0,1]
 * (higher = harder to make). Weighted average of normalized vector
 * components against the difficulty weights.
 */
export function difficultyIndex(vector: Float32Array, weights: Float32Array): number {
  let num = 0;
  let den = 0;
  for (let i = 0; i < MFG_VECTOR_DIM; i++) {
    num += vector[i] * weights[i];
    den += weights[i];
  }
  return den > 0 ? num / den : 0;
}
