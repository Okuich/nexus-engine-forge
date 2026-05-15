import { describe, expect, it, beforeEach } from 'vitest';
import {
  adaptFaceAdjacency,
  analyzeFaceAdjacency,
  findCriticalFaces,
  planTopologyDispatch,
  stubTopologyBackend,
  topologyRegistry,
  TopologyNotImplementedError,
} from '@/lib/geometry';
import type { FaceAdjacencyGraph } from '@/lib/geometry';

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
});
