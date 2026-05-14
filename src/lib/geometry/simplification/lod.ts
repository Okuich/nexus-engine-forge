/**
 * Multi-resolution Level-of-Detail (LOD) generator.
 *
 * Builds a progressive mesh hierarchy by repeatedly applying QEM
 * simplification to the previous level's output.
 */

import type { RawMesh } from '../types';
import { simplifyMesh } from './quadricSimplifier';
import type {
  MultiResolutionResult,
  SimplifiedLOD,
  SimplifyOptions,
} from './types';

export interface LODOptions extends Omit<SimplifyOptions, 'targetRatio' | 'targetTriangles'> {
  /** Geometric ratio per level. Default 0.5 (each level halves triangles). */
  ratioPerLevel?: number;
  /** Number of LOD levels (excluding L0 = original). Default 3. */
  levels?: number;
  /** Stop generating LODs below this triangle count. Default 64. */
  minTriangles?: number;
  /** Hard cap on level count (e.g. from gating). */
  maxLevels?: number;
}

export function buildLODs(
  mesh: RawMesh,
  options: LODOptions = {},
): MultiResolutionResult {
  const t0 =
    typeof performance !== 'undefined' ? performance.now() : Date.now();

  const ratio = options.ratioPerLevel ?? 0.5;
  const requested = options.levels ?? 3;
  const cap = options.maxLevels ?? requested;
  const levels = Math.min(requested, cap);
  const minTris = options.minTriangles ?? 64;

  const inputTri = mesh.indices
    ? (mesh.indices.length / 3) | 0
    : (((mesh.positions.length / 3) | 0) / 3) | 0;

  // L0 = original (zero-cost passthrough).
  const positions =
    mesh.positions instanceof Float32Array
      ? mesh.positions
      : new Float32Array(mesh.positions);
  const indices = mesh.indices
    ? mesh.indices instanceof Uint32Array
      ? mesh.indices
      : new Uint32Array(mesh.indices)
    : new Uint32Array(Array.from({ length: inputTri * 3 }, (_, i) => i));

  const lods: SimplifiedLOD[] = [
    {
      level: 0,
      ratio: 1,
      mesh: { positions, indices },
      stats: {
        inputTriangles: inputTri,
        outputTriangles: inputTri,
        inputVertices: (positions.length / 3) | 0,
        outputVertices: (positions.length / 3) | 0,
        ratio: 1,
        collapses: 0,
        rejectedCollapses: 0,
        meanError: 0,
        maxError: 0,
        curvatureDelta: 0,
        elapsedMs: 0,
      },
    },
  ];

  let current: RawMesh = { positions, indices };
  let cumulativeRatio = 1;

  for (let l = 1; l <= levels; l++) {
    cumulativeRatio *= ratio;
    const targetTri = Math.max(
      minTris,
      Math.floor(inputTri * cumulativeRatio),
    );
    if (targetTri >= (current.indices!.length / 3) | 0) break;
    if (targetTri < minTris) break;

    const { mesh: out, stats } = simplifyMesh(current, {
      ...options,
      targetTriangles: targetTri,
    });
    lods.push({
      level: l,
      ratio: cumulativeRatio,
      mesh: out,
      stats,
    });
    current = out;
  }

  const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  return { lods, totalElapsedMs: t1 - t0 };
}
