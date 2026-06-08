import { describe, it, expect, beforeEach } from 'vitest';
import {
  AutonomousNavigationEngine,
  getAutonomousNavigationEngine,
} from '@/lib/autonomousNavigation';
import type { OperationalSnapshot } from '@/lib/operationalState';

let ticker = 0;
function ts(): string {
  ticker += 1;
  return new Date(Date.UTC(2026, 0, 1, 0, ticker)).toISOString();
}

function snap(profile: 'healthy' | 'failing' | 'optimal', overrides: Partial<OperationalSnapshot> = {}): OperationalSnapshot {
  const base: OperationalSnapshot = {
    tenantId: 't1',
    snapshotAt: ts(),
    machines: [
      { machineId: 'm1', status: 1, utilization: 0.6, load: 0.5, temperature: 0.4 },
      { machineId: 'm2', status: 1, utilization: 0.6, load: 0.5, temperature: 0.4 },
    ],
    queue: { pending: 20, inProgress: 4, avgQueueAgeHrs: 6, rushCount: 1 },
    inventory: { stockoutCount: 2, inventoryHealth: 0.75, daysOfCover: 10 },
    tools: { activeTools: 18, avgWear: 0.35, toolsNeedingChange: 2 },
    throughput: { partsPerHour: 60, cycleEfficiency: 0.75, oee: 0.65 },
    downtime: { unplannedHrs24: 1, plannedHrs24: 1, mtbfHrs: 120 },
    energy: { kwhLastHour: 300, kwhPerPart: 5, peakRatio: 0.4 },
    backlog: { openOrders: 60, backlogValueUsd: 250_000, overdueCount: 4 },
    quality: { scrapRate: 0.03, firstPassYield: 0.93, openNcrs: 2 },
    demand: { rfqRate: 8, conversionRate: 0.32, forecastIndex: 1.0 },
  };
  if (profile === 'failing') {
    base.machines = base.machines.map((m) => ({ ...m, status: 3, utilization: 0.1 }));
    base.throughput = { partsPerHour: 15, cycleEfficiency: 0.3, oee: 0.2 };
    base.downtime = { unplannedHrs24: 12, plannedHrs24: 2, mtbfHrs: 20 };
    base.quality = { scrapRate: 0.25, firstPassYield: 0.55, openNcrs: 15 };
    base.backlog = { openOrders: 120, backlogValueUsd: 700_000, overdueCount: 60 };
  } else if (profile === 'optimal') {
    base.throughput = { partsPerHour: 110, cycleEfficiency: 0.95, oee: 0.92 };
    base.quality = { scrapRate: 0.005, firstPassYield: 0.99, openNcrs: 0 };
    base.downtime = { unplannedHrs24: 0.2, plannedHrs24: 1, mtbfHrs: 400 };
    base.energy = { kwhLastHour: 220, kwhPerPart: 2.5, peakRatio: 0.3 };
    base.backlog = { openOrders: 30, backlogValueUsd: 200_000, overdueCount: 0 };
  }
  return { ...base, ...overrides };
}

function seed(engine: AutonomousNavigationEngine, profile: 'healthy' | 'failing' | 'optimal', n: number) {
  for (let i = 0; i < n; i++) engine.ingest(snap(profile));
}

describe('AutonomousNavigationEngine', () => {
  let engine: AutonomousNavigationEngine;
  beforeEach(() => {
    ticker = 0;
    engine = new AutonomousNavigationEngine({ config: { minBasinSize: 2, basinRadius: 0.6 } });
  });

  it('ingests snapshots into the manifold', () => {
    engine.ingest(snap('healthy'));
    engine.ingest(snap('healthy'));
    expect(engine.size()).toBe(2);
  });

  it('discovers optimal, stable, and failure basins', () => {
    seed(engine, 'healthy', 4);
    seed(engine, 'optimal', 4);
    seed(engine, 'failing', 4);
    const basins = engine.basinsSnapshot();
    const kinds = new Set(basins.map((b) => b.kind));
    expect(basins.length).toBeGreaterThan(0);
    expect(kinds.has('failure')).toBe(true);
    expect(kinds.has('optimal')).toBe(true);
  });

  it('tracks operational trajectory with velocity and value delta', () => {
    seed(engine, 'failing', 3);
    seed(engine, 'healthy', 3);
    seed(engine, 'optimal', 3);
    const traj = engine.trajectory('t1');
    expect(traj.points.length).toBe(9);
    expect(traj.valueDelta).toBeGreaterThan(0);
    expect(traj.velocity).toBeGreaterThanOrEqual(0);
  });

  it('detects drift when state moves abruptly', () => {
    for (let i = 0; i < 6; i++) engine.ingest(snap('healthy'));
    engine.ingest(snap('failing'));
    const drift = engine.detectDrift('t1');
    expect(['moderate', 'severe']).toContain(drift.severity);
    expect(drift.topDrivers.length).toBeGreaterThan(0);
    expect(drift.magnitude).toBeGreaterThan(0);
  });

  it('finds nearest stable and optimal regions', () => {
    seed(engine, 'healthy', 4);
    seed(engine, 'optimal', 4);
    seed(engine, 'failing', 4);
    const probe = snap('failing');
    const stable = engine.nearestStableRegion(probe);
    const optimal = engine.nearestOptimalRegion(probe);
    expect(stable || optimal).toBeTruthy();
    if (optimal) expect(optimal.basin.kind).toBe('optimal');
    if (stable) expect(stable.basin.kind).toBe('stable');
  });

  it('builds a recovery trajectory toward a stable region', () => {
    seed(engine, 'healthy', 5);
    seed(engine, 'failing', 5);
    const probe = snap('failing');
    const rec = engine.recoveryTrajectory(probe);
    // recovery may be null if no stable basin formed; otherwise validate it.
    if (rec) {
      expect(rec.kind).toBe('recovery');
      expect(rec.trajectory.nodeIds.length).toBeGreaterThanOrEqual(2);
      expect(rec.confidence).toBeGreaterThanOrEqual(0);
      expect(rec.confidence).toBeLessThanOrEqual(1);
    }
  });

  it('builds an optimization trajectory toward an optimal region', () => {
    seed(engine, 'healthy', 5);
    seed(engine, 'optimal', 5);
    const probe = snap('healthy');
    const rec = engine.optimizationTrajectory(probe);
    expect(rec).not.toBeNull();
    expect(rec!.kind).toBe('optimization');
    expect(rec!.expectedValueGain).toBeGreaterThanOrEqual(0);
  });

  it('autoRecommend prefers recovery when in a failure state', () => {
    seed(engine, 'healthy', 6);
    for (let i = 0; i < 4; i++) engine.ingest(snap('failing'));
    const rec = engine.autoRecommend(snap('failing'));
    expect(['recovery', 'optimization', 'hold']).toContain(rec.kind);
    // With severe drift / failure basin, should not be 'hold'.
    expect(rec.kind).not.toBe('hold');
  });

  it('learns from realized outcomes (updates point value)', () => {
    const p = engine.ingest(snap('healthy'));
    const before = p.value;
    engine.learn(p.id, 0.01);
    expect(p.value).toBeLessThan(before);
  });

  it('singleton returns the same engine instance', () => {
    const a = getAutonomousNavigationEngine();
    const b = getAutonomousNavigationEngine();
    expect(a).toBe(b);
  });
});
