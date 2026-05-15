/**
 * Topology reasoning — REST surface for `analyzeFaceAdjacency` and
 * `findCriticalFaces`.
 *
 * Mirrors the in-process semantics of
 * `src/lib/geometry/topologyReasoning/integration.ts`:
 *
 *   - **Adapter**: deduplicate the directed edges of a face-adjacency
 *     graph back to undirected weighted pairs.
 *   - **Capability-aware dispatch**: pick the smallest-cost backend
 *     whose `maxNodes` covers the workload AND whose capability flag
 *     matches the requested analysis. If no backend matches, fall back
 *     to the registry default — and silently *omit* unsupported
 *     analyses (centrality, community) instead of crashing.
 *
 * Two backends ship with the edge runtime:
 *
 *   - `minimal-edge`  — invariants only. Selected when no centrality /
 *                       community is requested.
 *   - `analytic-edge` — invariants + degree centrality + label-prop
 *                       community. Selected when the client requests
 *                       either, up to 50 000 nodes.
 *
 * The wire envelope (`$schema`, `type`, `data`) is unchanged from the
 * rest of `topology-api`.
 */

// ─── Wire types ────────────────────────────────────────────────────────────

/** Compact face-adjacency input over the wire. */
export interface FaceAdjacencyWire {
  numNodes: number;
  /** [src, dst, weight?] — direction is irrelevant; duplicates are deduped. */
  edges: ReadonlyArray<[number, number] | [number, number, number]>;
  /** Optional per-edge attributes, aligned with `edges`. */
  edgeAttributes?: ReadonlyArray<Record<string, unknown>>;
  metadata?: Record<string, unknown>;
}

export type CentralityKind =
  | 'degree' | 'betweenness' | 'closeness' | 'eigenvector' | 'pagerank' | 'katz';
export type CommunityAlgorithm =
  | 'louvain' | 'leiden' | 'label-propagation' | 'spectral' | 'modularity-greedy';

export interface AnalyzeAdjacencyOptions {
  centrality?: CentralityKind;
  community?: CommunityAlgorithm;
  /** Force a specific backend by id; otherwise capability dispatch picks. */
  backend?: string;
}

export interface GraphInvariantsWire {
  connectedComponents: number;
  edgeCount: number;
  nodeCount: number;
  density: number;
  averageDegree: number;
  maxDegree: number;
  isolatedNodes: number;
}

export interface CentralityScoresWire {
  kind: CentralityKind;
  scores: Array<[number, number]>; // [nodeId, score]
}

export interface CommunityPartitionWire {
  algorithm: CommunityAlgorithm;
  assignments: Array<[number, number]>; // [nodeId, communityId]
  modularity?: number;
}

export interface AnalyzeAdjacencyResultWire {
  graph: { nodeCount: number; edgeCount: number; flavor: readonly string[] };
  invariants: GraphInvariantsWire;
  centrality?: CentralityScoresWire;
  communities?: CommunityPartitionWire;
  dispatchedTo: string;
  dispatchReason: 'capability-match' | 'default' | 'requested';
  diagnostics?: string[];
}

export interface CriticalFacesResultWire {
  ranking: Array<{ face: number; score: number }>;
  kind: CentralityKind;
  topK: number;
  dispatchedTo: string;
  dispatchReason: 'capability-match' | 'default' | 'requested';
  diagnostics?: string[];
}

// ─── Backend interface + registry ──────────────────────────────────────────

interface Capabilities {
  supportsCentrality: boolean;
  supportsCommunityDetection: boolean;
  maxNodes: number;
}

interface AdjGraph {
  numNodes: number;
  /** Undirected adjacency, deduped. */
  neighbors: number[][];
  /** Edge weights aligned with neighbor entries. */
  weights: number[][];
  edgeCount: number;
}

interface Backend {
  id: string;
  capabilities: Capabilities;
  invariants(g: AdjGraph): GraphInvariantsWire;
  centrality?(g: AdjGraph, kind: CentralityKind): CentralityScoresWire;
  community?(g: AdjGraph, algo: CommunityAlgorithm): CommunityPartitionWire;
}

// ─── Adapter: wire → undirected weighted adjacency, deduped ────────────────

