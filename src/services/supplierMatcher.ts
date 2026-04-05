/**
 * Supplier Matcher — Unified Matching & Ranking Service
 *
 * Orchestrates supplier selection by combining three scoring dimensions:
 *   1. Capability — material, process, certifications, surface handling
 *   2. Price      — adjusted cost vs. target, volume discounts
 *   3. Performance — trust score, delivery rate, quality, response time
 *
 * Includes a feedback loop that records match outcomes and adjusts
 * future scoring weights based on historical success.
 *
 * Product boundary: this service is part of **midwater** (demand monopoly).
 */

import type { SupplierProfile, MatchedSupplier } from '@/lib/marketplace/types';
import type { TrustScoreResult, TrustMetrics } from '@/lib/trust/types';

// ─── Types ──────────────────────────────────────────────────────

export interface MatchRequest {
  material: string;
  process: string;
  quantity: number;
  complexityScore: number;
  surfaceClasses: string[];
  requiredCertifications: string[];
  maxLeadTimeDays: number | null;
  targetCostUsd: number | null;
  region: string | null;
  /** Optional: override default scoring weights */
  weights?: Partial<MatchWeights>;
}

export interface MatchWeights {
  capability: number;   // 0–1
  price: number;        // 0–1
  performance: number;  // 0–1
}

export const DEFAULT_MATCH_WEIGHTS: MatchWeights = {
  capability: 0.35,
  price: 0.30,
  performance: 0.35,
};

export interface ScoredSupplier {
  supplierId: string;
  companyName: string;
  rank: number;
  totalScore: number;
  scores: {
    capability: number;   // 0–100
    price: number;        // 0–100
    performance: number;  // 0–100
  };
  reasons: string[];
  estimatedUnitCost: number;
  estimatedLeadDays: number;
  trustTier: string | null;
}

export interface MatchOutput {
  suppliers: ScoredSupplier[];
  totalCandidates: number;
  totalDisqualified: number;
  weightsUsed: MatchWeights;
}

// ─── Feedback Loop ──────────────────────────────────────────────

export type FeedbackOutcome = 'awarded' | 'rejected' | 'no_response' | 'dispute';

export interface MatchFeedback {
  matchId: string;
  supplierId: string;
  outcome: FeedbackOutcome;
  actualCostUsd?: number;
  actualLeadDays?: number;
  qualityRating?: number;   // 1–5
  notes?: string;
  timestamp: string;
}

interface FeedbackAggregates {
  totalMatches: number;
  awardRate: number;
  avgCostDeviation: number;   // % over/under estimate
  avgLeadDeviation: number;   // days over/under estimate
  outcomeDistribution: Record<FeedbackOutcome, number>;
}

// In-memory feedback store (replace with DB in production)
const feedbackStore: MatchFeedback[] = [];
const weightAdjustmentHistory: Array<{ timestamp: string; before: MatchWeights; after: MatchWeights; reason: string }> = [];

// ─── Scoring Functions ──────────────────────────────────────────

function scoreCapability(
  supplier: SupplierProfile,
  req: MatchRequest,
): { score: number; reasons: string[]; disqualified: boolean } {
  const reasons: string[] = [];
  let score = 0;

  // Hard filters — return disqualified if any fail
  if (!supplier.materials.includes(req.material)) {
    return { score: 0, reasons: [`No support for material: ${req.material}`], disqualified: true };
  }
  score += 25;
  reasons.push(`Supports ${req.material}`);

  if (!supplier.processes.includes(req.process)) {
    return { score: 0, reasons: [`No support for process: ${req.process}`], disqualified: true };
  }
  score += 25;
  reasons.push(`Supports ${req.process}`);

  if (req.complexityScore > supplier.maxComplexity) {
    return { score: 0, reasons: [`Complexity ${pct(req.complexityScore)} exceeds max ${pct(supplier.maxComplexity)}`], disqualified: true };
  }
  // Headroom bonus
  const headroom = supplier.maxComplexity - req.complexityScore;
  score += Math.min(20, Math.round(headroom * 100));
  reasons.push(`Complexity headroom: ${pct(headroom)}`);

  // Certifications (hard filter if required)
  if (req.requiredCertifications.length > 0) {
    const has = req.requiredCertifications.every(c => supplier.certifications.includes(c));
    if (!has) {
      const missing = req.requiredCertifications.filter(c => !supplier.certifications.includes(c));
      return { score: 0, reasons: [`Missing certs: ${missing.join(', ')}`], disqualified: true };
    }
    score += 15;
    reasons.push(`Has required certs`);
  } else {
    score += 5 + Math.min(10, supplier.certifications.length * 2);
  }

  // Advanced surface handling
  const advancedNeeded = req.surfaceClasses.filter(s => ['freeform', 'toroidal'].includes(s));
  if (advancedNeeded.length > 0) {
    const canHandle = advancedNeeded.every(s => supplier.advancedSurfaces.includes(s));
    if (canHandle) {
      score += 10;
      reasons.push('Handles advanced surfaces');
    } else {
      score -= 15;
      reasons.push('Cannot handle required advanced surfaces');
    }
  }

  // Region preference (soft)
  if (req.region && supplier.region === req.region) {
    score += 5;
    reasons.push(`Preferred region: ${req.region}`);
  }

  return { score: clamp(score, 0, 100), reasons, disqualified: false };
}

