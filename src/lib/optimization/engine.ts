/**
 * Geometry Optimization Engine
 *
 * Iterative optimization loop that:
 *   1. Generates candidate modifications from modular generators
 *   2. Applies deltas to create virtual modified feature sets
 *   3. Re-runs cost estimation + rule-based manufacturability scoring
 *   4. Ranks candidates by weighted cost/manufacturability improvement
 *   5. Uses best candidate as input for next iteration
 *   6. Returns top-N results with expected savings
 *
 * Architecture:
 *   GeometryFeatureSet ──→ Generators ──→ Candidates
 *        ↑                                    │
 *        └──── best candidate (next iter) ←───┘
 *
 * Deterministic fallback: pure rule-based scoring, no ML dependency.
 */

import type { GeometryFeatureSet, FaceFeatures, GeometryStats, SurfaceClass } from '@/lib/geometry/types';
import { estimateCost } from '@/lib/ml/costEngine';
import type { CostBreakdown } from '@/lib/ml/costEngine';
import { getEnabledGenerators } from './generators';
import type {
  OptimizationConfig,
  OptimizationResult,
  OptimizationCandidate,
  Modification,
  FeatureDelta,
  SavingsSummary,
  DEFAULT_OPTIMIZATION_CONFIG,
} from './types';

// ─── Virtual Feature Modification ───────────────────────────────

/**
 * Apply a FeatureDelta to a GeometryFeatureSet, producing a new
 * virtual feature set without mutating the original.
 *
 * This is a parametric approximation — actual geometry modification
 * would require a CAD kernel. We adjust the feature vectors that
 * the cost engine and rule engine consume.
 */
function applyDelta(
  features: GeometryFeatureSet,
  modifications: Modification[],
): GeometryFeatureSet {
  // Deep-clone faces and stats
  const newFaces: FaceFeatures[] = features.faces.map(f => ({ ...f, normal: [...f.normal] as [number, number, number], centroid: [...f.centroid] as [number, number, number] }));
  const newStats: GeometryStats = {
    ...features.stats,
    boundingBox: { ...features.stats.boundingBox, min: [...features.stats.boundingBox.min] as [number, number, number], max: [...features.stats.boundingBox.max] as [number, number, number], center: [...features.stats.boundingBox.center] as [number, number, number] },
    curvatureStats: { ...features.stats.curvatureStats },
    surfaceClassDistribution: { ...features.stats.surfaceClassDistribution },
  };

  for (const mod of modifications) {
    const delta = mod.delta;
    const affected = new Set(mod.affectedFaces);

    for (const face of newFaces) {
      if (!affected.has(face.id)) continue;

      // Curvature scaling
      if (delta.curvatureScale !== undefined) {
        face.curvatureMean *= delta.curvatureScale;
        face.curvatureMax *= delta.curvatureScale;
        face.curvatureMin *= delta.curvatureScale;
        face.curvatureGaussian *= delta.curvatureScale * delta.curvatureScale;
      }

      // Area offset
      if (delta.areaOffset !== undefined) {
        face.area = Math.max(0.001, face.area + delta.areaOffset / affected.size);
      }

      // Surface class override
      if (delta.targetSurfaceClass) {
        const oldClass = face.surfaceClass;
        face.surfaceClass = delta.targetSurfaceClass;
        // Update distribution
        newStats.surfaceClassDistribution[oldClass] = Math.max(0, (newStats.surfaceClassDistribution[oldClass] ?? 0) - 1);
        newStats.surfaceClassDistribution[delta.targetSurfaceClass] = (newStats.surfaceClassDistribution[delta.targetSurfaceClass] ?? 0) + 1;
      }
    }

    // Global stat adjustments
    if (delta.complexityScale !== undefined) {
      newStats.complexityScore *= delta.complexityScale;
    }
    if (delta.volumeOffset !== undefined) {
      newStats.volume = Math.max(0.001, newStats.volume + delta.volumeOffset);
    }
    if (delta.freeformDelta !== undefined) {
      newStats.surfaceClassDistribution.freeform = Math.max(
        0,
        (newStats.surfaceClassDistribution.freeform ?? 0) + delta.freeformDelta,
      );
    }
  }

  // Recompute curvature stats from modified faces
  const curvatures = newFaces.map(f => f.curvatureMean);
  const gaussians = newFaces.map(f => f.curvatureGaussian);
  const maxCurvs = newFaces.map(f => Math.abs(f.curvatureMax));

  newStats.curvatureStats.meanMean = curvatures.reduce((s, v) => s + v, 0) / curvatures.length || 0;
  newStats.curvatureStats.meanGaussian = gaussians.reduce((s, v) => s + v, 0) / gaussians.length || 0;
  newStats.curvatureStats.maxAbsCurvature = Math.max(...maxCurvs, 0);

  const mean = newStats.curvatureStats.meanMean;
  newStats.curvatureStats.variance = curvatures.reduce((s, v) => s + (v - mean) ** 2, 0) / curvatures.length || 0;

  // Recompute total area
  newStats.totalArea = newFaces.reduce((s, f) => s + f.area, 0);

  // Recompute complexity score: κ = (σ_curvature / σ_max) × (f_freeform / f_total)
  const freeformCount = newStats.surfaceClassDistribution.freeform ?? 0;
  const freeformRatio = newStats.totalFaces > 0 ? freeformCount / newStats.totalFaces : 0;
  const curvRatio = newStats.curvatureStats.maxAbsCurvature > 0
    ? Math.sqrt(newStats.curvatureStats.variance) / newStats.curvatureStats.maxAbsCurvature
    : 0;
  newStats.complexityScore = Math.max(0, Math.min(1, curvRatio * freeformRatio));

  // Build new node features (12-dim vectors matching extractionEngine format)
  const newNodeFeatures = newFaces.map(f => [
    f.area,
    f.normal[0], f.normal[1], f.normal[2],
    f.centroid[0], f.centroid[1], f.centroid[2],
    f.curvatureMean,
    f.curvatureGaussian,
    f.curvatureMin,
    f.curvatureMax,
    surfaceClassToNum(f.surfaceClass),
  ]);

  return {
    ...features,
    faces: newFaces,
    stats: newStats,
    nodeFeatures: newNodeFeatures,
  };
}