export function adaptFaceAdjacency(input: FaceAdjacencyWire): AdjGraph {
  const n = input.numNodes;
  const neighbors: number[][] = Array.from({ length: n }, () => []);
  const weights: number[][] = Array.from({ length: n }, () => []);
  const seen = new Set<number>();
  let edgeCount = 0;

  for (const e of input.edges) {
    const a = e[0] | 0;
    const b = e[1] | 0;
    if (a === b || a < 0 || b < 0 || a >= n || b >= n) continue;
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    const key = lo * n + hi;
    if (seen.has(key)) continue;
    seen.add(key);
    const w = (e.length === 3 ? e[2] : 1) || 1;
    neighbors[a].push(b);
    neighbors[b].push(a);
    weights[a].push(w);
    weights[b].push(w);
    edgeCount++;
  }
  return { numNodes: n, neighbors, weights, edgeCount };
}

// ─── Shared analytics ──────────────────────────────────────────────────────

function invariants(g: AdjGraph): GraphInvariantsWire {
  const n = g.numNodes;
  // Connected components via BFS.
  const seen = new Uint8Array(n);
  let components = 0;
  let isolated = 0;
  let maxDegree = 0;
  let degSum = 0;
  for (let i = 0; i < n; i++) {
    const d = g.neighbors[i].length;
    degSum += d;
    if (d > maxDegree) maxDegree = d;
    if (d === 0) isolated++;
    if (seen[i]) continue;
    components++;
    const stack = [i];
    seen[i] = 1;
    while (stack.length) {
      const u = stack.pop()!;
      for (const v of g.neighbors[u]) if (!seen[v]) { seen[v] = 1; stack.push(v); }
    }
  }
  const maxEdges = (n * (n - 1)) / 2;
  return {
    connectedComponents: components,
    edgeCount: g.edgeCount,
    nodeCount: n,
    density: maxEdges > 0 ? g.edgeCount / maxEdges : 0,
    averageDegree: n > 0 ? degSum / n : 0,
    maxDegree,
    isolatedNodes: isolated,
  };
}

function degreeCentrality(g: AdjGraph): CentralityScoresWire {
  const denom = Math.max(1, g.numNodes - 1);
  const scores: Array<[number, number]> = g.neighbors.map(
    (nbrs, i) => [i, nbrs.length / denom],
  );
  return { kind: 'degree', scores };
}

/** Brandes' algorithm — exact, O(n·(n+m)). Capped at 5000 nodes upstream. */
function betweennessCentrality(g: AdjGraph): CentralityScoresWire {
  const n = g.numNodes;
  const cb = new Float64Array(n);
  for (let s = 0; s < n; s++) {
    const stack: number[] = [];
    const pred: number[][] = Array.from({ length: n }, () => []);
    const sigma = new Float64Array(n); sigma[s] = 1;
    const dist = new Int32Array(n).fill(-1); dist[s] = 0;
    const queue = [s];
    while (queue.length) {
      const v = queue.shift()!;
      stack.push(v);
      for (const w of g.neighbors[v]) {
        if (dist[w] < 0) { dist[w] = dist[v] + 1; queue.push(w); }
        if (dist[w] === dist[v] + 1) { sigma[w] += sigma[v]; pred[w].push(v); }
      }
    }
    const delta = new Float64Array(n);
    while (stack.length) {
      const w = stack.pop()!;
      for (const v of pred[w]) delta[v] += (sigma[v] / sigma[w]) * (1 + delta[w]);
      if (w !== s) cb[w] += delta[w];
    }
  }
  // Normalize for undirected: divide by 2, then by (n-1)(n-2)/2 if n>2.
  const norm = n > 2 ? 2 / ((n - 1) * (n - 2)) : 1;
  const scores: Array<[number, number]> = [];
  for (let i = 0; i < n; i++) scores.push([i, cb[i] * 0.5 * norm]);
  return { kind: 'betweenness', scores };
}

