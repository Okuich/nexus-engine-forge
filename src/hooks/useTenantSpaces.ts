/**
 * Tenant Spaces Hook
 *
 * Produces the data feeding the four metric spaces for the currently
 * active tenant. Operational snapshots, CAD parts, and physics
 * samples are deterministically seeded from the active tenantId so
 * each tenant sees a stable but distinct manifold, and we read live
 * RFQ counts from the database to anchor the latest snapshot in real
 * tenant activity.
 */

import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import type { OperationalSnapshot } from '@/lib/operationalState';
import type { CadModel } from '@/lib/manufacturability';
import type { PhysicsSnapshot } from '@/lib/physicsConstrained';

// ─── Deterministic PRNG ───────────────────────────────────────

function hashSeed(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ─── Live tenant signals ──────────────────────────────────────

interface LiveSignals {
  openRfqCount: number;
  awardedCount: number;
  totalValueUsd: number;
}

async function fetchLiveSignals(tenantId: string): Promise<LiveSignals> {
  const { data } = await supabase
    .from('rfqs')
    .select('status, estimated_value')
    .eq('tenant_id', tenantId)
    .limit(500);
  const rows = data ?? [];
  let open = 0;
  let awarded = 0;
  let total = 0;
  for (const r of rows) {
    const status = (r as { status?: string }).status ?? '';
    const val = Number((r as { estimated_value?: number }).estimated_value ?? 0);
    total += val;
    if (status === 'awarded' || status === 'closed') awarded += 1;
    else open += 1;
  }
  return { openRfqCount: open, awardedCount: awarded, totalValueUsd: total };
}

// ─── Snapshot generation ──────────────────────────────────────

interface BuildOptions {
  tenantId: string;
  count: number;
  live: LiveSignals;
}

function buildHistory({ tenantId, count, live }: BuildOptions): OperationalSnapshot[] {
  const rng = mulberry32(hashSeed(tenantId));
  // Phase profile: simulates a recovery curve — start under stress, climb to optimal.
  const phases: ('failing' | 'healthy' | 'optimal')[] = [];
  for (let i = 0; i < count; i++) {
    const t = i / Math.max(1, count - 1);
    phases.push(t < 0.3 ? 'failing' : t < 0.7 ? 'healthy' : 'optimal');
  }
  const baseTime = Date.now() - count * 3600_000;
  const openWeight = Math.min(1, live.openRfqCount / 50);
  return phases.map((phase, i) => snapshotFor(tenantId, phase, baseTime + i * 3600_000, rng, openWeight));
}

function snapshotFor(
  tenantId: string,
  phase: 'failing' | 'healthy' | 'optimal',
  ts: number,
  rng: () => number,
  openWeight: number,
): OperationalSnapshot {
  const jitter = (m: number) => m * (0.9 + rng() * 0.2);
  const pendingBase = phase === 'failing' ? 50 : phase === 'healthy' ? 20 : 10;
  const oee = phase === 'failing' ? 0.25 : phase === 'healthy' ? 0.7 : 0.9;
  const scrap = phase === 'failing' ? 0.2 : phase === 'healthy' ? 0.03 : 0.005;
  const status = phase === 'failing' ? 3 : 1;
  return {
    tenantId,
    snapshotAt: new Date(ts).toISOString(),
    machines: [
      { machineId: 'm1', status: status as 0 | 1 | 2 | 3, utilization: jitter(oee), load: jitter(oee * 0.9), temperature: jitter(0.5) },
      { machineId: 'm2', status: status as 0 | 1 | 2 | 3, utilization: jitter(oee), load: jitter(oee * 0.85), temperature: jitter(0.55) },
      { machineId: 'm3', status: 1, utilization: jitter(oee * 0.9), load: jitter(oee * 0.7), temperature: jitter(0.45) },
    ],
    queue: {
      pending: Math.round(jitter(pendingBase + openWeight * 20)),
      inProgress: Math.round(jitter(4)),
      avgQueueAgeHrs: jitter(phase === 'failing' ? 14 : 5),
      rushCount: Math.round(jitter(phase === 'failing' ? 5 : 1)),
    },
    inventory: {
      stockoutCount: Math.round(jitter(phase === 'failing' ? 6 : 1)),
      inventoryHealth: jitter(phase === 'failing' ? 0.4 : 0.85),
      daysOfCover: jitter(phase === 'failing' ? 3 : 12),
    },
    tools: {
      activeTools: Math.round(jitter(18)),
      avgWear: jitter(phase === 'failing' ? 0.7 : 0.3),
      toolsNeedingChange: Math.round(jitter(phase === 'failing' ? 6 : 1)),
    },
    throughput: {
      partsPerHour: jitter(phase === 'failing' ? 15 : phase === 'healthy' ? 60 : 110),
      cycleEfficiency: jitter(oee),
      oee: jitter(oee),
    },
    downtime: {
      unplannedHrs24: jitter(phase === 'failing' ? 12 : 1),
      plannedHrs24: jitter(2),
      mtbfHrs: jitter(phase === 'failing' ? 20 : 250),
    },
    energy: {
      kwhLastHour: jitter(phase === 'failing' ? 500 : 280),
      kwhPerPart: jitter(phase === 'failing' ? 12 : 3),
      peakRatio: jitter(phase === 'failing' ? 0.7 : 0.35),
    },
    backlog: {
      openOrders: Math.round(jitter(60 + openWeight * 40)),
      backlogValueUsd: jitter(250_000),
      overdueCount: Math.round(jitter(phase === 'failing' ? 30 : 2)),
    },
    quality: {
      scrapRate: scrap * (0.9 + rng() * 0.2),
      firstPassYield: 1 - scrap * 2,
      openNcrs: Math.round(jitter(phase === 'failing' ? 12 : 1)),
    },
    demand: {
      rfqRate: jitter(8 + openWeight * 4),
      conversionRate: jitter(0.32),
      forecastIndex: jitter(1),
    },
  };
}

function buildParts(tenantId: string): CadModel[] {
  const rng = mulberry32(hashSeed(`${tenantId}:parts`));
  const families: CadModel['material']['family'][] = ['aluminum', 'steel', 'plastic', 'titanium', 'stainless'];
  return Array.from({ length: 4 }).map((_, i) => {
    const jitter = (m: number) => m * (0.8 + rng() * 0.4);
    return {
      id: `${tenantId}-part-${i}`,
      name: ['Bracket', 'Housing', 'Manifold', 'Plate'][i] ?? `Part ${i}`,
      volumeMm3: jitter(120_000),
      features: {
        holes: Math.round(jitter(8)),
        pockets: Math.round(jitter(4)),
        bosses: Math.round(jitter(2)),
        ribs: Math.round(jitter(3)),
        fillets: Math.round(jitter(6)),
        chamfers: Math.round(jitter(4)),
        threads: Math.round(jitter(3)),
        undercuts: Math.round(jitter(i)),
      },
      tolerances: {
        tightestTolMm: jitter(0.05),
        precisionFeatureCount: Math.round(jitter(2)),
        bestSurfaceRaUm: jitter(0.8),
        gdtCount: Math.round(jitter(4)),
      },
      surface: {
        surfaceAreaMm2: jitter(25_000),
        freeformFaceCount: Math.round(jitter(i + 1)),
        planarFaceCount: Math.round(jitter(20)),
        meanCurvature: jitter(0.4),
      },
      wall: {
        minThicknessMm: jitter(1.5),
        meanThicknessMm: jitter(3),
        thicknessStdMm: jitter(0.5),
      },
      material: {
        family: families[i % families.length],
        machinability: jitter(0.7),
        hardness: jitter(0.4),
        costPerKgUsd: jitter(8),
      },
      tooling: {
        threeAxisCoverage: jitter(0.8),
        requiredToolLengthMm: jitter(40),
        setupCount: Math.round(jitter(2)),
      },
      assembly: {
        partCount: Math.round(jitter(1)),
        fastenerCount: Math.round(jitter(4)),
        interfaceCount: Math.round(jitter(3)),
        stackupCount: Math.round(jitter(2)),
      },
      topology: {
        euler: 2,
        genus: Math.round(jitter(0)),
        componentCount: 1,
        featureClassCount: Math.round(jitter(6)),
      },
    } as CadModel;
  });
}

function buildPhysics(tenantId: string): PhysicsSnapshot[] {
  const rng = mulberry32(hashSeed(`${tenantId}:physics`));
  return Array.from({ length: 3 }).map((_, i) => {
    const stressLevel = i === 0 ? 0.4 : i === 1 ? 0.85 : 1.1;
    return {
      id: `${tenantId}-phys-${i}`,
      material: {
        family: 'steel',
        yieldMPa: 250,
        utsMPa: 400,
        enduranceMPa: 200,
        maxServiceK: 450,
        youngsGPa: 210,
      },
      stress: {
        vonMisesMPa: 250 * stressLevel * (0.9 + rng() * 0.2),
        principalMPa: 280 * stressLevel,
      },
      strain: { equivalent: 0.002 * stressLevel, plastic: stressLevel > 1 ? 0.002 : 0 },
      thermal: {
        peakK: 380 * (0.9 + rng() * 0.2),
        meanK: 320,
        gradientKperMm: 2 * stressLevel,
      },
      vibration: {
        forcingHz: 90,
        firstNaturalHz: 100,
        dampingRatio: 0.03,
      },
      flow: {
        reynolds: 5e5,
        pressureDropPa: 8e4 * stressLevel,
        peakVelocity: 12,
        separation: stressLevel > 1,
      },
      fatigue: {
        amplitudeMPa: 80 * stressLevel,
        meanMPa: 100,
        cyclesToFailure: stressLevel > 1 ? 5e4 : 5e6,
        requiredLifeCycles: 1e6,
      },
    } satisfies PhysicsSnapshot;
  });
}

// ─── Hook ─────────────────────────────────────────────────────

export interface TenantSpacesData {
  tenantId: string | null;
  loading: boolean;
  history: OperationalSnapshot[];
  current: OperationalSnapshot | null;
  target: OperationalSnapshot | null;
  parts: CadModel[];
  physics: PhysicsSnapshot[];
  live: LiveSignals;
}

export function useTenantSpaces(historyCount = 24): TenantSpacesData {
  const { activeTenantId } = useAuth();
  const [live, setLive] = useState<LiveSignals>({ openRfqCount: 0, awardedCount: 0, totalValueUsd: 0 });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!activeTenantId) return;
    let cancelled = false;
    setLoading(true);
    fetchLiveSignals(activeTenantId)
      .then((s) => {
        if (!cancelled) setLive(s);
      })
      .catch(() => {
        /* fall back to defaults */
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeTenantId]);

  return useMemo<TenantSpacesData>(() => {
    if (!activeTenantId) {
      return { tenantId: null, loading, history: [], current: null, target: null, parts: [], physics: [], live };
    }
    const history = buildHistory({ tenantId: activeTenantId, count: historyCount, live });
    const current = history[history.length - 1] ?? null;
    const target = history.length > 0 ? { ...history[history.length - 1] } : null;
    if (target) {
      // Define an aspirational target: keep tenant identity, push throughput + quality.
      target.snapshotAt = new Date(Date.now() + 24 * 3600_000).toISOString();
      target.throughput = { partsPerHour: 130, cycleEfficiency: 0.95, oee: 0.93 };
      target.quality = { scrapRate: 0.005, firstPassYield: 0.99, openNcrs: 0 };
      target.downtime = { unplannedHrs24: 0.2, plannedHrs24: 1, mtbfHrs: 500 };
      target.energy = { kwhLastHour: 220, kwhPerPart: 2.4, peakRatio: 0.3 };
    }
    return {
      tenantId: activeTenantId,
      loading,
      history,
      current,
      target,
      parts: buildParts(activeTenantId),
      physics: buildPhysics(activeTenantId),
      live,
    };
  }, [activeTenantId, historyCount, live, loading]);
}
