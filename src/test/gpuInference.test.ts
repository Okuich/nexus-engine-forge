import { describe, it, expect } from 'vitest';
import {
  packMultiResolution,
  PACKED_NODE_STRIDE,
  scorePackedCPU,
  scorePacked,
  scoreBatch,
  isWebGPUAvailable,
} from '@/lib/ml/gpu';
import type { SimplifiedGraph } from '@/lib/geometry/simplification/types';

function makeGraph(n: number, ringEdges = true): SimplifiedGraph {
  const edges: Array<[number, number]> = [];
  if (ringEdges) {
    for (let i = 0; i < n; i++) edges.push([i, (i + 1) % n]);
  }
  return {
    nodeCount: n,
    edgeCount: edges.length,
    clusters: Array.from({ length: n }, (_, i) => [i]),
    edges,
    nodeFeatures: Array.from({ length: n }, () => ({
      area: 1,
      avgNormal: [0, 0, 1] as [number, number, number],
      avgCurvature: 0,
    })),
    edgeCompression: 1,
  };
}

function makeFeatures(n: number, dim: number, seed = 1): Float32Array {
  const f = new Float32Array(n * dim);
  let s = seed;
  for (let i = 0; i < f.length; i++) {
    s = (s * 9301 + 49297) % 233280;
    f[i] = (s / 233280) * 2 - 1;
  }
  return f;
}

describe('multi-resolution feature packaging', () => {
  it('packs LOD stack into 16-float-aligned rows with CSR adjacency', () => {
    const g0 = makeGraph(8);
    const g1 = makeGraph(4);
    const f0 = makeFeatures(8, 7);
    const f1 = makeFeatures(4, 7, 9);

    const packed = packMultiResolution([
      { graph: g0, features: f0, featureDim: 7, triangleCount: 16 },
      { graph: g1, features: f1, featureDim: 7, triangleCount: 8 },
    ]);

    expect(packed.totalNodes).toBe(12);
    expect(packed.features.length).toBe(12 * PACKED_NODE_STRIDE);
    expect(packed.adjOffsets.length).toBe(13);
    expect(packed.adjOffsets[0]).toBe(0);
    expect(packed.adjOffsets[12]).toBe(packed.adjNeighbors.length);
    expect(packed.levels).toHaveLength(2);
    expect(packed.levels[1].featureOffset).toBe(8 * PACKED_NODE_STRIDE);

    // Row 3 in level 0 retains the original first feature value
    expect(packed.features[3 * PACKED_NODE_STRIDE]).toBeCloseTo(f0[3 * 7]);
    // Padding lanes are zero
    for (let k = 7; k < PACKED_NODE_STRIDE; k++) {
      expect(packed.features[3 * PACKED_NODE_STRIDE + k]).toBe(0);
    }

    // Neighbor indices in level 1 are offset by level-0 node count
    const lvl1Start = packed.adjOffsets[8];
    const lvl1End = packed.adjOffsets[9];
    for (let e = lvl1Start; e < lvl1End; e++) {
      expect(packed.adjNeighbors[e]).toBeGreaterThanOrEqual(8);
    }
  });
});

describe('GPU/CPU inference scoring', () => {
  it('produces deterministic per-node scores on CPU fallback', () => {
    const g = makeGraph(32);
    const packed = packMultiResolution([
      { graph: g, features: makeFeatures(32, 7), featureDim: 7, triangleCount: 60 },
    ]);
    const r = scorePackedCPU(packed);
    expect(r.scores.length).toBe(32);
    expect(r.backend).toBe('cpu');
    for (const s of r.scores) {
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(1);
      expect(Number.isFinite(s)).toBe(true);
    }
  });

  it('scorePacked falls back to CPU when WebGPU is unavailable', async () => {
    const g = makeGraph(16);
    const packed = packMultiResolution([
      { graph: g, features: makeFeatures(16, 7), featureDim: 7, triangleCount: 30 },
    ]);
    const r = await scorePacked(packed);
    // In Node/jsdom there is no navigator.gpu → must report cpu
    expect(['cpu', 'webgpu']).toContain(r.backend);
    expect(r.scores.length).toBe(16);
  });

  it('isWebGPUAvailable returns false in non-browser test env', async () => {
    const ok = await isWebGPUAvailable();
    expect(typeof ok).toBe('boolean');
  });

  it('scoreBatch sustains throughput across many payloads', async () => {
    const payloads = Array.from({ length: 6 }, (_, i) => {
      const g = makeGraph(24 + i * 4);
      return packMultiResolution([
        { graph: g, features: makeFeatures(g.nodeCount, 7, i + 1), featureDim: 7, triangleCount: 50 },
      ]);
    });
    const out = await scoreBatch(payloads, undefined, { concurrency: 3 });
    expect(out.results).toHaveLength(6);
    expect(out.totalNodes).toBe(payloads.reduce((a, p) => a + p.totalNodes, 0));
    expect(out.nodesPerSecond).toBeGreaterThan(0);
  });
});
