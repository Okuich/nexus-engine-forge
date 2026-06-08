/**
 * ROI Gating Engine — unified facade enforcing capability priority.
 *
 * Capabilities fire in strict order 1→5. Each tier is gated on:
 *   - the required inputs being present
 *   - prior tiers not having already short-circuited the pipeline
 *   - a minimum estimated ROI uplift threshold
 *
 * The result is a flat, prioritized list of GatedRecommendations
 * suitable for direct rendering or for feeding into agent planners.
 */

import {
  getOperationalStateEngine,
  type OperationalSnapshot,
} from '@/lib/operationalState';
import { evaluateManufacturability } from '@/lib/manufacturability';
import { evaluatePhysicalFeasibility } from '@/lib/physicsConstrained';
import {
  findOptimalPath,
  type OptimizationGoal,
} from '@/lib/optimizationGeometry';
import { getAutonomousNavigationEngine } from '@/lib/autonomousNavigation';
import {
  CAPABILITY_ORDER,
  type CapabilityDescriptor,
  type CapabilityId,
  type GatedRecommendation,
  type RoiGateInputs,
  type RoiGateOptions,
  type RoiGateResult,
} from './types';

const DEFAULTS: Required<RoiGateOptions> = {
  maxPriority: 5,
  shortCircuit: false,
  minRoi: 0.05,
  perTierLimit: 3,
};

function descriptor(id: CapabilityId): CapabilityDescriptor {
  const d = CAPABILITY_ORDER.find((c) => c.id === id);
  if (!d) throw new Error(`Unknown capability ${id}`);
  return d;
}

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return Math.min(1, Math.max(0, x));
}

export class RoiGatingEngine {
  /**
   * Run all enabled capabilities in priority order and return a
   * deduplicated, prioritized list of recommendations.
   */
  evaluate(inputs: RoiGateInputs, options: RoiGateOptions = {}): RoiGateResult {
    const opts = { ...DEFAULTS, ...options };
    const recommendations: GatedRecommendation[] = [];
    const skipped: { capability: CapabilityId; reason: string }[] = [];
    let shortCircuited = false;

    const tryTier = (id: CapabilityId, run: () => GatedRecommendation[] | GatedRecommendation | null) => {
      const d = descriptor(id);
      if (d.priority > opts.maxPriority) {
        skipped.push({ capability: id, reason: `priority>${opts.maxPriority}` });
        return;
      }
      if (shortCircuited) {
        skipped.push({ capability: id, reason: 'short-circuited by higher-ROI tier' });
        return;
      }
      try {
        const out = run();
        if (!out) {
          skipped.push({ capability: id, reason: 'no actionable signal' });
          return;
        }
        const list = Array.isArray(out) ? out : [out];
        const filtered = list.filter((r) => r.roiScore >= opts.minRoi).slice(0, opts.perTierLimit);
        if (filtered.length === 0) {
          skipped.push({ capability: id, reason: `roi<${opts.minRoi}` });
          return;
        }
        recommendations.push(...filtered);
        if (opts.shortCircuit && filtered.some((r) => r.blocksDownstream)) {
          shortCircuited = true;
        }
      } catch (err) {
        skipped.push({ capability: id, reason: (err as Error).message });
      }
    };

    // Priority 1 — Operational State Space
    tryTier('operational-state', () => this.runOperationalState(inputs));
    // Priority 2 — Manufacturability
    tryTier('manufacturability', () => this.runManufacturability(inputs));
    // Priority 3 — Physics-Constrained
    tryTier('physics-constrained', () => this.runPhysics(inputs));
    // Priority 4 — Optimization Geometry
    tryTier('optimization-geometry', () => this.runOptimization(inputs));
    // Priority 5 — Autonomous Navigation (always runs last; the strategic moat)
    tryTier('autonomous-navigation', () => this.runAutonomous(inputs));

    return {
      tenantId: inputs.tenantId,
      generatedAt: new Date().toISOString(),
      recommendations,
      skipped,
      shortCircuited,
    };
  }

  // ─── Tier runners ─────────────────────────────────────────────

  private runOperationalState(inputs: RoiGateInputs): GatedRecommendation | null {
    if (!inputs.current) return null;
    const states = getOperationalStateEngine();
    // Seed history so the corpus has neighbors to compare against.
    for (const h of inputs.history ?? []) states.ingest(h, {});
    const similar = states.findSimilarStates(inputs.current, { k: 5, tenantId: inputs.tenantId });
    if (similar.length === 0) return null;
    const top = similar[0];
    const roiScore = clamp01(top.similarity * 0.7);
    return {
      capability: descriptor('operational-state'),
      title: `Found ${similar.length} operationally similar states`,
      rationale: `Best match similarity ${top.similarity.toFixed(2)} — apply prior interventions to capture quick wins.`,
      roiScore,
      confidence: clamp01(top.similarity),
      payload: {
        kind: 'operational-state',
        similar,
        rationale: 'Historical situations matched in metric space.',
      },
      blocksDownstream: false,
    };
  }

