/**
 * Real-time geometry optimizer.
 *
 *   1. Compute baseline (volume / mass / cost / safety).
 *   2. Run DFM rules in parallel (yielding under time budget).
 *   3. Run physics + cost rules (material swap, hollowing).
 *   4. Filter against constraints, score by impact × confidence.
 *   5. Compute Pareto front of (cost ↓, safety ↑).
 *
 * Designed to complete within ~100ms on meshes up to ~50k triangles.
 */
import type { RawMesh } from '../types';
import type {
  OptimizationContext,
  OptimizationReport,
  OptimizerOptions,
  Suggestion,
} from './types';
import { computeBaseline } from './baseline';
import {
  ruleWallThickness,
  ruleFillets,
  ruleDraftAngle,
  ruleHollowing,
  ruleMaterialSwap,
  ruleFeatureConsolidation,
} from './dfmRules';

function impactScore(s: Suggestion): number {
  const cost = -s.estCostDeltaUsd; // positive = savings
  const safety = Math.max(0, s.estSafetyDelta) * 5;
  return (cost + safety) * s.confidence;
}

function paretoFront(suggestions: Suggestion[]): Suggestion[] {
  return suggestions.filter(a =>
    !suggestions.some(b =>
      b !== a &&
      b.estCostDeltaUsd <= a.estCostDeltaUsd &&
      b.estSafetyDelta >= a.estSafetyDelta &&
      (b.estCostDeltaUsd < a.estCostDeltaUsd || b.estSafetyDelta > a.estSafetyDelta),
    ),
  );
}

export function optimizeGeometry(
  mesh: RawMesh,
  ctx: OptimizationContext,
  opts: OptimizerOptions = {},
): OptimizationReport {
  const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const budget = opts.timeBudgetMs ?? 100;
  const minImpact = opts.minImpactUsd ?? 0;
  const maxOut = opts.maxSuggestions ?? 25;

  const baseline = computeBaseline(mesh, ctx);
  const all: Suggestion[] = [];

  const runners: Array<() => Suggestion[]> = [
    () => ruleWallThickness(mesh, ctx),
    () => ruleFillets(mesh, ctx),
    () => ruleDraftAngle(mesh, ctx),
    () => ruleFeatureConsolidation(mesh, ctx),
    () => ruleHollowing(mesh, ctx, baseline.volumeMm3),
    () => ruleMaterialSwap(mesh, ctx, baseline.estSafetyFactor),
  ];

  for (const run of runners) {
    const elapsed = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
    if (elapsed > budget) break;
    try { all.push(...run()); } catch { /* rule failure is non-fatal */ }
  }

  // Filter against constraints
  const maxCost = ctx.cost?.maxUnitCostUsd ?? Infinity;
  const minFoS = ctx.physics?.minSafetyFactor ?? 0;
  const filtered = all.filter(s => {
    if (Math.abs(s.estCostDeltaUsd) < minImpact && s.estSafetyDelta <= 0) return false;
    if (baseline.estUnitCostUsd + s.estCostDeltaUsd > maxCost) return false;
    if (baseline.estSafetyFactor + s.estSafetyDelta < minFoS) return false;
    return true;
  });

  filtered.sort((a, b) => impactScore(b) - impactScore(a));
  const top = filtered.slice(0, maxOut);
  const front = paretoFront(top);
  const potentialSavingsUsd = top
    .filter(s => s.estCostDeltaUsd < 0)
    .reduce((sum, s) => sum + (-s.estCostDeltaUsd), 0);

  const elapsedMs = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
  return {
    baseline,
    suggestions: top,
    paretoFront: front,
    potentialSavingsUsd,
    elapsedMs,
  };
}
