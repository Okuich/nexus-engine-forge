/**
 * Operational State Metric Space — Engine
 *
 * Public facade for embedding generation, persistence, and
 * similarity retrieval. A single shared instance is exposed via
 * `getOperationalStateEngine()` for app-wide use.
 */

import {
  defaultStats,
  extractRawFeatures,
  normalize,
  updateStats,
  type NormalizerStats,
} from './normalizer';
import { OperationalVectorStore, type VectorStoreOptions } from './vectorStore';
import {
  type FindSimilarOptions,
  type NearestNeighborResult,
  type OperationalSnapshot,
  type OperationalStateVector,
  type StateIntervention,
  type StateOutcome,
  type StatePerformanceMetrics,
  type StoredOperationalState,
  VECTOR_DIM,
} from './types';

function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return (crypto as Crypto).randomUUID();
  }
  return `osv-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export interface IngestOptions {
  outcome?: StateOutcome | null;
  interventions?: StateIntervention[];
  performance?: StatePerformanceMetrics;
}

export class OperationalStateEngine {
  private stats: NormalizerStats = defaultStats();
  private readonly store: OperationalVectorStore;

  constructor(opts: VectorStoreOptions = {}) {
    this.store = new OperationalVectorStore(opts);
  }

  /** Number of embeddings currently in the store. */
  size(): number {
    return this.store.size();
  }

  reset(): void {
    this.stats = defaultStats();
    this.store.clear();
  }

  /**
   * Build an OperationalStateVector from a raw snapshot without
   * persisting it. Useful for ad-hoc queries.
   */
  embed(snapshot: OperationalSnapshot): OperationalStateVector {
    const raw = extractRawFeatures(snapshot);
    const vector = normalize(raw, this.stats);
    return {
      id: newId(),
      tenantId: snapshot.tenantId,
      snapshotAt: snapshot.snapshotAt,
      vector,
    };
  }

  /**
   * Ingest a snapshot: fit stats, embed, and store with metadata.
   */
  ingest(snapshot: OperationalSnapshot, opts: IngestOptions = {}): StoredOperationalState {
    const raw = extractRawFeatures(snapshot);
    this.stats = updateStats(this.stats, raw);
    const vector = normalize(raw, this.stats);
    const stateVector: OperationalStateVector = {
      id: newId(),
      tenantId: snapshot.tenantId,
      snapshotAt: snapshot.snapshotAt,
      vector,
    };
    const performance: StatePerformanceMetrics = opts.performance ?? {
      oee: snapshot.throughput.oee,
      scrapRate: snapshot.quality.scrapRate,
      onTimeDelivery:
        snapshot.backlog.openOrders > 0
          ? 1 - snapshot.backlog.overdueCount / snapshot.backlog.openOrders
          : 1,
      energyEfficiency:
        snapshot.energy.kwhPerPart > 0 ? 1 / (1 + snapshot.energy.kwhPerPart) : 1,
    };
    return this.store.add(stateVector, {
      outcome: opts.outcome,
      interventions: opts.interventions,
      performance,
    });
  }

  /**
   * Attach an outcome (and optional interventions) to a previously
   * stored state — used by the learning loop.
   */
  recordOutcome(
    stateId: string,
    outcome: StateOutcome,
    interventions: StateIntervention[] = [],
  ): boolean {
    return this.store.recordOutcome(stateId, outcome, interventions);
  }

  /**
   * Primary API.
   *
   *   findSimilarStates(state) → top-k nearest operational states,
   *   each annotated with its outcome, interventions and performance.
   */
  findSimilarStates(
    state: OperationalSnapshot | OperationalStateVector,
    options: FindSimilarOptions = {},
  ): NearestNeighborResult[] {
    const query: OperationalStateVector =
      'vector' in state && state.vector instanceof Float32Array
        ? (state as OperationalStateVector)
        : this.embed(state as OperationalSnapshot);

    if (query.vector.length !== VECTOR_DIM) {
      throw new Error(
        `Query vector length ${query.vector.length} does not match VECTOR_DIM ${VECTOR_DIM}`,
      );
    }
    return this.store.query(query, this.stats, options);
  }

  /** Expose stats for inspection / persistence. */
  getStats(): NormalizerStats {
    return this.stats;
  }
}

// ─── Shared singleton ────────────────────────────────────────────

let shared: OperationalStateEngine | null = null;

export function getOperationalStateEngine(): OperationalStateEngine {
  if (!shared) shared = new OperationalStateEngine();
  return shared;
}

/**
 * Convenience top-level API matching the spec:
 *
 *   findSimilarStates(state)  → Top-k nearest operational states.
 */
export function findSimilarStates(
  state: OperationalSnapshot | OperationalStateVector,
  options?: FindSimilarOptions,
): NearestNeighborResult[] {
  return getOperationalStateEngine().findSimilarStates(state, options);
}
