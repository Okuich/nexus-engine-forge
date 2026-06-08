/**
 * Operational Optimization Geometry — Engine
 *
 * Public facade. Holds a corpus of registered operational states,
 * builds a sparsified k-NN graph on demand, and runs A* to compute
 * the optimal sequence of actions from a current state to a target.
 *
 *   findOptimalPath(currentState, targetState) →
 *     {nodeIds, actions[], predictedOutcome, risk, ...}
 */

import {
  euclideanDistance,
  OperationalStateEngine,
  type OperationalSnapshot,
} from '@/lib/operationalState';
import { resolveWeights } from './cost';
import {
  OperationalGraphBuilder,
  aStarPath,
  buildOptimalPath,
} from './graph';
import {
  DEFAULT_WEIGHTS,
  type FindPathOptions,
  type OptimalPath,
  type OptimizationNode,
} from './types';

interface Registered {
  node: OptimizationNode;
}

export class OptimizationGeometryEngine {
  private readonly states = new OperationalStateEngine();
  private readonly registry = new Map<string, Registered>();

  size(): number {
    return this.registry.size;
  }

  reset(): void {
    this.registry.clear();
    this.states.reset();
  }

  /**
   * Register a snapshot as a candidate node in the optimization
   * graph. Returns the registered node id.
   */
  registerState(snapshot: OperationalSnapshot, label?: string): string {
    const vector = this.states.embed(snapshot);
    const node: OptimizationNode = { id: vector.id, vector, snapshot, label };
    this.registry.set(node.id, { node });
    return node.id;
  }

  /**
   * Primary API.
   *
   * Finds the optimal trajectory through registered states from the
   * current snapshot to the target snapshot. The current and target
   * states are added to the working graph automatically; they do not
   * need to be pre-registered.
   */
  findOptimalPath(
    currentState: OperationalSnapshot,
    targetState: OperationalSnapshot,
    options: FindPathOptions = {},
  ): OptimalPath {
    const weights = resolveWeights(options.goal, options.weights);
    const connectivityRadius = options.connectivityRadius ?? 0.6;
    const maxDegree = options.maxDegree ?? 8;
    const maxExpansions = options.maxExpansions ?? 5000;

    // Build the working set of nodes for this query.
    const currentVec = this.states.embed(currentState);
    const targetVec = this.states.embed(targetState);
    const startNode: OptimizationNode = {
      id: currentVec.id,
      vector: currentVec,
      snapshot: currentState,
      label: 'current',
    };
    const goalNode: OptimizationNode = {
      id: targetVec.id,
      vector: targetVec,
      snapshot: targetState,
      label: 'target',
    };

    const nodes: OptimizationNode[] = [startNode, goalNode];
    for (const r of this.registry.values()) nodes.push(r.node);

    const builder = new OperationalGraphBuilder();
    const graph = builder.build(nodes, { connectivityRadius, maxDegree, weights });

    // Ensure connectivity: if no path exists at the chosen radius,
    // add a direct start→goal edge so the caller always gets a
    // single-step trajectory rather than failure.
    const hasDirect = graph.adjacency.get(startNode.id)?.some((e) => e.toId === goalNode.id);
    if (!hasDirect) {
      const d = euclideanDistance(currentVec.vector, targetVec.vector);
      const expanded = new OperationalGraphBuilder().build(nodes, {
        connectivityRadius: Math.max(connectivityRadius, d + 1e-3),
        maxDegree,
        weights,
      });
      graph.adjacency.set(startNode.id, expanded.adjacency.get(startNode.id) ?? []);
    }

    const raw = aStarPath({
      graph,
      startId: startNode.id,
      goalId: goalNode.id,
      maxExpansions,
      weights,
    });
    return buildOptimalPath(raw, currentVec, targetVec);
  }
}

// ─── Shared singleton + top-level API ────────────────────────────

let shared: OptimizationGeometryEngine | null = null;

export function getOptimizationGeometryEngine(): OptimizationGeometryEngine {
  if (!shared) shared = new OptimizationGeometryEngine();
  return shared;
}

export function findOptimalPath(
  currentState: OperationalSnapshot,
  targetState: OperationalSnapshot,
  options?: FindPathOptions,
): OptimalPath {
  return getOptimizationGeometryEngine().findOptimalPath(currentState, targetState, options);
}

export { DEFAULT_WEIGHTS };
