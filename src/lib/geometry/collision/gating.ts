/**
 * Tier-based gating for the collision engine.
 *
 * Activation:
 *   - assembly workflows
 *   - enterprise manufacturing customers
 */

import type {
  CollisionGatingContext,
  CollisionGatingDecision,
} from './types';

const TIER_LIMITS = {
  starter: { maxParts: 4, maxTriangles: 50_000 },
  professional: { maxParts: 32, maxTriangles: 1_000_000 },
  enterprise: { maxParts: 1024, maxTriangles: 50_000_000 },
} as const;

export function checkCollisionGate(
  ctx: CollisionGatingContext,
): CollisionGatingDecision {
  const limits = TIER_LIMITS[ctx.tier];
  if (!limits) {
    return {
      allowed: false,
      reason: `Unknown tier: ${ctx.tier}`,
      maxParts: 0,
      maxTriangles: 0,
    };
  }

  // Starter requires explicit assembly workflow flag to access at all.
  if (ctx.tier === 'starter' && !ctx.assemblyWorkflow) {
    return {
      allowed: false,
      reason: 'Collision analysis requires an assembly workflow context.',
      maxParts: limits.maxParts,
      maxTriangles: limits.maxTriangles,
    };
  }

  if (ctx.partCount > limits.maxParts) {
    return {
      allowed: false,
      reason:
        `Assembly of ${ctx.partCount} parts exceeds ${ctx.tier} limit ` +
        `(${limits.maxParts}). Upgrade for enterprise manufacturing.`,
      maxParts: limits.maxParts,
      maxTriangles: limits.maxTriangles,
    };
  }

  if (ctx.totalTriangles > limits.maxTriangles) {
    return {
      allowed: false,
      reason:
        `Total triangles ${ctx.totalTriangles.toLocaleString()} exceed ` +
        `${ctx.tier} limit (${limits.maxTriangles.toLocaleString()}).`,
      maxParts: limits.maxParts,
      maxTriangles: limits.maxTriangles,
    };
  }

  return {
    allowed: true,
    maxParts: limits.maxParts,
    maxTriangles: limits.maxTriangles,
  };
}
