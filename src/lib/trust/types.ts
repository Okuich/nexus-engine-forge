/**
 * Supplier Trust Scoring — Type Definitions
 *
 * Tracks supplier reliability metrics and computes a composite
 * trust score with bronze/silver/gold tier assignment.
 */

// ─── Tier Definitions ───────────────────────────────────────────

export type TrustTier = 'bronze' | 'silver' | 'gold';

export interface TierThreshold {
  tier: TrustTier;
  minScore: number;
  label: string;
  color: string;
}

export const TIER_THRESHOLDS: TierThreshold[] = [
  { tier: 'gold', minScore: 80, label: 'Gold', color: '#FFD700' },
  { tier: 'silver', minScore: 55, label: 'Silver', color: '#C0C0C0' },
  { tier: 'bronze', minScore: 0, label: 'Bronze', color: '#CD7F32' },
];

// ─── Metric Weights ─────────────────────────────────────────────

export interface TrustWeights {
  responseTime: number;    // 0–1, weight for avg response time
  deliveryRate: number;    // 0–1, weight for on-time delivery
  quoteAccuracy: number;   // 0–1, weight for quote accuracy
  qualityRating: number;   // 0–1, weight for avg quality rating
  disputePenalty: number;  // points deducted per dispute
  volumeBonus: number;     // max bonus points for order volume
}

export const DEFAULT_TRUST_WEIGHTS: TrustWeights = {
  responseTime: 0.15,
  deliveryRate: 0.30,
  quoteAccuracy: 0.25,
  qualityRating: 0.25,
  disputePenalty: 5,
  volumeBonus: 5,
};

// ─── Raw Metrics (input to scoring) ─────────────────────────────

export interface TrustMetrics {
  avgResponseTimeHrs: number;
  onTimeDeliveryRate: number;   // 0–1
  quoteAccuracyRate: number;    // 0–1
  avgQualityRating: number;     // 0–1
  totalOrders: number;
  totalQuotes: number;
  disputes: number;
}

// ─── Scored Output ──────────────────────────────────────────────

export interface TrustScoreResult {
  trustScore: number;           // 0–100
  tier: TrustTier;
  breakdown: TrustScoreBreakdown;
  metrics: TrustMetrics;
}

export interface TrustScoreBreakdown {
  responseTimeScore: number;
  deliveryRateScore: number;
  quoteAccuracyScore: number;
  qualityRatingScore: number;
  disputePenalty: number;
  volumeBonus: number;
  rawTotal: number;
  clampedTotal: number;
}

// ─── DB Record ──────────────────────────────────────────────────

export interface SupplierTrustScore {
  id: string;
  supplierId: string;
  avgResponseTimeHrs: number;
  onTimeDeliveryRate: number;
  quoteAccuracyRate: number;
  avgQualityRating: number;
  totalOrders: number;
  totalQuotes: number;
  disputes: number;
  trustScore: number;
  tier: TrustTier;
  lastRecalculatedAt: string;
  createdAt: string;
  updatedAt: string;
}

// ─── Service Input ──────────────────────────────────────────────

export interface RecordEventInput {
  supplierId: string;
  event:
    | { type: 'quote_submitted'; responseTimeHrs: number; accuracy?: number }
    | { type: 'order_delivered'; onTime: boolean }
    | { type: 'rating_received'; rating: number }
    | { type: 'dispute_filed' };
}
