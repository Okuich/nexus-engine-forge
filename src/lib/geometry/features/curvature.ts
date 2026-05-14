/**
 * Discrete Curvature — vertex-based Gaussian and mean curvature.
 *
 * Gaussian (angle defect):
 *     K_v = (2π − Σ θ_i) / A_mixed
 * Mean (cotangent Laplacian magnitude):
 *     H_v = ‖Δx_v‖ / 2
 *     Δx_v = (1 / 2A_mixed) · Σ (cot α_ij + cot β_ij) · (x_j − x_v)
 *
 * Per-face curvatures are the area-weighted average of their three
 * vertices. Robust to small triangles via clamped cot weights.
 *
 * Reference: Meyer, Desbrun, Schröder, Barr (2003).
 */

import type { RawMesh, Vec3 } from '../types';
import { normalizeIndexed } from '../core/meshGenerator';

export interface VertexCurvature {
  /** Discrete Gaussian curvature K. */
  gaussian: number;
  /** Discrete mean curvature H. */
  mean: number;
  /** Mixed (Voronoi-cell) area used as the denominator. */
  area: number;
}

export interface FaceCurvature {
  faceIndex: number;
  gaussian: number;
  mean: number;
  /** Principal curvature estimates derived from H ± √(H² − K). */
  k1: number;
  k2: number;
}

export interface CurvatureField {
  perVertex: VertexCurvature[];
  perFace: FaceCurvature[];
}

/**
 * Compute per-vertex and per-face Gaussian / mean curvature.
 */
export function computeCurvature(input: RawMesh): CurvatureField {
  const mesh = normalizeIndexed(input);
  const positions = mesh.positions as ArrayLike<number>;
  const indices = mesh.indices as ArrayLike<number>;
  const vertCount = positions.length / 3;
  const faceCount = indices.length / 3;

  const angleSum = new Float64Array(vertCount);
  const mixedArea = new Float64Array(vertCount);
  const laplacian = new Float64Array(vertCount * 3);

  for (let f = 0; f < faceCount; f++) {
    const i0 = indices[f * 3], i1 = indices[f * 3 + 1], i2 = indices[f * 3 + 2];
    const p0 = vertex(positions, i0);
    const p1 = vertex(positions, i1);
    const p2 = vertex(positions, i2);

    // Edge vectors per corner.
    const e01 = sub(p1, p0), e02 = sub(p2, p0);
    const e10 = neg(e01),    e12 = sub(p2, p1);
    const e20 = neg(e02),    e21 = neg(e12);

    // Interior angles
    const a0 = angle(e01, e02);
    const a1 = angle(e10, e12);
    const a2 = angle(e20, e21);
    angleSum[i0] += a0;
    angleSum[i1] += a1;
    angleSum[i2] += a2;

    // Triangle area
    const n = cross(e01, e02);
    const area = 0.5 * length(n);
    if (area < 1e-14) continue;

    // Cotangent weights (cot α at the *opposite* vertex)
    const cot0 = cot(a0);
    const cot1 = cot(a1);
    const cot2 = cot(a2);

    // Voronoi mixed area per vertex (Meyer 2003 simplification: 1/3 of triangle area).
    const third = area / 3;
    mixedArea[i0] += third;
    mixedArea[i1] += third;
    mixedArea[i2] += third;

    // Cotangent Laplacian contributions.
    // For edge (i,j) opposite vertex k: weight = cot(angle at k) / 2.
    addScaled(laplacian, i0, p1, p0, cot2 / 2);
    addScaled(laplacian, i0, p2, p0, cot1 / 2);
    addScaled(laplacian, i1, p0, p1, cot2 / 2);
    addScaled(laplacian, i1, p2, p1, cot0 / 2);
    addScaled(laplacian, i2, p0, p2, cot1 / 2);
    addScaled(laplacian, i2, p1, p2, cot0 / 2);
  }

  const perVertex: VertexCurvature[] = [];
  for (let v = 0; v < vertCount; v++) {
    const a = mixedArea[v];
    const gaussian = a > 1e-14 ? (2 * Math.PI - angleSum[v]) / a : 0;
    const lx = laplacian[v * 3], ly = laplacian[v * 3 + 1], lz = laplacian[v * 3 + 2];
    const lapMag = Math.sqrt(lx * lx + ly * ly + lz * lz);
    const mean = a > 1e-14 ? lapMag / (2 * a) : 0;
    perVertex.push({ gaussian, mean, area: a });
  }

  const perFace: FaceCurvature[] = [];
  for (let f = 0; f < faceCount; f++) {
    const i0 = indices[f * 3], i1 = indices[f * 3 + 1], i2 = indices[f * 3 + 2];
    const g = (perVertex[i0].gaussian + perVertex[i1].gaussian + perVertex[i2].gaussian) / 3;
    const h = (perVertex[i0].mean + perVertex[i1].mean + perVertex[i2].mean) / 3;
    // Principal curvatures from H, K
    const disc = Math.max(0, h * h - g);
    const root = Math.sqrt(disc);
    perFace.push({ faceIndex: f, gaussian: g, mean: h, k1: h + root, k2: h - root });
  }

  return { perVertex, perFace };
}

// ─── Vector helpers ─────────────────────────────────────────────

function vertex(positions: ArrayLike<number>, idx: number): Vec3 {
  return [positions[idx * 3], positions[idx * 3 + 1], positions[idx * 3 + 2]];
}
function sub(a: Vec3, b: Vec3): Vec3 { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function neg(a: Vec3): Vec3 { return [-a[0], -a[1], -a[2]]; }
function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function length(v: Vec3): number { return Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]); }
function angle(a: Vec3, b: Vec3): number {
  const la = length(a), lb = length(b);
  if (la < 1e-14 || lb < 1e-14) return 0;
  const c = (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (la * lb);
  return Math.acos(Math.max(-1, Math.min(1, c)));
}
function cot(theta: number): number {
  const s = Math.sin(theta);
  if (Math.abs(s) < 1e-9) return 0;
  // Clamp to avoid blow-up at degenerate triangles.
  const c = Math.cos(theta) / s;
  return Math.max(-1e4, Math.min(1e4, c));
}
function addScaled(out: Float64Array, vIdx: number, target: Vec3, base: Vec3, w: number) {
  out[vIdx * 3]     += w * (target[0] - base[0]);
  out[vIdx * 3 + 1] += w * (target[1] - base[1]);
  out[vIdx * 3 + 2] += w * (target[2] - base[2]);
}
