/**
 * Topology Reasoning ↔ Geometry Engine integration.
 *
 * The Topology Reasoning layer ships as an interface-only facade with
 * pluggable backends (`networkx-wasm`, `boost-graph`, `cugraph-remote`,
 * GNN priors, …). This module is the **bridge** between the concrete
 * geometry data structures (face-adjacency graphs, COO edge indices)
 * and the abstract `GraphDescriptor` consumed by the topology engine.
 *
 * Responsibilities:
 *   1. Adapters — convert `FaceAdjacencyGraph` and raw edge lists into
 *      the `createGraph` spec without losing weights/attributes.
 *   2. Capability-aware dispatch — pick the smallest backend that
 *      satisfies a requested capability + workload size, falling back
 *      to the registry default and surfacing a typed error if no
 *      backend is registered.
 *   3. High-level integration hooks — one-call helpers
 *      (`analyzeFaceAdjacency`, `findCriticalFaces`,
 *      `partitionAssemblyGraph`) that geometry features and the
 *      optimizer can call without touching the topology backend API.
 */

import type { EdgeFeatures, FaceAdjacencyGraph } from '../types';
import type { TopologyBackend, TopologyCapabilities } from './backend';
import type { TopologyDispatch } from './engine';
import { TopologyReasoningEngine } from './engine';
import { topologyRegistry } from './registry';
import {
  TopologyNotImplementedError,
  type CentralityKind,
  type CentralityScores,
  type CommunityAlgorithm,
  type CommunityPartition,
  type GraphDescriptor,
  type GraphFlavor,
  type GraphInvariants,
  type GraphKind,
  type TopologyResult,
} from './types';

// ─── Capability-aware dispatch ─────────────────────────────────────

/** Capability flags that gate dispatch (string literals to match registry). */
export type TopologyCapabilityFlag =
  keyof Omit<TopologyCapabilities, 'kinds' | 'flavors' | 'maxNodes'>;

export interface DispatchPlan {
  readonly backend: TopologyBackend;
  readonly reason: 'requested' | 'capability-match' | 'default';
}

/**
 * Pick the cheapest backend that supports `flag` and can handle
 * `nodeCount`. Honors an explicit `requested` backend id. Throws
 * `TopologyNotImplementedError` if nothing satisfies the request.
 */
export function planDispatch(
  flag: TopologyCapabilityFlag,
  nodeCount: number,
  requested?: string,
): DispatchPlan {
  if (requested) {
    const b = topologyRegistry.get(requested);
    if (!b) throw new TopologyNotImplementedError('planDispatch', requested);
    return { backend: b, reason: 'requested' };
  }
  const matched = topologyRegistry.findForWorkload(flag, nodeCount);
  if (matched) return { backend: matched, reason: 'capability-match' };
  const def = topologyRegistry.getDefault();
  if (!def) throw new TopologyNotImplementedError(`dispatch:${flag}`, 'none');
  return { backend: def, reason: 'default' };
}

// ─── Adapters: geometry data → topology graph spec ─────────────────

export interface CreateGraphSpec {
  kind: GraphKind;
  flavor: readonly GraphFlavor[];
  nodes: readonly (number | string)[];
  edges: ReadonlyArray<{
    source: number | string;
    target: number | string;
    weight?: number;
    attributes?: Record<string, unknown>;
  }>;
  metadata?: Record<string, unknown>;
}

/**
 * Convert a `FaceAdjacencyGraph` into a deduplicated edge list suitable
 * for `TopologyReasoningEngine.createGraph`. The directed edges in
 * `edgeIndex` are collapsed back to undirected pairs and aligned with
 * the per-edge `EdgeFeatures` payload as edge attributes.
 */
export function adaptFaceAdjacency(
  graph: FaceAdjacencyGraph,
  metadata: Record<string, unknown> = {},
): CreateGraphSpec {
  const seen = new Set<number>();
  const edges: Array<{
    source: number | string;
    target: number | string;
    weight?: number;
    attributes?: Record<string, unknown>;
  }> = [];
  for (const e of graph.adjacency) {
    const key = e.faceA < e.faceB
      ? e.faceA * graph.numNodes + e.faceB
      : e.faceB * graph.numNodes + e.faceA;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push({
      source: e.faceA,
      target: e.faceB,
      weight: e.dihedralAngle,
      attributes: edgeAttributesFromFeatures(e),
    });
  }
  return {
    kind: 'face-adjacency',
    flavor: ['undirected', 'weighted', 'attributed'],
    nodes: Array.from({ length: graph.numNodes }, (_, i) => i),
    edges,
    metadata: { source: 'FaceAdjacencyGraph', ...metadata },
  };
}

