/**
 * Cost model + action inference for edges in the optimization graph.
 *
 * An edge between two operational states is annotated with a
 * multi-objective cost (time / energy / waste / downtime / risk) and
 * a TrajectoryAction that describes the operational change that
 * effectively performs the transition.
 */

import {
  STATE_DIMENSIONS,
  type OperationalSnapshot,
  type OperationalStateVector,
} from '@/lib/operationalState';
import {
  DEFAULT_WEIGHTS,
  type ActionDelta,
  type ActionKind,
  type CostWeights,
  type EdgeCost,
  type OptimizationGoal,
  type TrajectoryAction,
} from './types';

// ─── Weight presets per goal ──────────────────────────────────────

const GOAL_WEIGHTS: Record<OptimizationGoal, CostWeights> = {
  'production-scaling': { time: 0.8, energy: 0.6, waste: 0.8, downtime: 1.0, risk: 0.8 },
  'downtime-reduction': { time: 1.2, energy: 0.5, waste: 0.6, downtime: 2.0, risk: 1.2 },
  'throughput-improvement': { time: 1.5, energy: 0.7, waste: 0.9, downtime: 1.4, risk: 0.9 },
  'inventory-optimization': { time: 0.8, energy: 0.5, waste: 1.5, downtime: 0.9, risk: 0.8 },
  'custom': DEFAULT_WEIGHTS,
};

export function resolveWeights(
  goal: OptimizationGoal | undefined,
  override: Partial<CostWeights> | undefined,
): CostWeights {
  const base = goal ? GOAL_WEIGHTS[goal] : DEFAULT_WEIGHTS;
  return { ...base, ...(override ?? {}) };
}

// ─── Edge cost ───────────────────────────────────────────────────

function dimIndex(name: string): number {
  return STATE_DIMENSIONS.indexOf(name as (typeof STATE_DIMENSIONS)[number]);
}

function delta(from: OperationalStateVector, to: OperationalStateVector, dim: string): number {
  const i = dimIndex(dim);
  if (i < 0) return 0;
  return to.vector[i] - from.vector[i];
}

export interface EdgeCostInputs {
  fromVec: OperationalStateVector;
  toVec: OperationalStateVector;
  fromSnap: OperationalSnapshot;
  toSnap: OperationalSnapshot;
  /** Euclidean distance between vectors */
  distance: number;
  weights: CostWeights;
}

export function computeEdgeCost(inputs: EdgeCostInputs): EdgeCost {
  const { fromVec, toVec, fromSnap, toSnap, distance, weights } = inputs;

  // Time: proportional to magnitude of operational change.
  const time = Math.max(0.25, 4 * distance + 0.5);

  // Energy: weighted normalized delta in energy.kwhLastHour (positive = added load).
  const energyDelta = delta(fromVec, toVec, 'energy.kwhLastHour');
  const energy = Math.max(0, energyDelta) * 50 + 1;

  // Waste: increases with scrap rate increases and instability.
  const scrapDelta = delta(fromVec, toVec, 'quality.scrapRate');
  const waste = Math.max(0, scrapDelta) * 30 + distance * 1.5;

  // Downtime: planned/unplanned hour deltas, plus a small base for any switch.
  const upDelta = delta(fromVec, toVec, 'downtime.unplannedHrs24');
  const planDelta = delta(fromVec, toVec, 'downtime.plannedHrs24');
  const downtime = Math.max(0, upDelta * 24) + Math.max(0, planDelta * 12) + 0.25 * distance;

  // Risk: increases with magnitude of change and current fault/quality state.
  const faultRatio = fromSnap.machines.length > 0
    ? fromSnap.machines.filter((m) => m.status === 3).length / fromSnap.machines.length
    : 0;
  const risk = Math.min(
    1,
    0.15 * distance + 0.4 * faultRatio + 0.3 * Math.max(0, toSnap.quality.scrapRate - fromSnap.quality.scrapRate),
  );

  const total =
    weights.time * time +
    weights.energy * energy * 0.05 +
    weights.waste * waste +
    weights.downtime * downtime +
    weights.risk * risk * 10;

  return { time, energy, waste, downtime, risk, total };
}

// ─── Action inference ────────────────────────────────────────────

const KIND_PRIORITY: Array<{ dim: string; kind: ActionKind; positive: boolean; desc: (d: number) => string }> = [
  // Throughput-driving deltas
  { dim: 'throughput.partsPerHour', kind: 'increase-throughput', positive: true, desc: (d) => `Raise throughput by ${(d * 100).toFixed(0)}%` },
  { dim: 'throughput.oee', kind: 'increase-throughput', positive: true, desc: (d) => `Improve OEE by ${(d * 100).toFixed(0)}%` },
  // Downtime
  { dim: 'downtime.unplannedHrs24', kind: 'reduce-downtime', positive: false, desc: (d) => `Cut unplanned downtime by ${(Math.abs(d) * 24).toFixed(1)}h` },
  // Inventory
  { dim: 'inventory.inventoryHealth', kind: 'adjust-inventory', positive: true, desc: (d) => `Replenish stock (health +${(d * 100).toFixed(0)}%)` },
  { dim: 'inventory.stockoutCount', kind: 'adjust-inventory', positive: false, desc: (d) => `Reduce stockouts by ${Math.abs(d * 50).toFixed(0)} SKUs` },
  // Queue
  { dim: 'queue.pending', kind: 'reschedule-queue', positive: false, desc: (d) => `Reschedule queue (${Math.abs(d * 200).toFixed(0)} jobs)` },
  // Tools
  { dim: 'tools.toolsNeedingChange', kind: 'rebalance-tools', positive: false, desc: () => 'Rotate worn tooling' },
  // Energy
  { dim: 'energy.kwhPerPart', kind: 'energy-tune', positive: false, desc: (d) => `Lower energy/part by ${(Math.abs(d) * 50).toFixed(1)} kWh` },
  // Quality
  { dim: 'quality.scrapRate', kind: 'improve-quality', positive: false, desc: (d) => `Reduce scrap rate by ${(Math.abs(d) * 100).toFixed(1)}%` },
  // Backlog
  { dim: 'backlog.openOrders', kind: 'scale-production', positive: true, desc: () => 'Scale production to absorb backlog' },
];

export function inferAction(
  from: OperationalStateVector,
  to: OperationalStateVector,
  cost: EdgeCost,
): TrajectoryAction {
  const deltas: ActionDelta[] = STATE_DIMENSIONS.map((d, i) => ({
    dimension: d,
    from: from.vector[i],
    to: to.vector[i],
    delta: to.vector[i] - from.vector[i],
  }))
    .filter((d) => Math.abs(d.delta) > 1e-4)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  // Pick the highest-priority rule whose delta has the expected sign.
  let chosen: { kind: ActionKind; description: string } | null = null;
  for (const rule of KIND_PRIORITY) {
    const match = deltas.find((d) => d.dimension === rule.dim);
    if (!match) continue;
    const ok = rule.positive ? match.delta > 0.01 : match.delta < -0.01;
    if (ok) {
      chosen = { kind: rule.kind, description: rule.desc(match.delta) };
      break;
    }
  }
  if (!chosen) {
    chosen = deltas.length === 0
      ? { kind: 'maintain', description: 'Hold current operating point' }
      : { kind: 'maintain', description: `Minor adjustment across ${deltas.length} dimensions` };
  }

  return {
    kind: chosen.kind,
    description: chosen.description,
    deltas: deltas.slice(0, 5),
    risk: cost.risk,
    etaHours: cost.time,
  };
}
