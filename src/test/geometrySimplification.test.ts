import { describe, it, expect } from 'vitest';
import {
  simplifyMesh,
  buildLODs,
  simplifyGraph,
  checkSimplificationGate,
  prepareForInference,
  SimplificationGateError,
} from '@/lib/geometry/simplification';
import type { RawMesh, FaceAdjacencyGraph } from '@/lib/geometry/types';

/** Build a tessellated grid mesh on the XY plane (n×n quads → 2n² triangles) */
function gridMesh(n: number): RawMesh {
  const positions: number[] = [];
  const indices: number[] = [];
  for (let y = 0; y <= n; y++) {
    for (let x = 0; x <= n; x++) {
      positions.push(x / n, y / n, 0);
    }
  }
  const idx = (x: number, y: number) => y * (n + 1) + x;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      indices.push(idx(x, y), idx(x + 1, y), idx(x + 1, y + 1));
      indices.push(idx(x, y), idx(x + 1, y + 1), idx(x, y + 1));
    }
  }
  return {
    positions: new Float32Array(positions),
    indices: new Uint32Array(indices),
  };
}

describe('simplifyMesh (QEM)', () => {
  it('reduces triangle count toward target', () => {
    const mesh = gridMesh(20);
    const inputTri = mesh.indices!.length / 3;
    const { mesh: out, stats } = simplifyMesh(mesh, { targetRatio: 0.25 });
    expect(stats.inputTriangles).toBe(inputTri);
    expect(stats.outputTriangles).toBeLessThan(inputTri);
    expect(stats.outputTriangles).toBeGreaterThan(0);
    expect(out.positions.length).toBeGreaterThan(0);
    expect(out.indices.length % 3).toBe(0);
  });

  it('preserves planar geometry with low curvature delta', () => {
    const mesh = gridMesh(15);
    const { stats } = simplifyMesh(mesh, { targetRatio: 0.3 });
    expect(stats.curvatureDelta).toBeLessThan(50);
  });

  it('respects time budget', () => {
    const mesh = gridMesh(30);
    const { stats } = simplifyMesh(mesh, {
      targetRatio: 0.1,
      timeBudgetMs: 100,
    });
    expect(stats.elapsedMs).toBeLessThan(500);
  });
});

describe('buildLODs', () => {
  it('produces decreasing-detail levels including L0 original', () => {
    const mesh = gridMesh(16);
    const { lods } = buildLODs(mesh, { levels: 3, ratioPerLevel: 0.5 });
    expect(lods[0].level).toBe(0);
    expect(lods[0].ratio).toBe(1);
    for (let i = 1; i < lods.length; i++) {
      expect(lods[i].mesh.indices.length).toBeLessThanOrEqual(
        lods[i - 1].mesh.indices.length,
      );
    }
  });

  it('respects maxLevels cap', () => {
    const mesh = gridMesh(12);
    const { lods } = buildLODs(mesh, { levels: 8, maxLevels: 2 });
    expect(lods.length).toBeLessThanOrEqual(3); // L0 + up to 2 simplified
  });
});

describe('simplifyGraph', () => {
  it('coarsens nodes and edges while preserving sharp boundaries', () => {
    const graph: FaceAdjacencyGraph = {
      nodeCount: 6,
      edges: [
        { id: 0, faceA: 0, faceB: 1, dihedralAngle: 0.05, sharedVertices: [0, 1], isConcave: false, length: 1 },
        { id: 1, faceA: 1, faceB: 2, dihedralAngle: 0.05, sharedVertices: [1, 2], isConcave: false, length: 1 },
        { id: 2, faceA: 2, faceB: 3, dihedralAngle: Math.PI / 2, sharedVertices: [2, 3], isConcave: false, length: 1 },
        { id: 3, faceA: 3, faceB: 4, dihedralAngle: 0.05, sharedVertices: [3, 4], isConcave: false, length: 1 },
        { id: 4, faceA: 4, faceB: 5, dihedralAngle: 0.05, sharedVertices: [4, 5], isConcave: false, length: 1 },
      ],
      faces: Array.from({ length: 6 }, (_, i) => ({
        id: i,
        area: 1,
        normal: [0, 0, 1] as [number, number, number],
        centroid: [i, 0, 0] as [number, number, number],
        curvatureMean: 0,
        curvatureGaussian: 0,
        curvatureMin: 0,
        curvatureMax: 0,
        surfaceClass: 'planar' as const,
      })),
    };
    const out = simplifyGraph(graph, { targetRatio: 0.5 });
    expect(out.nodeCount).toBeLessThanOrEqual(6);
    expect(out.nodeCount).toBeGreaterThanOrEqual(2);
    expect(out.edgeCompression).toBeLessThanOrEqual(1);
  });
});

describe('gating', () => {
  it('blocks starter tier above triangle limit', () => {
    const d = checkSimplificationGate({
      tier: 'starter',
      triangleCount: 200_000,
    });
    expect(d.allowed).toBe(false);
  });
  it('allows enterprise for high-volume inference', () => {
    const d = checkSimplificationGate({
      tier: 'enterprise',
      triangleCount: 1_000_000,
      inferenceJobsPerHour: 100_000,
      highVolumeInference: true,
    });
    expect(d.allowed).toBe(true);
  });
  it('blocks professional above job-rate cap', () => {
    const d = checkSimplificationGate({
      tier: 'professional',
      triangleCount: 1000,
      inferenceJobsPerHour: 5000,
    });
    expect(d.allowed).toBe(false);
  });
});

describe('prepareForInference', () => {
  it('packages LODs + coarsened graph + feature matrix', () => {
    const mesh = gridMesh(8);
    const graph: FaceAdjacencyGraph = {
      nodeCount: 4,
      edges: [
        { id: 0, faceA: 0, faceB: 1, dihedralAngle: 0.01, sharedVertices: [0, 1], isConcave: false, length: 1 },
        { id: 1, faceA: 1, faceB: 2, dihedralAngle: 0.01, sharedVertices: [1, 2], isConcave: false, length: 1 },
        { id: 2, faceA: 2, faceB: 3, dihedralAngle: 0.01, sharedVertices: [2, 3], isConcave: false, length: 1 },
      ],
      faces: Array.from({ length: 4 }, (_, i) => ({
        id: i,
        area: 1,
        normal: [0, 0, 1] as [number, number, number],
        centroid: [i, 0, 0] as [number, number, number],
        curvatureMean: 0.1,
        curvatureGaussian: 0,
        curvatureMin: 0,
        curvatureMax: 0,
        surfaceClass: 'planar' as const,
      })),
    };
    const payload = prepareForInference(mesh, graph, {
      gating: { tier: 'enterprise', triangleCount: mesh.indices!.length / 3 },
      lod: { levels: 2 },
      graph: { targetRatio: 0.5 },
    });
    expect(payload.lods.length).toBeGreaterThan(0);
    expect(payload.featureDim).toBe(7);
    expect(payload.features.length).toBe(payload.graph.nodeCount * 7);
    expect(payload.coarseMesh.indices.length).toBeGreaterThan(0);
  });

  it('throws SimplificationGateError when gated', () => {
    const mesh = gridMesh(4);
    const graph: FaceAdjacencyGraph = { nodeCount: 0, edges: [], faces: [] };
    expect(() =>
      prepareForInference(mesh, graph, {
        gating: { tier: 'starter', triangleCount: 10_000_000 },
      }),
    ).toThrow(SimplificationGateError);
  });
});
