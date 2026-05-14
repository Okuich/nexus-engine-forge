import { describe, it, expect } from 'vitest';
import { generateBox, generateSphere } from '@/lib/geometry/core';
import { KDTree, Octree, BVH, buildSpatialIndex } from '@/lib/geometry/spatial';
import type { Vec3 } from '@/lib/geometry/types';

function randomPoints(n: number, seed = 1): Vec3[] {
  let s = seed;
  const rand = () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
  const out: Vec3[] = [];
  for (let i = 0; i < n; i++) {
    out.push([rand() * 100 - 50, rand() * 100 - 50, rand() * 100 - 50]);
  }
  return out;
}

describe('spatial — KDTree', () => {
  it('nearest matches brute force', () => {
    const pts = randomPoints(500);
    const tree = new KDTree(pts);
    const target: Vec3 = [3.7, -12.4, 0.9];
    const got = tree.nearest(target)!;
    let bestIdx = -1, bestD2 = Infinity;
    for (let i = 0; i < pts.length; i++) {
      const dx = pts[i][0] - target[0], dy = pts[i][1] - target[1], dz = pts[i][2] - target[2];
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < bestD2) { bestD2 = d2; bestIdx = i; }
    }
    expect(got.index).toBe(bestIdx);
    expect(got.distance).toBeCloseTo(Math.sqrt(bestD2), 6);
  });

  it('knn returns k sorted nearest', () => {
    const pts = randomPoints(200);
    const tree = new KDTree(pts);
    const result = tree.knn([0, 0, 0], 5);
    expect(result).toHaveLength(5);
    for (let i = 1; i < result.length; i++) {
      expect(result[i].distance).toBeGreaterThanOrEqual(result[i - 1].distance);
    }
  });

  it('withinRadius returns all and only points inside', () => {
    const pts: Vec3[] = [[0, 0, 0], [1, 0, 0], [10, 0, 0], [0, 2, 0]];
    const tree = new KDTree(pts);
    const r = tree.withinRadius([0, 0, 0], 2.5);
    const idxs = r.map((x) => x.index).sort();
    expect(idxs).toEqual([0, 1, 3]);
  });

  it('1k-point nearest under 5ms', () => {
    const pts = randomPoints(1000);
    const tree = new KDTree(pts);
    const t0 = performance.now();
    for (let i = 0; i < 100; i++) tree.nearest([i, -i, i / 2]);
    const elapsed = performance.now() - t0;
    expect(elapsed).toBeLessThan(100); // 100 queries < 100ms
  });
});

describe('spatial — Octree', () => {
  const sphere = generateSphere({ radius: 1, latSegments: 16, lonSegments: 24 });

  it('raycast hits sphere from outside', () => {
    const o = new Octree(sphere);
    const hit = o.raycast({ origin: [0, 0, 5], direction: [0, 0, -1] });
    expect(hit).not.toBeNull();
    expect(hit!.point[2]).toBeCloseTo(1, 1);
  });

  it('queryBox returns subset of triangles', () => {
    const o = new Octree(sphere);
    const result = o.queryBox({ min: [0, 0, 0], max: [1.1, 1.1, 1.1] });
    expect(result.length).toBeGreaterThan(0);
    expect(result.length).toBeLessThan(o.triangleCount);
  });

  it('queryPoint returns empty outside bounds', () => {
    const o = new Octree(sphere);
    expect(o.queryPoint([100, 100, 100])).toEqual([]);
  });
});

describe('spatial — BVH parity & performance', () => {
  it('BVH and Octree raycast agree on hit distance', () => {
    const box = generateBox({ width: 2, height: 2, depth: 2 });
    const bvh = new BVH(box);
    const oct = new Octree(box);
    const ray = { origin: [0, 0, 5] as Vec3, direction: [0, 0, -1] as Vec3 };
    const a = bvh.raycast(ray)!;
    const b = oct.raycast(ray)!;
    expect(a.t).toBeCloseTo(b.t, 5);
  });

  it('large-mesh raycast under 100ms', () => {
    const dense = generateSphere({ radius: 1, latSegments: 64, lonSegments: 96 });
    const bvh = new BVH(dense);
    const t0 = performance.now();
    for (let i = 0; i < 50; i++) {
      bvh.raycast({ origin: [Math.cos(i) * 5, 0, Math.sin(i) * 5], direction: [-Math.cos(i), 0, -Math.sin(i)] });
    }
    expect(performance.now() - t0).toBeLessThan(100);
  });
});

describe('spatial — buildSpatialIndex factory', () => {
  it('selects BVH for raycast workload', () => {
    const idx = buildSpatialIndex(generateBox(), 'raycast');
    expect(idx.kind).toBe('bvh');
  });

  it('selects Octree for point-query workload', () => {
    const idx = buildSpatialIndex(generateBox(), 'point-query');
    expect(idx.kind).toBe('octree');
  });
});
