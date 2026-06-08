/**
 * Graph builder + A* pathfinder for the Operational Optimization
 * Geometry. Nodes are operational states; edges connect metrically
 * close states with multi-objective cost.
 */

import {
  STATE_DIMENSIONS,
  euclideanDistance,
  type OperationalSnapshot,
  type OperationalStateVector,
} from '@/lib/operationalState';
import { computeEdgeCost, inferAction, resolveWeights } from './cost';
import {
  type EdgeCost,
  type FindPathOptions,
  type OptimalPath,
  type OptimizationEdge,
  type OptimizationGraph,
  type OptimizationNode,
  type PredictedOutcome,
  type RiskEstimate,
  type TrajectoryAction,
} from './types';

// Need a Float32Array distance helper of the right dimensionality.
function dist(a: Float32Array, b: Float32Array): number {
  // Use the operationalState euclidean — it asserts VECTOR_DIM.
  return euclideanDistance(a, b);
}

export class OperationalGraphBuilder {
  build(
    nodes: OptimizationNode[],
    options: Required<Pick<FindPathOptions, 'connectivityRadius' | 'maxDegree'>> & {
      weights: ReturnType<typeof resolveWeights>;
    },
  ): OptimizationGraph {
    const adjacency = new Map<string, OptimizationEdge[]>();
    const nodeMap = new Map<string, OptimizationNode>();
    for (const n of nodes) nodeMap.set(n.id, n);

    for (const a of nodes) {
      const edges: OptimizationEdge[] = [];
      const candidates: Array<{ b: OptimizationNode; d: number }> = [];
      for (const b of nodes) {
        if (b.id === a.id) continue;
        const d = dist(a.vector.vector, b.vector.vector);
        if (d <= options.connectivityRadius) candidates.push({ b, d });
      }
      candidates.sort((x, y) => x.d - y.d);
      for (const c of candidates.slice(0, options.maxDegree)) {
        const cost = computeEdgeCost({
          fromVec: a.vector,
          toVec: c.b.vector,
          fromSnap: a.snapshot,
          toSnap: c.b.snapshot,
          distance: c.d,
          weights: options.weights,
        });
        const action = inferAction(a.vector, c.b.vector, cost);
        edges.push({ fromId: a.id, toId: c.b.id, distance: c.d, cost, action });
      }
      adjacency.set(a.id, edges);
    }
    return { nodes: nodeMap, adjacency };
  }
}

// ─── Min-heap (binary) ───────────────────────────────────────────

class MinHeap<T> {
  private readonly data: Array<{ key: number; value: T }> = [];
  size(): number { return this.data.length; }
  push(key: number, value: T): void {
    this.data.push({ key, value });
    this.bubbleUp(this.data.length - 1);
  }
  pop(): T | undefined {
    if (this.data.length === 0) return undefined;
    const top = this.data[0];
    const last = this.data.pop()!;
    if (this.data.length > 0) {
      this.data[0] = last;
      this.sinkDown(0);
    }
    return top.value;
  }
  private bubbleUp(i: number) {
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.data[p].key <= this.data[i].key) break;
      [this.data[p], this.data[i]] = [this.data[i], this.data[p]];
      i = p;
    }
  }
  private sinkDown(i: number) {
    const n = this.data.length;
    while (true) {
      const l = 2 * i + 1;
      const r = 2 * i + 2;
      let s = i;
      if (l < n && this.data[l].key < this.data[s].key) s = l;
      if (r < n && this.data[r].key < this.data[s].key) s = r;
      if (s === i) break;
      [this.data[s], this.data[i]] = [this.data[i], this.data[s]];
      i = s;
    }
  }
}

// ─── Pathfinder ──────────────────────────────────────────────────

export interface FindPathInputs {
  graph: OptimizationGraph;
  startId: string;
  goalId: string;
  maxExpansions: number;
  weights: ReturnType<typeof resolveWeights>;
}

export interface RawPathResult {
  nodeIds: string[];
  edges: OptimizationEdge[];
  exploredNodes: number;
  reached: boolean;
}

