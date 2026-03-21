/**
 * Tests for the Midwater Cost Labeling Engine.
 */

import { describe, it, expect } from 'vitest';
import {
  estimateCost,
  computeCorrectionFactors,
  selectCorrectionFactor,
  MATERIALS,
  PROCESSES,
} from '@/lib/ml/costEngine';
import type { CostFeedback } from '@/lib/ml/costEngine';
import { extractFeatures } from '@/lib/geometry';
import type { RawMesh } from '@/lib/geometry';

function makeTetrahedron(): RawMesh {
  return {
    positions: new Float32Array([
      0, 0, 0, 1, 0, 0, 0.5, 0.866, 0, 0.5, 0.289, 0.816,
    ]),
    indices: new Uint32Array([0, 1, 2, 0, 1, 3, 1, 2, 3, 0, 2, 3]),
  };
}

describe('costEngine', () => {
  const features = extractFeatures(makeTetrahedron());

  it('produces a valid cost breakdown', () => {
    const result = estimateCost(features, {
      materialId: 'al-6061',
      processId: 'cnc-milling',
    });

    expect(result.totalCost).toBeGreaterThan(0);
    expect(result.lineItems.length).toBeGreaterThan(0);
    expect(result.confidence).toBeGreaterThan(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
    expect(result.correctionFactor).toBe(1.0);
    expect(result.subtotals.setup).toBe(PROCESSES['cnc-milling'].setupCost);
  });

  it('increases cost for exotic materials', () => {
    const al = estimateCost(features, { materialId: 'al-6061', processId: 'cnc-milling' });
    const ti = estimateCost(features, { materialId: 'ti-6al4v', processId: 'cnc-milling' });

    expect(ti.totalCost).toBeGreaterThan(al.totalCost);
  });

  it('applies correction factor', () => {
    const base = estimateCost(features, { materialId: 'al-6061', processId: 'cnc-milling' });
    const corrected = estimateCost(features, {
      materialId: 'al-6061',
      processId: 'cnc-milling',
      correctionFactor: 1.2,
    });

    expect(corrected.totalCost).toBeCloseTo(base.rawTotal * 1.2, 1);
  });

  it('amortizes setup cost across quantity', () => {
    const single = estimateCost(features, { materialId: 'al-6061', processId: 'cnc-milling', quantity: 1 });
    const batch = estimateCost(features, { materialId: 'al-6061', processId: 'cnc-milling', quantity: 10 });

    expect(batch.subtotals.setup).toBeCloseTo(single.subtotals.setup / 10, 1);
  });

  it('throws on unknown material', () => {
    expect(() => estimateCost(features, { materialId: 'unobtanium', processId: 'cnc-milling' }))
      .toThrow('Unknown material');
  });

  it('throws on unknown process', () => {
    expect(() => estimateCost(features, { materialId: 'al-6061', processId: 'laser-beam' }))
      .toThrow('Unknown process');
  });

  it('includes all expected categories', () => {
    const result = estimateCost(features, { materialId: 'al-6061', processId: 'cnc-milling' });
    expect(result.subtotals.material).toBeGreaterThanOrEqual(0);
    expect(result.subtotals.machining).toBeGreaterThanOrEqual(0);
    expect(result.subtotals.overhead).toBeGreaterThan(0);
  });
});

describe('correctionFactors', () => {
  it('returns default factors with no feedback', () => {
    const factors = computeCorrectionFactors([]);
    expect(factors.global).toBe(1.0);
    expect(factors.sampleCount).toBe(0);
  });

  it('computes factors from feedback', () => {
    const feedback: CostFeedback[] = [
      { estimateId: '1', predictedCost: 100, actualCost: 120, material: 'al-6061', process: 'cnc-milling', complexityScore: 0.1 },
      { estimateId: '2', predictedCost: 200, actualCost: 220, material: 'al-6061', process: 'cnc-milling', complexityScore: 0.1 },
      { estimateId: '3', predictedCost: 150, actualCost: 180, material: 'ti-6al4v', process: 'cnc-milling', complexityScore: 0.6 },
    ];

    const factors = computeCorrectionFactors(feedback);
    expect(factors.global).toBeGreaterThan(1.0);
    expect(factors.sampleCount).toBe(3);
    expect(factors.byMaterial['al-6061']).toBeDefined();
    expect(factors.byMaterial['ti-6al4v']).toBeDefined();
    expect(factors.byComplexity['low']).toBeDefined();
    expect(factors.byComplexity['high']).toBeDefined();
  });

  it('selects material-specific factor when available', () => {
    const feedback: CostFeedback[] = [
      { estimateId: '1', predictedCost: 100, actualCost: 130, material: 'al-6061', process: 'cnc-milling', complexityScore: 0.1 },
    ];
    const factors = computeCorrectionFactors(feedback);
    const selected = selectCorrectionFactor(factors, 'al-6061', 'cnc-milling', 0.1);
    expect(selected).toBeCloseTo(1.3, 2);
  });

  it('falls back to global factor', () => {
    const feedback: CostFeedback[] = [
      { estimateId: '1', predictedCost: 100, actualCost: 110, material: 'al-6061', process: 'cnc-milling', complexityScore: 0.1 },
    ];
    const factors = computeCorrectionFactors(feedback);
    const selected = selectCorrectionFactor(factors, 'unknown', 'unknown', 0.99);
    expect(selected).toBe(factors.global);
  });
});
