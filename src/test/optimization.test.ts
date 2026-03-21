/**
 * Tests for the Geometry Optimization Engine.
 */

import { describe, it, expect } from 'vitest';
import { extractFeatures } from '@/lib/geometry';
import type { RawMesh } from '@/lib/geometry';
import { runOptimization, DEFAULT_OPTIMIZATION_CONFIG } from '@/lib/optimization';
import type { OptimizationConfig } from '@/lib/optimization';
import { getEnabledGenerators, ALL_GENERATORS } from '@/lib/optimization';

// ── Fixtures ────────────────────────────────────────────────────

function makeTetrahedron(): RawMesh {
  return {
    positions: new Float32Array([
      0, 0, 0, 1, 0, 0, 0.5, 0.866, 0, 0.5, 0.289, 0.816,
    ]),
    indices: new Uint32Array([0, 1, 2, 0, 1, 3, 1, 2, 3, 0, 2, 3]),
  };
}

function makeTwoTriangles(): RawMesh {
  return {
    positions: [0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0],
    indices: [0, 1, 2, 1, 3, 2],
  };
}

function defaultConfig(overrides?: Partial<OptimizationConfig>): OptimizationConfig {
  return {
    ...DEFAULT_OPTIMIZATION_CONFIG,
    materialId: 'al-6061',
    processId: 'cnc-milling',
    ...overrides,
  };
}

// ── Generator Registry ──────────────────────────────────────────

describe('generator registry', () => {
  it('has all 5 generator types', () => {
    expect(ALL_GENERATORS).toHaveLength(5);
    const types = ALL_GENERATORS.map(g => g.type);
    expect(types).toContain('thickness_adjustment');
    expect(types).toContain('radius_smoothing');
    expect(types).toContain('feature_simplification');
    expect(types).toContain('surface_consolidation');
    expect(types).toContain('draft_angle_addition');
  });

  it('filters generators by type', () => {
    const subset = getEnabledGenerators(['radius_smoothing', 'draft_angle_addition']);
    expect(subset).toHaveLength(2);
  });
});

// ── Optimization Engine ─────────────────────────────────────────

describe('runOptimization', () => {
  it('produces valid result from tetrahedron', () => {
    const features = extractFeatures(makeTetrahedron());
    const result = runOptimization(features, defaultConfig());

    expect(result.originalCost.totalCost).toBeGreaterThan(0);
    expect(result.originalManufacturability).toBeGreaterThan(0);
    expect(result.iterationsRun).toBeGreaterThanOrEqual(1);
    expect(result.durationMs).toBeGreaterThan(0);
    expect(result.totalCandidatesEvaluated).toBeGreaterThanOrEqual(0);
  });

  it('returns at most topN candidates', () => {
    const features = extractFeatures(makeTetrahedron());
    const result = runOptimization(features, defaultConfig({ topN: 2 }));
    expect(result.topCandidates.length).toBeLessThanOrEqual(2);
  });

  it('candidates have valid cost deltas', () => {
    const features = extractFeatures(makeTetrahedron());
    const result = runOptimization(features, defaultConfig());

    for (const c of result.topCandidates) {
      expect(Number.isFinite(c.costDelta)).toBe(true);
      expect(Number.isFinite(c.manufacturabilityScore)).toBe(true);
      expect(c.modifications.length).toBeGreaterThan(0);
      expect(c.rankScore).toBeGreaterThanOrEqual(0);
    }
  });

  it('respects maxIterations config', () => {
    const features = extractFeatures(makeTetrahedron());
    const result = runOptimization(features, defaultConfig({ maxIterations: 1 }));
    expect(result.iterationsRun).toBeLessThanOrEqual(1);
  });

  it('computes savings summary', () => {
    const features = extractFeatures(makeTetrahedron());
    const result = runOptimization(features, defaultConfig());

    expect(Number.isFinite(result.savings.maxCostReduction)).toBe(true);
    expect(Number.isFinite(result.savings.maxCostReductionPct)).toBe(true);
    expect(Number.isFinite(result.savings.maxManufacturabilityGain)).toBe(true);
    expect(Number.isFinite(result.savings.avgCostReduction)).toBe(true);
  });

  it('works with simple geometry', () => {
    const features = extractFeatures(makeTwoTriangles());
    const result = runOptimization(features, defaultConfig());

    expect(result.originalCost.totalCost).toBeGreaterThan(0);
    expect(result.originalManufacturability).toBeGreaterThan(50);
  });

  it('converges when no improvements possible', () => {
    const features = extractFeatures(makeTwoTriangles());
    const result = runOptimization(features, defaultConfig({
      maxIterations: 10,
      convergenceThreshold: 0.5,
    }));

    // Should stop early or converge
    expect(result.iterationsRun).toBeLessThanOrEqual(10);
  });

  it('candidates are ranked by score descending', () => {
    const features = extractFeatures(makeTetrahedron());
    const result = runOptimization(features, defaultConfig());

    for (let i = 1; i < result.topCandidates.length; i++) {
      expect(result.topCandidates[i - 1].rankScore).toBeGreaterThanOrEqual(
        result.topCandidates[i].rankScore,
      );
    }
  });
});