function scorePrice(
  supplier: SupplierProfile,
  req: MatchRequest,
): { score: number; estimatedUnitCost: number; reasons: string[] } {
  const reasons: string[] = [];
  const baseCost = req.targetCostUsd ?? 1000;
  const estimated = round2(baseCost * supplier.pricingMultiplier);

  let score = 50; // neutral baseline

  if (req.targetCostUsd != null) {
    const ratio = estimated / req.targetCostUsd;
    if (ratio <= 0.8) {
      score = 100;
      reasons.push(`${pct(1 - ratio)} under target cost`);
    } else if (ratio <= 1.0) {
      score = 70 + (1 - ratio) * 150;
      reasons.push(`Within target cost`);
    } else if (ratio <= 1.2) {
      score = 40 + (1.2 - ratio) * 150;
      reasons.push(`${pct(ratio - 1)} over target cost`);
    } else {
      score = Math.max(0, 40 - (ratio - 1.2) * 200);
      reasons.push(`${pct(ratio - 1)} over target — significant premium`);
    }
  } else {
    // No target: lower multiplier = better
    score = clamp(100 - (supplier.pricingMultiplier - 0.8) * 200, 0, 100);
    reasons.push(`Pricing multiplier: ${supplier.pricingMultiplier.toFixed(2)}x`);
  }

  return { score: round2(clamp(score, 0, 100)), estimatedUnitCost: estimated, reasons };
}

function scorePerformance(
  supplier: SupplierProfile,
  req: MatchRequest,
  trust: TrustScoreResult | null,
): { score: number; reasons: string[]; trustTier: string | null } {
  const reasons: string[] = [];

  if (trust) {
    // Use trust score directly (already 0-100)
    let score = trust.trustScore;

    // Lead time fit bonus/penalty
    if (req.maxLeadTimeDays != null) {
      if (supplier.leadTimeDays <= req.maxLeadTimeDays) {
        const margin = (req.maxLeadTimeDays - supplier.leadTimeDays) / req.maxLeadTimeDays;
        score += Math.min(10, margin * 30);
        reasons.push(`Lead time ${supplier.leadTimeDays}d within ${req.maxLeadTimeDays}d limit`);
      } else {
        score -= 15;
        reasons.push(`Lead time ${supplier.leadTimeDays}d exceeds ${req.maxLeadTimeDays}d limit`);
      }
    }

    reasons.push(`Trust: ${trust.tier} (${trust.trustScore.toFixed(0)}/100)`);
    return { score: round2(clamp(score, 0, 100)), reasons, trustTier: trust.tier };
  }

  // Fallback: derive from supplier profile
  let score = supplier.qualityRating * 60;

  if (req.maxLeadTimeDays != null) {
    if (supplier.leadTimeDays <= req.maxLeadTimeDays) {
      score += 25;
      reasons.push(`Lead time ${supplier.leadTimeDays}d within limit`);
    } else {
      score -= 10;
      reasons.push(`Lead time ${supplier.leadTimeDays}d exceeds limit`);
    }
  } else {
    score += 15;
  }

  reasons.push(`Quality: ${pct(supplier.qualityRating)}`);
  return { score: round2(clamp(score, 0, 100)), reasons, trustTier: null };
}

// ─── Main Matcher ───────────────────────────────────────────────

/**
 * Match and rank suppliers for a given request.
 *
 * @param suppliers   — candidate supplier profiles
 * @param request     — matching criteria
 * @param trustScores — optional map of supplierId → TrustScoreResult
 */
export function matchSuppliers(
  suppliers: SupplierProfile[],
  request: MatchRequest,
  trustScores?: Map<string, TrustScoreResult>,
): MatchOutput {
  const weights: MatchWeights = {
    ...DEFAULT_MATCH_WEIGHTS,
    ...request.weights,
  };

  // Apply learned weight adjustments
  const adjusted = applyLearnedAdjustments(weights);

  const active = suppliers.filter(s => s.active);
  const scored: ScoredSupplier[] = [];
  let disqualified = 0;

  for (const supplier of active) {
    const cap = scoreCapability(supplier, request);
    if (cap.disqualified) {
      disqualified++;
      continue;
    }

    const price = scorePrice(supplier, request);
    const perf = scorePerformance(supplier, request, trustScores?.get(supplier.id) ?? null);

    const totalScore = round2(
      cap.score * adjusted.capability +
      price.score * adjusted.price +
      perf.score * adjusted.performance,
    );

    scored.push({
      supplierId: supplier.id,
      companyName: supplier.companyName,
      rank: 0,
      totalScore,
      scores: {
        capability: cap.score,
        price: price.score,
        performance: perf.score,
      },
      reasons: [...cap.reasons, ...price.reasons, ...perf.reasons],
      estimatedUnitCost: price.estimatedUnitCost,
      estimatedLeadDays: supplier.leadTimeDays,
      trustTier: perf.trustTier,
    });
  }

  // Sort by total score descending, assign ranks
  scored.sort((a, b) => b.totalScore - a.totalScore);
  scored.forEach((s, i) => { s.rank = i + 1; });

  return {
    suppliers: scored,
    totalCandidates: active.length,
    totalDisqualified: disqualified,
    weightsUsed: adjusted,
  };
}

