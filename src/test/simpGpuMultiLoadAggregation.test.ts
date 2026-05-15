import { describe, it, expect } from 'vitest';
import { computeAggregationWeights } from '@/lib/geometry/topology/simpGpuMultiLoad';

describe('computeAggregationWeights', () => {
  it('weighted-sum returns case weights and Σ wᵢ·cᵢ', () => {
    const r = computeAggregationWeights([10, 40], [1, 2], 'weighted-sum', 8);
    expect(r.weights).toEqual([1, 2]);
    expect(r.aggCompliance).toBeCloseTo(1 * 10 + 2 * 40, 6);
  });

  it('ks weights sum to Σ caseWeights·softmax (each in [0, w])', () => {
    const caseW = [1, 1, 1];
    const r = computeAggregationWeights([1, 5, 9], caseW, 'ks', 4);
    const sum = r.weights.reduce((a, b) => a + b, 0);
    // Σ softmax · w_i where softmax sums to 1 and w_i = 1 → total = 1.
    expect(sum).toBeCloseTo(1, 6);
    // KS aggregate is between max·w and Σ w·c.
    const max = 9, sumWC = 1 + 5 + 9;
    expect(r.aggCompliance).toBeGreaterThanOrEqual(max - 1e-6);
    expect(r.aggCompliance).toBeLessThanOrEqual(sumWC + 1e-6);
  });

  it('ks reduces to ≈ max(w·c) as ρ → ∞', () => {
    const r = computeAggregationWeights([1, 5, 9], [1, 1, 1], 'ks', 500);
    expect(r.aggCompliance).toBeCloseTo(9, 1);
  });
});
