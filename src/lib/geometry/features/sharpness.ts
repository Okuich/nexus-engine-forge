/**
 * Edge Sharpness — dihedral-angle based crease detection.
 *
 * For each undirected edge shared by two faces:
 *   sharpness = clamp01( dihedral / (π/2) )
 * with sign indicating concave (−) vs convex (+).
 *
 * Per-face sharpness aggregates the maximum |sharpness| over its three
 * incident edges. A face is marked as a "crease" when at least one
 * incident edge exceeds the configurable threshold (default 30°).
 */

import type { RawMesh, Vec3 } from '../types';
import { normalizeIndexed } from '../core/meshGenerator';

export interface EdgeSharpness {
  v0: number;
  v1: number;
  faceA: number;
  faceB: number;
  /** Dihedral angle in radians (0 = coplanar normals). */
  dihedral: number;
  /** Signed sharpness: + convex, − concave. Range ≈ [-1, 1]. */
  signedSharpness: number;
  /** Absolute sharpness in [0, 1]. */
  sharpness: number;
  /** True when over the crease threshold. */
  isCrease: boolean;
}

export interface SharpnessOptions {
  /** Crease threshold in radians. Default π/6 (30°). */
  creaseThreshold?: number;
}

export interface SharpnessReport {
  edges: EdgeSharpness[];
  perFaceSharpness: number[];
  perFaceCrease: boolean[];
  meanSharpness: number;
  maxSharpness: number;
  creaseEdgeCount: number;
}

/** Compute per-edge and per-face sharpness. */
export function computeSharpness(input: RawMesh, opts: SharpnessOptions = {}): SharpnessReport {
  const mesh = normalizeIndexed(input);
  const positions = mesh.positions as ArrayLike<number>;
  const indices = mesh.indices as ArrayLike<number>;
  const faceCount = indices.length / 3;
  const threshold = opts.creaseThreshold ?? Math.PI / 6;

  const faceNormals: Vec3[] = [];
  const faceCentroids: Vec3[] = [];
  for (let f = 0; f < faceCount; f++) {
    const i0 = indices[f * 3], i1 = indices[f * 3 + 1], i2 = indices[f * 3 + 2];
    const p0 = vertex(positions, i0), p1 = vertex(positions, i1), p2 = vertex(positions, i2);
    faceNormals.push(normalize(cross(sub(p1, p0), sub(p2, p0))));
    faceCentroids.push([
      (p0[0] + p1[0] + p2[0]) / 3,
      (p0[1] + p1[1] + p2[1]) / 3,
      (p0[2] + p1[2] + p2[2]) / 3,
    ]);
  }

  const edgeFaces = new Map<string, { faces: number[]; v0: number; v1: number }>();
  for (let f = 0; f < faceCount; f++) {
    const a = indices[f * 3], b = indices[f * 3 + 1], c = indices[f * 3 + 2];
    for (const [u, v] of [[a, b], [b, c], [c, a]] as Array<[number, number]>) {
      const lo = u < v ? u : v;
      const hi = u < v ? v : u;
      const key = `${lo}_${hi}`;
      const e = edgeFaces.get(key);
      if (e) e.faces.push(f);
      else edgeFaces.set(key, { faces: [f], v0: lo, v1: hi });
    }
  }

  const edges: EdgeSharpness[] = [];
  const perFaceSharpness = new Array<number>(faceCount).fill(0);
  const perFaceCrease = new Array<boolean>(faceCount).fill(false);
  let creaseEdgeCount = 0;
  let sumAbs = 0, maxAbs = 0;

  for (const { faces, v0, v1 } of edgeFaces.values()) {
    if (faces.length !== 2) continue;
    const fA = faces[0], fB = faces[1];
    const nA = faceNormals[fA], nB = faceNormals[fB];

    const dot = clamp(nA[0] * nB[0] + nA[1] * nB[1] + nA[2] * nB[2], -1, 1);
    const dihedral = Math.acos(dot);

    // Convex vs concave: a convex edge has B's centroid below A's plane.
    const dirAB = sub(faceCentroids[fB], faceCentroids[fA]);
    const sign = (dirAB[0] * nA[0] + dirAB[1] * nA[1] + dirAB[2] * nA[2]) >= 0 ? -1 : 1;

    const absSharp = clamp01(dihedral / (Math.PI / 2));
    const signed = sign * absSharp;
    const isCrease = dihedral >= threshold;

    edges.push({
      v0, v1, faceA: fA, faceB: fB,
      dihedral, signedSharpness: signed, sharpness: absSharp, isCrease,
    });

    if (absSharp > perFaceSharpness[fA]) perFaceSharpness[fA] = absSharp;
    if (absSharp > perFaceSharpness[fB]) perFaceSharpness[fB] = absSharp;
    if (isCrease) {
      perFaceCrease[fA] = true;
      perFaceCrease[fB] = true;
      creaseEdgeCount++;
    }
    sumAbs += absSharp;
    if (absSharp > maxAbs) maxAbs = absSharp;
  }

  return {
    edges,
    perFaceSharpness,
    perFaceCrease,
    meanSharpness: edges.length > 0 ? sumAbs / edges.length : 0,
    maxSharpness: maxAbs,
    creaseEdgeCount,
  };
}

// ─── helpers ────────────────────────────────────────────────────

function vertex(positions: ArrayLike<number>, idx: number): Vec3 {
  return [positions[idx * 3], positions[idx * 3 + 1], positions[idx * 3 + 2]];
}
function sub(a: Vec3, b: Vec3): Vec3 { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function normalize(v: Vec3): Vec3 {
  const l = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
  return l > 1e-14 ? [v[0] / l, v[1] / l, v[2] / l] : [0, 0, 1];
}
function clamp(v: number, lo: number, hi: number) { return v < lo ? lo : v > hi ? hi : v; }
function clamp01(v: number) { return v < 0 ? 0 : v > 1 ? 1 : v; }