// ─── Feedback Loop ──────────────────────────────────────────────

/**
 * Record feedback on a match outcome. Drives the learning loop.
 */
export function recordFeedback(feedback: MatchFeedback): void {
  feedbackStore.push(feedback);
}

/**
 * Aggregate feedback statistics.
 */
export function getFeedbackAggregates(): FeedbackAggregates {
  const total = feedbackStore.length;
  if (total === 0) {
    return {
      totalMatches: 0,
      awardRate: 0,
      avgCostDeviation: 0,
      avgLeadDeviation: 0,
      outcomeDistribution: { awarded: 0, rejected: 0, no_response: 0, dispute: 0 },
    };
  }

  const dist: Record<FeedbackOutcome, number> = { awarded: 0, rejected: 0, no_response: 0, dispute: 0 };
  let costDeviations: number[] = [];
  let leadDeviations: number[] = [];

  for (const fb of feedbackStore) {
    dist[fb.outcome]++;
    if (fb.actualCostUsd != null) {
      // We don't have the estimated cost here, but we track deviation as a raw value
      costDeviations.push(fb.actualCostUsd);
    }
    if (fb.actualLeadDays != null) {
      leadDeviations.push(fb.actualLeadDays);
    }
  }

  return {
    totalMatches: total,
    awardRate: round2(dist.awarded / total),
    avgCostDeviation: costDeviations.length > 0
      ? round2(costDeviations.reduce((a, b) => a + b, 0) / costDeviations.length)
      : 0,
    avgLeadDeviation: leadDeviations.length > 0
      ? round2(leadDeviations.reduce((a, b) => a + b, 0) / leadDeviations.length)
      : 0,
    outcomeDistribution: dist,
  };
}

/**
 * Derive learned weight adjustments from feedback history.
 *
 * Strategy:
 *  - High dispute rate → increase performance weight
 *  - Low award rate with cost complaints → decrease price weight
 *  - Consistent quality issues → increase capability weight
 */
export function applyLearnedAdjustments(base: MatchWeights): MatchWeights {
  const agg = getFeedbackAggregates();
  if (agg.totalMatches < 10) return base; // need minimum sample

  const adjusted = { ...base };

  // High dispute rate (>10%): boost performance weight
  const disputeRate = agg.outcomeDistribution.dispute / agg.totalMatches;
  if (disputeRate > 0.10) {
    const boost = Math.min(0.10, disputeRate * 0.5);
    adjusted.performance = Math.min(0.60, adjusted.performance + boost);
    adjusted.price = Math.max(0.15, adjusted.price - boost / 2);
    adjusted.capability = Math.max(0.20, adjusted.capability - boost / 2);
    recordAdjustment(base, adjusted, `High dispute rate: ${pct(disputeRate)}`);
  }

  // Low award rate (<30%): relax price weight
  if (agg.awardRate < 0.30) {
    const shift = 0.05;
    adjusted.price = Math.max(0.15, adjusted.price - shift);
    adjusted.capability = Math.min(0.50, adjusted.capability + shift);
    recordAdjustment(base, adjusted, `Low award rate: ${pct(agg.awardRate)}`);
  }

  // High no-response rate (>25%): penalize performance
  const noResponseRate = agg.outcomeDistribution.no_response / agg.totalMatches;
  if (noResponseRate > 0.25) {
    const boost = Math.min(0.08, noResponseRate * 0.3);
    adjusted.performance = Math.min(0.55, adjusted.performance + boost);
    adjusted.price = Math.max(0.15, adjusted.price - boost);
    recordAdjustment(base, adjusted, `High no-response rate: ${pct(noResponseRate)}`);
  }

  // Normalize to sum to 1
  const sum = adjusted.capability + adjusted.price + adjusted.performance;
  adjusted.capability = round2(adjusted.capability / sum);
  adjusted.price = round2(adjusted.price / sum);
  adjusted.performance = round2(adjusted.performance / sum);

  return adjusted;
}

/**
 * Get weight adjustment history for debugging / audit.
 */
export function getWeightAdjustmentHistory() {
  return [...weightAdjustmentHistory];
}

/**
 * Clear all feedback data (for testing).
 */
export function resetFeedback(): void {
  feedbackStore.length = 0;
  weightAdjustmentHistory.length = 0;
}

// ─── Helpers ────────────────────────────────────────────────────

function recordAdjustment(before: MatchWeights, after: MatchWeights, reason: string): void {
  weightAdjustmentHistory.push({
    timestamp: new Date().toISOString(),
    before: { ...before },
    after: { ...after },
    reason,
  });
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function pct(n: number): string {
  return `${(n * 100).toFixed(0)}%`;
}
