/**
 * Value scoring for manifold points.
 *
 * The value function compresses a snapshot into a scalar in [0,1] that
 * blends raw operational performance with cross-substrate integration
 * signals (Math / Geometry / Physics / Computational Geometry /
 * Fabrication OS / Midwater core).
 */

import type {
  OperationalSnapshot,
  StatePerformanceMetrics,
} from '@/lib/operationalState';
import type { IntegrationHooks } from './types';

export function derivePerformance(
  snapshot: OperationalSnapshot,
): StatePerformanceMetrics {
  const oee = clamp01(snapshot.throughput.oee);
  const scrapRate = clamp01(snapshot.quality.scrapRate);
  const overdue = snapshot.backlog.overdueCount;
  const open = Math.max(1, snapshot.backlog.openOrders);
  const onTimeDelivery = clamp01(1 - overdue / open);
  const kwh = Math.max(0.001, snapshot.energy.kwhPerPart);
  const energyEfficiency = clamp01(1 / (1 + kwh / 5));
  return { oee, scrapRate, onTimeDelivery, energyEfficiency };
}

/**
 * Aggregate value of an operational point in [0,1].
 * Higher means more desirable — the navigation engine climbs this field.
 */
export function computeValue(
  snapshot: OperationalSnapshot,
  perf: StatePerformanceMetrics,
  hooks: IntegrationHooks = {},
): number {
  // Core operational value: weighted blend of performance signals.
  const opValue =
    0.4 * perf.oee +
    0.25 * (1 - perf.scrapRate) +
    0.2 * perf.onTimeDelivery +
    0.15 * perf.energyEfficiency;

  // Cross-substrate integrations. Defaults are neutral.
  const math = hooks.mathValue ? clamp01(hooks.mathValue(snapshot)) : 0.5;
  const geom = hooks.geometryPenalty ? 1 - clamp01(hooks.geometryPenalty(snapshot)) : 1;
  const phys = hooks.physicsPenalty ? 1 - clamp01(hooks.physicsPenalty(snapshot)) : 1;
  const cgWeight = hooks.computationalGeometryWeight
    ? clamp01(hooks.computationalGeometryWeight(snapshot))
    : 0.5;
  const fab = hooks.fabricationBonus ? clamp01(hooks.fabricationBonus(snapshot)) : 0.5;
  const mid = hooks.midwaterBonus ? clamp01(hooks.midwaterBonus(snapshot)) : 0.5;

  // Multiplicative penalties for physical/geometric infeasibility,
  // additive bonuses for manufacturability + marketplace value.
  const feasibility = 0.5 * geom + 0.5 * phys;
  const bonus = 0.25 * (math + cgWeight + fab + mid) / 1; // mean of 4 in [0,1]

  const blended = opValue * (0.6 + 0.4 * feasibility) * (0.7 + 0.3 * bonus);
  return clamp01(blended);
}

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}
