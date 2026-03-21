/**
 * Supplier Trust Scoring — Service Layer
 *
 * Persists trust metrics via Supabase and exposes methods
 * for recording events and recalculating scores.
 */

import { supabase } from '@/integrations/supabase/client';
import {
  computeTrustScore,
  updateMetricsAfterQuote,
  updateMetricsAfterDelivery,
  updateMetricsAfterRating,
  updateMetricsAfterDispute,
} from './engine';
import type {
  TrustMetrics,
  TrustScoreResult,
  SupplierTrustScore,
  RecordEventInput,
} from './types';

// ─── Helpers ────────────────────────────────────────────────────

function rowToMetrics(row: Record<string, unknown>): TrustMetrics {
  return {
    avgResponseTimeHrs: Number(row.avg_response_time_hrs),
    onTimeDeliveryRate: Number(row.on_time_delivery_rate),
    quoteAccuracyRate: Number(row.quote_accuracy_rate),
    avgQualityRating: Number(row.avg_quality_rating),
    totalOrders: Number(row.total_orders),
    totalQuotes: Number(row.total_quotes),
    disputes: Number(row.disputes),
  };
}

function rowToTrustScore(row: Record<string, unknown>): SupplierTrustScore {
  return {
    id: row.id as string,
    supplierId: row.supplier_id as string,
    avgResponseTimeHrs: Number(row.avg_response_time_hrs),
    onTimeDeliveryRate: Number(row.on_time_delivery_rate),
    quoteAccuracyRate: Number(row.quote_accuracy_rate),
    avgQualityRating: Number(row.avg_quality_rating),
    totalOrders: Number(row.total_orders),
    totalQuotes: Number(row.total_quotes),
    disputes: Number(row.disputes),
    trustScore: Number(row.trust_score),
    tier: row.tier as SupplierTrustScore['tier'],
    lastRecalculatedAt: row.last_recalculated_at as string,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

// ─── Service ────────────────────────────────────────────────────

export const trustService = {
  /** Get or create trust score record for a supplier. */
  async getOrCreate(supplierId: string): Promise<SupplierTrustScore> {
    const { data, error } = await supabase
      .from('supplier_trust_scores')
      .select('*')
      .eq('supplier_id', supplierId)
      .maybeSingle();

    if (error) throw new Error(`Failed to fetch trust score: ${error.message}`);
    if (data) return rowToTrustScore(data as Record<string, unknown>);

    // Create initial record
    const { data: created, error: createErr } = await supabase
      .from('supplier_trust_scores')
      .insert({ supplier_id: supplierId })
      .select()
      .single();

    if (createErr) throw new Error(`Failed to create trust score: ${createErr.message}`);
    return rowToTrustScore(created as Record<string, unknown>);
  },

  /** Recalculate trust score from current metrics. */
  async recalculate(supplierId: string): Promise<TrustScoreResult> {
    const record = await this.getOrCreate(supplierId);
    const metrics = rowToMetrics(record as unknown as Record<string, unknown>);
    const result = computeTrustScore(metrics);

    const { error } = await supabase
      .from('supplier_trust_scores')
      .update({
        trust_score: result.trustScore,
        tier: result.tier,
        last_recalculated_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('supplier_id', supplierId);

    if (error) throw new Error(`Failed to update trust score: ${error.message}`);
    return result;
  },

  /** Record a trust-relevant event and recalculate score. */
  async recordEvent(input: RecordEventInput): Promise<TrustScoreResult> {
    const record = await this.getOrCreate(input.supplierId);
    let metrics = rowToMetrics(record as unknown as Record<string, unknown>);

    switch (input.event.type) {
      case 'quote_submitted':
        metrics = updateMetricsAfterQuote(metrics, input.event.responseTimeHrs, input.event.accuracy);
        break;
      case 'order_delivered':
        metrics = updateMetricsAfterDelivery(metrics, input.event.onTime);
        break;
      case 'rating_received':
        metrics = updateMetricsAfterRating(metrics, input.event.rating);
        break;
      case 'dispute_filed':
        metrics = updateMetricsAfterDispute(metrics);
        break;
    }

    const result = computeTrustScore(metrics);

    const { error } = await supabase
      .from('supplier_trust_scores')
      .update({
        avg_response_time_hrs: metrics.avgResponseTimeHrs,
        on_time_delivery_rate: metrics.onTimeDeliveryRate,
        quote_accuracy_rate: metrics.quoteAccuracyRate,
        avg_quality_rating: metrics.avgQualityRating,
        total_orders: metrics.totalOrders,
        total_quotes: metrics.totalQuotes,
        disputes: metrics.disputes,
        trust_score: result.trustScore,
        tier: result.tier,
        last_recalculated_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('supplier_id', input.supplierId);

    if (error) throw new Error(`Failed to persist trust metrics: ${error.message}`);
    return result;
  },

  /** Get trust score for display (read-only). */
  async getScore(supplierId: string): Promise<TrustScoreResult | null> {
    const { data, error } = await supabase
      .from('supplier_trust_scores')
      .select('*')
      .eq('supplier_id', supplierId)
      .maybeSingle();

    if (error) throw new Error(`Failed to fetch trust score: ${error.message}`);
    if (!data) return null;

    const metrics = rowToMetrics(data as Record<string, unknown>);
    return computeTrustScore(metrics);
  },

  /** List all trust scores, optionally filtered by tier. */
  async listScores(tier?: string): Promise<SupplierTrustScore[]> {
    let query = supabase
      .from('supplier_trust_scores')
      .select('*')
      .order('trust_score', { ascending: false });

    if (tier) query = query.eq('tier', tier);

    const { data, error } = await query;
    if (error) throw new Error(`Failed to list trust scores: ${error.message}`);
    return (data ?? []).map((r) => rowToTrustScore(r as Record<string, unknown>));
  },
};
