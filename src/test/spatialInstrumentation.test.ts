import { describe, it, expect } from 'vitest';
import { BVH } from '@/lib/geometry/core/spatialIndex';
import { Octree } from '@/lib/geometry/spatial/octree';
import {
  traceBVHRaycast, traceBVHNearest, traceOctreeRaycast,
  collectAllSplits,
} from '@/lib/geometry/spatial/instrumentation';
import type { RawMesh, Vec3 } from '@/lib/geometry/types';

const mesh: RawMesh = {
  positions: new Float32Array([
    0, 0, 0,  1, 0, 0,  1, 1, 0,  0, 1, 0,
    0, 0, 1,  1, 0, 1,  1, 1, 1,  0, 1, 1,
  ]),
  indices: new Uint32Array([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]),
};

describe('spatial instrumentation', () => {
  it('records visited and pruned nodes during BVH raycast', () => {
    const bvh = new BVH(mesh);
    const t = traceBVHRaycast(bvh, { origin: [0.3, 0.3, 5] as Vec3, direction: [0, 0, -1] as Vec3 });
    expect(t.nodes.length).toBeGreaterThan(0);
    expect(t.totalLeaves).toBeGreaterThan(0);
  });

  it('records traversal during BVH nearest-triangle query', () => {
    const bvh = new BVH(mesh);
    const t = traceBVHNearest(bvh, [0.5, 0.5, 0.5]);
    expect(t.nodes.length).toBeGreaterThan(0);
    expect(t.totalLeaves).toBeGreaterThanOrEqual(1);
  });

  it('records octree raycast nodes', () => {
    const oct = new Octree(mesh);
    const t = traceOctreeRaycast(oct, { origin: [0.3, 0.3, 5] as Vec3, direction: [0, 0, -1] as Vec3 });
    expect(t.nodes.length).toBeGreaterThan(0);
  });

  it('collects all splits without a query', () => {
    const bvh = new BVH(mesh);
    const all = collectAllSplits(bvh);
    expect(all.length).toBeGreaterThan(0);
    expect(all.every((n) => n.role === 'visited')).toBe(true);
  });
});
