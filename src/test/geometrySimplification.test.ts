import { describe, it, expect } from 'vitest';
import {
  simplifyMesh,
  buildLODs,
  simplifyGraph,
  checkSimplificationGate,
  prepareForInference,
  SimplificationGateError,
} from '@/lib/geometry/simplification';
import type {
  RawMesh,
  FaceAdjacencyGraph,
  FaceFeatures,
  EdgeFeatures,
} from '@/lib/geometry/types';

function gridMesh(n: number): RawMesh {
  const positions: number[] = [];
  const indices: number[] = [];
  for (let y = 0; y <= n; y++) {
    for (let x = 0; x <= n; x++) positions.push(x / n, y / n, 0);
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

function makeGraph(numNodes: number, edges: Array<[number, number, number]>): {
  graph: FaceAdjacencyGraph;
  faces: FaceFeatures[];
} {
  const adjacency: EdgeFeatures[] = edges.map(([a, b, dih], i) => ({
    id: i,
    faceA: a,
    faceB: b,
    sharedVertices: [a, b],
    dihedralAngle: dih,
    isConcave: false,
    length: 1,
  }));
  const neighbors = new Map<number, number[]>();
  const degree = new Array(numNodes).fill(0);
  for (let i = 0; i < numNodes; i++) neighbors.set(i, []);
  for (const e of adjacency) {
    neighbors.get(e.faceA)!.push(e.faceB);
    neighbors.get(e.faceB)!.push(e.faceA);
    degree[e.faceA]++;
    degree[e.faceB]++;
  }
  const graph: FaceAdjacencyGraph = {
    numNodes,
    numEdges: adjacency.length,
    adjacency,
    edgeIndex: [[], []],
    edgeAttr: [],
    neighbors,
    degree,
  };
  const faces: FaceFeatures[] = Array.from({ length: numNodes }, (_, i) => ({
    id: i,
    area: 1,
    normal: [0, 0, 1],
    centroid: [i, 0, 0],
    curvatureMean: 0.1,
    curvatureGaussian: 0,
    curvatureMin: 0,
    curvatureMax: 0,
    surfaceClass: 'planar',
  }));
  return { graph, faces };
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
    expect(lods.length).toBeLessThanOrEqual(3);
  });
});

describe('simplifyGraph', () => {
  it('coarsens nodes and edges while preserving sharp boundaries', () => {
    const { graph, faces } = makeGraph(6, [
      [0, 1, 0.05],
      [1, 2, 0.05],
      [2, 3, Math.PI / 2],
      [3, 4, 0.05],
      [4, 5, 0.05],
    ]);
    const out = simplifyGraph(graph, faces, { targetRatio: 0.5 });
    expect(out.nodeCount).toBeLessThanOrEqual(6);
    expect(out.nodeCount).toBeGreaterThanOrEqual(2);
    expect(out.edgeCompression).toBeLessThanOrEqual(1);
  });
});

describe('gating', () => {
  it('blocks starter tier above triangle limit', () => {
    expect(
      checkSimplificationGate({ tier: 'starter', triangleCount: 200_000 })
        .allowed,
    ).toBe(false);
  });
  it('allows enterprise for high-volume inference', () => {
    expect(
      checkSimplificationGate({
        tier: 'enterprise',
        triangleCount: 1_000_000,
        inferenceJobsPerHour: 100_000,
        highVolumeInference: true,
      }).allowed,
    ).toBe(true);
  });
  it('blocks professional above job-rate cap', () => {
    expect(
      checkSimplificationGate({
        tier: 'professional',
        triangleCount: 1000,
        inferenceJobsPerHour: 5000,
      }).allowed,
    ).toBe(false);
  });
});

describe('prepareForInference', () => {
  it('packages LODs + coarsened graph + feature matrix', () => {
    const mesh = gridMesh(8);
    const { graph, faces } = makeGraph(4, [
      [0, 1, 0.01],
      [1, 2, 0.01],
      [2, 3, 0.01],
    ]);
    const payload = prepareForInference(mesh, graph, {
      gating: { tier: 'enterprise', triangleCount: mesh.indices!.length / 3 },
      lod: { levels: 2 },
      graph: { targetRatio: 0.5 },
      faceFeatures: faces,
    });
    expect(payload.lods.length).toBeGreaterThan(0);
    expect(payload.featureDim).toBe(7);
    expect(payload.features.length).toBe(payload.graph.nodeCount * 7);
    expect(payload.coarseMesh.indices.length).toBeGreaterThan(0);
  });

  it('throws SimplificationGateError when gated', () => {
    const mesh = gridMesh(4);
    const { graph } = makeGraph(0, []);
    expect(() =>
      prepareForInference(mesh, graph, {
        gating: { tier: 'starter', triangleCount: 10_000_000 },
      }),
    ).toThrow(SimplificationGateError);
  });
});
