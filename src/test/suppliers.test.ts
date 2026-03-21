import { describe, it, expect } from 'vitest';
import {
  filterSuppliers,
  computeAdjustedPrice,
  generateQuotes,
  SUPPLIERS,
} from '@/lib/suppliers';

describe('filterSuppliers', () => {
  it('filters by material and process', () => {
    const result = filterSuppliers(SUPPLIERS, {
      materialId: 'ti-6al4v',
      processId: 'cnc-milling',
      complexityScore: 0.3,
    });
    expect(result.length).toBeGreaterThan(0);
    result.forEach((s) => {
      expect(s.materials).toContain('ti-6al4v');
      expect(s.processes).toContain('cnc-milling');
    });
  });

  it('excludes suppliers below complexity threshold', () => {
    const result = filterSuppliers(SUPPLIERS, {
      materialId: 'al-6061',
      processId: 'cnc-milling',
      complexityScore: 0.95,
    });
    result.forEach((s) => expect(s.maxComplexity).toBeGreaterThanOrEqual(0.95));
  });

  it('filters by certifications', () => {
    const result = filterSuppliers(SUPPLIERS, {
      materialId: 'al-6061',
      processId: 'cnc-milling',
      complexityScore: 0.2,
      requiresCertifications: ['AS9100', 'ITAR'],
    });
    result.forEach((s) => {
      expect(s.certifications).toContain('AS9100');
      expect(s.certifications).toContain('ITAR');
    });
  });

  it('returns empty for impossible combo', () => {
    const result = filterSuppliers(SUPPLIERS, {
      materialId: 'inconel-718',
      processId: 'injection',
      complexityScore: 0.1,
    });
    expect(result).toHaveLength(0);
  });
});

describe('computeAdjustedPrice', () => {
  const supplier = SUPPLIERS.find((s) => s.id === 'precision-works')!;

  it('applies base multiplier', () => {
    const { adjustedCostUsd } = computeAdjustedPrice(supplier, 100, 'al-6061', 'cnc-milling', 1);
    expect(adjustedCostUsd).toBeCloseTo(115, 0);
  });

  it('applies volume discount', () => {
    const single = computeAdjustedPrice(supplier, 100, 'al-6061', 'cnc-milling', 1);
    const batch = computeAdjustedPrice(supplier, 100, 'al-6061', 'cnc-milling', 50);
    expect(batch.adjustedCostUsd).toBeLessThan(single.adjustedCostUsd);
  });

  it('applies material surcharge for titanium', () => {
    const { adjustments } = computeAdjustedPrice(supplier, 100, 'ti-6al4v', 'cnc-milling', 1);
    const matAdj = adjustments.find((a) => a.label.includes('Material surcharge'));
    expect(matAdj).toBeDefined();
    expect(matAdj!.factor).toBe(1.25);
  });
});

describe('generateQuotes', () => {
  it('returns ranked quotes sorted by cost', () => {
    const quotes = generateQuotes({
      baseCostUsd: 200,
      materialId: 'al-6061',
      processId: 'cnc-milling',
      complexityScore: 0.3,
      quantity: 1,
      surfaceClasses: ['planar', 'cylindrical'],
    });
    expect(quotes.length).toBeGreaterThan(0);
    expect(quotes[0].rank).toBe(1);
    for (let i = 1; i < quotes.length; i++) {
      expect(quotes[i].adjustedCostUsd).toBeGreaterThanOrEqual(quotes[i - 1].adjustedCostUsd);
    }
  });

  it('sorts by quality when requested', () => {
    const quotes = generateQuotes({
      baseCostUsd: 200,
      materialId: 'al-6061',
      processId: 'cnc-milling',
      complexityScore: 0.3,
      quantity: 1,
      surfaceClasses: [],
      sortBy: 'quality',
    });
    for (let i = 1; i < quotes.length; i++) {
      expect(quotes[i].qualityRating).toBeLessThanOrEqual(quotes[i - 1].qualityRating);
    }
  });

  it('returns empty for no matching suppliers', () => {
    const quotes = generateQuotes({
      baseCostUsd: 200,
      materialId: 'inconel-718',
      processId: 'injection',
      complexityScore: 0.1,
      quantity: 1,
      surfaceClasses: [],
    });
    expect(quotes).toHaveLength(0);
  });
});
