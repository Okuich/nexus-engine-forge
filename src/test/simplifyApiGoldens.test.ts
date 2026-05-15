/**
 * Golden-fixture integration tests for simplify-api.
 *
 * Three deterministic procedural meshes (cube, UV-sphere, torus "teapot")
 * are fed through `buildLODs` and `coarsenGraph` directly. We pin the
 * exact LOD chain length, per-level triangle counts, and graph topology
 * (node count, edge count, cluster sizes) so any regression in the
 * vertex-cluster simplifier or heaviest-edge matcher is caught.
 */
import { describe, it, expect } from 'vitest';
import {
  buildLODs,
  coarsenGraph,
  meshToArrays,
} from '../../supabase/functions/simplify-api/core';

// ─── Golden mesh generators ────────────────────────────────────────────────

interface RawMesh { positions: number[]; indices: number[] }

/** Unit cube centered at origin: 8 verts, 12 tris. */
function makeCube(): RawMesh {
  const p = [
    -1,-1,-1,  1,-1,-1,  1, 1,-1, -1, 1,-1,
    -1,-1, 1,  1,-1, 1,  1, 1, 1, -1, 1, 1,
  ];
  const i = [
    0,1,2, 0,2,3,   // -Z
    4,6,5, 4,7,6,   // +Z
    0,4,5, 0,5,1,   // -Y
    3,2,6, 3,6,7,   // +Y
    0,3,7, 0,7,4,   // -X
    1,5,6, 1,6,2,   // +X
  ];
  return { positions: p, indices: i };
}

