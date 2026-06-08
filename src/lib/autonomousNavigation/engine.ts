/**
 * Autonomous Operational Navigation — Engine
 *
 * Continuously navigates a tenant's operations toward higher-value
 * regions of the global state manifold. Tracks trajectories, detects
 * drift, materializes basins, and emits multi-step recovery /
 * optimization trajectories using the Optimization Geometry engine.
 *
 * Public API:
 *   - ingest(snapshot)               → ManifoldPoint
 *   - trajectory(tenantId)           → OperationalTrajectory
 *   - detectDrift(tenantId)          → DriftReport
 *   - nearestStableRegion(snapshot)  → RegionHit | null
 *   - nearestOptimalRegion(snapshot) → RegionHit | null
 *   - recoveryTrajectory(snapshot)   → NavigationRecommendation | null
 *   - optimizationTrajectory(snap)   → NavigationRecommendation | null
 *   - autoRecommend(snapshot)        → NavigationRecommendation
 *   - learn(pointId, outcome)        → void
 *   - updateMetrics()                → void  (re-fits normalizer + basins)
 */

import {
  euclideanDistance,
  OperationalStateEngine,
  type OperationalSnapshot,
} from '@/lib/operationalState';
import {
  OptimizationGeometryEngine,
  type OptimizationGoal,
} from '@/lib/optimizationGeometry';
import { discoverBasins } from './basins';
import { detectDrift } from './drift';
import { computeValue, derivePerformance } from './value';
import {
  DEFAULT_MANIFOLD_CONFIG,
  type Basin,
  type DriftReport,
  type IntegrationHooks,
  type ManifoldConfig,
  type ManifoldPoint,
  type NavigationRecommendation,
  type OperationalTrajectory,
  type RegionHit,
} from './types';

export interface EngineOptions {
  config?: Partial<ManifoldConfig>;
  hooks?: IntegrationHooks;
}

export class AutonomousNavigationEngine {
  private readonly states = new OperationalStateEngine();
  private readonly optimizer = new OptimizationGeometryEngine();
  private readonly points = new Map<string, ManifoldPoint>();
  private readonly byTenant = new Map<string, ManifoldPoint[]>();
  private basins: Basin[] = [];
  private basinsDirty = true;
  private readonly config: ManifoldConfig;
  private readonly hooks: IntegrationHooks;
  /** EMA-tracked mean value, used as an adaptive baseline. */
  private valueEma = 0.5;

  constructor(options: EngineOptions = {}) {
    this.config = { ...DEFAULT_MANIFOLD_CONFIG, ...(options.config ?? {}) };
    this.hooks = options.hooks ?? {};
  }

  size(): number {
    return this.points.size;
  }

  reset(): void {
    this.points.clear();
    this.byTenant.clear();
    this.basins = [];
    this.basinsDirty = true;
    this.states.reset();
    this.optimizer.reset();
    this.valueEma = 0.5;
  }

  // ─── Ingestion ─────────────────────────────────────────────────

  ingest(snapshot: OperationalSnapshot): ManifoldPoint {
    const vector = this.states.embed(snapshot);
    const performance = derivePerformance(snapshot);
    const value = computeValue(snapshot, performance, this.hooks);

    const point: ManifoldPoint = {
      id: vector.id,
      tenantId: snapshot.tenantId,
      snapshotAt: snapshot.snapshotAt,
      vector,
      snapshot,
      performance,
      value,
      basin: 'stable',
    };
    this.points.set(point.id, point);

    const list = this.byTenant.get(snapshot.tenantId) ?? [];
    list.push(point);
    this.byTenant.set(snapshot.tenantId, list);

    // Also register with the optimizer so trajectories can route through it.
    this.optimizer.registerState(snapshot, point.id);

    // EMA update for value baseline + mark basins dirty.
    this.valueEma = (1 - this.config.metricEma) * this.valueEma + this.config.metricEma * value;
    this.basinsDirty = true;
    return point;
  }

  // ─── Trajectory ────────────────────────────────────────────────

  trajectory(tenantId: string, window = 50): OperationalTrajectory {
    const all = this.byTenant.get(tenantId) ?? [];
    const slice = all.slice(-window);
    const trajPoints = slice.map((p) => ({
      pointId: p.id,
      snapshotAt: p.snapshotAt,
      value: p.value,
      basin: p.basin,
    }));
    let velocity = 0;
    let hours = 0;
    for (let i = 1; i < slice.length; i++) {
      const a = slice[i - 1];
      const b = slice[i];
      const dt =
        (new Date(b.snapshotAt).getTime() - new Date(a.snapshotAt).getTime()) /
        3_600_000;
      if (dt > 0) {
        velocity += euclideanDistance(a.vector.vector, b.vector.vector) / dt;
        hours += 1;
      }
    }
    const meanVelocity = hours > 0 ? velocity / hours : 0;
    const valueDelta = slice.length > 1 ? slice[slice.length - 1].value - slice[0].value : 0;
    return { tenantId, points: trajPoints, velocity: meanVelocity, valueDelta };
  }

