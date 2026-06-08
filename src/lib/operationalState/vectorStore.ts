/**
 * Vector Store — in-memory store for OperationalStateVectors with
 * linear-scan nearest-neighbor retrieval. Designed to comfortably
 * meet the <100ms target for tens of thousands of 32-D vectors.
 *
 * The store is metric-agnostic at insert time. The query method
 * accepts the distance metric, falling back to Euclidean.
 */

import {
  cosineDistance,
  euclideanDistance,
  mahalanobisDistance,
  toSimilarity,
} from './distance';
import type { NormalizerStats } from './normalizer';
import {
  type DistanceMetric,
  type FindSimilarOptions,
  type NearestNeighborResult,
  type OperationalStateVector,
  type StateIntervention,
  type StateOutcome,
  type StatePerformanceMetrics,
  type StoredOperationalState,
} from './types';

export interface VectorStoreOptions {
  /** Maximum number of stored states (FIFO eviction). */
  capacity?: number;
}

export class OperationalVectorStore {
  private readonly items: StoredOperationalState[] = [];
  private readonly capacity: number;

  constructor(opts: VectorStoreOptions = {}) {
    this.capacity = opts.capacity ?? 50_000;
  }

  size(): number {
    return this.items.length;
  }

  clear(): void {
    this.items.length = 0;
  }

  add(
    vector: OperationalStateVector,
    options: {
      outcome?: StateOutcome | null;
      interventions?: StateIntervention[];
      performance: StatePerformanceMetrics;
    },
  ): StoredOperationalState {
    const entry: StoredOperationalState = {
      vector,
      outcome: options.outcome ?? null,
      interventions: options.interventions ?? [],
      performance: options.performance,
    };
    this.items.push(entry);
    if (this.items.length > this.capacity) {
      this.items.shift();
    }
    return entry;
  }

  /**
   * Attach an outcome or intervention to an existing stored state.
   */
  recordOutcome(
    id: string,
    outcome: StateOutcome,
    interventions: StateIntervention[] = [],
  ): boolean {
    const found = this.items.find((s) => s.vector.id === id);
    if (!found) return false;
    found.outcome = outcome;
    if (interventions.length) {
      found.interventions = [...found.interventions, ...interventions];
    }
    return true;
  }

  /**
   * k-NN query. Linear scan with metric selected at query time.
   */
  query(
    query: OperationalStateVector,
    stats: NormalizerStats,
    options: FindSimilarOptions = {},
  ): NearestNeighborResult[] {
    const k = Math.max(1, options.k ?? 10);
    const metric: DistanceMetric = options.metric ?? 'euclidean';
    const minSim = options.minSimilarity ?? 0;
    const filterTenant = options.tenantId;

    const results: NearestNeighborResult[] = [];
    for (const item of this.items) {
      if (filterTenant && item.vector.tenantId !== filterTenant) continue;
      if (item.vector.id === query.id) continue;

      let distance: number;
      if (metric === 'cosine') {
        distance = cosineDistance(query.vector, item.vector.vector);
      } else if (metric === 'mahalanobis') {
        distance = mahalanobisDistance(query.vector, item.vector.vector, stats.variance);
      } else {
        distance = euclideanDistance(query.vector, item.vector.vector);
      }
      const similarity = toSimilarity(distance, metric);
      if (similarity < minSim) continue;
      results.push({ state: item, distance, similarity });
    }

    results.sort((a, b) => a.distance - b.distance);
    return results.slice(0, k);
  }
}
