import { describe, it, expect } from 'vitest';
import { createTraversal } from '@/lib/geometry/traversal';
import type { RawMesh } from '@/lib/geometry/types';

// Single triangle in z=0 plane.
const mesh: RawMesh = {
  positions: new Float32Array([
    0, 0, 0,
    1, 0, 0,
    0, 1, 0,
  ]),
  indices: new Uint32Array([0, 1, 2]),
};

describe('GeometryTraversal pipeline', () => {
  it('raycasts via cached BVH', () => {
    const t = createTraversal(mesh, { workload: 'raycast' });
    const hit = t.raycast({ origin: [0.25, 0.25, 1], direction: [0, 0, -1] });
    expect(hit).not.toBeNull();
    expect(hit!.triangleIndex).toBe(0);
    expect(t.activeIndexKind).toBe('bvh');
  });

  it('finds nearest vertex via KD-tree', () => {
    const t = createTraversal(mesh);
    const r = t.nearestVertex([0.9, 0.05, 0]);
    expect(r).not.toBeNull();
    expect(r!.index).toBe(1);
  });

  it('returns vertices within radius and box', () => {
    const t = createTraversal(mesh);
    expect(t.verticesInRadius([0, 0, 0], 0.5).map((r) => r.index)).toEqual([0]);
    expect(t.verticesInBox([-0.1, -0.1, -0.1], [1.1, 1.1, 0.1]).length).toBe(3);
  });

  it('runs region triangle queries', () => {
    const t = createTraversal(mesh);
    const ids = t.trianglesInBox({ min: [-1, -1, -1], max: [2, 2, 1] });
    expect(ids).toEqual([0]);
    expect(t.trianglesInRadius([0.3, 0.3, 0], 1).length).toBe(1);
  });

  it('selects octree for point-query workload', () => {
    const t = createTraversal(mesh, { workload: 'point-query' });
    expect(t.activeIndexKind).toBe('octree');
  });
});