  // ─── Drift ─────────────────────────────────────────────────────

  detectDrift(tenantId: string): DriftReport {
    this.ensureBasins();
    const all = this.byTenant.get(tenantId) ?? [];
    if (all.length < 2) {
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
    const current = all[all.length - 1];
    const baseline = all.slice(
      Math.max(0, all.length - 1 - this.config.baselineWindow),
      all.length - 1,
    );
    return detectDrift(baseline, current, this.basins, this.config);
  }

  // ─── Basin discovery / metric updates ─────────────────────────

  /**
   * Re-fit the manifold: re-cluster basins from the current corpus and
   * recompute EMA value statistics. Cheap enough to call on a timer.
   */
  updateMetrics(): void {
    this.basins = discoverBasins(Array.from(this.points.values()), this.config);
    this.basinsDirty = false;
    // Recompute EMA from scratch over the corpus when re-fitting.
    const all = Array.from(this.points.values());
    if (all.length > 0) {
      const mean = all.reduce((s, p) => s + p.value, 0) / all.length;
      this.valueEma = mean;
    }
  }

  basinsSnapshot(): Basin[] {
    this.ensureBasins();
    return this.basins.slice();
  }

  private ensureBasins(): void {
    if (this.basinsDirty) this.updateMetrics();
  }

  // ─── Region queries ───────────────────────────────────────────

  nearestStableRegion(snapshot: OperationalSnapshot): RegionHit | null {
    return this.nearestRegionOfKind(snapshot, 'stable');
  }

  nearestOptimalRegion(snapshot: OperationalSnapshot): RegionHit | null {
    return this.nearestRegionOfKind(snapshot, 'optimal');
  }

  private nearestRegionOfKind(
    snapshot: OperationalSnapshot,
    kind: Basin['kind'],
  ): RegionHit | null {
    this.ensureBasins();
    const probe = this.states.embed(snapshot).vector;
    const candidates = this.basins.filter((b) => b.kind === kind);
    if (candidates.length === 0) return null;

    let best: RegionHit | null = null;
    for (const basin of candidates) {
      const dist = euclideanDistance(probe, basin.centroid);
      const anchor = this.closestMember(basin, probe);
      if (!anchor) continue;
      if (!best || dist < best.distance) {
        best = { basin, distance: dist, anchor };
      }
    }
    return best;
  }

  private closestMember(basin: Basin, probe: Float32Array): ManifoldPoint | null {
    let best: ManifoldPoint | null = null;
    let bestDist = Infinity;
    for (const id of basin.members) {
      const p = this.points.get(id);
      if (!p) continue;
      const d = euclideanDistance(probe, p.vector.vector);
      if (d < bestDist) {
        best = p;
        bestDist = d;
      }
    }
    return best;
  }

  // ─── Trajectory generation ────────────────────────────────────

  recoveryTrajectory(snapshot: OperationalSnapshot): NavigationRecommendation | null {
    const stable = this.nearestStableRegion(snapshot);
    if (!stable) return null;
    const goal: OptimizationGoal = 'downtime-reduction';
    const path = this.optimizer.findOptimalPath(snapshot, stable.anchor.snapshot, { goal });
    const drift = this.detectDrift(snapshot.tenantId);
    const expectedValueGain = Math.max(0, stable.basin.meanValue - this.valueAt(snapshot));
    return {
      kind: 'recovery',
      rationale: `Drift detected (${drift.severity}); routing to nearest stable region ${stable.basin.id}.`,
      expectedValueGain,
      goal,
      trajectory: path,
      target: stable,
      confidence: this.confidenceFor(stable),
      drift,
    };
  }

  optimizationTrajectory(
    snapshot: OperationalSnapshot,
    goal: OptimizationGoal = 'throughput-improvement',
  ): NavigationRecommendation | null {
    const optimal = this.nearestOptimalRegion(snapshot);
    if (!optimal) return null;
    const path = this.optimizer.findOptimalPath(snapshot, optimal.anchor.snapshot, { goal });
    const expectedValueGain = Math.max(0, optimal.basin.meanValue - this.valueAt(snapshot));
    return {
      kind: 'optimization',
      rationale: `Climbing value gradient toward optimal basin ${optimal.basin.id}.`,
      expectedValueGain,
      goal,
      trajectory: path,
      target: optimal,
      confidence: this.confidenceFor(optimal),
      drift: null,
    };
  }

  /**
   * Strategic moat: autonomously chooses between holding, recovering,
   * and optimizing based on drift severity, basin proximity, and
   * expected value uplift. Returns a recommendation even when the
   * facility is healthy — falling back to 'hold' when no meaningful
   * improvement is available.
   */
  autoRecommend(snapshot: OperationalSnapshot): NavigationRecommendation {
    const drift = this.detectDrift(snapshot.tenantId);
    // If we're drifting hard or sitting in a failure basin, recover first.
    if (drift.severity === 'severe' || drift.toBasin === 'failure') {
      const rec = this.recoveryTrajectory(snapshot);
      if (rec) return rec;
    }
    // Otherwise look for value uplift.
    const opt = this.optimizationTrajectory(snapshot);
    if (opt && opt.expectedValueGain > 0.02) return opt;
    // Hold position.
    return {
      kind: 'hold',
      rationale: 'No higher-value region within reach; recommend holding course.',
      expectedValueGain: 0,
      goal: 'throughput-improvement',
      trajectory: {
        nodeIds: [],
        actions: [],
        totalCost: { time: 0, energy: 0, waste: 0, downtime: 0, risk: 0, total: 0 },
        predictedOutcome: {
          valueDelta: 0,
          throughputChange: 0,
          scrapChange: 0,
          energyChange: 0,
        },
        risk: { score: 0, level: 'low', drivers: [] },
        exploredNodes: 0,
        reached: true,
      },
      target: this.nearestOptimalRegion(snapshot) ??
        this.nearestStableRegion(snapshot) ?? {
          basin: {
            id: 'none',
            kind: 'stable',
            centroid: new Float32Array(0),
            meanValue: 0,
            radius: 0,
            members: [],
          },
          distance: 0,
          anchor: this.fallbackAnchor(snapshot),
        },
      confidence: 0.5,
      drift,
    };
  }

  // ─── Learning ──────────────────────────────────────────────────

  /**
   * Update a stored point's value from realized outcome. Subsequent
   * basin re-fits use the updated values, letting the engine learn
   * which regions actually pay off.
   */
  learn(pointId: string, realizedValue: number): void {
    const p = this.points.get(pointId);
    if (!p) return;
    p.value = (1 - this.config.metricEma) * p.value + this.config.metricEma * realizedValue;
    this.basinsDirty = true;
  }

  // ─── Internal helpers ─────────────────────────────────────────

  private valueAt(snapshot: OperationalSnapshot): number {
    const perf = derivePerformance(snapshot);
    return computeValue(snapshot, perf, this.hooks);
  }

  private confidenceFor(hit: RegionHit): number {
    const corpusFactor = Math.min(1, this.points.size / 50);
    const proximity = Math.max(0, 1 - hit.distance);
    const tightness = Math.max(0, 1 - hit.basin.radius);
    return Math.min(1, 0.35 * corpusFactor + 0.35 * proximity + 0.3 * tightness);
  }

  private fallbackAnchor(snapshot: OperationalSnapshot): ManifoldPoint {
    const vector = this.states.embed(snapshot);
    const performance = derivePerformance(snapshot);
    return {
      id: vector.id,
      tenantId: snapshot.tenantId,
      snapshotAt: snapshot.snapshotAt,
      vector,
      snapshot,
      performance,
      value: computeValue(snapshot, performance, this.hooks),
      basin: 'stable',
    };
  }
}

// ─── Shared singleton ────────────────────────────────────────────

let shared: AutonomousNavigationEngine | null = null;

export function getAutonomousNavigationEngine(): AutonomousNavigationEngine {
  if (!shared) shared = new AutonomousNavigationEngine();
  return shared;
}

// Convenience top-level wrappers mirroring the requested API surface.
export function nearestStableRegion(snapshot: OperationalSnapshot) {
  return getAutonomousNavigationEngine().nearestStableRegion(snapshot);
}
export function nearestOptimalRegion(snapshot: OperationalSnapshot) {
  return getAutonomousNavigationEngine().nearestOptimalRegion(snapshot);
}
export function recoveryTrajectory(snapshot: OperationalSnapshot) {
  return getAutonomousNavigationEngine().recoveryTrajectory(snapshot);
}
export function optimizationTrajectory(snapshot: OperationalSnapshot, goal?: OptimizationGoal) {
  return getAutonomousNavigationEngine().optimizationTrajectory(snapshot, goal);
}
