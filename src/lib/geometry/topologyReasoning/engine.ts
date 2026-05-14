/**
 * Topology Reasoning Engine — stable facade over pluggable backends.
 */

import type {
  CentralityKind,
  CentralityScores,
  CommunityAlgorithm,
  CommunityPartition,
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
import { TopologyNotImplementedError } from './types';
import type { TopologyBackend } from './backend';
import { topologyRegistry } from './registry';

export interface TopologyDispatch {
  backend?: string;
}

function resolve(opts?: TopologyDispatch): TopologyBackend {
  if (opts?.backend) {
    const b = topologyRegistry.get(opts.backend);
    if (!b) throw new TopologyNotImplementedError('resolve', opts.backend);
    return b;
  }
  const def = topologyRegistry.getDefault();
  if (!def) throw new TopologyNotImplementedError('resolve', 'none');
  return def;
}

export const TopologyReasoningEngine = {
  // ── Construction ─────────────────────────────────────────────
  createGraph(
    spec: {
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
    },
    opts?: TopologyDispatch,
  ): TopologyResult<GraphDescriptor> {
    return resolve(opts).createGraph(spec);
  },

  invariants(g: GraphDescriptor, opts?: TopologyDispatch): TopologyResult<GraphInvariants> {
    return resolve(opts).invariants(g);
  },

  // ── Centrality / community ───────────────────────────────────
  centrality(
    g: GraphDescriptor,
    kind: CentralityKind,
    options?: Record<string, unknown>,
    opts?: TopologyDispatch,
  ): TopologyResult<CentralityScores> {
    return resolve(opts).centrality(g, kind, options);
  },
  community(
    g: GraphDescriptor,
    algo: CommunityAlgorithm,
    options?: Record<string, unknown>,
    opts?: TopologyDispatch,
  ): TopologyResult<CommunityPartition> {
    return resolve(opts).community(g, algo, options);
  },

  // ── Paths / flows ────────────────────────────────────────────
  path(
    g: GraphDescriptor,
    source: NodeRef,
    target: NodeRef,
    kind: PathKind,
    options?: { k?: number; weight?: string },
    opts?: TopologyDispatch,
  ): TopologyResult<readonly PathResult[]> {
    return resolve(opts).path(g, source, target, kind, options);
  },
  flow(
    g: GraphDescriptor,
    source: NodeRef,
    sink: NodeRef,
    kind: FlowKind,
    opts?: TopologyDispatch,
  ): TopologyResult<FlowResult> {
    return resolve(opts).flow(g, source, sink, kind);
  },

  // ── Isomorphism / motifs ─────────────────────────────────────
  isomorphism(
    a: GraphDescriptor,
    b: GraphDescriptor,
    kind: GraphIsomorphismKind,
    opts?: TopologyDispatch,
  ): TopologyResult<IsomorphismResult> {
    return resolve(opts).isomorphism(a, b, kind);
  },
  matchMotif(
    g: GraphDescriptor,
    query: MotifQuery,
    opts?: TopologyDispatch,
  ): TopologyResult<readonly MotifMatch[]> {
    return resolve(opts).matchMotif(g, query);
  },

  // ── Transformations ──────────────────────────────────────────
  transform(
    g: GraphDescriptor,
    op: GraphTransform,
    options?: Record<string, unknown>,
    opts?: TopologyDispatch,
  ): TopologyResult<GraphDescriptor> {
    return resolve(opts).transform(g, op, options);
  },

  // ── Introspection ────────────────────────────────────────────
  listBackends(): readonly TopologyBackend[] {
    return topologyRegistry.list();
  },
  hasBackend(): boolean {
    return topologyRegistry.getDefault() !== null;
  },
} as const;

export type TopologyReasoningEngineApi = typeof TopologyReasoningEngine;