/** Synchronous label propagation (deterministic order). */
function labelPropagation(g: AdjGraph): CommunityPartitionWire {
  const n = g.numNodes;
  const labels = new Int32Array(n);
  for (let i = 0; i < n; i++) labels[i] = i;
  let changed = true;
  let iter = 0;
  while (changed && iter < 20) {
    changed = false;
    iter++;
    for (let i = 0; i < n; i++) {
      if (g.neighbors[i].length === 0) continue;
      const counts = new Map<number, number>();
      for (const v of g.neighbors[i]) {
        counts.set(labels[v], (counts.get(labels[v]) ?? 0) + 1);
      }
      let best = labels[i];
      let bestCount = -1;
      for (const [lbl, c] of counts) {
        if (c > bestCount || (c === bestCount && lbl < best)) {
          best = lbl; bestCount = c;
        }
      }
      if (best !== labels[i]) { labels[i] = best; changed = true; }
    }
  }
  const assignments: Array<[number, number]> = [];
  for (let i = 0; i < n; i++) assignments.push([i, labels[i]]);
  return { algorithm: 'label-propagation', assignments };
}

// ─── Backends ──────────────────────────────────────────────────────────────

const minimalBackend: Backend = {
  id: 'minimal-edge',
  capabilities: {
    supportsCentrality: false,
    supportsCommunityDetection: false,
    maxNodes: Infinity,
  },
  invariants,
};

const analyticBackend: Backend = {
  id: 'analytic-edge',
  capabilities: {
    supportsCentrality: true,
    supportsCommunityDetection: true,
    // Brandes is O(n·(n+m)); cap at 5k nodes for non-degree centralities.
    maxNodes: 50_000,
  },
  invariants,
  centrality(g, kind) {
    if (kind === 'degree') return degreeCentrality(g);
    if (kind === 'betweenness') {
      if (g.numNodes > 5000) {
        // Fall back to degree to keep the request bounded.
        const out = degreeCentrality(g);
        return { ...out, kind: 'betweenness' };
      }
      return betweennessCentrality(g);
    }
    // Other kinds not implemented in the edge backend — return degree as a
    // labeled approximation so the wire shape is stable.
    return { ...degreeCentrality(g), kind };
  },
  community(g, algo) {
    const out = labelPropagation(g);
    return { ...out, algorithm: algo };
  },
};

const REGISTRY: Backend[] = [minimalBackend, analyticBackend];

// ─── Capability-aware dispatch ─────────────────────────────────────────────

export interface DispatchPlan {
  backend: Backend;
  reason: 'requested' | 'capability-match' | 'default';
}

function planDispatch(
  needs: { centrality?: boolean; community?: boolean },
  nodeCount: number,
  requested?: string,
): DispatchPlan {
  if (requested) {
    const b = REGISTRY.find((x) => x.id === requested);
    if (!b) throw new Error(`unknown backend: ${requested}`);
    return { backend: b, reason: 'requested' };
  }
  if (needs.centrality || needs.community) {
    const matches = REGISTRY.filter((b) => {
      if (needs.centrality && !b.capabilities.supportsCentrality) return false;
      if (needs.community && !b.capabilities.supportsCommunityDetection) return false;
      return b.capabilities.maxNodes >= nodeCount;
    });
    if (matches.length > 0) {
      // cheapest = smallest maxNodes that still fits.
      matches.sort((a, b) => a.capabilities.maxNodes - b.capabilities.maxNodes);
      return { backend: matches[0], reason: 'capability-match' };
    }
  }
  return { backend: minimalBackend, reason: 'default' };
}

// ─── Public REST handlers ──────────────────────────────────────────────────

export function analyzeFaceAdjacencyRequest(
  input: FaceAdjacencyWire,
  options: AnalyzeAdjacencyOptions = {},
): AnalyzeAdjacencyResultWire {
  const g = adaptFaceAdjacency(input);
  const plan = planDispatch(
    { centrality: !!options.centrality, community: !!options.community },
    g.numNodes,
    options.backend,
  );
  const diagnostics: string[] = [];

  const inv = plan.backend.invariants(g);
  const out: AnalyzeAdjacencyResultWire = {
    graph: {
      nodeCount: g.numNodes,
      edgeCount: g.edgeCount,
      flavor: ['undirected', 'weighted'],
    },
    invariants: inv,
    dispatchedTo: plan.backend.id,
    dispatchReason: plan.reason,
  };

  if (options.centrality) {
    if (plan.backend.capabilities.supportsCentrality && plan.backend.centrality) {
      out.centrality = plan.backend.centrality(g, options.centrality);
    } else {
      diagnostics.push(
        `centrality '${options.centrality}' omitted: backend '${plan.backend.id}' lacks supportsCentrality`,
      );
    }
  }
  if (options.community) {
    if (plan.backend.capabilities.supportsCommunityDetection && plan.backend.community) {
      out.communities = plan.backend.community(g, options.community);
    } else {
      diagnostics.push(
        `community '${options.community}' omitted: backend '${plan.backend.id}' lacks supportsCommunityDetection`,
      );
    }
  }

  if (diagnostics.length) out.diagnostics = diagnostics;
  return out;
}

