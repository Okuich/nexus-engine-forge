/**
 * Supplier Marketplace — Ranking Engine
 *
 * Scores and ranks supplier quotes using a weighted
 * multi-criteria decision analysis (MCDA) approach.
 */

import type {
  RFQQuote,
  ScoreBreakdown,
  RankingWeights,
  SupplierProfile,
} from './types';
import { DEFAULT_RANKING_WEIGHTS } from './types';

interface RankingContext {
  targetCostUsd: number | null;
  maxLeadTimeDays: number | null;
  requiredCertifications: string[];
  complexityScore: number;
}

/**
 * Score and rank an array of quotes for the same RFQ.
 * Mutates the rank and score fields on each quote.
 */
export function rankQuotes(
  quotes: RFQQuote[],
  suppliers: Map<string, SupplierProfile>,
  context: RankingContext,
  weights: RankingWeights = DEFAULT_RANKING_WEIGHTS,
): RFQQuote[] {
  if (quotes.length === 0) return [];

  // Normalize ranges
  const prices = quotes.map((q) => q.unitPriceUsd);
  const leads = quotes.map((q) => q.leadTimeDays);
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const minLead = Math.min(...leads);
  const maxLead = Math.max(...leads);
  const priceRange = maxPrice - minPrice || 1;
  const leadRange = maxLead - minLead || 1;

  for (const quote of quotes) {
    const supplier = suppliers.get(quote.supplierId);

    // Cost score: lower is better (0-100)
    const costScore = 100 - ((quote.unitPriceUsd - minPrice) / priceRange) * 100;

    // Target cost bonus
    const targetBonus = context.targetCostUsd != null && quote.unitPriceUsd <= context.targetCostUsd
      ? 10
      : 0;

    // Lead time score: lower is better
    const leadTimeScore = 100 - ((quote.leadTimeDays - minLead) / leadRange) * 100;

    // Quality score from supplier profile
    const qualityScore = (supplier?.qualityRating ?? 0.7) * 100;

    // Certification score
    let certificationScore = 50;
    if (supplier && context.requiredCertifications.length > 0) {
      const matched = context.requiredCertifications.filter((c) =>
        supplier.certifications.includes(c),
      ).length;
      certificationScore = (matched / context.requiredCertifications.length) * 100;
    } else if (supplier) {
      certificationScore = Math.min(100, supplier.certifications.length * 20);
    }

    // Complexity fit score
    let complexityFitScore = 50;
    if (supplier) {
      const headroom = supplier.maxComplexity - context.complexityScore;
      complexityFitScore = headroom >= 0
        ? Math.min(100, 60 + headroom * 200)
        : Math.max(0, 60 + headroom * 300);
    }

    const breakdown: ScoreBreakdown = {
      costScore: round(costScore + targetBonus),
      leadTimeScore: round(leadTimeScore),
      qualityScore: round(qualityScore),
      certificationScore: round(certificationScore),
      complexityFitScore: round(complexityFitScore),
      totalScore: 0,
    };

    // Weighted total
    breakdown.totalScore = round(
      breakdown.costScore * weights.cost +
      breakdown.leadTimeScore * weights.leadTime +
      breakdown.qualityScore * weights.quality +
      breakdown.certificationScore * weights.certification +
      breakdown.complexityFitScore * weights.complexityFit,
    );

    quote.score = breakdown.totalScore;
    quote.scoreBreakdown = breakdown;
  }

  // Sort by total score descending, assign ranks
  quotes.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  quotes.forEach((q, i) => { q.rank = i + 1; });

  return quotes;
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}
