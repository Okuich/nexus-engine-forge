/**
 * Spatial Acceleration Engine — unified entry point.
 *
 * Re-exports KD-Tree, BVH (from core), and Octree, plus a convenience
 * factory for picking the right structure based on workload hints.
 *
 * Targets sub-100ms queries on meshes up to ~500k triangles for
 * raycasts, point lookups, and k-NN searches.
 */

export { KDTree } from './kdTree';
export type { KDQueryResult, KDTreeOptions } from './kdTree';

export { Octree } from './octree';
export type { OctreeOptions } from './octree';

// Re-export BVH from the core layer so callers have one import surface.
export { BVH, UniformGrid, aabb } from '../core/spatialIndex';
export type {
  AABB,
  Ray,
  RayHit,
  BVHOptions,
  UniformGridOptions,
} from '../core/spatialIndex';

import { BVH } from '../core/spatialIndex';
import { Octree } from './octree';
import type { RawMesh } from '../types';

export type SpatialWorkload =
  | 'raycast'        // ray-heavy (raycasting, picking) → BVH
  | 'point-query'    // many point-in-region lookups → Octree
  | 'box-query'      // many AABB overlap queries → BVH
  | 'mixed';

export interface SpatialIndex {
  /** Backing structure name. */
  kind: 'bvh' | 'octree';
  raycast: BVH['raycast'] | Octree['raycast'];
  queryBox: BVH['queryBox'] | Octree['queryBox'];
}

/**
 * Pick the right triangle-spatial index for a workload hint.
 *
 *   • raycast / box-query / mixed → BVH (best worst-case prune)
 *   • point-query                 → Octree (O(1) descent to leaf)
 */
export function buildSpatialIndex(
  mesh: RawMesh,
  workload: SpatialWorkload = 'mixed',
): SpatialIndex {
  if (workload === 'point-query') {
    const o = new Octree(mesh);
    return {
      kind: 'octree',
      raycast: o.raycast.bind(o),
      queryBox: o.queryBox.bind(o),
    };
  }
  const b = new BVH(mesh);
  return {
    kind: 'bvh',
    raycast: b.raycast.bind(b),
    queryBox: b.queryBox.bind(b),
  };
}

// ── Serialization ─────────────────────────────────────────────
export {
  serializeBVH,
  deserializeBVH,
  serializeOctree,
  deserializeOctree,
  serializeKDTree,
  deserializeKDTree,
  serializeSpatialIndex,
  deserializeSpatialIndex,
  toJSON as spatialIndexToJSON,
  fromJSON as spatialIndexFromJSON,
  SPATIAL_FORMAT_VERSION,
} from './serialization';
export type {
  SerializedSpatialIndex,
  SerializedBVH,
  SerializedOctree,
  SerializedKDTree,
  SerializedKind,
} from './serialization';

// ── Benchmark runner ──────────────────────────────────────────
export { runSpatialBenchmark, formatReport as formatSpatialBenchmark } from './benchmark';
export type {
  BenchmarkOptions as SpatialBenchmarkOptions,
  BenchmarkReport as SpatialBenchmarkReport,
  BenchmarkCase as SpatialBenchmarkCase,
  LatencyStats as SpatialLatencyStats,
} from './benchmark';
