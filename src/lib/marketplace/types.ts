/**
 * Supplier Marketplace — Type Definitions
 *
 * Data models for the RFQ system, supplier matching,
 * quote submission, and ranking.
 */

// ─── RFQ (Request for Quotation) ────────────────────────────────

export type RFQStatus = 'draft' | 'open' | 'evaluating' | 'awarded' | 'closed' | 'cancelled';

export interface RFQ {
  id: string;
  title: string;
  description: string | null;
  partName: string;
  material: string;
  process: string;
  quantity: number;
  complexityScore: number;
  surfaceClasses: string[];
  requiredCertifications: string[];
  maxLeadTimeDays: number | null;
  region: string | null;
  targetCostUsd: number | null;
  geometryStats: Record<string, unknown>;
  status: RFQStatus;
  createdBy: string;
  tenantId: string | null;
  deadline: string | null;
  createdAt: string;
  updatedAt: string;
  /** Computed: number of quotes received */
  quoteCount?: number;
  /** Computed: best quote */
  bestQuote?: RFQQuote | null;
}

// ─── Supplier Profile ────────────────────────────────────────────

export interface SupplierProfile {
  id: string;
  userId: string;
  companyName: string;
  materials: string[];
  processes: string[];
  maxComplexity: number;
  advancedSurfaces: string[];
  leadTimeDays: number;
  qualityRating: number;
  region: string;
  minOrderUsd: number;
  pricingMultiplier: number;
  certifications: string[];
  active: boolean;
  tenantId: string | null;
  createdAt: string;
  updatedAt: string;
}

// ─── RFQ Quote (Supplier Response) ──────────────────────────────

export type QuoteStatus = 'submitted' | 'under-review' | 'accepted' | 'rejected' | 'withdrawn';

export interface RFQQuote {
  id: string;
  rfqId: string;
  supplierId: string;
  unitPriceUsd: number;
  totalPriceUsd: number;
  leadTimeDays: number;
  notes: string | null;
  adjustments: QuoteAdjustment[];
  confidence: number;
  status: QuoteStatus;
  rank: number | null;
  score: number | null;
  scoreBreakdown: ScoreBreakdown;
  createdAt: string;
  updatedAt: string;
  /** Joined supplier info */
  supplier?: SupplierProfile;
}

export interface QuoteAdjustment {
  label: string;
  factor: number;
  deltaUsd: number;
}

// ─── Scoring & Ranking ──────────────────────────────────────────

export interface ScoreBreakdown {
  costScore: number;
  leadTimeScore: number;
  qualityScore: number;
  certificationScore: number;
  complexityFitScore: number;
  /** Weighted total 0-100 */
  totalScore: number;
}

export interface RankingWeights {
  cost: number;
  leadTime: number;
  quality: number;
  certification: number;
  complexityFit: number;
}

export const DEFAULT_RANKING_WEIGHTS: RankingWeights = {
  cost: 0.35,
  leadTime: 0.20,
  quality: 0.25,
  certification: 0.10,
  complexityFit: 0.10,
};

// ─── Matching Result ─────────────────────────────────────────────

export interface MatchResult {
  rfqId: string;
  matchedSuppliers: MatchedSupplier[];
  totalEligible: number;
  totalFiltered: number;
  matchCriteria: string[];
}

export interface MatchedSupplier {
  supplierId: string;
  companyName: string;
  fitScore: number;
  matchReasons: string[];
  disqualifyReasons: string[];
  estimatedUnitCost: number;
  estimatedLeadDays: number;
}

// ─── API Request/Response ────────────────────────────────────────

export interface CreateRFQRequest {
  title: string;
  description?: string;
  partName: string;
  material: string;
  process: string;
  quantity: number;
  complexityScore?: number;
  surfaceClasses?: string[];
  requiredCertifications?: string[];
  maxLeadTimeDays?: number;
  region?: string;
  targetCostUsd?: number;
  geometryStats?: Record<string, unknown>;
  deadline?: string;
}

export interface SubmitQuoteRequest {
  rfqId: string;
  unitPriceUsd: number;
  leadTimeDays: number;
  notes?: string;
  adjustments?: QuoteAdjustment[];
  confidence?: number;
}
