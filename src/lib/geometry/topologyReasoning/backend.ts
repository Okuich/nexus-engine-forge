/**
 * Topology Reasoning Backend Contract.
 *
 * Future backend candidates:
 *   - 'networkx-wasm'   : classical algorithms (BFS, Dijkstra, Louvain)
 *   - 'boost-graph'     : high-performance C++ via WASM
 *   - 'cugraph-remote'  : GPU graph analytics over RPC
 *   - 'gnn-inference'   : learned topology priors via TF.js / ONNX
 *   - 'tda-mapper'      : Reeb / Mapper construction
 *
 * No backend ships in this commit.
 */

import type {
  CentralityKind,
  CentralityScores,
  CommunityAlgorithm,
  CommunityPartition,
  EdgeRef,
  FlowKind,
  FlowResult,
  GraphDescriptor,
  GraphFlavor,
  GraphInvariants,
  GraphIsomorphismKind,
  GraphKind,
  GraphTransform,
  IsomorphismResult,
  MotifMatch,
  MotifQuery,
  NodeRef,
  PathKind,
  PathResult,
  TopologyResult,
} from './types';

export interface TopologyCapabilities {
  readonly supportsCentrality: boolean;
  readonly supportsCommunityDetection: boolean;
  readonly supportsIsomorphism: boolean;
  readonly supportsMotifMining: boolean;
  readonly supportsFlow: boolean;
  readonly supportsSpectralAnalysis: boolean;
  readonly supportsPlanarity: boolean;
  readonly supportsLearnedInference: boolean;
  readonly kinds: ReadonlySet<GraphKind>;
  readonly flavors: ReadonlySet<GraphFlavor>;
  /** Max graph size this backend should be dispatched for. */
  readonly maxNodes?: number;
}

export interface TopologyBackend {
  readonly id: string;
  readonly version: string;
  readonly capabilities: TopologyCapabilities;

  // ── Construction ─────────────────────────────────────────────
  createGraph(spec: {
    kind: GraphKind;
    flavor: readonly GraphFlavor[];
    nodes: readonly (number | string)[];
    edges: ReadonlyArray<{
      source: number | string;
      target: number | string;
      weight?: number;
      attributes?: Record<string, unknown>;
    }>;
    nodeAttributes?: ReadonlyMap<number | string, Record<string, unknown>>;
    metadata?: Record<string, unknown>;
  }): TopologyResult<GraphDescriptor>;

  // ── Invariants ───────────────────────────────────────────────
  invariants(g: GraphDescriptor): TopologyResult<GraphInvariants>;

  // ── Centrality / community ───────────────────────────────────
  centrality(
    g: GraphDescriptor,
    kind: CentralityKind,
    options?: Record<string, unknown>,
  ): TopologyResult<CentralityScores>;
  community(
    g: GraphDescriptor,
    algo: CommunityAlgorithm,
    options?: Record<string, unknown>,
  ): TopologyResult<CommunityPartition>;

  // ── Paths / flows ────────────────────────────────────────────
  path(
    g: GraphDescriptor,
    source: NodeRef,
    target: NodeRef,
    kind: PathKind,
    options?: { k?: number; weight?: string },
  ): TopologyResult<readonly PathResult[]>;
  flow(
    g: GraphDescriptor,
    source: NodeRef,
    sink: NodeRef,
    kind: FlowKind,
  ): TopologyResult<FlowResult>;

  // ── Isomorphism / motifs ─────────────────────────────────────
  isomorphism(
    a: GraphDescriptor,
    b: GraphDescriptor,
    kind: GraphIsomorphismKind,
  ): TopologyResult<IsomorphismResult>;
  matchMotif(
    g: GraphDescriptor,
    query: MotifQuery,
  ): TopologyResult<readonly MotifMatch[]>;

  // ── Transformations ──────────────────────────────────────────
  transform(
    g: GraphDescriptor,
    op: GraphTransform,
    options?: Record<string, unknown>,
  ): TopologyResult<GraphDescriptor>;

  // ── Mutation (optional, for incremental analysis) ────────────
  addNode?(g: GraphDescriptor, node: number | string, attrs?: Record<string, unknown>): TopologyResult<void>;
  addEdge?(g: GraphDescriptor, edge: EdgeRef & { weight?: number }): TopologyResult<void>;
  removeNode?(g: GraphDescriptor, node: number | string): TopologyResult<void>;
  removeEdge?(g: GraphDescriptor, edge: EdgeRef): TopologyResult<void>;

  // ── Lifecycle ────────────────────────────────────────────────
  dispose?(): void;
}

export function makeTopologyCapabilities(
  partial: Partial<TopologyCapabilities> = {},
): TopologyCapabilities {
  return {
    supportsCentrality: false,
    supportsCommunityDetection: false,
    supportsIsomorphism: false,
    supportsMotifMining: false,
    supportsFlow: false,
    supportsSpectralAnalysis: false,
    supportsPlanarity: false,
    supportsLearnedInference: false,
    kinds: new Set(),
    flavors: new Set(),
    ...partial,
  };
}
