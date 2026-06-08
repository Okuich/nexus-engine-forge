import { describe, it, expect, beforeEach } from 'vitest';
import {
  OptimizationGeometryEngine,
  findOptimalPath,
  getOptimizationGeometryEngine,
  type OptimizationGoal,
} from '@/lib/optimizationGeometry';
import type { OperationalSnapshot } from '@/lib/operationalState';

function makeSnapshot(overrides: Partial<OperationalSnapshot> = {}): OperationalSnapshot {
  const base: OperationalSnapshot = {
    tenantId: 't1',
    snapshotAt: new Date().toISOString(),
    machines: [
      { machineId: 'm1', status: 1, utilization: 0.5, load: 0.4, temperature: 0.4 },
      { machineId: 'm2', status: 1, utilization: 0.5, load: 0.4, temperature: 0.5 },
    ],
    queue: { pending: 30, inProgress: 4, avgQueueAgeHrs: 8, rushCount: 1 },
    inventory: { stockoutCount: 4, inventoryHealth: 0.6, daysOfCover: 8 },
    tools: { activeTools: 20, avgWear: 0.4, toolsNeedingChange: 5 },
    throughput: { partsPerHour: 50, cycleEfficiency: 0.7, oee: 0.55 },
    downtime: { unplannedHrs24: 3, plannedHrs24: 2, mtbfHrs: 80 },
    energy: { kwhLastHour: 400, kwhPerPart: 8, peakRatio: 0.6 },
    backlog: { openOrders: 80, backlogValueUsd: 400_000, overdueCount: 10 },
    quality: { scrapRate: 0.04, firstPassYield: 0.9, openNcrs: 3 },
    demand: { rfqRate: 10, conversionRate: 0.3, forecastIndex: 1.0 },
  };
  return { ...base, ...overrides };
}

function tweak(s: OperationalSnapshot, mod: (s: OperationalSnapshot) => void): OperationalSnapshot {
  const next = JSON.parse(JSON.stringify(s)) as OperationalSnapshot;
  mod(next);
  return next;
}

describe('OptimizationGeometryEngine', () => {
  let engine: OptimizationGeometryEngine;
  beforeEach(() => {
    engine = new OptimizationGeometryEngine();
  });

  it('registers states and reports size', () => {
    engine.registerState(makeSnapshot());
    engine.registerState(makeSnapshot({ snapshotAt: new Date(Date.now() - 60_000).toISOString() }));
    expect(engine.size()).toBe(2);
  });

  it('returns a direct path when no intermediate states are registered', () => {
    const current = makeSnapshot();
    const target = tweak(current, (s) => {
      s.throughput.partsPerHour = 90;
      s.throughput.oee = 0.78;
      s.quality.scrapRate = 0.02;
    });
    const path = engine.findOptimalPath(current, target);
    expect(path.reached).toBe(true);
    expect(path.nodeIds.length).toBe(2);
    expect(path.actions.length).toBe(1);
    expect(path.totalCost.total).toBeGreaterThan(0);
  });

  it('chains multiple actions through intermediate states', () => {
    const current = makeSnapshot();
    // Intermediate hops that improve incrementally.
    const mid1 = tweak(current, (s) => {
      s.throughput.partsPerHour = 65;
      s.throughput.oee = 0.62;
    });
    const mid2 = tweak(mid1, (s) => {
      s.throughput.partsPerHour = 78;
      s.throughput.oee = 0.7;
      s.quality.scrapRate = 0.03;
    });
    const target = tweak(mid2, (s) => {
      s.throughput.partsPerHour = 95;
      s.throughput.oee = 0.8;
      s.quality.scrapRate = 0.02;
    });

    engine.registerState(mid1, 'mid-1');
    engine.registerState(mid2, 'mid-2');

    const path = engine.findOptimalPath(current, target, {
      goal: 'throughput-improvement',
      connectivityRadius: 1.5, // generous so chained path is reachable
      maxDegree: 6,
    });
    expect(path.reached).toBe(true);
    expect(path.actions.length).toBeGreaterThanOrEqual(1);
    expect(path.actions.length).toBeLessThanOrEqual(4);
    expect(path.predictedOutcome.throughputDelta).toBeGreaterThan(0);
    expect(path.predictedOutcome.oeeDelta).toBeGreaterThan(0);
  });

  it('produces named actions that match the dominant deltas', () => {
    const current = makeSnapshot();
    const target = tweak(current, (s) => {
      s.downtime.unplannedHrs24 = 0.5;
      s.throughput.oee = 0.7;
    });
    const path = engine.findOptimalPath(current, target, { goal: 'downtime-reduction' });
    expect(path.reached).toBe(true);
    const kinds = path.actions.map((a) => a.kind);
    expect(
      kinds.some((k) => ['reduce-downtime', 'increase-throughput'].includes(k as string)),
    ).toBe(true);
    for (const action of path.actions) {
      expect(action.description.length).toBeGreaterThan(0);
      expect(action.deltas.length).toBeGreaterThan(0);
      expect(action.etaHours).toBeGreaterThan(0);
    }
  });

  it.each<OptimizationGoal>([
    'production-scaling',
    'downtime-reduction',
    'throughput-improvement',
    'inventory-optimization',
  ])('respects %s goal preset', (goal) => {
    const current = makeSnapshot();
    const target = tweak(current, (s) => {
      s.throughput.partsPerHour = 80;
      s.inventory.inventoryHealth = 0.9;
      s.inventory.stockoutCount = 0;
      s.downtime.unplannedHrs24 = 1;
    });
    const path = engine.findOptimalPath(current, target, { goal });
    expect(path.reached).toBe(true);
    expect(path.totalCost.total).toBeGreaterThan(0);
  });

  it('estimates risk and predicted outcome', () => {
    const current = makeSnapshot();
    const target = tweak(current, (s) => {
      s.inventory.inventoryHealth = 0.95;
      s.inventory.stockoutCount = 0;
    });
    const path = engine.findOptimalPath(current, target, { goal: 'inventory-optimization' });
    expect(path.risk.overall).toBeGreaterThanOrEqual(0);
    expect(path.risk.overall).toBeLessThanOrEqual(1);
    expect(path.risk.perStep.length).toBe(path.actions.length);
    expect(path.predictedOutcome.inventoryHealthDelta).toBeGreaterThan(0);
  });

  it('exposes a singleton findOptimalPath helper', () => {
    getOptimizationGeometryEngine().reset();
    const current = makeSnapshot();
    const target = tweak(current, (s) => {
      s.throughput.partsPerHour = 70;
    });
    const path = findOptimalPath(current, target);
    expect(path.reached).toBe(true);
    expect(path.nodeIds[0]).toBeDefined();
  });
});
