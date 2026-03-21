/**
 * Marketplace Support Tools — Type Definitions & Executor
 *
 * Extensible tool registry for marketplace operations:
 * check_order, recompute_quote, refund, escalate
 */

// ─── Tool Result ────────────────────────────────────────────────

export interface ToolResult<T = Record<string, unknown>> {
  tool: string;
  success: boolean;
  data: T;
  warnings: string[];
  durationMs: number;
}

// ─── Tool Definition ────────────────────────────────────────────

export interface MarketplaceToolDef {
  name: string;
  description: string;
  parameters: {
    name: string;
    type: string;
    required: boolean;
    description: string;
  }[];
}

// ─── Tool Input Types ───────────────────────────────────────────

export interface CheckOrderInput {
  orderId: string;
}

export interface CheckOrderOutput {
  orderId: string;
  status: string;
  buyerId: string;
  supplierId: string;
  unitPriceUsd: number;
  quantity: number;
  totalUsd: number;
  platformFeeUsd: number;
  supplierPayoutUsd: number;
  createdAt: string;
  paymentStatus: string | null;
}

export interface RecomputeQuoteInput {
  rfqId: string;
  supplierId?: string;
  quantity?: number;
}

export interface RecomputeQuoteOutput {
  rfqId: string;
  supplierId: string;
  originalUnitPrice: number;
  recomputedUnitPrice: number;
  deltaUsd: number;
  deltaPct: number;
  quantity: number;
  newTotalUsd: number;
  appliedAdjustments: string[];
}

export interface RefundInput {
  orderId: string;
  reason: string;
  amountUsd?: number; // partial refund; omit for full
}

export interface RefundOutput {
  orderId: string;
  refundType: 'full' | 'partial';
  refundAmountUsd: number;
  platformFeeRefundUsd: number;
  supplierDeductionUsd: number;
  newOrderStatus: string;
  reason: string;
}

export interface EscalateInput {
  orderId?: string;
  issueType: 'quality' | 'delivery' | 'pricing' | 'dispute' | 'other';
  description: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
}

export interface EscalateOutput {
  ticketId: string;
  issueType: string;
  priority: string;
  assignedTo: string;
  slaHours: number;
  status: string;
  relatedOrderId: string | null;
}