/** UV sphere, fixed segs/rings → fully deterministic. */
function makeSphere(segs = 16, rings = 12, radius = 1): RawMesh {
  const positions: number[] = [];
  const indices: number[] = [];
  for (let r = 0; r <= rings; r++) {
    const theta = (r / rings) * Math.PI;
    const sinT = Math.sin(theta), cosT = Math.cos(theta);
    for (let s = 0; s <= segs; s++) {
      const phi = (s / segs) * Math.PI * 2;
      positions.push(
        radius * sinT * Math.cos(phi),
        radius * cosT,
        radius * sinT * Math.sin(phi),
      );
    }
  }
  const stride = segs + 1;
  for (let r = 0; r < rings; r++) {
    for (let s = 0; s < segs; s++) {
      const a = r * stride + s;
      const b = a + 1;
      const c = a + stride;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  return { positions, indices };
}

/**
 * "Teapot" — we use a parameterised torus as a stand-in. It's a well-known
 * non-trivial closed surface that's deterministic without shipping a 25 KB
 * fixture file. Same role in tests as the Utah teapot.
 */
function makeTeapot(segs = 24, rings = 12, R = 1, r = 0.35): RawMesh {
  const positions: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i <= rings; i++) {
    const u = (i / rings) * Math.PI * 2;
    const cu = Math.cos(u), su = Math.sin(u);
    for (let j = 0; j <= segs; j++) {
      const v = (j / segs) * Math.PI * 2;
      const cv = Math.cos(v), sv = Math.sin(v);
      positions.push((R + r * cv) * cu, (R + r * cv) * su, r * sv);
    }
  }
  const stride = segs + 1;
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < segs; j++) {
      const a = i * stride + j;
      const b = a + 1;
      const c = a + stride;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  return { positions, indices };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('simplify-api goldens — LOD counts', () => {
  it('cube produces deterministic LOD chain', () => {
    const cube = makeCube();
    const { lods } = buildLODs(cube, { levels: 3, ratioPerLevel: 0.5, minTriangles: 4 });

    // L0 is always passthrough.
    expect(lods[0].level).toBe(0);
    expect(lods[0].stats.outputTriangles).toBe(12);
    expect(lods[0].ratio).toBe(1);

    // 12-triangle cube collapses fast — chain stops once it hits the floor.
    const triCounts = lods.map((l) => l.stats.outputTriangles);
    expect(triCounts).toEqual([12]); // no further LODs viable above minTriangles
    expect(lods.length).toBe(1);
  });

  it('sphere produces a monotonically decreasing LOD chain', () => {
    const sphere = makeSphere(16, 12); // 384 triangles
    const { lods } = buildLODs(sphere, { levels: 4, ratioPerLevel: 0.5, minTriangles: 8 });

    expect(lods.length).toBeGreaterThanOrEqual(2);
    expect(lods[0].stats.outputTriangles).toBe(384);

    // Strictly decreasing tri counts, ratios in (0, 1].
    for (let i = 1; i < lods.length; i++) {
      expect(lods[i].stats.outputTriangles).toBeLessThan(lods[i - 1].stats.outputTriangles);
      expect(lods[i].ratio).toBeGreaterThan(0);
      expect(lods[i].ratio).toBeLessThanOrEqual(1);
      expect(lods[i].level).toBe(i);
    }

    // Pin the exact chain — vertex-cluster grid scaling is deterministic.
    const triCounts = lods.map((l) => l.stats.outputTriangles);
    expect(triCounts).toMatchInlineSnapshot(`
      [
        384,
        336,
        332,
        314,
        264,
      ]
    `);
  });

  it('teapot (torus) produces a deterministic LOD chain', () => {
    const teapot = makeTeapot(24, 12); // 576 triangles
    const { lods } = buildLODs(teapot, { levels: 3, ratioPerLevel: 0.5, minTriangles: 8 });

    expect(lods[0].stats.outputTriangles).toBe(576);
    expect(lods.length).toBeGreaterThanOrEqual(2);

    const triCounts = lods.map((l) => l.stats.outputTriangles);
    expect(triCounts).toMatchInlineSnapshot(`
      [
        576,
        460,
        324,
        244,
      ]
    `);
  });
});

describe('simplify-api goldens — graph cluster topology', () => {
  it('cube coarsens to a deterministic 6-face graph at targetRatio=0.5', () => {
    const m = meshToArrays(makeCube());
    const g = coarsenGraph(m, undefined, 0.5);

    // 12 tris → 6 nodes (pairs of coplanar tris merge first by cos=1, area equal).
    expect(g.nodeCount).toBe(6);
    // Cluster sizes: each face of cube has 2 tris → all clusters size 2.
    const sizes = g.clusters.map((c) => c.length).sort((a, b) => a - b);
    expect(sizes).toEqual([2, 2, 2, 2, 2, 2]);
    // 6 cube faces fully connected at their shared edges → 12 coarse edges.
    expect(g.edgeCount).toBe(12);
    expect(g.edgeCompression).toBeCloseTo(12 / 18, 5);
  });

  it('sphere coarsening yields stable node/edge counts', () => {
    const m = meshToArrays(makeSphere(16, 12));
    const g = coarsenGraph(m, undefined, 0.25);

    // Pin exact topology — heaviest-edge matching is deterministic given a
    // stable input ordering and stable JS sort.
    expect(g.nodeCount).toMatchInlineSnapshot(`96`);
    expect(g.edgeCount).toMatchInlineSnapshot(`125`);
    expect(g.clusters.reduce((s, c) => s + c.length, 0)).toBe(384);
  });

  it('teapot coarsening preserves face partition over original mesh', () => {
    const m = meshToArrays(makeTeapot(24, 12));
    const g = coarsenGraph(m, undefined, 0.25);

    expect(g.nodeCount).toMatchInlineSnapshot(`144`);
    expect(g.edgeCount).toMatchInlineSnapshot(`220`);
    // Every original face appears in exactly one cluster.
    const seen = new Set<number>();
    for (const c of g.clusters) for (const f of c) {
      expect(seen.has(f)).toBe(false);
      seen.add(f);
    }
    expect(seen.size).toBe(576);
  });

  it('targetNodes hard cap is honoured for all three goldens', () => {
    for (const [name, mesh] of [
      ['cube', makeCube()],
      ['sphere', makeSphere(16, 12)],
      ['teapot', makeTeapot(24, 12)],
    ] as const) {
      const g = coarsenGraph(meshToArrays(mesh), 8);
      expect(g.nodeCount, `${name}: ≤ targetNodes`).toBeLessThanOrEqual(8);
      expect(g.nodeCount, `${name}: ≥ 1`).toBeGreaterThan(0);
    }
  });
});