function surfaceClassToNum(sc: SurfaceClass): number {
  const map: Record<SurfaceClass, number> = {
    planar: 0, cylindrical: 1, spherical: 2, conical: 3, toroidal: 4, freeform: 5,
  };
  return map[sc] ?? 5;
}

// ─── Deterministic Manufacturability Scorer ─────────────────────

/**
 * Lightweight rule-based manufacturability scorer.
 * Mirrors the rule engine in inferenceEngine.ts but operates
 * purely on GeometryStats for speed.
 */
function scoreManufacturability(stats: GeometryStats): number {
  let score = 92;

  // Complexity penalty
  score -= stats.complexityScore * 25;

  // Surface class penalties
  const dist = stats.surfaceClassDistribution;
  const total = stats.totalFaces || 1;
  const freeformRatio = (dist.freeform ?? 0) / total;
  const toroidalRatio = (dist.toroidal ?? 0) / total;

  if (freeformRatio > 0.2) score -= freeformRatio * 15;
  if (toroidalRatio > 0.1) score -= toroidalRatio * 8;

  const planarRatio = (dist.planar ?? 0) / total;
  if (planarRatio > 0.6) score += planarRatio * 5;

  // Curvature penalties
  if (stats.curvatureStats.maxAbsCurvature > 0.25) {
    score -= Math.min(15, stats.curvatureStats.maxAbsCurvature * 10);
  }

  if (stats.curvatureStats.variance > 0.01) {
    score -= Math.min(10, stats.curvatureStats.variance * 200);
  }

  // Connected components penalty
  if (stats.connectedComponents > 1) {
    score -= stats.connectedComponents * 3;
  }

  // Volume/area ratio (thin-wall detection)
  if (stats.volume > 0 && stats.totalArea > 0) {
    const vaRatio = stats.volume / stats.totalArea;
    if (vaRatio < 0.05) score -= 5;
  }

  return Math.max(10, Math.min(98, score));
}

// ─── Ranking ────────────────────────────────────────────────────

function rankCandidate(
  candidate: { costDelta: number; manufacturabilityDelta: number },
  originalCost: number,
  config: Pick<OptimizationConfig, 'costWeight' | 'manufacturabilityWeight'>,
): number {
  // Normalize cost delta to 0–1 range (positive = saving)
  const costScore = originalCost > 0
    ? Math.max(0, -candidate.costDelta / originalCost)
    : 0;

  // Normalize manufacturability delta to 0–1 range (positive = improvement)
  const mfgScore = Math.max(0, candidate.manufacturabilityDelta / 100);

  return costScore * config.costWeight + mfgScore * config.manufacturabilityWeight;
}

// ─── Main Engine ────────────────────────────────────────────────

/**
 * Run iterative geometry optimization.
 *
 * @param features - Extracted geometry features (from extractFeatures)
 * @param config   - Optimization configuration
 * @returns Ranked optimization candidates with savings summary
 */
