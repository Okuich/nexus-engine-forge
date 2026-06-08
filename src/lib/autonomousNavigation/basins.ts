/**
 * Basin discovery for the operational state manifold.
 *
 * Performs a fast greedy clustering pass over registered manifold
 * points and labels each resulting cluster as:
 *   - failure       (low value, high scrap/fault)
 *   - inefficient   (low value, no failure signature)
 *   - optimal       (top-percentile value)
 *   - stable        (everything else)
 */

import { euclideanDistance } from '@/lib/operationalState';
import type {
  Basin,
  BasinKind,
  ManifoldConfig,
  ManifoldPoint,
} from './types';

interface ClassifyContext {
  values: number[];
  config: ManifoldConfig;
}

export function discoverBasins(
  points: ManifoldPoint[],
  config: ManifoldConfig,
): Basin[] {
  if (points.length === 0) return [];

  // Greedy clustering: walk points in arbitrary order, assign to
  // nearest existing centroid within basinRadius, else seed new cluster.
  const clusters: { centroid: Float32Array; members: ManifoldPoint[] }[] = [];
  for (const p of points) {
    let best = -1;
    let bestDist = Infinity;
    for (let i = 0; i < clusters.length; i++) {
      const d = euclideanDistance(p.vector.vector, clusters[i].centroid);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    if (best >= 0 && bestDist <= config.basinRadius) {
      clusters[best].members.push(p);
      clusters[best].centroid = recomputeCentroid(clusters[best].members);
    } else {
      clusters.push({ centroid: copy(p.vector.vector), members: [p] });
    }
  }

  // Materialize only clusters meeting the min size.
  const sortedValues = points.map((p) => p.value).sort((a, b) => a - b);
  const ctx: ClassifyContext = { values: sortedValues, config };

  const basins: Basin[] = [];
  let idx = 0;
  for (const c of clusters) {
    if (c.members.length < config.minBasinSize) continue;
    const meanValue = mean(c.members.map((m) => m.value));
    const radius = mean(
      c.members.map((m) => euclideanDistance(m.vector.vector, c.centroid)),
    );
    const kind = classifyBasin(c.members, meanValue, ctx);
    const id = `basin-${idx++}-${kind}`;
    basins.push({
      id,
      kind,
      centroid: c.centroid,
      meanValue,
      radius,
      members: c.members.map((m) => m.id),
    });
    // Backfill basin membership on the points themselves.
    for (const m of c.members) m.basin = kind;
  }
  return basins;
}

function classifyBasin(
  members: ManifoldPoint[],
  meanValue: number,
  { values, config }: ClassifyContext,
): BasinKind {
  const meanScrap = mean(members.map((m) => m.performance.scrapRate));
  const meanFault = mean(
    members.map((m) => avgFault(m.snapshot.machines)),
  );
  if (
    meanScrap >= config.failureScrapThreshold ||
    meanFault >= config.failureFaultThreshold
  ) {
    return 'failure';
  }
  const low = percentile(values, config.valueLowPercentile);
  const high = percentile(values, config.valueHighPercentile);
  if (meanValue >= high) return 'optimal';
  if (meanValue <= low) return 'inefficient';
  return 'stable';
}

function avgFault(machines: { status: number }[]): number {
  if (machines.length === 0) return 0;
  const faults = machines.filter((m) => m.status === 3).length;
  return faults / machines.length;
}

function recomputeCentroid(members: ManifoldPoint[]): Float32Array {
  const dim = members[0].vector.vector.length;
  const out = new Float32Array(dim);
  for (const m of members) {
    const v = m.vector.vector;
    for (let i = 0; i < dim; i++) out[i] += v[i];
  }
  for (let i = 0; i < dim; i++) out[i] /= members.length;
  return out;
}

function copy(v: Float32Array): Float32Array {
  const out = new Float32Array(v.length);
  out.set(v);
  return out;
}

function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(p * sorted.length)));
  return sorted[idx];
}