export function aStarPath(inputs: FindPathInputs): RawPathResult {
  const { graph, startId, goalId, maxExpansions, weights } = inputs;
  const goalNode = graph.nodes.get(goalId);
  if (!goalNode) {
    return { nodeIds: [], edges: [], exploredNodes: 0, reached: false };
  }
  const heuristic = (id: string): number => {
    const n = graph.nodes.get(id);
    if (!n) return Infinity;
    // Underestimate of remaining cost: treat distance as time-only.
    return weights.time * 4 * dist(n.vector.vector, goalNode.vector.vector);
  };

  const gScore = new Map<string, number>();
  const cameFrom = new Map<string, { prev: string; edge: OptimizationEdge }>();
  const visited = new Set<string>();
  const open = new MinHeap<string>();

  gScore.set(startId, 0);
  open.push(heuristic(startId), startId);
  let expansions = 0;

  while (open.size() > 0 && expansions < maxExpansions) {
    const current = open.pop()!;
    if (current === goalId) {
      // Reconstruct path
      const nodeIds: string[] = [current];
      const edges: OptimizationEdge[] = [];
      let cur = current;
      while (cameFrom.has(cur)) {
        const { prev, edge } = cameFrom.get(cur)!;
        edges.unshift(edge);
        nodeIds.unshift(prev);
        cur = prev;
      }
      return { nodeIds, edges, exploredNodes: expansions, reached: true };
    }
    if (visited.has(current)) continue;
    visited.add(current);
    expansions++;

    const adj = graph.adjacency.get(current) ?? [];
    for (const edge of adj) {
      const tentative = (gScore.get(current) ?? Infinity) + edge.cost.total;
      const prevG = gScore.get(edge.toId) ?? Infinity;
      if (tentative < prevG) {
        gScore.set(edge.toId, tentative);
        cameFrom.set(edge.toId, { prev: current, edge });
        open.push(tentative + heuristic(edge.toId), edge.toId);
      }
    }
  }

  return { nodeIds: [], edges: [], exploredNodes: expansions, reached: false };
}

// ─── Aggregation helpers ─────────────────────────────────────────

export function aggregateCost(edges: OptimizationEdge[]): EdgeCost {
  const acc: EdgeCost = { time: 0, energy: 0, waste: 0, downtime: 0, risk: 0, total: 0 };
  for (const e of edges) {
    acc.time += e.cost.time;
    acc.energy += e.cost.energy;
    acc.waste += e.cost.waste;
    acc.downtime += e.cost.downtime;
    acc.total += e.cost.total;
    // Risk is bounded — track worst rather than sum.
    if (e.cost.risk > acc.risk) acc.risk = e.cost.risk;
  }
  return acc;
}

function denormalize(v: number, lo: number, hi: number): number {
  return lo + v * (hi - lo);
}

export function predictOutcome(
  from: OperationalStateVector,
  to: OperationalStateVector,
): PredictedOutcome {
  const idx = (d: string) => STATE_DIMENSIONS.indexOf(d as (typeof STATE_DIMENSIONS)[number]);
  const dn = (d: string, lo: number, hi: number) =>
    denormalize(to.vector[idx(d)] - from.vector[idx(d)], 0, hi - lo);

  return {
    throughputDelta: dn('throughput.partsPerHour', 0, 500),
    scrapDelta: to.vector[idx('quality.scrapRate')] - from.vector[idx('quality.scrapRate')],
    oeeDelta: to.vector[idx('throughput.oee')] - from.vector[idx('throughput.oee')],
    inventoryHealthDelta:
      to.vector[idx('inventory.inventoryHealth')] - from.vector[idx('inventory.inventoryHealth')],
    backlogDelta: dn('backlog.openOrders', 0, 1000),
  };
}

export function aggregateRisk(actions: TrajectoryAction[]): RiskEstimate {
  if (actions.length === 0) {
    return { overall: 0, perStep: [], worstStep: 0, drivers: [] };
  }
  const perStep = actions.map((a) => a.risk);
  const worstStep = Math.max(...perStep);
  // Overall is dominated by worst step but grows with step count.
  const overall = Math.min(1, worstStep + 0.05 * Math.sqrt(Math.max(0, actions.length - 1)));
  const drivers: string[] = [];
  const counts: Record<string, number> = {};
  for (const a of actions) counts[a.kind] = (counts[a.kind] ?? 0) + 1;
  for (const [kind, n] of Object.entries(counts)) {
    if (n >= 2 || (kind === 'reduce-downtime' || kind === 'energy-tune')) {
      drivers.push(`${kind} ×${n}`);
    }
  }
  return { overall, perStep, worstStep, drivers };
}

export function buildOptimalPath(
  raw: RawPathResult,
  fromVec: OperationalStateVector,
  toVec: OperationalStateVector,
): OptimalPath {
  const actions = raw.edges.map((e) => e.action);
  const totalCost = aggregateCost(raw.edges);
  return {
    nodeIds: raw.nodeIds,
    actions,
    totalCost,
    predictedOutcome: predictOutcome(fromVec, toVec),
    risk: aggregateRisk(actions),
    exploredNodes: raw.exploredNodes,
    reached: raw.reached,
  };
}

// Re-export OperationalSnapshot so callers can stay in one import.
export type { OperationalSnapshot };
