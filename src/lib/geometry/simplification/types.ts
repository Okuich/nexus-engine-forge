/**
 * Geometry Simplification Engine — Types
 *
 * Production-grade mesh + graph simplification with feature preservation,
 * multi-resolution LOD output, and inference-pipeline integration.
 */

import type { RawMesh, FaceAdjacencyGraph } from '../types';

export type SimplificationTier = 'starter' | 'professional' | 'enterprise';

export interface SimplificationGatingContext {
  tier: SimplificationTier;
  /** Trigger for large-scale processing */
  triangleCount: number;
  /** Trigger for high-volume inference workloads */
  inferenceJobsPerHour?: number;
  /** Whether the caller is part of a batch / streaming pipeline */
  highVolumeInference?: boolean;
}

export interface SimplificationGatingDecision {
  allowed: boolean;
  reason?: string;
  /** Hard cap on output LOD count for this tier */
  maxLODs: number;
  /** Hard cap on input triangles for this tier */
  maxTriangles: number;
}

export interface SimplifyOptions {
  /** Target ratio in (0,1]. 0.25 means keep 25% of triangles. */
  targetRatio?: number;
  /** Absolute target triangle count (overrides ratio if set). */
  targetTriangles?: number;
  /** Hard quadric error ceiling — collapses above this are skipped. */
  maxError?: number;
  /** Preserve sharp edges above this dihedral angle (radians). Default π/4. */
  preserveSharpAngle?: number;
  /** Lock boundary (open-edge) vertices. Default true. */
  preserveBoundary?: boolean;
  /** Extra weight applied to sharp / boundary quadrics. Default 1000. */
  featureWeight?: number;
  /** Time budget in ms (soft). Default 250. */
  timeBudgetMs?: number;
}

export interface SimplifiedMesh extends RawMesh {
  positions: Float32Array;
  indices: Uint32Array;
}

export interface SimplificationStats {
  inputTriangles: number;
  outputTriangles: number;
  inputVertices: number;
  outputVertices: number;
  ratio: number;
  collapses: number;
  rejectedCollapses: number;
  /** Mean quadric error of accepted collapses */
  meanError: number;
  /** Max quadric error of accepted collapses */
  maxError: number;
  /** Mean curvature delta vs. baseline (lower = better fidelity) */
  curvatureDelta: number;
  elapsedMs: number;
}

export interface SimplifiedLOD {
  level: number;
  ratio: number;
  mesh: SimplifiedMesh;
  stats: SimplificationStats;
}

export interface MultiResolutionResult {
  /** L0 = original mesh, L1..Ln = progressively simpler */
  lods: SimplifiedLOD[];
  totalElapsedMs: number;
}

export interface SimplifiedGraph {
  nodeCount: number;
  edgeCount: number;
  /** Surviving original-face IDs per super-node */
  clusters: number[][];
  /** Adjacency as [src, dst] pairs */
  edges: Array<[number, number]>;
  /** Per super-node aggregate features */
  nodeFeatures: Array<{
    area: number;
    avgNormal: [number, number, number];
    avgCurvature: number;
  }>;
  /** Compression ratio = newEdges / originalEdges */
  edgeCompression: number;
}

export interface GraphSimplifyOptions {
  /** Target node count after coarsening. */
  targetNodes?: number;
  /** Target ratio in (0,1]. */
  targetRatio?: number;
  /** Don't merge across edges with dihedral above this (radians). */
  preserveSharpAngle?: number;
}

/** Inference-pipeline contract */
export interface InferenceReadyPayload {
  /** Coarsest mesh suitable for fast model passes */
  coarseMesh: SimplifiedMesh;
  /** All LOD levels for hierarchical / multi-scale models */
  lods: SimplifiedLOD[];
  /** Coarsened face graph */
  graph: SimplifiedGraph;
  /** Flat feature matrix [nodes × featureDim] */
  features: Float32Array;
  featureDim: number;
  /** Mapping coarse-node → original face IDs */
  nodeToFaces: number[][];
}

export class SimplificationGateError extends Error {
  constructor(public decision: SimplificationGatingDecision) {
    super(decision.reason || 'Simplification gated');
    this.name = 'SimplificationGateError';
  }
}
