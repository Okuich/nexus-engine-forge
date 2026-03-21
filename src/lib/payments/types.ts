/**
 * Marketplace Payments — Type Definitions
 *
 * Models for orders, payments, payouts, and fee calculations.
 */

// ─── Order ──────────────────────────────────────────────────────

export type OrderStatus =
  | 'pending'
  | 'confirmed'
  | 'paid'
  | 'processing'
  | 'shipped'
  | 'completed'
  | 'cancelled'
  | 'refunded'
  | 'disputed';

export interface MarketplaceOrder {
  id: string;
  rfqId: string | null;
  quoteId: string | null;
  buyerId: string;
  supplierId: string;
  unitPriceUsd: number;
  quantity: number;
  subtotalUsd: number;
  platformFeeUsd: number;
  platformFeePct: number;
  supplierPayoutUsd: number;
  taxUsd: number;
  totalUsd: number;
  currency: string;
  status: OrderStatus;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

// ─── Payment ────────────────────────────────────────────────────

export type PaymentStatus =
  | 'pending'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'refunded'
  | 'partially_refunded';

export type PaymentMethod =
  | 'platform_balance'
  | 'credit_card'
  | 'bank_transfer'
  | 'wire'
  | 'crypto';

export interface MarketplacePayment {
  id: string;
  orderId: string;
  payerId: string;
  amountUsd: number;
  platformFeeUsd: number;
  supplierPayoutUsd: number;
  paymentMethod: PaymentMethod;
  externalPaymentId: string | null;
  status: PaymentStatus;
  failureReason: string | null;
  paidAt: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

// ─── Supplier Payout ────────────────────────────────────────────

export type PayoutStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface SupplierPayout {
  id: string;
  supplierId: string;
  paymentId: string;
  orderId: string;
  amountUsd: number;
  status: PayoutStatus;
  payoutMethod: string;
  externalPayoutId: string | null;
  processedAt: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

// ─── Fee Calculation ────────────────────────────────────────────

export interface FeeSchedule {
  /** Base platform fee percentage (default 5%) */
  basePlatformFeePct: number;
  /** Tiered fee reductions based on order volume */
  volumeTiers: FeeTier[];
  /** Minimum platform fee in USD */
  minFeeUsd: number;
  /** Maximum platform fee cap in USD (null = uncapped) */
  maxFeeUsd: number | null;
  /** Tax rate percentage (0 for B2B exempt) */
  taxRatePct: number;
}

export interface FeeTier {
  minSubtotalUsd: number;
  feePct: number;
}

export interface FeeBreakdown {
  subtotalUsd: number;
  platformFeePct: number;
  platformFeeUsd: number;
  taxUsd: number;
  totalUsd: number;
  supplierPayoutUsd: number;
  tierApplied: string;
}

export const DEFAULT_FEE_SCHEDULE: FeeSchedule = {
  basePlatformFeePct: 5.0,
  volumeTiers: [
    { minSubtotalUsd: 50_000, feePct: 4.0 },
    { minSubtotalUsd: 100_000, feePct: 3.5 },
    { minSubtotalUsd: 250_000, feePct: 3.0 },
    { minSubtotalUsd: 500_000, feePct: 2.5 },
  ],
  minFeeUsd: 25,
  maxFeeUsd: null,
  taxRatePct: 0,
};

// ─── API Requests ───────────────────────────────────────────────

export interface CreateOrderRequest {
  rfqId?: string;
  quoteId?: string;
  supplierId: string;
  unitPriceUsd: number;
  quantity: number;
  feeSchedule?: Partial<FeeSchedule>;
  metadata?: Record<string, unknown>;
}

export interface ProcessPaymentRequest {
  orderId: string;
  paymentMethod?: PaymentMethod;
  externalPaymentId?: string;
  metadata?: Record<string, unknown>;
}

export interface RefundRequest {
  paymentId: string;
  amountUsd?: number;
  reason?: string;
}
