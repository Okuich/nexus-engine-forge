/**
 * Tests for the topology REST surface — analyzeFaceAdjacency and
 * findCriticalFaces. Pure-function level (HTTP plumbing is exercised
 * indirectly via index.ts).
 */
import { assert, assertEquals, assertExists } from 'jsr:@std/assert@1';
import {
  adaptFaceAdjacency,
  analyzeFaceAdjacencyRequest,
  findCriticalFacesRequest,
  listBackends,
  validateAnalyzeBody,
} from './topology.ts';

// 4-node path graph: 0—1—2—3
const pathGraph = {
  numNodes: 4,
  edges: [
    [0, 1, 1] as [number, number, number],
    [1, 2, 1] as [number, number, number],
    [2, 3, 1] as [number, number, number],
    [1, 0, 1] as [number, number, number], // duplicate (reversed) — must dedupe
  ],
};

Deno.test('adapter dedupes reversed edges and produces undirected adjacency', () => {
  const g = adaptFaceAdjacency(pathGraph);
  assertEquals(g.numNodes, 4);
  assertEquals(g.edgeCount, 3);
  assertEquals(g.neighbors[0], [1]);
  assertEquals(g.neighbors[1].sort(), [0, 2]);
  assertEquals(g.neighbors[3], [2]);
});

Deno.test('analyzeFaceAdjacency returns invariants under default dispatch', () => {
  const result = analyzeFaceAdjacencyRequest(pathGraph);
  assertEquals(result.dispatchedTo, 'minimal-edge');
  assertEquals(result.dispatchReason, 'default');
  assertEquals(result.invariants.connectedComponents, 1);
  assertEquals(result.invariants.edgeCount, 3);
  assertEquals(result.invariants.maxDegree, 2);
  assertEquals(result.centrality, undefined);
  assertEquals(result.communities, undefined);
});

Deno.test('capability-aware dispatch picks analytic backend when centrality requested', () => {
  const result = analyzeFaceAdjacencyRequest(pathGraph, { centrality: 'degree' });
  assertEquals(result.dispatchedTo, 'analytic-edge');
  assertEquals(result.dispatchReason, 'capability-match');
  assertExists(result.centrality);
  assertEquals(result.centrality!.kind, 'degree');
  assertEquals(result.centrality!.scores.length, 4);
});

Deno.test('community label-propagation runs on analytic backend', () => {
  const result = analyzeFaceAdjacencyRequest(pathGraph, { community: 'louvain' });
  assertEquals(result.dispatchedTo, 'analytic-edge');
  assertExists(result.communities);
  assertEquals(result.communities!.assignments.length, 4);
  // Even on a path the algorithm should complete and return one label per node.
});

Deno.test('forced minimal backend omits centrality with diagnostic, no throw', () => {
  const result = analyzeFaceAdjacencyRequest(pathGraph, {
    centrality: 'pagerank',
    community: 'louvain',
    backend: 'minimal-edge',
  });
  assertEquals(result.dispatchedTo, 'minimal-edge');
  assertEquals(result.dispatchReason, 'requested');
  assertEquals(result.centrality, undefined);
  assertEquals(result.communities, undefined);
  assertExists(result.diagnostics);
  assertEquals(result.diagnostics!.length, 2);
  assert(result.diagnostics![0].includes('supportsCentrality'));
});

Deno.test('findCriticalFaces ranks by betweenness on a path graph', () => {
  // On 0—1—2—3, nodes 1 and 2 have higher betweenness than the endpoints.
  const result = findCriticalFacesRequest(pathGraph, { kind: 'betweenness', topK: 2 });
  assertEquals(result.dispatchedTo, 'analytic-edge');
  assertEquals(result.kind, 'betweenness');
  assertEquals(result.ranking.length, 2);
  const top = result.ranking.map((r) => r.face).sort();
  assertEquals(top, [1, 2]);
});

Deno.test('findCriticalFaces with forced minimal backend returns empty + diagnostic', () => {
  const result = findCriticalFacesRequest(pathGraph, { backend: 'minimal-edge' });
  assertEquals(result.ranking.length, 0);
  assertExists(result.diagnostics);
  assert(result.diagnostics![0].includes('supportsCentrality'));
});

Deno.test('validateAnalyzeBody rejects missing graph and bad edges', () => {
  let threw = false;
  try { validateAnalyzeBody({}); } catch { threw = true; }
  assert(threw);

  threw = false;
  try {
    validateAnalyzeBody({ graph: { numNodes: 2, edges: [[0]] } });
  } catch { threw = true; }
  assert(threw);
});

Deno.test('listBackends advertises both edge backends with capabilities', () => {
  const list = listBackends();
  assertEquals(list.length, 2);
  const ids = list.map((b) => b.id).sort();
  assertEquals(ids, ['analytic-edge', 'minimal-edge']);
  const minimal = list.find((b) => b.id === 'minimal-edge')!;
  assertEquals(minimal.capabilities.supportsCentrality, false);
  const analytic = list.find((b) => b.id === 'analytic-edge')!;
  assertEquals(analytic.capabilities.supportsCentrality, true);
  assertEquals(analytic.capabilities.supportsCommunityDetection, true);
});
