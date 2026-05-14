import { describe, it, expect } from 'vitest';
import { BVH } from '@/lib/geometry/core/spatialIndex';
import { Octree } from '@/lib/geometry/spatial/octree';
import { KDTree } from '@/lib/geometry/spatial/kdTree';
import {
  serializeBVH, deserializeBVH,
  serializeOctree, deserializeOctree,
  serializeKDTree, deserializeKDTree,
  serializeSpatialIndex, deserializeSpatialIndex,
  spatialIndexToJSON, spatialIndexFromJSON,
} from '@/lib/geometry/spatial';
import type { RawMesh, Vec3 } from '@/lib/geometry/types';

// Two-triangle quad in z=0.
const mesh: RawMesh = {
  positions: new Float32Array([
    0, 0, 0,  1, 0, 0,  1, 1, 0,  0, 1, 0,
    0, 0, 1,  1, 0, 1,  1, 1, 1,  0, 1, 1,
  ]),
  indices: new Uint32Array([
    0, 1, 2,  0, 2, 3,
    4, 5, 6,  4, 6, 7,
  ]),
};

const ray = { origin: [0.3, 0.3, 2] as Vec3, direction: [0, 0, -1] as Vec3 };

describe('Spatial index serialization', () => {
  it('round-trips BVH and preserves raycast results', () => {
    const orig = new BVH(mesh);
    const blob = serializeBVH(orig);
    const restored = deserializeBVH(blob);
    const a = orig.raycast(ray);
    const b = restored.raycast(ray);
    expect(b).not.toBeNull();
    expect(b!.triangleIndex).toBe(a!.triangleIndex);
    expect(b!.t).toBeCloseTo(a!.t, 6);
    expect(restored.triangleCount).toBe(orig.triangleCount);
  });

  it('round-trips BVH box queries', () => {
    const orig = new BVH(mesh);
    const blob = serializeBVH(orig);
    const restored = deserializeBVH(blob);
    const box = { min: [-0.1, -0.1, -0.1] as Vec3, max: [1.1, 1.1, 0.1] as Vec3 };
    expect(restored.queryBox(box).sort()).toEqual(orig.queryBox(box).sort());
  });

  it('round-trips Octree raycast and queries', () => {
    const orig = new Octree(mesh);
    const blob = serializeOctree(orig);
    const restored = deserializeOctree(blob);
    const a = orig.raycast(ray);
    const b = restored.raycast(ray);
    expect(b!.triangleIndex).toBe(a!.triangleIndex);
    expect(restored.triangleCount).toBe(orig.triangleCount);
  });

  it('round-trips KDTree nearest and knn', () => {
    const pts: Vec3[] = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [5, 5, 5]];
    const orig = new KDTree(pts);
    const blob = serializeKDTree(orig);
    const restored = deserializeKDTree(blob);
    expect(restored.nearest([0.9, 0.05, 0])!.index).toBe(1);
    expect(restored.knn([0, 0, 0], 2).map((r) => r.index)).toEqual(
      orig.knn([0, 0, 0], 2).map((r) => r.index),
    );
  });

  it('polymorphic serialize/deserialize works', () => {
    const bvh = new BVH(mesh);
    const blob = serializeSpatialIndex(bvh);
    const restored = deserializeSpatialIndex(blob);
    expect(restored).toBeInstanceOf(BVH);
  });

  it('survives JSON transport (typed arrays → arrays → typed arrays)', () => {
    const orig = new BVH(mesh);
    const blob = serializeBVH(orig);
    const json = JSON.parse(JSON.stringify(spatialIndexToJSON(blob)));
    const restored = deserializeBVH(spatialIndexFromJSON(json) as ReturnType<typeof serializeBVH>);
    const a = orig.raycast(ray);
    const b = restored.raycast(ray);
    expect(b!.triangleIndex).toBe(a!.triangleIndex);
  });

  it('rejects mismatched kind on deserialization', () => {
    const bvh = serializeBVH(new BVH(mesh));
    expect(() => deserializeOctree(bvh as never)).toThrow();
  });
});