export function runOptimization(
  features: GeometryFeatureSet,
  config: OptimizationConfig,
): OptimizationResult {
  const start = performance.now();

  // ── Baseline assessment ───────────────────────────
  const originalCost = estimateCost(features, {
    materialId: config.materialId,
    processId: config.processId,
  });
  const originalMfg = scoreManufacturability(features.stats);

  const generators = getEnabledGenerators(config.enabledGenerators);
  const allCandidates: OptimizationCandidate[] = [];
  let currentBest = features;
  let converged = false;
  let iterationsRun = 0;

  // ── Iterative optimization loop ───────────────────
  for (let iter = 0; iter < config.maxIterations; iter++) {
    iterationsRun = iter + 1;

    // Generate modifications from all enabled generators
    const allMods: Modification[] = [];
    for (const gen of generators) {
      const mods = gen.generate(currentBest, currentBest.stats, iter);
      allMods.push(...mods);
    }

    if (allMods.length === 0) {
      converged = true;
      break;
    }

    // Create candidates: each modification individually + combined
    const iterCandidates: OptimizationCandidate[] = [];

    // Individual modifications
    for (const mod of allMods.slice(0, config.maxCandidatesPerIteration - 1)) {
      const modified = applyDelta(currentBest, [mod]);
      const cost = estimateCost(modified, {
        materialId: config.materialId,
        processId: config.processId,
      });
      const mfgScore = scoreManufacturability(modified.stats);

      const candidate: OptimizationCandidate = {
        id: `cand-${iter}-${iterCandidates.length}`,
        modifications: [mod],
        modifiedFeatures: modified,
        costBreakdown: cost,
        manufacturabilityScore: mfgScore,
        costDelta: cost.totalCost - originalCost.totalCost,
        manufacturabilityDelta: mfgScore - originalMfg,
        rankScore: 0,
        iteration: iter,
      };
      candidate.rankScore = rankCandidate(candidate, originalCost.totalCost, config);
      iterCandidates.push(candidate);
    }

    // Combined candidate: apply all modifications together
    if (allMods.length > 1) {
      const modified = applyDelta(currentBest, allMods);
      const cost = estimateCost(modified, {
        materialId: config.materialId,
        processId: config.processId,
      });
      const mfgScore = scoreManufacturability(modified.stats);

      const combined: OptimizationCandidate = {
        id: `cand-${iter}-combined`,
        modifications: allMods,
        modifiedFeatures: modified,
        costBreakdown: cost,
        manufacturabilityScore: mfgScore,
        costDelta: cost.totalCost - originalCost.totalCost,
        manufacturabilityDelta: mfgScore - originalMfg,
        rankScore: 0,
        iteration: iter,
      };
      combined.rankScore = rankCandidate(combined, originalCost.totalCost, config);
      iterCandidates.push(combined);
    }

    allCandidates.push(...iterCandidates);

    // Select best candidate for next iteration
    const sorted = [...iterCandidates].sort((a, b) => b.rankScore - a.rankScore);
    const bestThisIter = sorted[0];

    if (!bestThisIter || bestThisIter.rankScore < config.convergenceThreshold) {
      converged = true;
      break;
    }

    currentBest = bestThisIter.modifiedFeatures;
  }

  // ── Rank all candidates globally and return top N ──
  allCandidates.sort((a, b) => b.rankScore - a.rankScore);
  const topCandidates = allCandidates.slice(0, config.topN);

  // ── Savings summary ───────────────────────────────
  const savings = computeSavings(topCandidates, originalCost.totalCost, originalMfg);

  return {
    originalCost,
    originalManufacturability: originalMfg,
    topCandidates,
    totalCandidatesEvaluated: allCandidates.length,
    iterationsRun,
    converged,
    durationMs: +(performance.now() - start).toFixed(1),
    savings,
  };
}

function computeSavings(
  candidates: OptimizationCandidate[],
  originalCost: number,
  originalMfg: number,
): SavingsSummary {
  if (candidates.length === 0) {
    return {
      maxCostReduction: 0,
      maxCostReductionPct: 0,
      maxManufacturabilityGain: 0,
      avgCostReduction: 0,
      avgManufacturabilityGain: 0,
    };
  }

  const costDeltas = candidates.map(c => -c.costDelta);
  const mfgDeltas = candidates.map(c => c.manufacturabilityDelta);

  const maxCostReduction = Math.max(...costDeltas, 0);

  return {
    maxCostReduction: +maxCostReduction.toFixed(2),
    maxCostReductionPct: originalCost > 0
      ? +((maxCostReduction / originalCost) * 100).toFixed(1)
      : 0,
    maxManufacturabilityGain: +Math.max(...mfgDeltas, 0).toFixed(1),
    avgCostReduction: +(costDeltas.reduce((s, v) => s + v, 0) / costDeltas.length).toFixed(2),
    avgManufacturabilityGain: +(mfgDeltas.reduce((s, v) => s + v, 0) / mfgDeltas.length).toFixed(1),
  };
}
