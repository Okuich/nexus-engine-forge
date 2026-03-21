export { trustService } from './service';
export { computeTrustScore, scoreToTier } from './engine';
export type {
  TrustTier,
  TrustMetrics,
  TrustScoreResult,
  TrustScoreBreakdown,
  SupplierTrustScore,
  RecordEventInput,
  TrustWeights,
  TierThreshold,
} from './types';
export { DEFAULT_TRUST_WEIGHTS, TIER_THRESHOLDS } from './types';
