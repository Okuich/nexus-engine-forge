import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MarketplaceService } from '@/lib/marketplace/service';
import { rankQuotes } from '@/lib/marketplace/rankingEngine';
import { matchSuppliersToRFQ } from '@/lib/marketplace/matchingEngine';
import type { RFQQuote, SupplierProfile, RankingWeights } from '@/lib/marketplace/types';
import { DEFAULT_RANKING_WEIGHTS } from '@/lib/marketplace/types';

// ─── Mock Supabase ──────────────────────────────────────────────

const mockSelect = vi.fn();
const mockInsert = vi.fn();
const mockUpdate = vi.fn();
const mockEq = vi.fn();
const mockNeq = vi.fn();
const mockOrder = vi.fn();
const mockSingle = vi.fn();

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: 'test-user-123' } },
      }),
    },
    from: vi.fn(() => ({
      select: mockSelect,
      insert: mockInsert,
      update: mockUpdate,
      upsert: vi.fn().mockReturnValue({
        select: mockSelect,
      }),
    })),
  },
}));

// ─── Test Data ──────────────────────────────────────────────────

function makeSupplier(overrides: Partial<SupplierProfile> = {}): SupplierProfile {
  return {
    id: 'supplier-1',
    userId: 'user-1',
    companyName: 'Acme CNC',
    materials: ['Aluminum-6061', 'Steel-304'],
    processes: ['CNC_Milling', 'CNC_Turning'],
    maxComplexity: 0.9,
    advancedSurfaces: [],
    leadTimeDays: 7,
    qualityRating: 0.85,
    region: 'US-East',
    minOrderUsd: 100,
    pricingMultiplier: 1.0,
    certifications: ['ISO-9001'],
    active: true,
    tenantId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeQuote(overrides: Partial<RFQQuote> = {}): RFQQuote {
  return {
    id: 'quote-1',
    rfqId: 'rfq-1',
    supplierId: 'supplier-1',
    unitPriceUsd: 150,
    totalPriceUsd: 1500,
    leadTimeDays: 7,
    notes: null,
    adjustments: [],
    confidence: 0.85,
    status: 'submitted',
    rank: null,
    score: null,
    scoreBreakdown: {
      costScore: 0,
      leadTimeScore: 0,
      qualityScore: 0,
      certificationScore: 0,
      complexityFitScore: 0,
      trustScore: 0,
      totalScore: 0,
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

// ─── Tests ──────────────────────────────────────────────────────

describe('Marketplace E2E Flow', () => {
  describe('matchSuppliersToRFQ (pure logic)', () => {
    it('should match suppliers by material and process', () => {
      const suppliers = [
        makeSupplier({ id: 's1', materials: ['Aluminum-6061'], processes: ['CNC_Milling'] }),
        makeSupplier({ id: 's2', materials: ['Titanium'], processes: ['CNC_Milling'] }),
        makeSupplier({ id: 's3', materials: ['Aluminum-6061'], processes: ['Casting'] }),
      ];

      const result = matchSuppliersToRFQ(suppliers, {
        material: 'Aluminum-6061',
        process: 'CNC_Milling',
        complexityScore: 0.5,
        surfaceClasses: [],
        requiredCertifications: [],
        maxLeadTimeDays: null,
        region: null,
        targetCostUsd: null,
        quantity: 10,
      });

      expect(result.totalEligible).toBeGreaterThanOrEqual(1);
      const matched = result.matchedSuppliers;
      // s1 should match (has both material + process)
      const s1Match = matched.find((m) => m.supplierId === 's1');
      expect(s1Match).toBeDefined();
      expect(s1Match!.fitScore).toBeGreaterThan(0);
    });

    it('should filter by complexity', () => {
      const suppliers = [
        makeSupplier({ id: 's1', maxComplexity: 0.3 }),
        makeSupplier({ id: 's2', maxComplexity: 0.9 }),
      ];

      const result = matchSuppliersToRFQ(suppliers, {
        material: 'Aluminum-6061',
        process: 'CNC_Milling',
        complexityScore: 0.7,
        surfaceClasses: [],
        requiredCertifications: [],
        maxLeadTimeDays: null,
        region: null,
        targetCostUsd: null,
        quantity: 10,
      });

      // s1 can't handle complexity 0.7 (max 0.3), should be filtered or score low
      const s2Match = result.matchedSuppliers.find((m) => m.supplierId === 's2');
      expect(s2Match).toBeDefined();
    });
  });

  describe('rankQuotes (pure logic)', () => {
    it('should rank quotes by weighted score', () => {
      const supplierMap = new Map<string, SupplierProfile>([
        ['s1', makeSupplier({ id: 's1', qualityRating: 0.95, certifications: ['ISO-9001', 'AS9100'] })],
        ['s2', makeSupplier({ id: 's2', qualityRating: 0.70, certifications: [] })],
      ]);

      const quotes = [
        makeQuote({ id: 'q1', supplierId: 's1', unitPriceUsd: 200, leadTimeDays: 10 }),
        makeQuote({ id: 'q2', supplierId: 's2', unitPriceUsd: 100, leadTimeDays: 5 }),
      ];

      const rfqContext = {
        targetCostUsd: 150,
        maxLeadTimeDays: 14,
        requiredCertifications: ['ISO-9001'],
        complexityScore: 0.5,
      };

      const ranked = rankQuotes(quotes, supplierMap, rfqContext, DEFAULT_RANKING_WEIGHTS);

      expect(ranked).toHaveLength(2);
      expect(ranked[0].rank).toBe(1);
      expect(ranked[1].rank).toBe(2);
      expect(ranked[0].score).toBeGreaterThan(0);
      expect(ranked[0].scoreBreakdown.totalScore).toBeGreaterThan(0);
      // Each quote should have all score components
      expect(ranked[0].scoreBreakdown).toHaveProperty('costScore');
      expect(ranked[0].scoreBreakdown).toHaveProperty('trustScore');
    });

    it('should handle single quote', () => {
      const supplierMap = new Map([['s1', makeSupplier({ id: 's1' })]]);
      const quotes = [makeQuote({ id: 'q1', supplierId: 's1' })];
      const ranked = rankQuotes(quotes, supplierMap, {
        targetCostUsd: null,
        maxLeadTimeDays: null,
        requiredCertifications: [],
        complexityScore: 0.5,
      }, DEFAULT_RANKING_WEIGHTS);

      expect(ranked).toHaveLength(1);
      expect(ranked[0].rank).toBe(1);
    });

    it('should return empty for no quotes', () => {
      const ranked = rankQuotes([], new Map(), {
        targetCostUsd: null,
        maxLeadTimeDays: null,
        requiredCertifications: [],
        complexityScore: 0.5,
      }, DEFAULT_RANKING_WEIGHTS);
      expect(ranked).toEqual([]);
    });
  });

  describe('SubmitQuoteRequest validation', () => {
    it('should require supplierId in submitQuote', async () => {
      const service = new MarketplaceService();

      // Mock getRFQ to return an open RFQ
      vi.spyOn(service, 'getRFQ').mockResolvedValue({
        id: 'rfq-1',
        title: 'Test',
        description: null,
        partName: 'Bracket',
        material: 'Aluminum-6061',
        process: 'CNC_Milling',
        quantity: 10,
        complexityScore: 0.5,
        surfaceClasses: [],
        requiredCertifications: [],
        maxLeadTimeDays: null,
        region: null,
        targetCostUsd: null,
        geometryStats: {},
        status: 'open',
        createdBy: 'user-1',
        tenantId: null,
        deadline: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      await expect(
        service.submitQuote({
          rfqId: 'rfq-1',
          unitPriceUsd: 150,
          leadTimeDays: 7,
        }),
      ).rejects.toThrow('supplierId is required');
    });

    it('should reject quotes on non-open RFQs', async () => {
      const service = new MarketplaceService();

      vi.spyOn(service, 'getRFQ').mockResolvedValue({
        id: 'rfq-1',
        title: 'Test',
        description: null,
        partName: 'Bracket',
        material: 'Aluminum-6061',
        process: 'CNC_Milling',
        quantity: 10,
        complexityScore: 0.5,
        surfaceClasses: [],
        requiredCertifications: [],
        maxLeadTimeDays: null,
        region: null,
        targetCostUsd: null,
        geometryStats: {},
        status: 'awarded',
        createdBy: 'user-1',
        tenantId: null,
        deadline: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      await expect(
        service.submitQuote({
          rfqId: 'rfq-1',
          supplierId: 's1',
          unitPriceUsd: 150,
          leadTimeDays: 7,
        }),
      ).rejects.toThrow('not accepting quotes');
    });
  });
});
