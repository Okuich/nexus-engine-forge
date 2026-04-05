/**
 * Fabrication OS — Quoter
 *
 * Generate and manage quotes linked to fabrication jobs and Midwater RFQs.
 */

import { supabase } from '@/integrations/supabase/client';

// ─── Types ──────────────────────────────────────────────────────

export type FabQuoteStatus = 'draft' | 'sent' | 'accepted' | 'rejected' | 'expired';

export interface FabQuote {
  id: string;
  job_id: string | null;
  rfq_id: string | null;
  supplier_id: string;
  unit_price_usd: number;
  total_price_usd: number;
  lead_time_days: number;
  breakdown: Record<string, number>;
  status: FabQuoteStatus;
  sent_at: string | null;
  notes: string | null;
  tenant_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateQuoteInput {
  job_id?: string;
  rfq_id?: string;
  unit_price_usd: number;
  quantity: number;
  lead_time_days: number;
  breakdown?: Record<string, number>;
  notes?: string;
  tenant_id?: string;
}

export interface QuoteCostBreakdown {
  material: number;
  labor: number;
  machine: number;
  overhead: number;
  margin: number;
  total: number;
}

// ─── CRUD ───────────────────────────────────────────────────────

export async function listQuotes(filters?: {
  status?: FabQuoteStatus;
  rfq_id?: string;
}): Promise<FabQuote[]> {
  let query = supabase
    .from('fabrication_quotes')
    .select('*')
    .order('created_at', { ascending: false });

  if (filters?.status) query = query.eq('status', filters.status);
  if (filters?.rfq_id) query = query.eq('rfq_id', filters.rfq_id);

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as FabQuote[];
}

export async function createQuote(input: CreateQuoteInput): Promise<FabQuote> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const totalPrice = Math.round(input.unit_price_usd * input.quantity * 100) / 100;

  const { data, error } = await supabase
    .from('fabrication_quotes')
    .insert({
      job_id: input.job_id ?? null,
      rfq_id: input.rfq_id ?? null,
      supplier_id: user.id,
      unit_price_usd: input.unit_price_usd,
      total_price_usd: totalPrice,
      lead_time_days: input.lead_time_days,
      breakdown: input.breakdown ?? {},
      notes: input.notes ?? null,
      tenant_id: input.tenant_id ?? null,
    })
    .select()
    .single();

  if (error) throw error;
  return data as FabQuote;
}

export async function sendQuote(id: string): Promise<FabQuote> {
  const { data, error } = await supabase
    .from('fabrication_quotes')
    .update({ status: 'sent', sent_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data as FabQuote;
}

export async function updateQuoteStatus(
  id: string,
  status: FabQuoteStatus,
): Promise<FabQuote> {
  const { data, error } = await supabase
    .from('fabrication_quotes')
    .update({ status })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data as FabQuote;
}

// ─── Cost Estimator ─────────────────────────────────────────────

/**
 * Generate a cost breakdown estimate for a job.
 * Pure function — no DB calls.
 */
export function estimateCost(params: {
  material: string;
  process: string;
  quantity: number;
  complexityFactor?: number;
}): QuoteCostBreakdown {
  const complexity = params.complexityFactor ?? 1.0;

  // Base rates (simplified — would come from config in production)
  const materialRates: Record<string, number> = {
    aluminum: 12, steel: 18, titanium: 45, plastic: 6, copper: 22,
  };
  const processRates: Record<string, number> = {
    cnc_milling: 35, turning: 28, edm: 55, grinding: 30, injection_molding: 15,
  };

  const materialCost = (materialRates[params.material] ?? 15) * params.quantity * complexity;
  const laborCost = materialCost * 0.4;
  const machineCost = (processRates[params.process] ?? 30) * params.quantity * complexity;
  const overhead = (materialCost + laborCost + machineCost) * 0.15;
  const subtotal = materialCost + laborCost + machineCost + overhead;
  const margin = subtotal * 0.20;

  return {
    material: round2(materialCost),
    labor: round2(laborCost),
    machine: round2(machineCost),
    overhead: round2(overhead),
    margin: round2(margin),
    total: round2(subtotal + margin),
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ─── Quote Stats ────────────────────────────────────────────────

export async function getQuoteStats(): Promise<Record<FabQuoteStatus, number>> {
  const quotes = await listQuotes();
  const stats: Record<FabQuoteStatus, number> = {
    draft: 0, sent: 0, accepted: 0, rejected: 0, expired: 0,
  };
  for (const q of quotes) {
    stats[q.status] = (stats[q.status] || 0) + 1;
  }
  return stats;
}
