/**
 * Multi-Resolution Feature Packaging (GPU-ready).
 *
 * Packs LOD-stack node features and adjacency into WebGPU/storage-buffer
 * friendly layouts:
 *   - Tightly-aligned (16-byte stride) Float32 feature blocks
 *   - CSR-style adjacency (offsets + neighbors) for graph kernels
 *   - LOD level offsets so a single buffer can carry the whole pyramid
 *
 * Produced layouts are consumable both by WebGPU compute kernels and
 * CPU fallbacks (the same Float32Array works in both).
 */

import type { InferenceReadyPayload, SimplifiedGraph } from '../../geometry/simplification/types';

/** Each packed node row is padded to 16 floats (= 64 bytes) for WGSL alignment. */
export const PACKED_NODE_STRIDE = 16;

export interface PackedLODLevel {
  level: number;
  /** byte / float offset into the global features buffer (in floats, not bytes) */
  featureOffset: number;
  nodeCount: number;
  /** Offset into the CSR neighbors buffer (in u32 elements) */
  adjOffset: number;
  edgeCount: number;
  triangleCount: number;
}

export interface PackedMultiResolution {
  /** Concatenated [nodes × PACKED_NODE_STRIDE] across all LOD levels */
  features: Float32Array;
  /** CSR row offsets (length = totalNodes + 1) */
  adjOffsets: Uint32Array;
  /** CSR neighbor indices (length = sum(edgeCount * 2)) */
  adjNeighbors: Uint32Array;
  /** Per-level metadata */
  levels: PackedLODLevel[];
  totalNodes: number;
  /** Source feature dim (≤ PACKED_NODE_STRIDE) */
  sourceFeatureDim: number;
}

function buildCSR(graph: SimplifiedGraph): { offsets: Uint32Array; neighbors: Uint32Array } {
  const n = graph.nodeCount;
  const degree = new Uint32Array(n);
  for (const [a, b] of graph.edges) {
    if (a < n) degree[a]++;
    if (b < n && b !== a) degree[b]++;
  }
  const offsets = new Uint32Array(n + 1);
  for (let i = 0; i < n; i++) offsets[i + 1] = offsets[i] + degree[i];
  const neighbors = new Uint32Array(offsets[n]);
  const cursor = new Uint32Array(n);
  for (const [a, b] of graph.edges) {
    if (a < n) neighbors[offsets[a] + cursor[a]++] = b;
    if (b < n && b !== a) neighbors[offsets[b] + cursor[b]++] = a;
  }
  return { offsets, neighbors };
}

export interface MultiResLevelInput {
  graph: SimplifiedGraph;
  features: Float32Array;
  featureDim: number;
  triangleCount: number;
}

/**
 * Pack an arbitrary stack of (graph, features) levels into one GPU-friendly bundle.
 * Levels should typically be ordered finest → coarsest.
 */
export function packMultiResolution(levels: MultiResLevelInput[]): PackedMultiResolution {
  if (!levels.length) {
    return {
      features: new Float32Array(0),
      adjOffsets: new Uint32Array(1),
      adjNeighbors: new Uint32Array(0),
      levels: [],
      totalNodes: 0,
      sourceFeatureDim: 0,
    };
  }

  const sourceFeatureDim = Math.min(PACKED_NODE_STRIDE, levels[0].featureDim);
  let totalNodes = 0;
  let totalNeighbors = 0;

  const csrCache: Array<{ offsets: Uint32Array; neighbors: Uint32Array }> = [];
  for (const lvl of levels) {
    totalNodes += lvl.graph.nodeCount;
    const csr = buildCSR(lvl.graph);
    csrCache.push(csr);
    totalNeighbors += csr.neighbors.length;
  }

  const features = new Float32Array(totalNodes * PACKED_NODE_STRIDE);
  const adjOffsets = new Uint32Array(totalNodes + 1);
  const adjNeighbors = new Uint32Array(totalNeighbors);
  const meta: PackedLODLevel[] = [];

  let nodeBase = 0;
  let neighborBase = 0;
  for (let l = 0; l < levels.length; l++) {
    const lvl = levels[l];
    const dim = Math.min(PACKED_NODE_STRIDE, lvl.featureDim);
    const csr = csrCache[l];

    // Copy features row-by-row, padded to PACKED_NODE_STRIDE
    for (let i = 0; i < lvl.graph.nodeCount; i++) {
      const dst = (nodeBase + i) * PACKED_NODE_STRIDE;
      const src = i * lvl.featureDim;
      for (let k = 0; k < dim; k++) features[dst + k] = lvl.features[src + k] ?? 0;
    }

    // Offset neighbors into the global node-id space (so kernels can chase across levels)
    for (let i = 0; i < lvl.graph.nodeCount; i++) {
      adjOffsets[nodeBase + i] = neighborBase + csr.offsets[i];
    }
    for (let i = 0; i < csr.neighbors.length; i++) {
      adjNeighbors[neighborBase + i] = nodeBase + csr.neighbors[i];
    }

    meta.push({
      level: l,
      featureOffset: nodeBase * PACKED_NODE_STRIDE,
      nodeCount: lvl.graph.nodeCount,
      adjOffset: neighborBase,
      edgeCount: csr.neighbors.length,
      triangleCount: lvl.triangleCount,
    });

    nodeBase += lvl.graph.nodeCount;
    neighborBase += csr.neighbors.length;
  }
  adjOffsets[totalNodes] = neighborBase;

  return { features, adjOffsets, adjNeighbors, levels: meta, totalNodes, sourceFeatureDim };
}

/** Convenience: pack a single InferenceReadyPayload (e.g. from prepareForInference). */
export function packInferencePayload(p: InferenceReadyPayload, triangleCount = 0): PackedMultiResolution {
  return packMultiResolution([
    { graph: p.graph, features: p.features, featureDim: p.featureDim, triangleCount },
  ]);
}
