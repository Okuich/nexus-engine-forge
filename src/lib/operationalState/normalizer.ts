/**
 * Normalizer — fits per-dimension min/max statistics and produces
 * vectors in [0, 1]. Also fits a diagonal covariance matrix used by
 * the Mahalanobis distance.
 */

import { STATE_DIMENSIONS, VECTOR_DIM, type OperationalSnapshot } from './types';

export interface NormalizerStats {
  min: Float32Array;
  max: Float32Array;
  /** Per-dimension variance (diagonal Mahalanobis) */
  variance: Float32Array;
  /** Number of samples used to fit */
  n: number;
}

/** Sensible default ranges so the system works before any data has been observed. */
const DEFAULT_RANGES: Record<string, [number, number]> = {
  'machine.avgUtilization': [0, 1],
  'machine.avgLoad': [0, 1],
  'machine.avgTemperature': [0, 1],
  'machine.faultRatio': [0, 1],
  'queue.pending': [0, 200],
  'queue.inProgress': [0, 50],
  'queue.avgQueueAgeHrs': [0, 72],
  'queue.rushCount': [0, 20],
  'inventory.stockoutCount': [0, 50],
  'inventory.inventoryHealth': [0, 1],
  'inventory.daysOfCover': [0, 60],
  'tools.activeTools': [0, 200],
  'tools.avgWear': [0, 1],
  'tools.toolsNeedingChange': [0, 50],
  'throughput.partsPerHour': [0, 500],
  'throughput.cycleEfficiency': [0, 1],
  'throughput.oee': [0, 1],
  'downtime.unplannedHrs24': [0, 24],
  'downtime.plannedHrs24': [0, 24],
  'downtime.mtbfHrs': [0, 720],
  'energy.kwhLastHour': [0, 2000],
  'energy.kwhPerPart': [0, 50],
  'energy.peakRatio': [0, 1],
  'backlog.openOrders': [0, 1000],
  'backlog.backlogValueUsd': [0, 5_000_000],
  'backlog.overdueCount': [0, 200],
  'quality.scrapRate': [0, 1],
  'quality.firstPassYield': [0, 1],
  'quality.openNcrs': [0, 100],
  'demand.rfqRate': [0, 200],
  'demand.conversionRate': [0, 1],
  'demand.forecastIndex': [0, 2],
};

export function defaultStats(): NormalizerStats {
  const min = new Float32Array(VECTOR_DIM);
  const max = new Float32Array(VECTOR_DIM);
  const variance = new Float32Array(VECTOR_DIM);
  STATE_DIMENSIONS.forEach((d, i) => {
    const [lo, hi] = DEFAULT_RANGES[d] ?? [0, 1];
    min[i] = lo;
    max[i] = hi;
    // Variance of uniform[lo,hi] on a normalized [0,1] basis = 1/12
    variance[i] = 1 / 12;
  });
  return { min, max, variance, n: 0 };
}

/**
 * Extract raw feature values from a snapshot, in dimension order.
 */
export function extractRawFeatures(s: OperationalSnapshot): Float32Array {
  const out = new Float32Array(VECTOR_DIM);
  const m = s.machines;
  const mCount = Math.max(1, m.length);
  let uSum = 0, loadSum = 0, tSum = 0, faults = 0;
  for (const mm of m) {
    uSum += mm.utilization;
    loadSum += mm.load;
    tSum += mm.temperature;
    if (mm.status === 3) faults++;
  }

  const v: Record<string, number> = {
    'machine.avgUtilization': uSum / mCount,
    'machine.avgLoad': loadSum / mCount,
    'machine.avgTemperature': tSum / mCount,
    'machine.faultRatio': faults / mCount,
    'queue.pending': s.queue.pending,
    'queue.inProgress': s.queue.inProgress,
    'queue.avgQueueAgeHrs': s.queue.avgQueueAgeHrs,
    'queue.rushCount': s.queue.rushCount,
    'inventory.stockoutCount': s.inventory.stockoutCount,
    'inventory.inventoryHealth': s.inventory.inventoryHealth,
    'inventory.daysOfCover': s.inventory.daysOfCover,
    'tools.activeTools': s.tools.activeTools,
    'tools.avgWear': s.tools.avgWear,
    'tools.toolsNeedingChange': s.tools.toolsNeedingChange,
    'throughput.partsPerHour': s.throughput.partsPerHour,
    'throughput.cycleEfficiency': s.throughput.cycleEfficiency,
    'throughput.oee': s.throughput.oee,
    'downtime.unplannedHrs24': s.downtime.unplannedHrs24,
    'downtime.plannedHrs24': s.downtime.plannedHrs24,
    'downtime.mtbfHrs': s.downtime.mtbfHrs,
    'energy.kwhLastHour': s.energy.kwhLastHour,
    'energy.kwhPerPart': s.energy.kwhPerPart,
    'energy.peakRatio': s.energy.peakRatio,
    'backlog.openOrders': s.backlog.openOrders,
    'backlog.backlogValueUsd': s.backlog.backlogValueUsd,
    'backlog.overdueCount': s.backlog.overdueCount,
    'quality.scrapRate': s.quality.scrapRate,
    'quality.firstPassYield': s.quality.firstPassYield,
    'quality.openNcrs': s.quality.openNcrs,
    'demand.rfqRate': s.demand.rfqRate,
    'demand.conversionRate': s.demand.conversionRate,
    'demand.forecastIndex': s.demand.forecastIndex,
  };

  STATE_DIMENSIONS.forEach((d, i) => {
    out[i] = Number.isFinite(v[d]) ? v[d] : 0;
  });
  return out;
}

/** Min-max normalize raw features into [0, 1] using fitted stats. */
export function normalize(raw: Float32Array, stats: NormalizerStats): Float32Array {
  const out = new Float32Array(VECTOR_DIM);
  for (let i = 0; i < VECTOR_DIM; i++) {
    const lo = stats.min[i];
    const hi = stats.max[i];
    const range = hi - lo;
    if (range <= 0) {
      out[i] = 0;
    } else {
      const v = (raw[i] - lo) / range;
      out[i] = v < 0 ? 0 : v > 1 ? 1 : v;
    }
  }
  return out;
}

/**
 * Online stats update — expand min/max envelope and accumulate variance
 * (Welford-style) on the normalized vector for Mahalanobis use.
 */
export function updateStats(stats: NormalizerStats, raw: Float32Array): NormalizerStats {
  const min = new Float32Array(stats.min);
  const max = new Float32Array(stats.max);
  const variance = new Float32Array(stats.variance);
  for (let i = 0; i < VECTOR_DIM; i++) {
    if (raw[i] < min[i]) min[i] = raw[i];
    if (raw[i] > max[i]) max[i] = raw[i];
  }
  // Update variance against the normalized vector for stability.
  const n = stats.n + 1;
  const normalized = normalize(raw, { min, max, variance, n });
  // EMA-style variance to keep things simple and online-friendly.
  const alpha = 1 / Math.min(n, 200);
  for (let i = 0; i < VECTOR_DIM; i++) {
    const mean = 0.5; // approximate; normalized vectors center near 0.5
    const sq = (normalized[i] - mean) * (normalized[i] - mean);
    variance[i] = (1 - alpha) * variance[i] + alpha * sq;
    if (variance[i] < 1e-6) variance[i] = 1e-6;
  }
  return { min, max, variance, n };
}
