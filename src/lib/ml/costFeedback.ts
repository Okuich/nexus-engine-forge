/**
 * Midwater Cost Feedback Service
 *
 * Persists predicted vs actual cost feedback and computes
 * correction factors from historical data.
 */

import { supabase } from '@/integrations/supabase/client';
import type { CostFeedback, CorrectionFactors } from './costEngine';
import { computeCorrectionFactors, selectCorrectionFactor } from './costEngine';

// ─── Submit Feedback ─────────────────────────────────────────────

export async function submitCostFeedback(feedback: CostFeedback): Promise<void> {
  const { error } = await supabase
    .from('cost_feedback')
    .insert({
      estimate_id: feedback.estimateId,
      predicted_cost: feedback.predictedCost,
      actual_cost: feedback.actualCost,
      material: feedback.material,
      process: feedback.process,
      complexity_score: feedback.complexityScore,
      correction_factor: feedback.actualCost / feedback.predictedCost,
      notes: feedback.notes ?? null,
    });

  if (error) throw new Error(`Failed to submit feedback: ${error.message}`);
}

// ─── Fetch Feedback History ──────────────────────────────────────

export async function fetchCostFeedback(limit = 200): Promise<CostFeedback[]> {
  const { data, error } = await supabase
    .from('cost_feedback')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw new Error(`Failed to fetch feedback: ${error.message}`);

  return (data ?? []).map((row: any) => ({
    estimateId: row.estimate_id,
    predictedCost: row.predicted_cost,
    actualCost: row.actual_cost,
    material: row.material,
    process: row.process,
    complexityScore: row.complexity_score,
    notes: row.notes,
  }));
}

// ─── Compute & Cache Correction Factors ──────────────────────────

let cachedFactors: CorrectionFactors | null = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 60_000; // 1 minute

export async function getCorrectionFactors(forceRefresh = false): Promise<CorrectionFactors> {
  const now = Date.now();
  if (!forceRefresh && cachedFactors && (now - cacheTimestamp) < CACHE_TTL_MS) {
    return cachedFactors;
  }

  const feedback = await fetchCostFeedback(500);
  cachedFactors = computeCorrectionFactors(feedback);
  cacheTimestamp = now;
  return cachedFactors;
}

/**
 * Get the best correction factor for a specific estimate context.
 * Fetches factors from DB if not cached.
 */
export async function getCorrectionForContext(
  materialId: string,
  processId: string,
  complexityScore: number,
): Promise<number> {
  const factors = await getCorrectionFactors();
  return selectCorrectionFactor(factors, materialId, processId, complexityScore);
}

// ─── Feedback Statistics ─────────────────────────────────────────

export interface FeedbackStats {
  totalSamples: number;
  meanAbsoluteError: number;
  meanAbsolutePercentageError: number;
  medianRatio: number;
  underestimates: number;
  overestimates: number;
}

export async function getFeedbackStats(): Promise<FeedbackStats> {
  const feedback = await fetchCostFeedback(500);

  if (feedback.length === 0) {
    return {
      totalSamples: 0,
      meanAbsoluteError: 0,
      meanAbsolutePercentageError: 0,
      medianRatio: 1,
      underestimates: 0,
      overestimates: 0,
    };
  }

  const errors = feedback.map((f) => Math.abs(f.actualCost - f.predictedCost));
  const pctErrors = feedback.map((f) =>
    Math.abs(f.actualCost - f.predictedCost) / Math.max(f.predictedCost, 0.01),
  );
  const ratios = feedback.map((f) => f.actualCost / f.predictedCost).sort((a, b) => a - b);

  const mid = Math.floor(ratios.length / 2);
  const medianRatio = ratios.length % 2 === 0
    ? (ratios[mid - 1] + ratios[mid]) / 2
    : ratios[mid];

  return {
    totalSamples: feedback.length,
    meanAbsoluteError: +(errors.reduce((s, e) => s + e, 0) / errors.length).toFixed(2),
    meanAbsolutePercentageError: +(pctErrors.reduce((s, e) => s + e, 0) / pctErrors.length * 100).toFixed(1),
    medianRatio: +medianRatio.toFixed(4),
    underestimates: feedback.filter((f) => f.actualCost > f.predictedCost * 1.05).length,
    overestimates: feedback.filter((f) => f.actualCost < f.predictedCost * 0.95).length,
  };
}
