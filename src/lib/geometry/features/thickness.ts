/**
 * Thickness — Shape Diameter Function (SDF).
 *
 * For each face, casts a small bundle of rays from its centroid in the
 * inward-normal cone and measures the distance to the opposite surface.
 * The robust thickness is a cone-weighted average of the bundle hits,
 * filtered to within 1.5σ of the median to reject outliers.
 *
 * Reference: Shapira, Shamir, Cohen-Or — "Consistent mesh segmentation
 * using the Shape Diameter Function" (2008).
 */

import type { RawMesh, Vec3 } from '../types';
import { normalizeIndexed } from '../core/meshGenerator';
import { BVH } from '../core/spatialIndex';

export interface ThicknessOptions {
  /** Number of rays per face. Default 9. */
  samples?: number;
  /** Half-angle of the inward cone (radians). Default π/6. */
  coneHalfAngle?: number;
  /** Maximum ray distance, in units of the mesh diagonal. Default 2. */
  maxDistanceFactor?: number;
}

export interface ThicknessResult {
  /** Per-face thickness; NaN if no inward hit was recorded. */
  thickness: number[];
  /** Mean thickness across faces (excluding NaN). */
  meanThickness: number;
  /** Standard deviation. */
  stdThickness: number;
  /** Min / max for normalization. */
  minThickness: number;
  maxThickness: number;
}

/**
 * Compute per-face Shape Diameter Function thickness.
 */
export function computeThickness(input: RawMesh, opts: ThicknessOptions = {}): ThicknessResult {
  const mesh = normalizeIndexed(input);
  const positions = mesh.positions as ArrayLike<number>;
  const indices = mesh.indices as ArrayLike<number>;
  const faceCount = indices.length / 3;
  const samples = opts.samples ?? 9;
  const halfAngle = opts.coneHalfAngle ?? Math.PI / 6;

  const bvh = new BVH(mesh);
  const bounds = bvh.bounds;
  const dx = bounds.max[0] - bounds.min[0];
  const dy = bounds.max[1] - bounds.min[1];
  const dz = bounds.max[2] - bounds.min[2];
  const diag = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const maxT = (opts.maxDistanceFactor ?? 2) * (diag || 1);

  const directions = generateConeDirections(samples, halfAngle);
  const thickness = new Array<number>(faceCount).fill(NaN);
  let sum = 0, sum2 = 0, count = 0;
  let mn = Infinity, mx = -Infinity;

  for (let f = 0; f < faceCount; f++) {
    const i0 = indices[f * 3], i1 = indices[f * 3 + 1], i2 = indices[f * 3 + 2];
    const p0 = vertex(positions, i0);
    const p1 = vertex(positions, i1);
    const p2 = vertex(positions, i2);
    const c: Vec3 = [(p0[0] + p1[0] + p2[0]) / 3, (p0[1] + p1[1] + p2[1]) / 3, (p0[2] + p1[2] + p2[2]) / 3];
    const n = faceNormal(p0, p1, p2);
    const inward: Vec3 = [-n[0], -n[1], -n[2]];

    // Build orthonormal basis around inward normal.
    const tangent = orthogonal(inward);
    const bitangent = normalize(cross(inward, tangent));

    const hits: number[] = [];
    const weights: number[] = [];
    for (const d of directions) {
      // Rotate template direction (along +Z) into world basis (inward is +Z).
      const dir: Vec3 = [
        tangent[0] * d[0] + bitangent[0] * d[1] + inward[0] * d[2],
        tangent[1] * d[0] + bitangent[1] * d[1] + inward[1] * d[2],
        tangent[2] * d[0] + bitangent[2] * d[1] + inward[2] * d[2],
      ];
      // Offset origin slightly inward to avoid self-hit.
      const origin: Vec3 = [
        c[0] + inward[0] * 1e-5 * diag,
        c[1] + inward[1] * 1e-5 * diag,
        c[2] + inward[2] * 1e-5 * diag,
      ];
      const hit = bvh.raycast({ origin, direction: dir });
      if (hit && hit.t > 0 && hit.t < maxT && hit.triangleIndex !== f) {
        hits.push(hit.t);
        // Weight by alignment with inward normal (cosine).
        weights.push(Math.max(0, d[2]));
      }
    }

    if (hits.length === 0) continue;
    const t = robustMean(hits, weights);
    thickness[f] = t;
    sum += t; sum2 += t * t; count++;
    if (t < mn) mn = t;
    if (t > mx) mx = t;
  }

  const meanThickness = count > 0 ? sum / count : 0;
  const variance = count > 0 ? sum2 / count - meanThickness * meanThickness : 0;
  const stdThickness = Math.sqrt(Math.max(0, variance));
  return {
    thickness,
    meanThickness,
    stdThickness,
    minThickness: count > 0 ? mn : 0,
    maxThickness: count > 0 ? mx : 0,
  };
}

// ─── Helpers ────────────────────────────────────────────────────

function generateConeDirections(n: number, halfAngle: number): Vec3[] {
  if (n <= 1) return [[0, 0, 1]];
  const out: Vec3[] = [[0, 0, 1]];
  const rings = Math.max(1, Math.floor(Math.sqrt(n - 1)));
  const perRing = Math.max(1, Math.ceil((n - 1) / rings));
  for (let r = 1; r <= rings && out.length < n; r++) {
    const theta = (r / rings) * halfAngle;
    const sinT = Math.sin(theta), cosT = Math.cos(theta);
    for (let k = 0; k < perRing && out.length < n; k++) {
      const phi = (k / perRing) * Math.PI * 2;
      out.push([sinT * Math.cos(phi), sinT * Math.sin(phi), cosT]);
    }
  }
  return out;
}

function robustMean(values: number[], weights: number[]): number {
  // Median-MAD outlier rejection at 1.5σ-equivalent.
  const sorted = [...values].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const dev = sorted.map((v) => Math.abs(v - median)).sort((a, b) => a - b);
  const mad = dev[Math.floor(dev.length / 2)] || 1e-6;
  const cutoff = 1.5 * 1.4826 * mad;

  let wsum = 0, vsum = 0;
  for (let i = 0; i < values.length; i++) {
    if (Math.abs(values[i] - median) <= cutoff) {
      vsum += values[i] * weights[i];
      wsum += weights[i];
    }
  }
  if (wsum < 1e-9) return median;
  return vsum / wsum;
}

function vertex(positions: ArrayLike<number>, idx: number): Vec3 {
  return [positions[idx * 3], positions[idx * 3 + 1], positions[idx * 3 + 2]];
}

function faceNormal(a: Vec3, b: Vec3, c: Vec3): Vec3 {
  const e1: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const e2: Vec3 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  return normalize(cross(e1, e2));
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function normalize(v: Vec3): Vec3 {
  const len = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
  return len > 1e-14 ? [v[0] / len, v[1] / len, v[2] / len] : [0, 0, 1];
}

function orthogonal(n: Vec3): Vec3 {
  // Pick the basis vector furthest from n, then cross.
  const ax = Math.abs(n[0]), ay = Math.abs(n[1]), az = Math.abs(n[2]);
  const ref: Vec3 = ax < ay && ax < az ? [1, 0, 0] : ay < az ? [0, 1, 0] : [0, 0, 1];
  return normalize(cross(n, ref));
}