  private runManufacturability(inputs: RoiGateInputs): GatedRecommendation[] {
    const parts = inputs.parts ?? [];
    return parts
      .map((part) => {
        const ev = evaluateManufacturability(part);
        const roiScore = clamp01(ev.feasibility * 0.6 + ev.score / 200);
        return {
          capability: descriptor('manufacturability'),
          title: `${part.name}: ${ev.recommendedProcess} (${Math.round(ev.score)}/100)`,
          rationale: ev.difficulty[0]?.message ?? `Recommended process ${ev.recommendedProcess}.`,
          roiScore,
          confidence: clamp01(ev.feasibility),
          payload: { kind: 'manufacturability', evaluation: ev } as const,
          blocksDownstream: ev.feasibility < 0.3,
        };
      })
      .sort((a, b) => b.roiScore - a.roiScore);
  }

  private runPhysics(inputs: RoiGateInputs): GatedRecommendation[] {
    const snaps = inputs.physics ?? [];
    return snaps
      .map((snap) => {
        const result = evaluatePhysicalFeasibility(snap);
        // Higher ROI when result reveals an avoidable failure (penalty large).
        const roiScore = clamp01(result.penalty * 0.6 + (1 - result.feasibilityScore) * 0.4);
        const blocksDownstream = !result.feasible;
        const headline =
          result.violations[0]?.message ??
          (result.feasible ? 'Physical envelope is safe' : 'Physical envelope violated');
        return {
          capability: descriptor('physics-constrained'),
          title: `${result.verdict.toUpperCase()} — ${headline}`,
          rationale: blocksDownstream
            ? 'Blocking downstream optimization: simulated state violates physical constraints.'
            : `Feasibility ${(result.feasibilityScore * 100).toFixed(0)}%.`,
          roiScore: blocksDownstream ? Math.max(roiScore, 0.6) : roiScore,
          confidence: clamp01(result.feasibilityScore),
          payload: { kind: 'physics-constrained', feasibility: result } as const,
          blocksDownstream,
        };
      })
      .sort((a, b) => b.roiScore - a.roiScore);
  }

  private runOptimization(inputs: RoiGateInputs): GatedRecommendation | null {
    if (!inputs.current || !inputs.target) return null;
    const goal: OptimizationGoal = inputs.goal ?? 'throughput-improvement';
    const path = findOptimalPath(inputs.current, inputs.target, { goal });
    if (!path.reached) return null;
    const steps = Math.max(0, path.nodeIds.length - 1);
    // ROI scales with predicted OEE/throughput gain and inversely with risk.
    const oeeGain = clamp01(path.predictedOutcome.oeeDelta);
    const throughputGain = clamp01(path.predictedOutcome.throughputDelta / 50);
    const riskPenalty = clamp01(path.risk.overall);
    const roiScore = clamp01(0.5 * oeeGain + 0.4 * throughputGain - 0.3 * riskPenalty + 0.1);
    return {
      capability: descriptor('optimization-geometry'),
      title: `${steps}-step trajectory toward ${goal.replace(/-/g, ' ')}`,
      rationale: `Predicted OEE +${(oeeGain * 100).toFixed(0)}%, risk ${path.risk.overall.toFixed(2)}.`,
      roiScore,
      confidence: clamp01(1 - path.risk.overall),
      payload: { kind: 'optimization-geometry', path, goal } as const,
      blocksDownstream: false,
    };
  }

  private runAutonomous(inputs: RoiGateInputs): GatedRecommendation | null {
    if (!inputs.current) return null;
    const nav = getAutonomousNavigationEngine();
    for (const h of inputs.history ?? []) nav.ingest(h);
    const rec = nav.autoRecommend(inputs.current);
    if (rec.kind === 'hold') {
      return {
        capability: descriptor('autonomous-navigation'),
        title: 'Hold course — no higher-value region within reach',
        rationale: rec.rationale,
        roiScore: 0.05,
        confidence: rec.confidence,
        payload: { kind: 'autonomous-navigation', recommendation: rec, target: rec.target } as const,
        blocksDownstream: false,
      };
    }
    const roiScore = clamp01(rec.expectedValueGain * 1.5);
    return {
      capability: descriptor('autonomous-navigation'),
      title:
        rec.kind === 'recovery'
          ? `Autonomous recovery: route to ${rec.target.basin.kind} region`
          : `Autonomous optimization: climb toward ${rec.target.basin.kind} region`,
      rationale: rec.rationale,
      roiScore,
      confidence: rec.confidence,
      payload: { kind: 'autonomous-navigation', recommendation: rec, target: rec.target } as const,
      blocksDownstream: false,
    };
  }
}

// ─── Singleton + functional API ─────────────────────────────

let shared: RoiGatingEngine | null = null;
export function getRoiGatingEngine(): RoiGatingEngine {
  if (!shared) shared = new RoiGatingEngine();
  return shared;
}

export function evaluateRoi(inputs: RoiGateInputs, options?: RoiGateOptions): RoiGateResult {
  return getRoiGatingEngine().evaluate(inputs, options);
}

export { CAPABILITY_ORDER };
export type { OperationalSnapshot };
