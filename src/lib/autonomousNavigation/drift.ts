/**
 * Drift detection over operational trajectories.
 *
 * Computes per-dimension drift vs the baseline window centroid and
 * grades severity, plus flags basin-boundary crossings.
 */

import { STATE_DIMENSIONS } from '@/lib/operationalState';
import type {
  Basin,
  DriftReport,
  DriftSeverity,
  ManifoldConfig,
  ManifoldPoint,
} from './types';

export function detectDrift(
  recent: ManifoldPoint[],
  current: ManifoldPoint,
  basins: Basin[],
  config: ManifoldConfig,
): DriftReport {
  if (recent.length === 0) {
    return emptyReport();
  }
  const dim = current.vector.vector.length;
  const baseline = new Float32Array(dim);
  for (const p of recent) {
    const v = p.vector.vector;
    for (let i = 0; i < dim; i++) baseline[i] += v[i];
  }
  for (let i = 0; i < dim; i++) baseline[i] /= recent.length;

  const perDimension: Record<string, number> = {};
  let sq = 0;
  const cur = current.vector.vector;
  for (let i = 0; i < dim; i++) {
    const delta = cur[i] - baseline[i];
    perDimension[STATE_DIMENSIONS[i]] = delta;
    sq += delta * delta;
  }
  const magnitude = Math.sqrt(sq);

  const severity = gradeSeverity(magnitude, config);
  const topDrivers = Object.entries(perDimension)
    .map(([dimension, delta]) => ({ dimension, delta }))
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, 5);

  const prev = recent[recent.length - 1];
  const fromBasin = prev?.basin ?? null;
  const toBasin = current.basin ?? null;
  const crossedBasin = fromBasin !== null && toBasin !== null && fromBasin !== toBasin;

  // Suppress 'crossedBasin' if no basins have materialized yet.
  const haveBasins = basins.length > 0;

  return {
    severity,
    magnitude,
    perDimension,
    topDrivers,
    crossedBasin: haveBasins && crossedBasin,
    fromBasin,
    toBasin,
  };
}

function gradeSeverity(magnitude: number, config: ManifoldConfig): DriftSeverity {
  if (magnitude >= config.driftSevereThreshold) return 'severe';
  if (magnitude >= config.driftModerateThreshold) return 'moderate';
  if (magnitude > 0.05) return 'minor';
  return 'none';
}

function emptyReport(): DriftReport {
  return {
    severity: 'none',
    magnitude: 0,
    perDimension: {},
    topDrivers: [],
    crossedBasin: false,
    fromBasin: null,
    toBasin: null,
  };
}
