import { describe, it, expect } from 'vitest';
import { runSIMP } from '../lib/geometry/topology/simp';
import type { VoxelDomain } from '../lib/geometry/topology/voxelizer';
import type { LoadCase, LoadCondition, SupportCondition } from '../lib/geometry/topology/types';

/** Build a fully-active rectangular design domain. */
function makeDomain(nx: number, ny: number, nz: number, voxel = 1): VoxelDomain {
  const N = nx * ny * nz;
  const designMask = new Uint8Array(N);
  designMask.fill(1);
  return { designMask, dims: [nx, ny, nz], origin: [0, 0, 0], voxelSize: voxel };
}

const supportLeft: SupportCondition = { point: [0.5, 4, 4] };
const supportRight: SupportCondition = { point: [11.5, 4, 4] };
const loadTop: LoadCondition = { point: [6, 7.5, 4], force: [0, -100, 0] };
const loadSide: LoadCondition = { point: [6, 4, 7.5], force: [0, 0, -100] };

describe('multi-load-case SIMP', () => {
  const domain = makeDomain(12, 8, 8);
  const supports = [supportLeft, supportRight];
  const opts = { maxIterations: 6, resolution: 12, targetVolumeFraction: 0.4, timeBudgetMs: 4000 };

  it('falls back to a single implicit case when loadCases not provided', () => {
    const r = runSIMP(domain, [loadTop], supports, opts);
    expect(r.perCaseCompliance.length).toBe(1);
    expect(r.compliance).toBeCloseTo(r.perCaseCompliance[0], 6);
    expect(r.loadCaseAggregation).toBe('weighted-sum');
  });

  it('weighted-sum aggregation = Σ wi · ci', () => {
    const cases: LoadCase[] = [
      { name: 'top', loads: [loadTop], weight: 1 },
      { name: 'side', loads: [loadSide], weight: 2 },
    ];
    const r = runSIMP(domain, [], supports, { ...opts, loadCases: cases });
    expect(r.perCaseCompliance.length).toBe(2);
    const expected = 1 * r.perCaseCompliance[0] + 2 * r.perCaseCompliance[1];
    expect(r.compliance).toBeCloseTo(expected, 4);
  });

  it('KS aggregation lies between max and weighted-sum, ≥ max(per-case · w)', () => {
    const cases: LoadCase[] = [
      { name: 'top', loads: [loadTop], weight: 1 },
      { name: 'side', loads: [loadSide], weight: 1 },
    ];
    const r = runSIMP(domain, [], supports, {
      ...opts,
      loadCases: cases,
      loadCaseAggregation: 'ks',
      ksRho: 10,
    });
    expect(r.loadCaseAggregation).toBe('ks');
    const weighted = cases.map((c, i) => (c.weight ?? 1) * r.perCaseCompliance[i]);
    const maxW = Math.max(...weighted);
    const sumW = weighted.reduce((a, b) => a + b, 0);
    // KS soft-max ∈ [max, max + ln(n)/ρ] which is ≤ sum
    expect(r.compliance).toBeGreaterThanOrEqual(maxW - 1e-6);
    expect(r.compliance).toBeLessThanOrEqual(sumW + 1e-6);
  });

  it('per-case supports override the top-level supports', () => {
    const cases: LoadCase[] = [
      { name: 'left-only', loads: [loadTop], supports: [supportLeft] },
      { name: 'right-only', loads: [loadTop], supports: [supportRight] },
    ];
    const r = runSIMP(domain, [], [], { ...opts, loadCases: cases });
    expect(r.perCaseCompliance.length).toBe(2);
    // Both single-support cases should have finite compliance even though
    // top-level supports[] is empty.
    for (const c of r.perCaseCompliance) {
      expect(Number.isFinite(c)).toBe(true);
      expect(c).toBeGreaterThan(0);
    }
  });

  it('returns Infinity when no case has both loads and supports', () => {
    const r = runSIMP(domain, [], [], { ...opts, loadCases: [{ loads: [loadTop] }] });
    expect(r.compliance).toBe(Infinity);
    expect(r.perCaseCompliance.length).toBe(0);
  });

  it('forwards perCaseCompliance to onIteration callback', () => {
    const seen: number[][] = [];
    const cases: LoadCase[] = [
      { name: 'a', loads: [loadTop] },
      { name: 'b', loads: [loadSide] },
    ];
    runSIMP(domain, [], supports, {
      ...opts,
      maxIterations: 3,
      loadCases: cases,
      onIteration: (s) => { if (s.perCaseCompliance) seen.push(s.perCaseCompliance); },
    });
    expect(seen.length).toBeGreaterThan(0);
    for (const arr of seen) expect(arr.length).toBe(2);
  });
});
