/**
 * SDF query operations.
 *
 *   • sampleSDF(field, point)     — trilinear-interpolated signed distance
 *   • isInside(field, point)      — boolean inside/outside test
 *   • nearestSurface(field, point)— closest surface point + normal via gradient descent
 *   • gradient(field, point)      — central-difference SDF gradient (≈ outward normal)
 */
import type { SDFGrid, NearestSurfaceResult } from './types';

type V3 = [number, number, number];

function indexToWorld(field: SDFGrid, i: number, j: number, k: number): V3 {
  return [
    field.bounds.min[0] + (i + 0.5) * field.voxelSize,
    field.bounds.min[1] + (j + 0.5) * field.voxelSize,
    field.bounds.min[2] + (k + 0.5) * field.voxelSize,
  ];
}

function worldToIndexF(field: SDFGrid, p: V3): V3 {
  return [
    (p[0] - field.bounds.min[0]) / field.voxelSize - 0.5,
    (p[1] - field.bounds.min[1]) / field.voxelSize - 0.5,
    (p[2] - field.bounds.min[2]) / field.voxelSize - 0.5,
  ];
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function fetch(field: SDFGrid, i: number, j: number, k: number): number {
  const [nx, ny, nz] = field.dims;
  const ci = clamp(i, 0, nx - 1);
  const cj = clamp(j, 0, ny - 1);
  const ck = clamp(k, 0, nz - 1);
  return field.data[ci + cj * nx + ck * nx * ny];
}

/** Trilinear sample of the SDF at world point. */
export function sampleSDF(field: SDFGrid, point: V3): number {
  const [fi, fj, fk] = worldToIndexF(field, point);
  const i0 = Math.floor(fi), j0 = Math.floor(fj), k0 = Math.floor(fk);
  const tx = fi - i0, ty = fj - j0, tz = fk - k0;
  const c000 = fetch(field, i0,     j0,     k0    );
  const c100 = fetch(field, i0 + 1, j0,     k0    );
  const c010 = fetch(field, i0,     j0 + 1, k0    );
  const c110 = fetch(field, i0 + 1, j0 + 1, k0    );
  const c001 = fetch(field, i0,     j0,     k0 + 1);
  const c101 = fetch(field, i0 + 1, j0,     k0 + 1);
  const c011 = fetch(field, i0,     j0 + 1, k0 + 1);
  const c111 = fetch(field, i0 + 1, j0 + 1, k0 + 1);
  const c00 = c000 * (1 - tx) + c100 * tx;
  const c01 = c001 * (1 - tx) + c101 * tx;
  const c10 = c010 * (1 - tx) + c110 * tx;
  const c11 = c011 * (1 - tx) + c111 * tx;
  const c0 = c00 * (1 - ty) + c10 * ty;
  const c1 = c01 * (1 - ty) + c11 * ty;
  return c0 * (1 - tz) + c1 * tz;
}

export function isInside(field: SDFGrid, point: V3): boolean {
  return sampleSDF(field, point) < 0;
}

/** Central-difference gradient — approximates outward surface normal. */
export function gradient(field: SDFGrid, point: V3): V3 {
  const h = field.voxelSize;
  const dx = sampleSDF(field, [point[0] + h, point[1], point[2]]) -
             sampleSDF(field, [point[0] - h, point[1], point[2]]);
  const dy = sampleSDF(field, [point[0], point[1] + h, point[2]]) -
             sampleSDF(field, [point[0], point[1] - h, point[2]]);
  const dz = sampleSDF(field, [point[0], point[1], point[2] + h]) -
             sampleSDF(field, [point[0], point[1], point[2] + h * 0]) -
             sampleSDF(field, [point[0], point[1], point[2] - h]);
  // Re-derive dz cleanly:
  const dzClean = sampleSDF(field, [point[0], point[1], point[2] + h]) -
                  sampleSDF(field, [point[0], point[1], point[2] - h]);
  const inv = 1 / (2 * h);
  const g: V3 = [dx * inv, dy * inv, dzClean * inv];
  const n = Math.hypot(g[0], g[1], g[2]) || 1;
  return [g[0] / n, g[1] / n, g[2] / n];
}

/**
 * Project a point to the nearest surface using SDF gradient descent.
 * Converges in 3-5 iterations for points near the surface.
 */
export function nearestSurface(
  field: SDFGrid,
  point: V3,
  maxIterations = 8,
): NearestSurfaceResult {
  let p: V3 = [point[0], point[1], point[2]];
  let d = sampleSDF(field, p);
  let n: V3 = gradient(field, p);
  for (let i = 0; i < maxIterations; i++) {
    p = [p[0] - n[0] * d, p[1] - n[1] * d, p[2] - n[2] * d];
    d = sampleSDF(field, p);
    if (Math.abs(d) < field.voxelSize * 0.01) break;
    n = gradient(field, p);
  }
  return {
    point: p,
    signedDistance: sampleSDF(field, point),
    normal: n,
  };
}

export { indexToWorld, worldToIndexF };
