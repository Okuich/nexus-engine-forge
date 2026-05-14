/**
 * Collision detector — BVH-accelerated assembly interference analysis.
 *
 * Pipeline:
 *   1. Build per-part BVH on transformed geometry (cached by transform key).
 *   2. AABB cross-prune across all part pairs.
 *   3. For each candidate pair, query BVH-vs-BVH triangle overlaps.
 *   4. Run Möller tri-tri tests on the prune set.
 *   5. Apply tolerance band to convert near-misses into "withinTolerance".
 */

import { BVH, aabb as aabbOps } from '../core/spatialIndex';
import type { AABB, RawMesh, Vec3 } from '../types';
import { transformMesh } from './transform';
import { trianglesIntersect, triangleIntersectionPoint } from './triTri';
import type {
  AssemblyPart,
  CollisionDetectionOptions,
  CollisionPair,
  InterferenceReport,
} from './types';

interface PreparedPart {
  id: string;
  group?: string;
  tolerance: number;
  positions: Float32Array;
  indices: Uint32Array;
  bvh: BVH;
  bounds: AABB;
}

function normalizeIndices(mesh: RawMesh): Uint32Array {
  if (mesh.indices) {
    if (mesh.indices instanceof Uint32Array) return mesh.indices;
    return new Uint32Array(mesh.indices);
  }
  const triCount = (mesh.positions.length / 3 / 3) | 0;
  const out = new Uint32Array(triCount * 3);
  for (let i = 0; i < out.length; i++) out[i] = i;
  return out;
}

function preparePart(part: AssemblyPart): PreparedPart {
  const transformed = transformMesh(part.mesh, part.transform);
  const positions =
    transformed.positions instanceof Float32Array
      ? transformed.positions
      : new Float32Array(transformed.positions);
  const indices = normalizeIndices(transformed);
  const bvh = new BVH({ positions, indices });
  return {
    id: part.id,
    group: part.group,
    tolerance: part.tolerance ?? 0,
    positions,
    indices,
    bvh,
    bounds: bvh.bounds,
  };
}

function expandAABB(b: AABB, pad: number): AABB {
  return {
    min: [b.min[0] - pad, b.min[1] - pad, b.min[2] - pad],
    max: [b.max[0] + pad, b.max[1] + pad, b.max[2] + pad],
  };
}

function aabbOverlapVolume(a: AABB, b: AABB): number {
  const dx = Math.max(0, Math.min(a.max[0], b.max[0]) - Math.max(a.min[0], b.min[0]));
  const dy = Math.max(0, Math.min(a.max[1], b.max[1]) - Math.max(a.min[1], b.min[1]));
  const dz = Math.max(0, Math.min(a.max[2], b.max[2]) - Math.max(a.min[2], b.min[2]));
  return dx * dy * dz;
}

function getTri(p: PreparedPart, ti: number): [Vec3, Vec3, Vec3] {
  const i0 = p.indices[ti * 3];
  const i1 = p.indices[ti * 3 + 1];
  const i2 = p.indices[ti * 3 + 2];
  return [
    [p.positions[i0 * 3], p.positions[i0 * 3 + 1], p.positions[i0 * 3 + 2]],
    [p.positions[i1 * 3], p.positions[i1 * 3 + 1], p.positions[i1 * 3 + 2]],
    [p.positions[i2 * 3], p.positions[i2 * 3 + 1], p.positions[i2 * 3 + 2]],
  ];
}

function triBounds(tri: [Vec3, Vec3, Vec3]): AABB {
  return {
    min: [
      Math.min(tri[0][0], tri[1][0], tri[2][0]),
      Math.min(tri[0][1], tri[1][1], tri[2][1]),
      Math.min(tri[0][2], tri[1][2], tri[2][2]),
    ],
    max: [
      Math.max(tri[0][0], tri[1][0], tri[2][0]),
      Math.max(tri[0][1], tri[1][1], tri[2][1]),
      Math.max(tri[0][2], tri[1][2], tri[2][2]),
    ],
  };
}

export function detectCollisions(
  parts: AssemblyPart[],
  options: CollisionDetectionOptions = {},
): InterferenceReport {
  const t0 =
    typeof performance !== 'undefined' ? performance.now() : Date.now();

  const budget = options.timeBudgetMs ?? 250;
  const maxPairs = options.maxPairs ?? Number.POSITIVE_INFINITY;
  const maxIxPerPair = options.maxIntersectionsPerPair ?? 256;
  const globalTol = options.globalTolerance ?? 0;

  const prepared = parts.map(preparePart);
  const pairs: CollisionPair[] = [];
  let evaluated = 0;
  let skipped = 0;
  let severity = 0;

  outer: for (let i = 0; i < prepared.length; i++) {
    for (let j = i + 1; j < prepared.length; j++) {
      if (
        (typeof performance !== 'undefined' ? performance.now() : Date.now()) -
          t0 >
        budget
      )
        break outer;

      const A = prepared[i];
      const B = prepared[j];
      if (
        options.excludeSameGroup &&
        A.group &&
        B.group &&
        A.group === B.group
      ) {
        skipped++;
        continue;
      }
      if (pairs.length >= maxPairs) break outer;

      const tol = A.tolerance + B.tolerance + globalTol;
      const aBounds = expandAABB(A.bounds, tol);
      const bBounds = expandAABB(B.bounds, tol);
      if (!aabbOps.overlaps(aBounds, bBounds)) {
        evaluated++;
        continue;
      }

      // BVH-vs-BVH: query A's BVH with B's triangle bounds.
      const candTrisA = new Set<number>();
      const candTrisB = new Set<number>();
      const triCountB = (B.indices.length / 3) | 0;
      for (let ti = 0; ti < triCountB; ti++) {
        const tri = getTri(B, ti);
        const tb = expandAABB(triBounds(tri), tol);
        const hits = A.bvh.queryBox(tb);
        if (hits.length > 0) {
          candTrisB.add(ti);
          for (const h of hits) candTrisA.add(h);
        }
      }

      let ixCount = 0;
      const samples: Vec3[] = [];
      for (const ai of candTrisA) {
        if (ixCount >= maxIxPerPair) break;
        const triA = getTri(A, ai);
        for (const bi of candTrisB) {
          const triB = getTri(B, bi);
          if (
            trianglesIntersect(
              triA[0], triA[1], triA[2],
              triB[0], triB[1], triB[2],
              1e-7,
            )
          ) {
            ixCount++;
            if (samples.length < 8) {
              samples.push(
                triangleIntersectionPoint(
                  triA[0], triA[1], triA[2],
                  triB[0], triB[1], triB[2],
                ),
              );
            }
            if (ixCount >= maxIxPerPair) break;
          }
        }
      }

      const overlapVol = aabbOverlapVolume(A.bounds, B.bounds);
      const minSep = ixCount > 0 ? -Math.cbrt(overlapVol) : Math.max(0, tol);
      const withinTol = ixCount === 0 && tol > 0 && aabbOps.overlaps(aBounds, bBounds);

      if (ixCount > 0 || withinTol) {
        pairs.push({
          partA: A.id,
          partB: B.id,
          overlapVolume: overlapVol,
          intersectionCount: ixCount,
          samplePoints: samples,
          withinTolerance: withinTol,
          minSeparation: minSep,
        });
        if (ixCount > 0) severity += overlapVol * ixCount;
      }
      evaluated++;
    }
  }

  const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  return {
    pairs,
    totalPairsEvaluated: evaluated,
    totalPairsSkipped: skipped,
    elapsedMs: t1 - t0,
    severityScore: severity,
  };
}
