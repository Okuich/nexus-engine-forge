/**
 * Tier-based access control for the simplification engine.
 *
 * Activation conditions:
 *   - large-scale processing      (triangleCount thresholds)
 *   - high-volume inference       (inferenceJobsPerHour thresholds)
 */

import type {
  SimplificationGatingContext,
  SimplificationGatingDecision,
} from './types';

const TIER_LIMITS = {
  starter: {
    maxTriangles: 50_000,
    maxLODs: 2,
    maxJobsPerHour: 10,
  },
  professional: {
    maxTriangles: 2_000_000,
    maxLODs: 5,
    maxJobsPerHour: 1_000,
  },
  enterprise: {
    maxTriangles: 50_000_000,
    maxLODs: 10,
    maxJobsPerHour: Number.POSITIVE_INFINITY,
  },
} as const;

export function checkSimplificationGate(
  ctx: SimplificationGatingContext,
): SimplificationGatingDecision {
  const limits = TIER_LIMITS[ctx.tier];
  if (!limits) {
    return {
      allowed: false,
      reason: `Unknown tier: ${ctx.tier}`,
      maxLODs: 0,
      maxTriangles: 0,
    };
  }

  if (ctx.triangleCount > limits.maxTriangles) {
    return {
      allowed: false,
      reason:
        `Mesh of ${ctx.triangleCount.toLocaleString()} triangles exceeds ` +
        `${ctx.tier} limit (${limits.maxTriangles.toLocaleString()}). ` +
        `Upgrade tier for large-scale processing.`,
      maxLODs: limits.maxLODs,
      maxTriangles: limits.maxTriangles,
    };
  }

  const jph = ctx.inferenceJobsPerHour ?? 0;
  if (jph > limits.maxJobsPerHour) {
    return {
      allowed: false,
      reason:
        `Inference throughput (${jph}/h) exceeds ${ctx.tier} limit ` +
        `(${limits.maxJobsPerHour}/h). Upgrade for high-volume workloads.`,
      maxLODs: limits.maxLODs,
      maxTriangles: limits.maxTriangles,
    };
  }

  return {
    allowed: true,
    maxLODs: limits.maxLODs,
    maxTriangles: limits.maxTriangles,
  };
}