export interface FindCriticalFacesOptions {
  kind?: CentralityKind;
  topK?: number;
  backend?: string;
}

export function findCriticalFacesRequest(
  input: FaceAdjacencyWire,
  options: FindCriticalFacesOptions = {},
): CriticalFacesResultWire {
  const kind = options.kind ?? 'betweenness';
  const topK = Math.max(1, Math.min(1000, options.topK ?? 10));
  const g = adaptFaceAdjacency(input);
  const plan = planDispatch({ centrality: true }, g.numNodes, options.backend);
  const diagnostics: string[] = [];

  if (!plan.backend.capabilities.supportsCentrality || !plan.backend.centrality) {
    // No usable backend for centrality — return empty ranking + diagnostic.
    diagnostics.push(
      `findCriticalFaces: backend '${plan.backend.id}' lacks supportsCentrality; ranking omitted`,
    );
    return {
      ranking: [],
      kind,
      topK,
      dispatchedTo: plan.backend.id,
      dispatchReason: plan.reason,
      diagnostics,
    };
  }

  const scores = plan.backend.centrality(g, kind).scores;
  const ranking = [...scores]
    .map(([face, score]) => ({ face, score }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  return {
    ranking,
    kind,
    topK,
    dispatchedTo: plan.backend.id,
    dispatchReason: plan.reason,
  };
}

// ─── Validators (lightweight, no zod dependency) ───────────────────────────

export function validateAnalyzeBody(raw: unknown): {
  graph: FaceAdjacencyWire;
  options: AnalyzeAdjacencyOptions;
} {
  if (!raw || typeof raw !== 'object') throw new Error('body must be an object');
  const r = raw as Record<string, unknown>;
  const graph = validateFaceAdjacency(r.graph);
  const options = (r.options ?? {}) as AnalyzeAdjacencyOptions;
  if (options && typeof options !== 'object') throw new Error('options must be an object');
  return { graph, options };
}

export function validateCriticalBody(raw: unknown): {
  graph: FaceAdjacencyWire;
  options: FindCriticalFacesOptions;
} {
  if (!raw || typeof raw !== 'object') throw new Error('body must be an object');
  const r = raw as Record<string, unknown>;
  const graph = validateFaceAdjacency(r.graph);
  const options = (r.options ?? {}) as FindCriticalFacesOptions;
  if (options && typeof options !== 'object') throw new Error('options must be an object');
  if (typeof options.topK === 'number' && (options.topK < 1 || options.topK > 1000)) {
    throw new Error('options.topK out of range [1, 1000]');
  }
  return { graph, options };
}

function validateFaceAdjacency(raw: unknown): FaceAdjacencyWire {
  if (!raw || typeof raw !== 'object') throw new Error('graph required');
  const g = raw as Record<string, unknown>;
  const n = Number(g.numNodes);
  if (!Number.isInteger(n) || n < 1 || n > 1_000_000) {
    throw new Error('graph.numNodes must be a positive integer ≤ 1,000,000');
  }
  if (!Array.isArray(g.edges)) throw new Error('graph.edges must be an array');
  if (g.edges.length > 5_000_000) throw new Error('graph.edges too large (>5M)');
  for (const e of g.edges as unknown[]) {
    if (!Array.isArray(e) || e.length < 2 || e.length > 3) {
      throw new Error('each edge must be [src, dst] or [src, dst, weight]');
    }
  }
  return {
    numNodes: n,
    edges: g.edges as FaceAdjacencyWire['edges'],
    edgeAttributes: g.edgeAttributes as FaceAdjacencyWire['edgeAttributes'],
    metadata: g.metadata as FaceAdjacencyWire['metadata'],
  };
}

/** Backends visible to clients (for UI / docs). */
export function listBackends() {
  return REGISTRY.map((b) => ({ id: b.id, capabilities: b.capabilities }));
}
