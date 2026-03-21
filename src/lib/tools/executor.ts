/**
 * Marketplace Support Tools — Executor
 *
 * Routes tool calls to implementations and returns structured results.
 * Each handler is independently testable. New tools are added by
 * registering a handler in the TOOL_HANDLERS map.
 */

import { supabase } from '@/integrations/supabase/client';
import { calculateFees, calculateRefundFees } from '@/lib/payments/feeEngine';
import type {
  ToolResult,
  CheckOrderInput,
  CheckOrderOutput,
  RecomputeQuoteInput,
  RecomputeQuoteOutput,
  RefundInput,
  RefundOutput,
  EscalateInput,
  EscalateOutput,
} from './types';

// ─── Tool Handler Type ──────────────────────────────────────────

type ToolHandler<I, O> = (input: I) => Promise<ToolResult<O>>;

// ─── Helpers ────────────────────────────────────────────────────

function ok<T>(tool: string, data: T, durationMs: number, warnings: string[] = []): ToolResult<T> {
  return { tool, success: true, data, warnings, durationMs };
}

function fail<T>(tool: string, data: T, durationMs: number, warnings: string[] = []): ToolResult<T> {
  return { tool, success: false, data, warnings, durationMs };
}

// ─── check_order ────────────────────────────────────────────────

