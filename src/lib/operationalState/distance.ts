/**
 * Distance metrics for OperationalStateVector.
 *
 * All functions assume both inputs share the same length (VECTOR_DIM).
 * Each metric also exposes a `similarity` helper that maps distance
 * to a bounded [0, 1] score for ranking and thresholding.
 */

import { VECTOR_DIM } from './types';

export function euclideanDistance(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < VECTOR_DIM; i++) {
    const d = a[i] - b[i];
    sum += d * d;
  }
  return Math.sqrt(sum);
}

export function cosineDistance(a: Float32Array, b: Float32Array): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < VECTOR_DIM; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  if (denom === 0) return 1;
  const sim = dot / denom;
  return 1 - sim;
}

/** Diagonal-covariance Mahalanobis distance. */
export function mahalanobisDistance(
  a: Float32Array,
  b: Float32Array,
  variance: Float32Array,
): number {
  let sum = 0;
  for (let i = 0; i < VECTOR_DIM; i++) {
    const d = a[i] - b[i];
    const v = variance[i] > 1e-9 ? variance[i] : 1e-9;
    sum += (d * d) / v;
  }
  return Math.sqrt(sum);
}

/** Bound a distance into a [0,1] similarity score. */
export function toSimilarity(distance: number, metric: 'euclidean' | 'cosine' | 'mahalanobis'): number {
  if (metric === 'cosine') {
    // cosine distance is in [0, 2]
    return Math.max(0, Math.min(1, 1 - distance / 2));
  }
  // Map [0, ∞) -> (0, 1] via 1 / (1 + d)
  return 1 / (1 + distance);
}
