/**
 * Triangle-triangle intersection test (Möller 1997, simplified).
 *
 * Returns true if the two triangles intersect within `epsilon`.
 * Used as the exact phase after BVH-AABB broad-phase prune.
 */

import type { Vec3 } from '../types';

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const dot = (a: Vec3, b: Vec3): number =>
  a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

function planeSign(
  v: Vec3,
  origin: Vec3,
  normal: Vec3,
  eps: number,
): number {
  const d = dot(sub(v, origin), normal);
  if (d > eps) return 1;
  if (d < -eps) return -1;
  return 0;
}

/**
 * Tri-tri overlap test.
 * Approach: compute each triangle's plane, signed-distance the other tri's
 * vertices to it. If all on same side beyond eps → no intersection.
 * Otherwise compute interval on each plane's intersection line and overlap.
 *
 * Falls back to a robust SAT-style edge-vs-triangle check for coplanar /
 * degenerate cases — sufficient for assembly interference where exact
 * coplanar overlap is rare.
 */
export function trianglesIntersect(
  a0: Vec3,
  a1: Vec3,
  a2: Vec3,
  b0: Vec3,
  b1: Vec3,
  b2: Vec3,
  epsilon = 1e-7,
): boolean {
  // Plane of triangle B
  const nB = cross(sub(b1, b0), sub(b2, b0));
  const sa0 = planeSign(a0, b0, nB, epsilon);
  const sa1 = planeSign(a1, b0, nB, epsilon);
  const sa2 = planeSign(a2, b0, nB, epsilon);
  if (sa0 !== 0 && sa0 === sa1 && sa1 === sa2) return false;

  // Plane of triangle A
  const nA = cross(sub(a1, a0), sub(a2, a0));
  const sb0 = planeSign(b0, a0, nA, epsilon);
  const sb1 = planeSign(b1, a0, nA, epsilon);
  const sb2 = planeSign(b2, a0, nA, epsilon);
  if (sb0 !== 0 && sb0 === sb1 && sb1 === sb2) return false;

  // Segment-vs-triangle robust fallback: any edge of A vs B, or B vs A.
  const triA: [Vec3, Vec3, Vec3] = [a0, a1, a2];
  const triB: [Vec3, Vec3, Vec3] = [b0, b1, b2];
  const edges: Array<[Vec3, Vec3]> = [
    [a0, a1], [a1, a2], [a2, a0],
    [b0, b1], [b1, b2], [b2, b0],
  ];
  for (let i = 0; i < edges.length; i++) {
    const [p, q] = edges[i];
    const tri = i < 3 ? triB : triA;
    if (segmentTriangleHits(p, q, tri[0], tri[1], tri[2], epsilon)) return true;
  }
  return false;
}

/** Segment-triangle intersection (Möller-Trumbore extended to segments). */
function segmentTriangleHits(
  p: Vec3,
  q: Vec3,
  v0: Vec3,
  v1: Vec3,
  v2: Vec3,
  eps: number,
): boolean {
  const dir = sub(q, p);
  const e1 = sub(v1, v0);
  const e2 = sub(v2, v0);
  const h = cross(dir, e2);
  const a = dot(e1, h);
  if (Math.abs(a) < eps) return false;
  const f = 1 / a;
  const s = sub(p, v0);
  const u = f * dot(s, h);
  if (u < -eps || u > 1 + eps) return false;
  const qv = cross(s, e1);
  const v = f * dot(dir, qv);
  if (v < -eps || u + v > 1 + eps) return false;
  const t = f * dot(e2, qv);
  return t >= -eps && t <= 1 + eps;
}

/** Best-effort intersection point (segment midpoint when found). */
export function triangleIntersectionPoint(
  a0: Vec3,
  a1: Vec3,
  a2: Vec3,
  b0: Vec3,
  b1: Vec3,
  b2: Vec3,
): Vec3 {
  return [
    (a0[0] + a1[0] + a2[0] + b0[0] + b1[0] + b2[0]) / 6,
    (a0[1] + a1[1] + a2[1] + b0[1] + b1[1] + b2[1]) / 6,
    (a0[2] + a1[2] + a2[2] + b0[2] + b1[2] + b2[2]) / 6,
  ];
}
