/**
 * Supplier Marketplace — Service Layer
 *
 * Clean separation between data access (Supabase) and business logic.
 * Orchestrates RFQ lifecycle: create → match → quote → rank → award.
 */

import { supabase } from '@/integrations/supabase/client';
import type { TablesInsert } from '@/integrations/supabase/types';
import { matchSuppliersToRFQ } from './matchingEngine';
import { rankQuotes } from './rankingEngine';
import type {
  RFQ,
  RFQQuote,
  SupplierProfile,
  CreateRFQRequest,
  SubmitQuoteRequest,
  MatchResult,
  RankingWeights,
  ScoreBreakdown,
  QuoteAdjustment,
} from './types';
import { DEFAULT_RANKING_WEIGHTS } from './types';

// ─── Data Mappers ────────────────────────────────────────────────

function mapRFQ(row: Record<string, unknown>): RFQ {
  return {
    id: row.id as string,
    title: row.title as string,
    description: row.description as string | null,
    partName: row.part_name as string,
    material: row.material as string,
    process: row.process as string,
    quantity: row.quantity as number,
    complexityScore: Number(row.complexity_score),
    surfaceClasses: (row.surface_classes as string[]) ?? [],
    requiredCertifications: (row.required_certifications as string[]) ?? [],
    maxLeadTimeDays: row.max_lead_time_days as number | null,
    region: row.region as string | null,
    targetCostUsd: row.target_cost_usd != null ? Number(row.target_cost_usd) : null,
    geometryStats: (row.geometry_stats as any) ?? {},
    status: row.status as RFQ['status'],
    createdBy: row.created_by as string,
    tenantId: row.tenant_id as string | null,
    deadline: row.deadline as string | null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function mapSupplierProfile(row: Record<string, unknown>): SupplierProfile {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    companyName: row.company_name as string,
    materials: (row.materials as string[]) ?? [],
    processes: (row.processes as string[]) ?? [],
    maxComplexity: Number(row.max_complexity),
    advancedSurfaces: (row.advanced_surfaces as string[]) ?? [],
    leadTimeDays: row.lead_time_days as number,
    qualityRating: Number(row.quality_rating),
    region: row.region as string,
    minOrderUsd: Number(row.min_order_usd),
    pricingMultiplier: Number(row.pricing_multiplier),
    certifications: (row.certifications as string[]) ?? [],
    active: row.active as boolean,
    tenantId: row.tenant_id as string | null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function mapRFQQuote(row: Record<string, unknown>): RFQQuote {
  return {
    id: row.id as string,
    rfqId: row.rfq_id as string,
    supplierId: row.supplier_id as string,
    unitPriceUsd: Number(row.unit_price_usd),
    totalPriceUsd: Number(row.total_price_usd),
    leadTimeDays: row.lead_time_days as number,
    notes: row.notes as string | null,
    adjustments: (row.adjustments as QuoteAdjustment[]) ?? [],
    confidence: Number(row.confidence),
    status: row.status as RFQQuote['status'],
    rank: row.rank as number | null,
    score: row.score != null ? Number(row.score) : null,
    scoreBreakdown: (row.score_breakdown as ScoreBreakdown) ?? { costScore: 0, leadTimeScore: 0, qualityScore: 0, certificationScore: 0, complexityFitScore: 0, totalScore: 0 },
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

// ─── RFQ Service ─────────────────────────────────────────────────

export class MarketplaceService {
  // ── RFQ CRUD ──

  async createRFQ(req: CreateRFQRequest): Promise<RFQ> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Authentication required');

    const { data, error } = await supabase
      .from('rfqs')
      .insert({
        title: req.title,
        description: req.description ?? null,
        part_name: req.partName,
        material: req.material,
        process: req.process,
        quantity: req.quantity,
        complexity_score: req.complexityScore ?? 0.5,
        surface_classes: req.surfaceClasses ?? [],
        required_certifications: req.requiredCertifications ?? [],
        max_lead_time_days: req.maxLeadTimeDays ?? null,
        region: req.region ?? null,
        target_cost_usd: req.targetCostUsd ?? null,
        geometry_stats: req.geometryStats ?? {},
        deadline: req.deadline ?? null,
        created_by: user.id,
        status: 'open',
      } satisfies TablesInsert<'rfqs'>)
      .select()
      .single();

    if (error) throw new Error(`Failed to create RFQ: ${error.message}`);
    return mapRFQ(data as any);
  }

  async listRFQs(filters?: { status?: string; material?: string }): Promise<RFQ[]> {
    let query = supabase
      .from('rfqs')
      .select('*')
      .order('created_at', { ascending: false });

    if (filters?.status) query = query.eq('status', filters.status);
    if (filters?.material) query = query.eq('material', filters.material);

    const { data, error } = await query;
    if (error) throw new Error(`Failed to list RFQs: ${error.message}`);
    return ((data ?? []) as Record<string, unknown>[]).map(mapRFQ);
  }

  async getRFQ(id: string): Promise<RFQ> {
    const { data, error } = await supabase
      .from('rfqs')
      .select('*')
      .eq('id', id)
      .single();

    if (error) throw new Error(`Failed to get RFQ: ${error.message}`);
    return mapRFQ(data as any);
  }

  async updateRFQStatus(id: string, status: RFQ['status']): Promise<void> {
    const { error } = await supabase
      .from('rfqs')
      .update({ status, updated_at: new Date().toISOString() } as any)
      .eq('id', id);

    if (error) throw new Error(`Failed to update RFQ status: ${error.message}`);
  }

  // ── Supplier Profiles ──

  async getSupplierProfiles(): Promise<SupplierProfile[]> {
    const { data, error } = await supabase
      .from('supplier_profiles')
      .select('*')
      .eq('active', true);

    if (error) throw new Error(`Failed to list suppliers: ${error.message}`);
    return ((data ?? []) as Record<string, unknown>[]).map(mapSupplierProfile);
  }

  async getSupplierProfile(id: string): Promise<SupplierProfile> {
    const { data, error } = await supabase
      .from('supplier_profiles')
      .select('*')
      .eq('id', id)
      .single();

    if (error) throw new Error(`Failed to get supplier: ${error.message}`);
    return mapSupplierProfile(data as any);
  }

  async upsertSupplierProfile(profile: Partial<SupplierProfile> & { companyName: string }): Promise<SupplierProfile> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Authentication required');

    const { data, error } = await supabase
      .from('supplier_profiles')
      .upsert({
        user_id: user.id,
        company_name: profile.companyName,
        materials: profile.materials ?? [],
        processes: profile.processes ?? [],
        max_complexity: profile.maxComplexity ?? 0.8,
        advanced_surfaces: profile.advancedSurfaces ?? [],
        lead_time_days: profile.leadTimeDays ?? 10,
        quality_rating: profile.qualityRating ?? 0.8,
        region: profile.region ?? 'US-East',
        min_order_usd: profile.minOrderUsd ?? 100,
        pricing_multiplier: profile.pricingMultiplier ?? 1.0,
        certifications: profile.certifications ?? [],
        active: profile.active ?? true,
      } satisfies TablesInsert<'supplier_profiles'>, { onConflict: 'user_id' })
      .select()
      .single();

    if (error) throw new Error(`Failed to upsert supplier profile: ${error.message}`);
    return mapSupplierProfile(data as any);
  }

  // ── Matching ──

  async matchSuppliersForRFQ(rfqId: string): Promise<MatchResult> {
    const rfq = await this.getRFQ(rfqId);
    const suppliers = await this.getSupplierProfiles();

    const result = matchSuppliersToRFQ(suppliers, {
      material: rfq.material,
      process: rfq.process,
      complexityScore: rfq.complexityScore,
      surfaceClasses: rfq.surfaceClasses,
      requiredCertifications: rfq.requiredCertifications,
      maxLeadTimeDays: rfq.maxLeadTimeDays,
      region: rfq.region,
      targetCostUsd: rfq.targetCostUsd,
      quantity: rfq.quantity,
    });

    result.rfqId = rfqId;
    return result;
  }

  // ── Quote Submission ──

  async submitQuote(req: SubmitQuoteRequest): Promise<RFQQuote> {
    const rfq = await this.getRFQ(req.rfqId);
    if (rfq.status !== 'open') {
      throw new Error(`RFQ is ${rfq.status}, not accepting quotes`);
    }

    const totalPrice = req.unitPriceUsd * rfq.quantity;

    const { data, error } = await supabase
      .from('rfq_quotes')
      .insert({
        rfq_id: req.rfqId,
        supplier_id: req.rfqId, // will be overridden — see note below
        unit_price_usd: req.unitPriceUsd,
        total_price_usd: totalPrice,
        lead_time_days: req.leadTimeDays,
        notes: req.notes ?? null,
        adjustments: req.adjustments ?? [],
        confidence: req.confidence ?? 0.8,
        status: 'submitted',
      } as any)
      .select()
      .single();

    if (error) throw new Error(`Failed to submit quote: ${error.message}`);
    return mapRFQQuote(data as any);
  }

  async submitQuoteAsSupplier(supplierId: string, req: SubmitQuoteRequest): Promise<RFQQuote> {
    const rfq = await this.getRFQ(req.rfqId);
    if (rfq.status !== 'open') {
      throw new Error(`RFQ is ${rfq.status}, not accepting quotes`);
    }

    const totalPrice = req.unitPriceUsd * rfq.quantity;

    const { data, error } = await supabase
      .from('rfq_quotes')
      .insert({
        rfq_id: req.rfqId,
        supplier_id: supplierId,
        unit_price_usd: req.unitPriceUsd,
        total_price_usd: totalPrice,
        lead_time_days: req.leadTimeDays,
        notes: req.notes ?? null,
        adjustments: req.adjustments ?? [],
        confidence: req.confidence ?? 0.8,
        status: 'submitted',
      } as any)
      .select()
      .single();

    if (error) throw new Error(`Failed to submit quote: ${error.message}`);
    return mapRFQQuote(data as any);
  }

  // ── Quote Retrieval ──

  async getQuotesForRFQ(rfqId: string): Promise<RFQQuote[]> {
    const { data, error } = await supabase
      .from('rfq_quotes')
      .select('*')
      .eq('rfq_id', rfqId)
      .order('created_at', { ascending: true });

    if (error) throw new Error(`Failed to get quotes: ${error.message}`);
    return ((data ?? []) as Record<string, unknown>[]).map(mapRFQQuote);
  }

  // ── Ranking ──

  async rankQuotesForRFQ(rfqId: string, weights?: RankingWeights): Promise<RFQQuote[]> {
    const rfq = await this.getRFQ(rfqId);
    const quotes = await this.getQuotesForRFQ(rfqId);
    const suppliers = await this.getSupplierProfiles();

    const supplierMap = new Map(suppliers.map((s) => [s.id, s]));

    const ranked = rankQuotes(
      quotes,
      supplierMap,
      {
        targetCostUsd: rfq.targetCostUsd,
        maxLeadTimeDays: rfq.maxLeadTimeDays,
        requiredCertifications: rfq.requiredCertifications,
        complexityScore: rfq.complexityScore,
      },
      weights ?? DEFAULT_RANKING_WEIGHTS,
    );

    // Persist rankings
    for (const quote of ranked) {
      await supabase
        .from('rfq_quotes')
        .update({
          rank: quote.rank,
          score: quote.score,
          score_breakdown: quote.scoreBreakdown,
          updated_at: new Date().toISOString(),
        } as any)
        .eq('id', quote.id);
    }

    // Move RFQ to evaluating
    await this.updateRFQStatus(rfqId, 'evaluating');

    return ranked;
  }

  // ── Award ──

  async awardQuote(rfqId: string, quoteId: string): Promise<void> {
    // Accept the winning quote
    await supabase
      .from('rfq_quotes')
      .update({ status: 'accepted', updated_at: new Date().toISOString() } as any)
      .eq('id', quoteId);

    // Reject all other quotes
    await supabase
      .from('rfq_quotes')
      .update({ status: 'rejected', updated_at: new Date().toISOString() } as any)
      .eq('rfq_id', rfqId)
      .neq('id', quoteId);

    // Close the RFQ
    await this.updateRFQStatus(rfqId, 'awarded');
  }
}

/** Singleton instance */
export const marketplaceService = new MarketplaceService();
