/**
 * Collision & Interference Analysis Engine — public API.
 *
 * Capabilities:
 *   - Multi-part static collision detection (BVH broad + Möller exact)
 *   - Tolerance-band near-miss reporting
 *   - Motion sweep for moving assemblies (time-of-impact)
 *   - Tier gating for assembly / enterprise workflows
 */

import type { AssemblyPart, CollisionDetectionOptions, CollisionGatingContext, InterferenceReport, MotionSweepOptions, MotionSweepResult, MovingPart } from './types';
import { detectCollisions } from './detector';
import { sweepMotion } from './sweep';
import { checkCollisionGate } from './gating';
import { CollisionGateError } from './types';

export { detectCollisions } from './detector';
export { sweepMotion } from './sweep';
export { checkCollisionGate } from './gating';
export { transformMesh, sampleMotion, lerpTransform } from './transform';
export { trianglesIntersect } from './triTri';
export { CollisionGateError } from './types';
export type {
  AssemblyPart,
  MovingPart,
  Transform,
  MotionKeyframe,
  CollisionDetectionOptions,
  CollisionPair,
  InterferenceReport,
  MotionSweepOptions,
  MotionSweepResult,
  CollisionTier,
  CollisionGatingContext,
  CollisionGatingDecision,
} from './types';

function totalTris(parts: AssemblyPart[]): number {
  let n = 0;
  for (const p of parts) {
    n += p.mesh.indices
      ? (p.mesh.indices.length / 3) | 0
      : ((p.mesh.positions.length / 3 / 3) | 0);
  }
  return n;
}

/** Gated entry point for static collision analysis. */
export function detectCollisionsGated(
  parts: AssemblyPart[],
  gating: Omit<CollisionGatingContext, 'partCount' | 'totalTriangles'>,
  options: CollisionDetectionOptions = {},
): InterferenceReport {
  const ctx: CollisionGatingContext = {
    ...gating,
    partCount: parts.length,
    totalTriangles: totalTris(parts),
  };
  const decision = checkCollisionGate(ctx);
  if (!decision.allowed) throw new CollisionGateError(decision);
  return detectCollisions(parts, options);
}

/** Gated entry point for moving-assembly motion sweep. */
export function sweepMotionGated(
  parts: Array<AssemblyPart | MovingPart>,
  gating: Omit<CollisionGatingContext, 'partCount' | 'totalTriangles'>,
  options: MotionSweepOptions = {},
): MotionSweepResult {
  const ctx: CollisionGatingContext = {
    ...gating,
    partCount: parts.length,
    totalTriangles: totalTris(parts as AssemblyPart[]),
  };
  const decision = checkCollisionGate(ctx);
  if (!decision.allowed) throw new CollisionGateError(decision);
  return sweepMotion(parts, options);
}
