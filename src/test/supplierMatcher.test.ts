import { describe, it, expect, beforeEach } from 'vitest';
import {
  matchSuppliers,
  recordFeedback,
  getFeedbackAggregates,
  applyLearnedAdjustments,
  resetFeedback,
  DEFAULT_MATCH_WEIGHTS,
} from '@/services/supplierMatcher';
import type { SupplierProfile } from '@/lib/marketplace/types';

const mockSuppliers: SupplierProfile[] = [
  {
    id: 's1', userId: 'u1', companyName: 'PrecisionCo',
    materials: ['aluminum', 'steel'], processes: ['cnc_milling', 'turning'],
    maxComplexity: 0.9, advancedSurfaces: ['freeform'], leadTimeDays: 7,
    qualityRating: 0.95, region: 'NA', minOrderUsd: 100, pricingMultiplier: 1.0,
    certifications: ['ISO9001', 'AS9100'], active: true, tenantId: null,
    createdAt: '', updatedAt: '',
  },
  {
    id: 's2', userId: 'u2', companyName: 'BudgetMill',
    materials: ['aluminum'], processes: ['cnc_milling'],
    maxComplexity: 0.6, advancedSurfaces: [], leadTimeDays: 14,
    qualityRating: 0.75, region: 'APAC', minOrderUsd: 50, pricingMultiplier: 0.7,
    certifications: ['ISO9001'], active: true, tenantId: null,
    createdAt: '', updatedAt: '',
  },
  {
    id: 's3', userId: 'u3', companyName: 'InactiveCorp',
    materials: ['aluminum'], processes: ['cnc_milling'],
    maxComplexity: 0.8, advancedSurfaces: [], leadTimeDays: 10,
    qualityRating: 0.85, region: 'NA', minOrderUsd: 200, pricingMultiplier: 1.1,
    certifications: [], active: false, tenantId: null,
    createdAt: '', updatedAt: '',
  },
];

describe('supplierMatcher', () => {
  beforeEach(() => resetFeedback());

  it('ranks suppliers by capability + price + performance', () => {
    const result = matchSuppliers(mockSuppliers, {
      material: 'aluminum', process: 'cnc_milling', quantity: 100,
      complexityScore: 0.5, surfaceClasses: [], requiredCertifications: [],
      maxLeadTimeDays: 15, targetCostUsd: 1000, region: 'NA',
    });

    expect(result.suppliers.length).toBe(2); // s3 is inactive
    expect(result.totalDisqualified).toBe(0);
    expect(result.suppliers[0].rank).toBe(1);
    expect(result.suppliers[1].rank).toBe(2);
    expect(result.suppliers[0].totalScore).toBeGreaterThan(0);
  });

  it('disqualifies suppliers missing required material', () => {
    const result = matchSuppliers(mockSuppliers, {
      material: 'titanium', process: 'cnc_milling', quantity: 10,
      complexityScore: 0.3, surfaceClasses: [], requiredCertifications: [],
      maxLeadTimeDays: null, targetCostUsd: null, region: null,
    });

    expect(result.suppliers.length).toBe(0);
    expect(result.totalDisqualified).toBe(2);
  });

  it('disqualifies on complexity overflow', () => {
    const result = matchSuppliers(mockSuppliers, {
      material: 'aluminum', process: 'cnc_milling', quantity: 10,
      complexityScore: 0.95, surfaceClasses: [], requiredCertifications: [],
      maxLeadTimeDays: null, targetCostUsd: null, region: null,
    });

    // Only s1 (maxComplexity 0.9) can't handle 0.95 either
    expect(result.suppliers.length).toBe(0);
  });

  it('records and aggregates feedback', () => {
    recordFeedback({ matchId: 'm1', supplierId: 's1', outcome: 'awarded', timestamp: new Date().toISOString() });
    recordFeedback({ matchId: 'm2', supplierId: 's2', outcome: 'rejected', timestamp: new Date().toISOString() });
    recordFeedback({ matchId: 'm3', supplierId: 's1', outcome: 'dispute', timestamp: new Date().toISOString() });

    const agg = getFeedbackAggregates();
    expect(agg.totalMatches).toBe(3);
    expect(agg.outcomeDistribution.awarded).toBe(1);
    expect(agg.outcomeDistribution.dispute).toBe(1);
    expect(agg.awardRate).toBeCloseTo(0.33, 1);
  });

  it('does not adjust weights with < 10 feedback entries', () => {
    recordFeedback({ matchId: 'm1', supplierId: 's1', outcome: 'dispute', timestamp: new Date().toISOString() });
    const adjusted = applyLearnedAdjustments(DEFAULT_MATCH_WEIGHTS);
    expect(adjusted).toEqual(DEFAULT_MATCH_WEIGHTS);
  });

  it('boosts performance weight with high dispute rate', () => {
    for (let i = 0; i < 10; i++) {
      recordFeedback({ matchId: `m${i}`, supplierId: 's1', outcome: 'dispute', timestamp: new Date().toISOString() });
    }

    const adjusted = applyLearnedAdjustments({ ...DEFAULT_MATCH_WEIGHTS });
    expect(adjusted.performance).toBeGreaterThan(DEFAULT_MATCH_WEIGHTS.performance);
  });
});
