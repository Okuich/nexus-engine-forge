import { describe, expect, it, beforeEach } from 'vitest';
import {
  adaptFaceAdjacency,
  analyzeFaceAdjacency,
  findCriticalFaces,
  makeTopologyCapabilities,
  planTopologyDispatch,
  stubTopologyBackend,
  topologyRegistry,
  TopologyNotImplementedError,
} from '@/lib/geometry';
import type {
  FaceAdjacencyGraph,
  TopologyBackend,
  GraphDescriptor,
  GraphInvariants,
  TopologyResult,
} from '@/lib/geometry';

const graph: FaceAdjacencyGraph = {
  numNodes: 4,
  numEdges: 4,
  adjacency: [
    { id: 0, faceA: 0, faceB: 1, sharedVertices: [0, 1], dihedralAngle: 0.1, isConcave: false, length: 1 },
    { id: 1, faceA: 1, faceB: 2, sharedVertices: [1, 2], dihedralAngle: 0.2, isConcave: false, length: 1 },
    { id: 2, faceA: 2, faceB: 3, sharedVertices: [2, 3], dihedralAngle: 0.3, isConcave: true, length: 1 },
    // duplicate (reverse direction) — adapter must dedupe
    { id: 3, faceA: 1, faceB: 0, sharedVertices: [0, 1], dihedralAngle: 0.1, isConcave: false, length: 1 },
  ],
  edgeIndex: [[], []],
  edgeAttr: [],
  neighbors: new Map(),
  degree: [1, 2, 2, 1],
};

describe('topology reasoning integration', () => {
  beforeEach(() => {
    topologyRegistry.clear();
  });

  it('adapts FaceAdjacencyGraph to a deduplicated weighted spec', () => {
    const spec = adaptFaceAdjacency(graph);
    expect(spec.kind).toBe('face-adjacency');
    expect(spec.flavor).toContain('weighted');
    expect(spec.nodes).toEqual([0, 1, 2, 3]);
    // 4 raw entries, one is reverse duplicate → 3 undirected edges
    expect(spec.edges.length).toBe(3);
    expect(spec.edges[0].weight).toBe(0.1);
    expect(spec.edges[2].attributes?.isConcave).toBe(true);
  });

  it('planDispatch throws when no backend is registered', () => {
    expect(() => planTopologyDispatch('supportsCentrality', 4)).toThrow(
      TopologyNotImplementedError,
    );
  });

  it('planDispatch falls back to default when capability not matched', () => {
    topologyRegistry.register(stubTopologyBackend);
    const plan = planTopologyDispatch('supportsCentrality', 4);
    expect(plan.backend.id).toBe(stubTopologyBackend.id);
    expect(plan.reason).toBe('default');
  });

  it('integration hooks surface backend NotImplemented errors cleanly', () => {
    topologyRegistry.register(stubTopologyBackend);
    expect(() => analyzeFaceAdjacency(graph, { centrality: 'pagerank' }))
      .toThrow(TopologyNotImplementedError);
    expect(() => findCriticalFaces(graph)).toThrow(TopologyNotImplementedError);
  });

  // ── Capability-gated omission tests ──────────────────────────────────
  //
  // A "minimal" backend supports only graph creation + invariants.
  // The dispatch hooks must skip centrality/community when the dispatched
  // backend's capabilities don't advertise support — instead of throwing.

  /** Build a backend with createGraph+invariants only; everything else throws. */
  function makeMinimalBackend(id = 'minimal'): TopologyBackend {
    const nope = (op: string) => {
      throw new TopologyNotImplementedError(op, id);
    };
    const handle: GraphDescriptor = {
      id: 'g1',
      kind: 'face-adjacency',
      flavor: ['undirected', 'weighted'],
      nodeCount: 4,
      edgeCount: 3,
      handle: null,
    };
    const invariants: GraphInvariants = {
      connectedComponents: 1,
      cycles: 0,
    };
    const wrap = <T>(value: T): TopologyResult<T> => ({ value, backendId: id });
    return {
      id,
      version: '0.0.1-minimal',
      capabilities: makeTopologyCapabilities({
        // Explicitly NO centrality / community / iso / motif / flow.
        kinds: new Set(['face-adjacency', 'generic']),
        flavors: new Set(['undirected', 'weighted', 'attributed']),
      }),
      createGraph: () => wrap(handle),
      invariants: () => wrap(invariants),
      centrality: () => nope('centrality'),
      community: () => nope('community'),
      path: () => nope('path'),
      flow: () => nope('flow'),
      isomorphism: () => nope('isomorphism'),
      matchMotif: () => nope('matchMotif'),
      transform: () => nope('transform'),
    };
  }

  it('omits centrality when the dispatched backend lacks supportsCentrality', () => {
    topologyRegistry.register(makeMinimalBackend());
    const result = analyzeFaceAdjacency(graph, { centrality: 'pagerank' });
    expect(result.dispatchedTo).toBe('minimal');
    expect(result.invariants).toBeDefined();
    expect(result.centrality).toBeUndefined();
    expect(result.communities).toBeUndefined();
  });

  it('omits communities when the dispatched backend lacks supportsCommunityDetection', () => {
    topologyRegistry.register(makeMinimalBackend());
    const result = analyzeFaceAdjacency(graph, { community: 'louvain' });
    expect(result.dispatchedTo).toBe('minimal');
    expect(result.communities).toBeUndefined();
    expect(result.centrality).toBeUndefined();
  });

  it('omits both when neither capability is present, even if both requested', () => {
    topologyRegistry.register(makeMinimalBackend());
    const result = analyzeFaceAdjacency(graph, {
      centrality: 'betweenness',
      community: 'louvain',
    });
    expect(result.centrality).toBeUndefined();
    expect(result.communities).toBeUndefined();
    // Core analysis still succeeds.
    expect(result.graph.nodeCount).toBe(4);
    expect(result.invariants.connectedComponents).toBe(1);
  });

  it('does not invoke unsupported backend methods (no throw, no call)', () => {
    const backend = makeMinimalBackend('spy');
    let centralityCalls = 0;
    let communityCalls = 0;
    backend.centrality = () => {
      centralityCalls++;
      throw new TopologyNotImplementedError('centrality', 'spy');
    };
    backend.community = () => {
      communityCalls++;
      throw new TopologyNotImplementedError('community', 'spy');
    };
    topologyRegistry.register(backend);

    const result = analyzeFaceAdjacency(graph, {
      centrality: 'pagerank',
      community: 'louvain',
    });
    expect(centralityCalls).toBe(0);
    expect(communityCalls).toBe(0);
    expect(result.centrality).toBeUndefined();
    expect(result.communities).toBeUndefined();
  });
});
