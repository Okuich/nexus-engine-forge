/**
 * Midwater Geometry Engine — Math Primitives
 *
 * Pure functions for triangle geometry computations.
 * No external dependencies. All operations are on flat arrays.
 */

import type { Vec3, SurfaceClass } from './types';

// ─── Vector Operations ───────────────────────────────────────────

export function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

export function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function length(v: Vec3): number {
  return Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
}

export function normalize(v: Vec3): Vec3 {
  const len = length(v);
  if (len < 1e-12) return [0, 0, 0];
  return [v[0] / len, v[1] / len, v[2] / len];
}

export function scale(v: Vec3, s: number): Vec3 {
  return [v[0] * s, v[1] * s, v[2] * s];
}

export function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

// ─── Triangle Computations ───────────────────────────────────────

/** Compute area of triangle from three vertices. */
export function triangleArea(a: Vec3, b: Vec3, c: Vec3): number {
  const e1 = sub(b, a);
  const e2 = sub(c, a);
  return length(cross(e1, e2)) * 0.5;
}

/** Compute unit normal of a triangle. Returns [0,0,0] for degenerate triangles. */
export function triangleNormal(a: Vec3, b: Vec3, c: Vec3): Vec3 {
  const e1 = sub(b, a);
  const e2 = sub(c, a);
  return normalize(cross(e1, e2));
}

/** Compute centroid of a triangle. */
export function triangleCentroid(a: Vec3, b: Vec3, c: Vec3): Vec3 {
  return [
    (a[0] + b[0] + c[0]) / 3,
    (a[1] + b[1] + c[1]) / 3,
    (a[2] + b[2] + c[2]) / 3,
  ];
}

/** Distance between two points. */
export function distance(a: Vec3, b: Vec3): number {
  return length(sub(a, b));
}

// ─── Curvature & Classification ──────────────────────────────────

/**
 * Compute dihedral angle between two face normals (radians, [0, π]).
 * Clamped to avoid NaN from floating-point error.
 */
export function dihedralAngle(normalA: Vec3, normalB: Vec3): number {
  const d = dot(normalA, normalB);
  return Math.acos(Math.max(-1, Math.min(1, d)));
}

/**
 * Test whether a face junction is concave.
 * Uses cross(nA, nB) · edgeDir < 0 as the concavity criterion.
 */
export function isConcaveJunction(
  normalA: Vec3,
  normalB: Vec3,
  edgeStart: Vec3,
  edgeEnd: Vec3,
): boolean {
  const c = cross(normalA, normalB);
  const d = sub(edgeEnd, edgeStart);
  return dot(c, d) < 0;
}

/**
 * Classify surface type from principal curvatures (κ_min, κ_max).
 *
 * Classification logic:
 *   - planar:      |κ_min| ≈ 0, |κ_max| ≈ 0
 *   - cylindrical: one ≈ 0, one ≠ 0
 *   - spherical:   κ_min ≈ κ_max, both > 0
 *   - conical:     same sign, different magnitude
 *   - toroidal:    opposite signs (saddle point)
 *   - freeform:    none of the above
 */
export function classifySurface(kMin: number, kMax: number, eps = 1e-4): SurfaceClass {
  const absMin = Math.abs(kMin);
  const absMax = Math.abs(kMax);

  if (absMin < eps && absMax < eps) return 'planar';
  if ((absMin < eps) !== (absMax < eps)) return 'cylindrical';
  if (Math.abs(kMin - kMax) / (absMax + 1e-12) < 0.15) return 'spherical';
  if (kMin * kMax > 0) return 'conical';
  if (kMin * kMax < -eps) return 'toroidal';

  return 'freeform';
}

// ─── Volume Computation ──────────────────────────────────────────

/**
 * Compute signed volume contribution of a triangle (signed tetrahedra method).
 * Sum over all faces for total enclosed volume.
 */
export function signedTetrahedronVolume(a: Vec3, b: Vec3, c: Vec3): number {
  return (
    a[0] * (b[1] * c[2] - b[2] * c[1]) +
    b[0] * (c[1] * a[2] - c[2] * a[1]) +
    c[0] * (a[1] * b[2] - a[2] * b[1])
  ) / 6;
}

// ─── Edge Hashing ────────────────────────────────────────────────

/**
 * Szudzik's elegant pairing function for unordered vertex pairs.
 * Produces a unique integer for each {a, b} pair.
 * Handles large indices better than Cantor pairing.
 */
export function edgeHash(a: number, b: number): number {
  const lo = a < b ? a : b;
  const hi = a < b ? b : a;
  return hi * hi + hi + lo;
}
