/**
 * Supplier Trust Scoring — Engine
 *
 * Pure functions to compute trust score from raw metrics.
 * No side effects, fully testable.
 */

import {
  DEFAULT_TRUST_WEIGHTS,
  TIER_THRESHOLDS,
  type TrustMetrics,
  type TrustScoreResult,
  type TrustScoreBreakdown,
  type TrustTier,
  type TrustWeights,
} from './types';

// ─── Helpers ────────────────────────────────────────────────────

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Convert avg response time (hours) to a 0–100 score.
 * ≤ 1 hr → 100, ≥ 72 hrs → 0, linear decay between.
 */
function responseTimeToScore(avgHrs: number): number {
  if (avgHrs <= 1) return 100;
  if (avgHrs >= 72) return 0;
  return round2(100 * (1 - (avgHrs - 1) / 71));
}

/**
 * Volume bonus: up to `maxBonus` points for reaching 50+ orders.
 */
function computeVolumeBonus(totalOrders: number, maxBonus: number): number {
  if (totalOrders >= 50) return maxBonus;
  return round2((totalOrders / 50) * maxBonus);
}

// ─── Core Scorer ────────────────────────────────────────────────

export function computeTrustScore(
  metrics: TrustMetrics,
  weights: TrustWeights = DEFAULT_TRUST_WEIGHTS,
): TrustScoreResult {
  const responseTimeScore = round2(responseTimeToScore(metrics.avgResponseTimeHrs) * weights.responseTime);
  const deliveryRateScore = round2(metrics.onTimeDeliveryRate * 100 * weights.deliveryRate);
  const quoteAccuracyScore = round2(metrics.quoteAccuracyRate * 100 * weights.quoteAccuracy);
  const qualityRatingScore = round2(metrics.avgQualityRating * 100 * weights.qualityRating);

  const disputePenalty = round2(metrics.disputes * weights.disputePenalty);
  const volumeBonus = computeVolumeBonus(metrics.totalOrders, weights.volumeBonus);

  const rawTotal = round2(
    responseTimeScore + deliveryRateScore + quoteAccuracyScore + qualityRatingScore
    + volumeBonus - disputePenalty,
  );

  const clampedTotal = round2(clamp(rawTotal, 0, 100));

  const breakdown: TrustScoreBreakdown = {
    responseTimeScore,
    deliveryRateScore,
    quoteAccuracyScore,
    qualityRatingScore,
    disputePenalty,
    volumeBonus,
    rawTotal,
    clampedTotal,
  };

  return {
    trustScore: clampedTotal,
    tier: scoreToTier(clampedTotal),
    breakdown,
    metrics,
  };
}

// ─── Tier Assignment ────────────────────────────────────────────

export function scoreToTier(score: number): TrustTier {
  for (const threshold of TIER_THRESHOLDS) {
    if (score >= threshold.minScore) return threshold.tier;
  }
  return 'bronze';
}

// ─── Incremental Metric Updates ─────────────────────────────────

/**
 * Incrementally update running averages after a new quote submission.
 */
export function updateMetricsAfterQuote(
  current: TrustMetrics,
  responseTimeHrs: number,
  accuracy?: number,
): TrustMetrics {
  const newTotalQuotes = current.totalQuotes + 1;
  const newAvgResponse = round2(
    (current.avgResponseTimeHrs * current.totalQuotes + responseTimeHrs) / newTotalQuotes,
  );

  let newAccuracy = current.quoteAccuracyRate;
  if (accuracy != null) {
    newAccuracy = round2(
      (current.quoteAccuracyRate * current.totalQuotes + accuracy) / newTotalQuotes,
    );
  }

  return { ...current, avgResponseTimeHrs: newAvgResponse, quoteAccuracyRate: newAccuracy, totalQuotes: newTotalQuotes };
}

/**
 * Incrementally update after an order delivery.
 */
export function updateMetricsAfterDelivery(
  current: TrustMetrics,
  onTime: boolean,
): TrustMetrics {
  const newTotalOrders = current.totalOrders + 1;
  const onTimeCount = Math.round(current.onTimeDeliveryRate * current.totalOrders) + (onTime ? 1 : 0);
  const newDeliveryRate = round2(onTimeCount / newTotalOrders);

  return { ...current, totalOrders: newTotalOrders, onTimeDeliveryRate: newDeliveryRate };
}

/**
 * Incrementally update after a rating is received.
 */
export function updateMetricsAfterRating(
  current: TrustMetrics,
  rating: number,
): TrustMetrics {
  const count = current.totalOrders || 1;
  const newRating = round2((current.avgQualityRating * (count - 1) + clamp(rating, 0, 1)) / count);
  return { ...current, avgQualityRating: newRating };
}

/**
 * Increment dispute count.
 */
export function updateMetricsAfterDispute(current: TrustMetrics): TrustMetrics {
  return { ...current, disputes: current.disputes + 1 };
}
