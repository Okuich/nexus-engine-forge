/**
 * Supplier Marketplace — Public API
 */

export { marketplaceService, MarketplaceService } from './service';
export { matchSuppliersToRFQ } from './matchingEngine';
export { rankQuotes } from './rankingEngine';
export type {
  RFQ,
  RFQStatus,
  RFQQuote,
  QuoteStatus,
  SupplierProfile,
  MatchResult,
  MatchedSupplier,
  ScoreBreakdown,
  RankingWeights,
  CreateRFQRequest,
  SubmitQuoteRequest,
  QuoteAdjustment,
} from './types';
export { DEFAULT_RANKING_WEIGHTS } from './types';
