/**
 * Marketplace Pipeline — Type Definitions
 *
 * Models for the end-to-end flow:
 * Geometry → RFQ → Match → Quote → Price → Order → Payment
 */

import type { GeometryStats } from '@/lib/geometry/types';
import type { RFQ, MatchResult, RFQQuote, MatchedSupplier } from '@/lib/marketplace/types';
import type { PriceCalculationResult } from '@/lib/pricing/types';
import type { MarketplaceOrder, MarketplacePayment, FeeBreakdown } from '@/lib/payments/types';

// ─── Pipeline Stages ────────────────────────────────────────────

export type PipelineStage =
  | 'idle'
  | 'generating_rfq'
  | 'matching_suppliers'
  | 'generating_quotes'
  | 'applying_pricing'
  | 'creating_order'
  | 'processing_payment'
  | 'completed'
  | 'failed';

export interface StageResult {
  stage: PipelineStage;
  status: 'pending' | 'running' | 'completed' | 'skipped' | 'failed';
  durationMs: number;
  error?: string;
}

// ─── Pipeline Input ─────────────────────────────────────────────

export interface PipelineInput {
  /** Part geometry stats from analysis */
  geometryStats: GeometryStats;
  /** Material identifier (e.g., 'al-6061') */
  materialId: string;
  /** Process identifier (e.g., 'cnc-milling') */
  processId: string;
  /** Human-readable material name */
  materialName: string;
  /** Human-readable process name */
  processName: string;
  /** Order quantity */
  quantity: number;
  /** Base cost from cost engine */
  baseCostUsd: number;
  /** Part name */
  partName: string;
  /** Optional pricing account for enterprise rules */
  pricingAccountId?: string;
  /** Required certifications */
  requiredCertifications?: string[];
  /** Max lead time in days */
  maxLeadTimeDays?: number;
  /** Preferred region */
  region?: string;
  /** Auto-select best supplier and proceed */
  autoAward?: boolean;
  /** Auto-process payment after order creation */
  autoPayment?: boolean;
}

// ─── Pipeline Output ────────────────────────────────────────────

export interface PipelineOutput {
  /** Overall pipeline status */
  status: 'completed' | 'partial' | 'failed';
  /** Total pipeline duration in ms */
  totalDurationMs: number;
  /** Per-stage results */
  stages: StageResult[];

  // Stage outputs (populated as pipeline progresses)
  rfq: RFQ | null;
  matchResult: MatchResult | null;
  quotes: RFQQuote[];
  selectedSupplier: MatchedSupplier | null;
  pricingResult: PriceCalculationResult | null;
  order: MarketplaceOrder | null;
  fees: FeeBreakdown | null;
  payment: MarketplacePayment | null;

  /** Summary for display */
  summary: PipelineSummary;
}

export interface PipelineSummary {
  partName: string;
  material: string;
  process: string;
  quantity: number;
  baseCostUsd: number;
  unitPriceUsd: number | null;
  totalPriceUsd: number | null;
  platformFeeUsd: number | null;
  supplierPayoutUsd: number | null;
  supplierName: string | null;
  matchedSupplierCount: number;
  quoteCount: number;
  pipelineDurationMs: number;
}

// ─── Pipeline Events (for progress tracking) ────────────────────

export interface PipelineEvent {
  stage: PipelineStage;
  status: 'started' | 'completed' | 'failed';
  message: string;
  timestamp: number;
  data?: unknown;
}

export type PipelineEventHandler = (event: PipelineEvent) => void;
