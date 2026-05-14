/**
 * SDF-derived geometry features.
 *
 * Lifts a Signed Distance Field into the per-face feature pipeline:
 *
 *   [0] sdfCentroidDist     — SDF sampled at the face centroid (≈ 0 for closed shells)
 *   [1] sdfShellThickness   — distance from a point one voxel inside the inward normal
 *                              to the opposite shell (proxy for wall thickness)
 *   [2] sdfGradAlignment    — cos(angle) between face normal and SDF gradient (1 = aligned)
 *   [3] sdfVertexMinDist    — min |SDF| across the face's three vertices (open-shell health)
 *
 * The SDF can be precomputed and reused across faces (one grid → O(F) sampling),
 * which is the whole point of integrating it into the feature pipeline rather
 * than recomputing per-face raycasts.
 */

import type { RawMesh, Vec3 } from '../types';
import { normalizeIndexed } from '../core/meshGenerator';
import { generateSDF } from '../sdf/sdfGenerator';
import { sampleSDF, gradient as sdfGradient } from '../sdf/sdfQuery';
import type { SDFGenerationOptions, SDFGrid } from '../sdf/types';

export interface SDFFeatureOptions {
  /** Reuse an existing SDF grid. If omitted, one is generated from the mesh. */
  grid?: SDFGrid;
  /** Generation overrides used when `grid` is not provided. */
  generation?: SDFGenerationOptions;
  /**
   * Distance to step along the inward face normal before sampling for
   * shell thickness. Defaults to `voxelSize * 1.5`.
   */
  insideStepFactor?: number;
}

export interface SDFFeatureSet {
  /** [numFaces × 4] feature matrix (column order documented above). */
  matrix: number[][];
  grid: SDFGrid;
  stats: {
    faces: number;
    /** Mean unsigned SDF at face centroids — closed shells should approach 0. */
    meanCentroidError: number;
    /** Fraction of faces whose normal aligns with the SDF gradient (cos > 0). */
    outwardConsistency: number;
    /** Median per-face shell thickness over faces where the inside ray hit a back-shell. */
    medianShellThickness: number;
    /** Total inside volume estimated by counting negative voxels. */
    enclosedVolume: number;
  };
}

export const SDF_FEATURE_COLUMNS = [
  'sdfCentroidDist',
  'sdfShellThickness',
  'sdfGradAlignment',
  'sdfVertexMinDist',
] as const;

export type SDFFeatureColumn = (typeof SDF_FEATURE_COLUMNS)[number];

// ─── Public ────────────────────────────────────────────────────

export function extractSDFFeatures(mesh: RawMesh, opts: SDFFeatureOptions = {}): SDFFeatureSet {
  const grid = opts.grid ?? generateSDF(mesh, opts.generation);
  const indexed = normalizeIndexed(mesh);
  const positions = indexed.positions as ArrayLike<number>;
  const indices = indexed.indices as ArrayLike<number>;
  const faceCount = indices.length / 3;
  const step = (opts.insideStepFactor ?? 1.5) * grid.voxelSize;

  const matrix: number[][] = new Array(faceCount);
  let sumCentroidErr = 0;
  let outwardCount = 0;
  const shellThicknesses: number[] = [];

  for (let f = 0; f < faceCount; f++) {
    const i0 = indices[f * 3], i1 = indices[f * 3 + 1], i2 = indices[f * 3 + 2];
    const v0 = vert(positions, i0);
    const v1 = vert(positions, i1);
    const v2 = vert(positions, i2);
    const centroid: Vec3 = [
      (v0[0] + v1[0] + v2[0]) / 3,
      (v0[1] + v1[1] + v2[1]) / 3,
      (v0[2] + v1[2] + v2[2]) / 3,
    ];
    const n = faceNormal(v0, v1, v2);

    const dCentroid = sampleSDF(grid, centroid);
    const grad = sdfGradient(grid, centroid);
    const align = dot(grad, n); // gradient is unit-ish for well-formed SDFs.

    // Step inside, then sample again. For closed meshes this returns the
    // distance to the opposite shell (≈ wall thickness × −1).
    const insidePoint: Vec3 = [
      centroid[0] - n[0] * step,
      centroid[1] - n[1] * step,
      centroid[2] - n[2] * step,
    ];
    const dInside = sampleSDF(grid, insidePoint);
    // Shell thickness proxy: 2 × distance from inside point to nearest surface.
    // For a thin wall, dInside ≈ -t/2 → thickness ≈ 2|dInside|.
    const shell = dInside < 0 ? Math.abs(dInside) * 2 : NaN;
    if (Number.isFinite(shell)) shellThicknesses.push(shell);

    const dV0 = Math.abs(sampleSDF(grid, v0));
    const dV1 = Math.abs(sampleSDF(grid, v1));
    const dV2 = Math.abs(sampleSDF(grid, v2));
    const vMin = Math.min(dV0, dV1, dV2);

    matrix[f] = [
      dCentroid,
      Number.isFinite(shell) ? shell : -1,
      align,
      vMin,
    ];

    sumCentroidErr += Math.abs(dCentroid);
    if (align > 0) outwardCount++;
  }

  shellThicknesses.sort((a, b) => a - b);
  const median = shellThicknesses.length
    ? shellThicknesses[shellThicknesses.length >> 1]
    : 0;

  return {
    matrix,
    grid,
    stats: {
      faces: faceCount,
      meanCentroidError: faceCount ? sumCentroidErr / faceCount : 0,
      outwardConsistency: faceCount ? outwardCount / faceCount : 0,
      medianShellThickness: median,
      enclosedVolume: estimateEnclosedVolume(grid),
    },
  };
}

// ─── Internals ────────────────────────────────────────────────

function vert(p: ArrayLike<number>, i: number): Vec3 {
  return [p[i * 3], p[i * 3 + 1], p[i * 3 + 2]];
}

function faceNormal(a: Vec3, b: Vec3, c: Vec3): Vec3 {
  const ab: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const ac: Vec3 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const n: Vec3 = [
    ab[1] * ac[2] - ab[2] * ac[1],
    ab[2] * ac[0] - ab[0] * ac[2],
    ab[0] * ac[1] - ab[1] * ac[0],
  ];
  const len = Math.hypot(n[0], n[1], n[2]) || 1;
  return [n[0] / len, n[1] / len, n[2] / len];
}

function dot(a: Vec3, b: Vec3 | [number, number, number]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function estimateEnclosedVolume(grid: SDFGrid): number {
  let inside = 0;
  for (let i = 0; i < grid.data.length; i++) if (grid.data[i] < 0) inside++;
  const v = grid.voxelSize;
  return inside * v * v * v;
}
