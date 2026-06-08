import { describe, it, expect, beforeEach } from 'vitest';
import {
  OperationalStateEngine,
  findSimilarStates,
  getOperationalStateEngine,
  euclideanDistance,
  cosineDistance,
  mahalanobisDistance,
  defaultStats,
  VECTOR_DIM,
  type OperationalSnapshot,
} from '@/lib/operationalState';

function makeSnapshot(overrides: Partial<OperationalSnapshot> = {}): OperationalSnapshot {
  const base: OperationalSnapshot = {
    tenantId: 't1',
    snapshotAt: new Date().toISOString(),
    machines: [
      { machineId: 'm1', status: 1, utilization: 0.7, load: 0.5, temperature: 0.4 },
      { machineId: 'm2', status: 1, utilization: 0.6, load: 0.4, temperature: 0.5 },
    ],
    queue: { pending: 10, inProgress: 4, avgQueueAgeHrs: 6, rushCount: 1 },
    inventory: { stockoutCount: 1, inventoryHealth: 0.85, daysOfCover: 14 },
    tools: { activeTools: 25, avgWear: 0.3, toolsNeedingChange: 2 },
    throughput: { partsPerHour: 80, cycleEfficiency: 0.9, oee: 0.78 },
    downtime: { unplannedHrs24: 1, plannedHrs24: 2, mtbfHrs: 120 },
    energy: { kwhLastHour: 350, kwhPerPart: 4.4, peakRatio: 0.5 },
    backlog: { openOrders: 40, backlogValueUsd: 250_000, overdueCount: 3 },
    quality: { scrapRate: 0.02, firstPassYield: 0.96, openNcrs: 1 },
    demand: { rfqRate: 8, conversionRate: 0.35, forecastIndex: 1.05 },
  };
  return { ...base, ...overrides } as OperationalSnapshot;
}

describe('OperationalStateEngine', () => {
  let engine: OperationalStateEngine;
  beforeEach(() => {
    engine = new OperationalStateEngine();
  });

  it('embeds snapshots to fixed-length normalized vectors', () => {
    const v = engine.embed(makeSnapshot());
    expect(v.vector).toBeInstanceOf(Float32Array);
    expect(v.vector.length).toBe(VECTOR_DIM);
    for (let i = 0; i < v.vector.length; i++) {
      expect(v.vector[i]).toBeGreaterThanOrEqual(0);
      expect(v.vector[i]).toBeLessThanOrEqual(1);
    }
  });

  it('ingests snapshots with outcomes and interventions', () => {
    const stored = engine.ingest(makeSnapshot(), {
      outcome: { throughputDelta: 5, scrapDelta: -0.01, revenueDeltaUsd: 1200, resolved: true },
      interventions: [
        { id: 'i1', action: 'tool-change', description: 'Swap tool 3', appliedAt: new Date().toISOString(), appliedBy: 'agent' },
      ],
    });
    expect(engine.size()).toBe(1);
    expect(stored.outcome?.resolved).toBe(true);
    expect(stored.interventions).toHaveLength(1);
    expect(stored.performance.oee).toBeGreaterThan(0);
  });

  it('returns top-k nearest neighbors sorted by distance', () => {
    for (let i = 0; i < 50; i++) {
      engine.ingest(
        makeSnapshot({
          snapshotAt: new Date(Date.now() - i * 3600_000).toISOString(),
          throughput: { partsPerHour: 60 + i, cycleEfficiency: 0.8, oee: 0.7 + (i % 10) * 0.02 },
        }),
        { performance: { oee: 0.7, scrapRate: 0.02, onTimeDelivery: 0.9, energyEfficiency: 0.5 } },
      );
    }
    const results = engine.findSimilarStates(makeSnapshot(), { k: 5 });
    expect(results).toHaveLength(5);
    for (let i = 1; i < results.length; i++) {
      expect(results[i].distance).toBeGreaterThanOrEqual(results[i - 1].distance);
    }
    for (const r of results) {
      expect(r.similarity).toBeGreaterThan(0);
      expect(r.similarity).toBeLessThanOrEqual(1);
      expect(r.state.performance).toBeDefined();
    }
  });

  it.each(['euclidean', 'cosine', 'mahalanobis'] as const)(
    'supports the %s distance metric',
    (metric) => {
      for (let i = 0; i < 20; i++) {
        engine.ingest(makeSnapshot({ snapshotAt: new Date(Date.now() - i * 60_000).toISOString() }));
      }
      const results = engine.findSimilarStates(makeSnapshot(), { metric, k: 3 });
      expect(results.length).toBe(3);
      expect(results.every((r) => Number.isFinite(r.distance))).toBe(true);
    },
  );

  it('distance metrics behave as expected on simple vectors', () => {
    const a = new Float32Array(VECTOR_DIM);
    const b = new Float32Array(VECTOR_DIM);
    a[0] = 1; b[0] = 1;
    expect(euclideanDistance(a, b)).toBe(0);
    expect(cosineDistance(a, b)).toBeCloseTo(0, 5);
    expect(mahalanobisDistance(a, b, defaultStats().variance)).toBe(0);

    b[0] = 0;
    expect(euclideanDistance(a, b)).toBeGreaterThan(0);
    expect(cosineDistance(a, b)).toBeGreaterThan(0);
  });

  it('retrieves top-k from a 5k-state store in under 100ms', () => {
    for (let i = 0; i < 5000; i++) {
      engine.ingest(
        makeSnapshot({
          snapshotAt: new Date(Date.now() - i * 1000).toISOString(),
          throughput: { partsPerHour: 50 + (i % 200), cycleEfficiency: 0.7 + (i % 10) * 0.02, oee: 0.6 + (i % 8) * 0.04 },
          quality: { scrapRate: (i % 5) * 0.01, firstPassYield: 0.9 + (i % 10) * 0.005, openNcrs: i % 4 },
        }),
      );
    }
    const query = makeSnapshot();
    const t0 = performance.now();
    const results = engine.findSimilarStates(query, { k: 10 });
    const elapsed = performance.now() - t0;
    expect(results).toHaveLength(10);
    expect(elapsed).toBeLessThan(100);
  });

  it('exposes a singleton findSimilarStates helper', () => {
    getOperationalStateEngine().reset();
    getOperationalStateEngine().ingest(makeSnapshot());
    getOperationalStateEngine().ingest(makeSnapshot({ snapshotAt: new Date(Date.now() - 60_000).toISOString() }));
    const results = findSimilarStates(makeSnapshot(), { k: 1 });
    expect(results.length).toBe(1);
  });
});