const checkOrder: ToolHandler<CheckOrderInput, CheckOrderOutput | { error: string }> = async (input) => {
  const start = performance.now();

  const { data: order, error } = await supabase
    .from('marketplace_orders')
    .select('*')
    .eq('id', input.orderId)
    .maybeSingle();

  if (error || !order) {
    return fail('check_order', { error: error?.message ?? 'Order not found' }, Math.round(performance.now() - start));
  }

  // Check for payment
  const { data: payment } = await supabase
    .from('marketplace_payments')
    .select('status')
    .eq('order_id', input.orderId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const result: CheckOrderOutput = {
    orderId: order.id,
    status: order.status,
    buyerId: order.buyer_id,
    supplierId: order.supplier_id,
    unitPriceUsd: Number(order.unit_price_usd),
    quantity: order.quantity,
    totalUsd: Number(order.total_usd),
    platformFeeUsd: Number(order.platform_fee_usd),
    supplierPayoutUsd: Number(order.supplier_payout_usd),
    createdAt: order.created_at,
    paymentStatus: payment?.status ?? null,
  };

  const warnings: string[] = [];
  if (order.status === 'pending' && new Date(order.created_at) < new Date(Date.now() - 7 * 86400000)) {
    warnings.push('Order has been pending for over 7 days');
  }

  return ok('check_order', result, Math.round(performance.now() - start), warnings);
};

// ─── recompute_quote ────────────────────────────────────────────

const recomputeQuote: ToolHandler<RecomputeQuoteInput, RecomputeQuoteOutput | { error: string }> = async (input) => {
  const start = performance.now();

  // Fetch RFQ
  const { data: rfq, error: rfqErr } = await supabase
    .from('rfqs')
    .select('*')
    .eq('id', input.rfqId)
    .maybeSingle();

  if (rfqErr || !rfq) {
    return fail('recompute_quote', { error: rfqErr?.message ?? 'RFQ not found' }, Math.round(performance.now() - start));
  }

  // Fetch best existing quote
  let quoteQuery = supabase
    .from('rfq_quotes')
    .select('*')
    .eq('rfq_id', input.rfqId)
    .order('score', { ascending: false })
    .limit(1);

  if (input.supplierId) {
    quoteQuery = quoteQuery.eq('supplier_id', input.supplierId);
  }

  const { data: quotes } = await quoteQuery;
  const existingQuote = quotes?.[0];

  if (!existingQuote) {
    return fail('recompute_quote', { error: 'No quotes found for this RFQ' }, Math.round(performance.now() - start));
  }

  const quantity = input.quantity ?? rfq.quantity;
  const originalUnit = Number(existingQuote.unit_price_usd);

  // Recompute with current pricing: apply complexity and volume adjustments
  const complexityMultiplier = 1 + (Number(rfq.complexity_score) * 0.3);
  const volumeDiscount = quantity >= 100 ? 0.85 : quantity >= 50 ? 0.90 : quantity >= 10 ? 0.95 : 1.0;
  const recomputedUnit = Math.round(originalUnit * complexityMultiplier * volumeDiscount * 100) / 100;

  const delta = Math.round((recomputedUnit - originalUnit) * 100) / 100;
  const deltaPct = Math.round((delta / originalUnit) * 10000) / 100;

  const adjustments: string[] = [];
  if (complexityMultiplier !== 1) adjustments.push(`Complexity adjustment: ×${complexityMultiplier.toFixed(2)}`);
  if (volumeDiscount !== 1) adjustments.push(`Volume discount: ${((1 - volumeDiscount) * 100).toFixed(0)}% off`);

  const result: RecomputeQuoteOutput = {
    rfqId: input.rfqId,
    supplierId: existingQuote.supplier_id,
    originalUnitPrice: originalUnit,
    recomputedUnitPrice: recomputedUnit,
    deltaUsd: delta,
    deltaPct,
    quantity,
    newTotalUsd: Math.round(recomputedUnit * quantity * 100) / 100,
    appliedAdjustments: adjustments,
  };

  return ok('recompute_quote', result, Math.round(performance.now() - start));
};

// ─── refund ─────────────────────────────────────────────────────

const refund: ToolHandler<RefundInput, RefundOutput | { error: string }> = async (input) => {
  const start = performance.now();

  const { data: order, error: orderErr } = await supabase
    .from('marketplace_orders')
    .select('*')
    .eq('id', input.orderId)
    .maybeSingle();

  if (orderErr || !order) {
    return fail('refund', { error: orderErr?.message ?? 'Order not found' }, Math.round(performance.now() - start));
  }

  if (order.status === 'refunded') {
    return fail('refund', { error: 'Order has already been refunded' }, Math.round(performance.now() - start));
  }

  const totalUsd = Number(order.total_usd);
  const isPartial = input.amountUsd != null && input.amountUsd < totalUsd;
  const refundAmount = input.amountUsd ?? totalUsd;

  if (refundAmount <= 0 || refundAmount > totalUsd) {
    return fail('refund', { error: `Invalid refund amount: $${refundAmount}. Order total is $${totalUsd}` }, Math.round(performance.now() - start));
  }

  const refundCalc = calculateRefund(
    Number(order.unit_price_usd),
    order.quantity,
    isPartial ? refundAmount : undefined,
  );

  const result: RefundOutput = {
    orderId: input.orderId,
    refundType: isPartial ? 'partial' : 'full',
    refundAmountUsd: refundCalc.refundAmountUsd,
    platformFeeRefundUsd: refundCalc.platformFeeRefundUsd,
    supplierDeductionUsd: refundCalc.supplierDeductionUsd,
    newOrderStatus: isPartial ? 'partially_refunded' : 'refunded',
    reason: input.reason,
  };

  const warnings: string[] = [];
  if (refundCalc.refundAmountUsd > 10000) {
    warnings.push('High-value refund — may require manual approval');
  }

  return ok('refund', result, Math.round(performance.now() - start), warnings);
};

// ─── escalate ───────────────────────────────────────────────────

const SLA_MAP: Record<string, number> = {
  critical: 2,
  high: 8,
  medium: 24,
  low: 72,
};

const ASSIGNMENT_MAP: Record<string, string> = {
  quality: 'Quality Assurance Team',
  delivery: 'Logistics Team',
  pricing: 'Pricing Operations',
  dispute: 'Dispute Resolution',
  other: 'General Support',
};

const escalate: ToolHandler<EscalateInput, EscalateOutput> = async (input) => {
  const start = performance.now();

  const ticketId = `ESC-${Date.now().toString(36).toUpperCase()}`;

  const result: EscalateOutput = {
    ticketId,
    issueType: input.issueType,
    priority: input.priority,
    assignedTo: ASSIGNMENT_MAP[input.issueType] ?? 'General Support',
    slaHours: SLA_MAP[input.priority] ?? 24,
    status: 'open',
    relatedOrderId: input.orderId ?? null,
  };

  // Log escalation to audit trail
  try {
    await supabase.from('audit_logs').insert({
      action: 'escalation_created',
      resource_type: 'escalation',
      resource_id: ticketId,
      metadata: {
        issue_type: input.issueType,
        priority: input.priority,
        description: input.description,
        order_id: input.orderId ?? null,
        assigned_to: result.assignedTo,
        sla_hours: result.slaHours,
      },
    });
  } catch {
    // Non-blocking
  }

  return ok('escalate', result, Math.round(performance.now() - start));
};

// ─── Tool Router ────────────────────────────────────────────────

const TOOL_HANDLERS: Record<string, ToolHandler<any, any>> = {
  check_order: checkOrder,
  recompute_quote: recomputeQuote,
  refund,
  escalate,
};

/**
 * Execute a tool by name with the given input.
 * Returns a structured ToolResult.
 */
export async function executeTool(
  toolName: string,
  input: Record<string, unknown>,
): Promise<ToolResult> {
  const handler = TOOL_HANDLERS[toolName];
  if (!handler) {
    return {
      tool: toolName,
      success: false,
      data: { error: `Unknown tool: ${toolName}. Available: ${Object.keys(TOOL_HANDLERS).join(', ')}` },
      warnings: [],
      durationMs: 0,
    };
  }
  return handler(input);
}

/**
 * Register a new tool handler at runtime.
 */
export function registerTool<I, O>(name: string, handler: ToolHandler<I, O>): void {
  TOOL_HANDLERS[name] = handler as ToolHandler<any, any>;
}

/**
 * List all registered tool names.
 */
export function listTools(): string[] {
  return Object.keys(TOOL_HANDLERS);
}