function edgeAttributesFromFeatures(e: EdgeFeatures): Record<string, unknown> {
  // Keep the adapter pure: surface the canonical numeric features,
  // skip Vec3 / nested objects so backends can ingest as scalars.
  return {
    dihedralAngle: e.dihedralAngle,
    length: e.length,
    isConcave: e.isConcave,
  };
}

/**
 * Generic adapter for assembly / workflow / constraint graphs already
 * stored as a node + edge list.
 */
export function adaptEdgeList(
  kind: GraphKind,
  flavor: readonly GraphFlavor[],
  nodes: readonly (number | string)[],
  edges: CreateGraphSpec['edges'],
  metadata: Record<string, unknown> = {},
): CreateGraphSpec {
  return { kind, flavor, nodes, edges, metadata };
}

// ─── Integration hooks (one-call helpers) ─────────────────────────

export interface AnalyzeAdjacencyResult {
  readonly graph: GraphDescriptor;
  readonly invariants: GraphInvariants;
  readonly centrality?: CentralityScores;
  readonly communities?: CommunityPartition;
  readonly dispatchedTo: string;
}

export interface AnalyzeAdjacencyOptions {
  readonly centrality?: CentralityKind;
  readonly community?: CommunityAlgorithm;
  readonly backend?: string;
}

/**
 * Build the topology graph for a face-adjacency mesh and run the
 * standard reasoning bundle. Centrality and community computations are
 * gated behind the dispatched backend's capabilities so callers never
 * crash on a stub backend — missing analyses are simply omitted.
 */
export function analyzeFaceAdjacency(
  faceGraph: FaceAdjacencyGraph,
  options: AnalyzeAdjacencyOptions = {},
): AnalyzeAdjacencyResult {
  const plan = planDispatch('supportsCentrality', faceGraph.numNodes, options.backend);
  const dispatch: TopologyDispatch = { backend: plan.backend.id };
  const spec = adaptFaceAdjacency(faceGraph);

  const created = TopologyReasoningEngine.createGraph(spec, dispatch);
  const invariants = TopologyReasoningEngine.invariants(created.value, dispatch);

  const out: AnalyzeAdjacencyResult = {
    graph: created.value,
    invariants: invariants.value,
    dispatchedTo: plan.backend.id,
  };

  let withCentrality: AnalyzeAdjacencyResult = out;
  if (options.centrality && plan.backend.capabilities.supportsCentrality) {
    const cent = TopologyReasoningEngine.centrality(created.value, options.centrality, undefined, dispatch);
    withCentrality = { ...out, centrality: cent.value };
  }
  if (options.community && plan.backend.capabilities.supportsCommunityDetection) {
    const com = TopologyReasoningEngine.community(created.value, options.community, undefined, dispatch);
    return { ...withCentrality, communities: com.value };
  }
  return withCentrality;
}

/**
 * Find the most structurally important faces in a mesh by running a
 * centrality measure over the face-adjacency graph. Convenience hook
 * for feature extraction / optimization heuristics.
 */
export function findCriticalFaces(
  faceGraph: FaceAdjacencyGraph,
  kind: CentralityKind = 'betweenness',
  topK = 10,
  opts?: { backend?: string },
): TopologyResult<ReadonlyArray<{ face: number; score: number }>> {
  const plan = planDispatch('supportsCentrality', faceGraph.numNodes, opts?.backend);
  const dispatch: TopologyDispatch = { backend: plan.backend.id };
  const spec = adaptFaceAdjacency(faceGraph);
  const g = TopologyReasoningEngine.createGraph(spec, dispatch);
  const c = TopologyReasoningEngine.centrality(g.value, kind, undefined, dispatch);
  const ranked = Array.from(c.value.scores.entries())
    .map(([id, score]) => ({ face: Number(id), score }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
  return { ...c, value: ranked };
}
