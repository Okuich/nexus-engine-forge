import { describe, it, expect } from 'vitest';
import { runSpatialBenchmark, formatSpatialBenchmark } from '@/lib/geometry/spatial';

describe('Spatial benchmark runner', () => {
  it('runs deterministically and produces stats for all 3 structures', () => {
    const a = runSpatialBenchmark({ sizes: [500], iterations: 30, warmup: 5, seed: 42 });
    const b = runSpatialBenchmark({ sizes: [500], iterations: 30, warmup: 5, seed: 42 });
    expect(a.cases.length).toBe(b.cases.length);
    expect(a.cases.length).toBeGreaterThan(0);
    const kinds = new Set(a.cases.map((c) => c.structure));
    expect(kinds).toEqual(new Set(['kdtree', 'bvh', 'octree']));
    for (const c of a.cases) {
      expect(c.query.count).toBe(30);
      expect(c.query.p95).toBeGreaterThanOrEqual(0);
      expect(c.query.max).toBeGreaterThanOrEqual(c.query.p95);
    }
  });

  it('flags budget violations correctly', () => {
    const r = runSpatialBenchmark({ sizes: [500], iterations: 20, warmup: 2, budgetMs: 0 });
    expect(r.cases.some((c) => !c.withinBudget)).toBe(true);
  });

  it('formats a human-readable report', () => {
    const r = runSpatialBenchmark({ sizes: [200], iterations: 10, warmup: 2 });
    const text = formatSpatialBenchmark(r);
    expect(text).toMatch(/structure/);
    expect(text).toMatch(/kdtree/);
    expect(text).toMatch(/bvh/);
    expect(text).toMatch(/octree/);
  });
});
