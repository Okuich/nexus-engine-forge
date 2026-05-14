/**
 * Topology Reasoning Extension Layer — public API (interface only).
 *
 * Architecture
 * ────────────
 *
 *   ┌────────────────────────────────────────────────────────────┐
 *   │            TopologyReasoningEngine (facade)                │
 *   │   stable API: autonomous geometry, design-space search,    │
 *   │   assembly intelligence, workflow optimization             │
 *   └──────────────────────────────┬─────────────────────────────┘
 *                                  │ dispatches via
 *                                  ▼
 *   ┌────────────────────────────────────────────────────────────┐
 *   │                  topologyRegistry                          │
 *   │  capability + workload-size aware backend selection        │
 *   └──────────────────────────────┬─────────────────────────────┘
 *                                  │ implements
 *                                  ▼
 *   ┌────────────────────────────────────────────────────────────┐
 *   │              TopologyBackend (contract)                    │
 *   │  networkx-wasm • boost-graph • cugraph-remote • GNN • TDA  │
 *   └────────────────────────────────────────────────────────────┘
 *
 * Future integration points
 * ─────────────────────────
 *   • Geometry Engine adjacency graphs  → centrality + community to
 *     classify "spine" faces vs decorative regions for ML features.
 *   • Assembly OS                       → flow / cut analysis to find
 *     bottleneck joints; isomorphism to deduplicate sub-assemblies.
 *   • Workflow Engine                   → DAG transforms (condensation,
 *     critical-path) for manufacturing process optimization.
 *   • Constraint Solver                 → planarity + block-cut trees
 *     to decompose under-constrained sketches into independent blocks.
 *   • Manifold Engine                   → Reeb / Mapper graphs as
 *     topology-reasoning input (consume `transform('reeb-from-scalar')`).
 *   • Symbolic Engine                   → constraint-graph isomorphism
 *     to cache solved sub-problems across sessions.
 *   • Autonomous design agents          → motif mining for known DFM
 *     anti-patterns; learned-inference backend for shape grammars.
 *
 * Implementation status
 * ─────────────────────
 *   - Interfaces, registry, facade, stub backend: shipped.
 *   - No graph algorithms ship in this commit.
 *   - Stub backend throws `TopologyNotImplementedError` on every call.
 */

export { TopologyReasoningEngine } from './engine';
export type {
  TopologyDispatch,
  TopologyReasoningEngineApi,
} from './engine';

export { topologyRegistry } from './registry';
export type { CapabilityFlag as TopologyCapabilityFlag } from './registry';

export { makeTopologyCapabilities } from './backend';
export type { TopologyBackend, TopologyCapabilities } from './backend';

export { stubTopologyBackend } from './stubBackend';

export {
  TopologyNotImplementedError,
  TopologyBackendError,
} from './types';

export type {
  GraphKind,
  GraphFlavor,
  GraphDescriptor,
  NodeRef,
  EdgeRef,
  CentralityKind,
  CommunityAlgorithm,
  GraphIsomorphismKind,
  PathKind,
  FlowKind,
  GraphInvariants,
  CommunityPartition,
  CentralityScores,
  PathResult,
  FlowResult,
  IsomorphismResult,
  MotifQuery,
  MotifMatch,
  GraphTransform,
  TopologyResult,
} from './types';
