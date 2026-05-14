import { describe, it, expect } from 'vitest';
import { generateBox, generateCylinder } from '@/lib/geometry/core';
import { optimizeGeometry, computeBaseline, MATERIAL_DB } from '@/lib/geometry/optimization';

describe('Geometry Optimization Engine', () => {
  it('computes a baseline with positive volume / cost / safety', () => {
    const box = generateBox({ width: 50, height: 30, depth: 20 });
    const baseline = computeBaseline(box, { process: 'cnc_milling', material: 'aluminum_6061' });
    expect(baseline.volumeMm3).toBeGreaterThan(0);
    expect(baseline.massG).toBeGreaterThan(0);
    expect(baseline.estUnitCostUsd).toBeGreaterThan(0);
    expect(baseline.estSafetyFactor).toBeGreaterThan(0);
  });

  it('returns suggestions within the time budget', () => {
    const cyl = generateCylinder({ radius: 10, height: 40, segments: 24 });
    const report = optimizeGeometry(cyl, {
      process: 'injection_molding',
      material: 'abs',
      physics: { peakLoadN: 500, minSafetyFactor: 2 },
      cost: { annualVolume: 10000, targetUnitCostUsd: 5 },
    }, { timeBudgetMs: 100 });
    expect(report.elapsedMs).toBeLessThan(500); // generous CI buffer
    expect(Array.isArray(report.suggestions)).toBe(true);
    expect(Array.isArray(report.paretoFront)).toBe(true);
  });

  it('flags draft-angle issues for molded processes', () => {
    const box = generateBox({ width: 30, height: 30, depth: 30 });
    const report = optimizeGeometry(box, {
      process: 'injection_molding',
      material: 'abs',
    });
    const draft = report.suggestions.find(s => s.category === 'draft_angle');
    expect(draft).toBeDefined();
    expect(draft!.severity).toBe('critical');
  });

  it('suggests material swaps when safety budget allows', () => {
    const box = generateBox({ width: 100, height: 100, depth: 100 });
    const report = optimizeGeometry(box, {
      process: 'cnc_milling',
      material: 'titanium_grade5',
      physics: { peakLoadN: 10, minSafetyFactor: 2 },
    });
    const swap = report.suggestions.find(s => s.category === 'material_swap');
    expect(swap).toBeDefined();
  });

  it('exposes a non-empty material database', () => {
    expect(MATERIAL_DB.aluminum_6061.density).toBeGreaterThan(0);
    expect(MATERIAL_DB.titanium_grade5.yieldStrength).toBeGreaterThan(0);
  });
});
