/**
 * Topology Reasoning Extension Layer — Type Definitions
 *
 * Interface-only architecture for graph-theoretic and topological
 * reasoning over geometry adjacency graphs, assembly graphs, and
 * abstract design topologies.
 *
 * No solvers are implemented. Future backends may bind to:
 *   - networkx-wasm  : classical graph algorithms
 *   - boost-graph    : C++ kernels via WASM
 *   - dgl/pyg-bridge : GNN-based topology inference
 *   - cugraph-remote : GPU-accelerated graph analytics
 *   - tda-mapper     : Mapper / Reeb-graph reasoning
 *
 * Activation: future autonomous geometry systems, large-scale
 * topology intelligence workflows.
 */

// ─── Graph descriptor ────────────────────────────────────────────

export type GraphKind =
  | 'face-adjacency'    // mesh dual graph
  | 'assembly'          // part-to-part connectivity
  | 'feature'           // CAD feature dependency
  | 'workflow'          // process / DAG topology
  | 'constraint'        // parametric constraint graph
  | 'design-space'      // abstract design exploration
  | 'reeb'              // scalar-field Reeb graph
  | 'mapper'            // TDA Mapper graph
  | 'generic';

export type GraphFlavor =
  | 'undirected'
  | 'directed'
  | 'multigraph'
  | 'hypergraph'
  | 'weighted'
  | 'attributed';

export interface GraphDescriptor {
  readonly id: string;
  readonly kind: GraphKind;
  readonly flavor: readonly GraphFlavor[];
  readonly nodeCount: number;
  readonly edgeCount: number;
  /** Backend-owned graph handle. */
  readonly handle: unknown;
  readonly metadata?: Record<string, unknown>;
}

// ─── Node / edge identity ────────────────────────────────────────

export interface NodeRef {
  readonly graphId: string;
  readonly id: number | string;
}

export interface EdgeRef {
  readonly graphId: string;
  readonly source: number | string;
  readonly target: number | string;
  /** Discriminator for parallel edges. */
  readonly key?: string;
}

// ─── Reasoning queries ───────────────────────────────────────────

export type CentralityKind =
  | 'degree'
  | 'betweenness'
  | 'closeness'
  | 'eigenvector'
  | 'pagerank'
  | 'katz';

export type CommunityAlgorithm =
  | 'louvain'
  | 'leiden'
  | 'label-propagation'
  | 'spectral'
  | 'modularity-greedy';

export type GraphIsomorphismKind =
  | 'exact'
  | 'subgraph'
  | 'approximate'
  | 'wl-hash';        // Weisfeiler-Lehman hash equivalence

export type PathKind =
  | 'shortest'
  | 'k-shortest'
  | 'all-simple'
  | 'eulerian'
  | 'hamiltonian';

export type FlowKind =
  | 'max-flow'
  | 'min-cut'
  | 'multi-commodity';

// ─── Topological summaries ───────────────────────────────────────

export interface GraphInvariants {
  readonly connectedComponents?: number;
  readonly stronglyConnectedComponents?: number;
  readonly cycles?: number;
  readonly bridges?: number;
  readonly articulationPoints?: number;
  readonly diameter?: number;
  readonly radius?: number;
  readonly girth?: number;
  /** Spectrum of the (normalized) Laplacian. */
  readonly laplacianSpectrum?: readonly number[];
  /** Algebraic connectivity (second-smallest Laplacian eigenvalue). */
  readonly algebraicConnectivity?: number;
  readonly chromaticNumber?: number;
  readonly cliqueNumber?: number;
}

export interface CommunityPartition {
  readonly algorithm: CommunityAlgorithm;
  readonly assignments: ReadonlyMap<number | string, number>;
  readonly modularity?: number;
}

export interface CentralityScores {
  readonly kind: CentralityKind;
  readonly scores: ReadonlyMap<number | string, number>;
}

export interface PathResult {
  readonly kind: PathKind;
  readonly nodes: readonly (number | string)[];
  readonly edges?: readonly EdgeRef[];
  readonly cost?: number;
}

export interface FlowResult {
  readonly kind: FlowKind;
  readonly value: number;
  readonly cut?: readonly EdgeRef[];
}

export interface IsomorphismResult {
  readonly kind: GraphIsomorphismKind;
  readonly isomorphic: boolean;
  /** Node mapping (source-id → target-id) when found. */
  readonly mapping?: ReadonlyMap<number | string, number | string>;
  readonly similarity?: number; // for 'approximate'
  readonly hash?: string;       // for 'wl-hash'
}

// ─── Pattern / motif mining ──────────────────────────────────────

export interface MotifQuery {
  /** Backend-owned graph handle of the pattern. */
  readonly pattern: GraphDescriptor;
  readonly maxMatches?: number;
  readonly nodeAttributePredicate?: string; // backend-parsed
  readonly edgeAttributePredicate?: string;
}

export interface MotifMatch {
  readonly nodeMapping: ReadonlyMap<number | string, number | string>;
  readonly score?: number;
}

// ─── Graph transformations ───────────────────────────────────────

export type GraphTransform =
  | 'line-graph'
  | 'condensation'    // SCC contraction
  | 'minimum-spanning-tree'
  | 'planar-embed'
  | 'block-cut-tree'
  | 'reeb-from-scalar'
  | 'mapper-from-cover';

// ─── Result wrapper ──────────────────────────────────────────────

export interface TopologyResult<T> {
  readonly value: T;
  readonly backendId: string;
  readonly approximation?: 'exact' | 'heuristic' | 'sampled' | 'learned';
  readonly diagnostics?: readonly string[];
  readonly cost?: { elapsedMs?: number; nodesTouched?: number };
}

// ─── Errors ──────────────────────────────────────────────────────

export class TopologyNotImplementedError extends Error {
  constructor(operation: string, backendId = 'none') {
    super(
      `Topology reasoning operation '${operation}' is not yet implemented ` +
      `(backend: ${backendId}). Interface-only stub.`,
    );
    this.name = 'TopologyNotImplementedError';
  }
}

export class TopologyBackendError extends Error {
  constructor(message: string, public readonly backendId: string) {
    super(`[${backendId}] ${message}`);
    this.name = 'TopologyBackendError';
  }
}
