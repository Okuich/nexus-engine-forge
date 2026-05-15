/**
 * One-call facades that bridge the standalone Geometry Engine
 * (`extractFeatures` / `buildAdjacencyGraph`) and the capability-aware
 * Topology Reasoning dispatch hooks (`analyzeFaceAdjacency`,
 * `findCriticalFaces`).
 *
 * These wrappers accept any of the standard engine inputs:
 *   - a `RawMesh` (positions + optional indices)         → builds graph here
 *   - a `GeometryFeatureSet`                              → reuses `.graph`
 *   - a pre-built `FaceAdjacencyGraph`                    → straight pass-through
 *
 * and return the same `AnalyzeAdjacencyResult` / `TopologyResult` shapes
 * the engine already exposes — so feature-extraction, optimizer, and
 * agent code can call a single function without manually wiring the
 * graph build step.
 */

import type { RawMesh, FaceAdjacencyGraph, GeometryFeatureSet, Vec3 } from './types';
import { extractFeatures } from './extractionEngine';
import { buildAdjacencyGraph } from './adjacencyGraph';
import { triangleNormal } from './meshMath';
import {
  analyzeFaceAdjacency,
  findCriticalFaces,
  type AnalyzeAdjacencyOptions,
  type AnalyzeAdjacencyResult,
  type CentralityKind,
  type TopologyResult,
} from './topologyReasoning';

/**
 * Anything we can derive a face-adjacency graph from. Order of preference:
 *   1. `FaceAdjacencyGraph`     — used directly.
 *   2. `GeometryFeatureSet`     — its `.graph` is reused.
 *   3. `RawMesh`                — minimal-cost build (normals + adjacency only).
 */
export type FaceAdjacencyInput =
  | FaceAdjacencyGraph
  | GeometryFeatureSet
  | RawMesh;

function isFaceAdjacencyGraph(x: unknown): x is FaceAdjacencyGraph {
  return (
    typeof x === 'object' &&
    x !== null &&
    'numNodes' in x &&
    'adjacency' in x &&
    'neighbors' in x
  );
}

function isGeometryFeatureSet(x: unknown): x is GeometryFeatureSet {
  return (
    typeof x === 'object' &&
    x !== null &&
    'graph' in x &&
    'edges' in x &&
    'faces' in (x as Record<string, unknown>)
  );
}

function isRawMesh(x: unknown): x is RawMesh {
  return (
    typeof x === 'object' &&
    x !== null &&
    'positions' in x &&
    typeof (x as { positions: unknown }).positions !== 'undefined'
  );
}

/**
 * Build a face-adjacency graph from a `RawMesh` without paying for the
 * full curvature / surface-classification pass that `extractFeatures`
 * does. Used by the facades when only the topology graph is needed.
 */
function adjacencyFromRawMesh(mesh: RawMesh): FaceAdjacencyGraph {
  const positions = mesh.positions;
  const vertexCount = (positions.length / 3) | 0;

  let indices: ArrayLike<number>;
  if (mesh.indices) {
    indices = mesh.indices;
  } else {
    const seq = new Uint32Array(vertexCount);
    for (let i = 0; i < vertexCount; i++) seq[i] = i;
    indices = seq;
  }

  const faceCount = (indices.length / 3) | 0;
  const normals: Vec3[] = new Array(faceCount);
  const get = (i: number): Vec3 => [
    positions[i * 3],
    positions[i * 3 + 1],
    positions[i * 3 + 2],
  ];

  for (let f = 0; f < faceCount; f++) {
    normals[f] = triangleNormal(
      get(indices[f * 3]),
      get(indices[f * 3 + 1]),
      get(indices[f * 3 + 2]),
    );
  }
  return buildAdjacencyGraph(indices, positions, normals);
}

/**
 * Resolve any supported input into a `FaceAdjacencyGraph`. For
 * `RawMesh`, normals + adjacency are built on the fly; the heavier
 * feature-extraction pass is skipped.
 */
export function toFaceAdjacencyGraph(input: FaceAdjacencyInput): FaceAdjacencyGraph {
  if (isFaceAdjacencyGraph(input)) return input;
  if (isGeometryFeatureSet(input)) return input.graph;
  if (isRawMesh(input)) return adjacencyFromRawMesh(input);
  throw new TypeError(
    'topologyFacade: input must be a FaceAdjacencyGraph, GeometryFeatureSet, or RawMesh',
  );
}

/**
 * One-call facade: analyze the face-adjacency topology of a mesh.
 *
 * Routes through the capability-aware dispatch hooks, so centrality and
 * community results are only included when the dispatched backend
 * advertises support — preventing crashes on stub / minimal backends.
 */
export function analyzeMeshFaceAdjacency(
  input: FaceAdjacencyInput,
  options: AnalyzeAdjacencyOptions = {},
): AnalyzeAdjacencyResult {
  return analyzeFaceAdjacency(toFaceAdjacencyGraph(input), options);
}

/**
 * One-call facade: rank the structurally most important faces of a mesh
 * by a chosen centrality measure. Returns the top-K faces with their
 * normalized centrality scores, wrapped in the engine's standard
 * `TopologyResult` envelope (so `dispatchedTo` / metadata are preserved).
 */
export function findCriticalMeshFaces(
  input: FaceAdjacencyInput,
  kind: CentralityKind = 'betweenness',
  topK = 10,
  opts?: { backend?: string },
): TopologyResult<ReadonlyArray<{ face: number; score: number }>> {
  return findCriticalFaces(toFaceAdjacencyGraph(input), kind, topK, opts);
}

/** Convenience: fold the critical-face ranking back into a `GeometryFeatureSet`. */
export function attachCriticalFaceScores(
  features: GeometryFeatureSet,
  kind: CentralityKind = 'betweenness',
  topK = 10,
  opts?: { backend?: string },
): GeometryFeatureSet & {
  criticalFaces: ReadonlyArray<{ face: number; score: number }>;
} {
  const result = findCriticalMeshFaces(features, kind, topK, opts);
  return { ...features, criticalFaces: result.value };
}

/**
 * Run a full feature extraction AND topology analysis in a single call.
 * Useful for pipelines (agents, optimizer, RFQ enrichment) that want
 * both the geometric feature matrix and graph-theoretic invariants.
 */
export function analyzeMesh(
  mesh: RawMesh,
  options: AnalyzeAdjacencyOptions = {},
): { features: GeometryFeatureSet; topology: AnalyzeAdjacencyResult } {
  const features = extractFeatures(mesh);
  const topology = analyzeFaceAdjacency(features.graph, options);
  return { features, topology };
}
