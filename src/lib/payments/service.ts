/**
 * Marketplace Payments — Service Layer
 *
 * Orchestrates order creation, payment processing, and supplier payouts.
 */

import { supabase } from '@/integrations/supabase/client';
import { calculateFees, calculateRefundFees } from './feeEngine';
import type {
  MarketplaceOrder,
  MarketplacePayment,
  SupplierPayout,
  FeeBreakdown,
  CreateOrderRequest,
  ProcessPaymentRequest,
  RefundRequest,
} from './types';
import { DEFAULT_FEE_SCHEDULE } from './types';

// ─── Data Mappers ────────────────────────────────────────────────

function mapOrder(row: Record<string, unknown>): MarketplaceOrder {
  return {
    id: row.id as string,
    rfqId: row.rfq_id as string | null,
    quoteId: row.quote_id as string | null,
    buyerId: row.buyer_id as string,
    supplierId: row.supplier_id as string,
    unitPriceUsd: Number(row.unit_price_usd),
    quantity: row.quantity as number,
    subtotalUsd: Number(row.subtotal_usd),
    platformFeeUsd: Number(row.platform_fee_usd),
    platformFeePct: Number(row.platform_fee_pct),
    supplierPayoutUsd: Number(row.supplier_payout_usd),
    taxUsd: Number(row.tax_usd),
    totalUsd: Number(row.total_usd),
    currency: row.currency as string,
    status: row.status as MarketplaceOrder['status'],
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function mapPayment(row: Record<string, unknown>): MarketplacePayment {
  return {
    id: row.id as string,
    orderId: row.order_id as string,
    payerId: row.payer_id as string,
    amountUsd: Number(row.amount_usd),
    platformFeeUsd: Number(row.platform_fee_usd),
    supplierPayoutUsd: Number(row.supplier_payout_usd),
    paymentMethod: row.payment_method as MarketplacePayment['paymentMethod'],
    externalPaymentId: row.external_payment_id as string | null,
    status: row.status as MarketplacePayment['status'],
    failureReason: row.failure_reason as string | null,
    paidAt: row.paid_at as string | null,
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function mapPayout(row: Record<string, unknown>): SupplierPayout {
  return {
    id: row.id as string,
    supplierId: row.supplier_id as string,
    paymentId: row.payment_id as string,
    orderId: row.order_id as string,
    amountUsd: Number(row.amount_usd),
    status: row.status as SupplierPayout['status'],
    payoutMethod: row.payout_method as string,
    externalPayoutId: row.external_payout_id as string | null,
    processedAt: row.processed_at as string | null,
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    createdAt: row.created_at as string,
  };
}

// ─── Service ────────────────────────────────────────────────────

export class PaymentService {
  // ── Order Creation ──

  async createOrder(req: CreateOrderRequest): Promise<{ order: MarketplaceOrder; fees: FeeBreakdown }> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Authentication required');

    const schedule = { ...DEFAULT_FEE_SCHEDULE, ...req.feeSchedule };
    const fees = calculateFees(req.unitPriceUsd, req.quantity, schedule);

    const payload = {
      rfq_id: req.rfqId ?? null,
      quote_id: req.quoteId ?? null,
      buyer_id: user.id,
      supplier_id: req.supplierId,
      unit_price_usd: req.unitPriceUsd,
      quantity: req.quantity,
      subtotal_usd: fees.subtotalUsd,
      platform_fee_usd: fees.platformFeeUsd,
      platform_fee_pct: fees.platformFeePct,
      supplier_payout_usd: fees.supplierPayoutUsd,
      tax_usd: fees.taxUsd,
      total_usd: fees.totalUsd,
      metadata: req.metadata ?? {},
      status: 'pending' as const,
    };

    const { data, error } = await (supabase.from('marketplace_orders') as any)
      .insert(payload).select().single();

    if (error) throw new Error(`Failed to create order: ${error.message}`);
    return { order: mapOrder(data as any), fees };
  }

  async getOrder(id: string): Promise<MarketplaceOrder> {
    const { data, error } = await supabase
      .from('marketplace_orders')
      .select('*')
      .eq('id', id)
      .single();

    if (error) throw new Error(`Failed to get order: ${error.message}`);
    return mapOrder(data as any);
  }

  async listOrders(filters?: { status?: string }): Promise<MarketplaceOrder[]> {
    let query = supabase
      .from('marketplace_orders')
      .select('*')
      .order('created_at', { ascending: false });

    if (filters?.status) query = query.eq('status', filters.status);

    const { data, error } = await query;
    if (error) throw new Error(`Failed to list orders: ${error.message}`);
    return ((data ?? []) as Record<string, unknown>[]).map(mapOrder);
  }

  async updateOrderStatus(id: string, status: MarketplaceOrder['status']): Promise<void> {
    const { error } = await (supabase.from('marketplace_orders') as any)
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', id);

    if (error) throw new Error(`Failed to update order: ${error.message}`);
  }

  // ── Payment Processing ──

  async processPayment(req: ProcessPaymentRequest): Promise<MarketplacePayment> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Authentication required');

    const order = await this.getOrder(req.orderId);
    if (order.status !== 'pending' && order.status !== 'confirmed') {
      throw new Error(`Order is ${order.status}, cannot process payment`);
    }

    const payload = {
      order_id: req.orderId,
      payer_id: user.id,
      amount_usd: order.totalUsd,
      platform_fee_usd: order.platformFeeUsd,
      supplier_payout_usd: order.supplierPayoutUsd,
      payment_method: req.paymentMethod ?? 'platform_balance',
      external_payment_id: req.externalPaymentId ?? null,
      status: 'completed' as const,
      paid_at: new Date().toISOString(),
      metadata: req.metadata ?? {},
    };

    const { data, error } = await (supabase.from('marketplace_payments') as any)
      .insert(payload).select().single();

    if (error) throw new Error(`Failed to process payment: ${error.message}`);

    const payment = mapPayment(data as any);

    // Update order status to paid
    await this.updateOrderStatus(req.orderId, 'paid');

    // Create supplier payout record
    await this.createPayout(order, payment);

    return payment;
  }

  private async createPayout(order: MarketplaceOrder, payment: MarketplacePayment): Promise<void> {
    const payload = {
      supplier_id: order.supplierId,
      payment_id: payment.id,
      order_id: order.id,
      amount_usd: order.supplierPayoutUsd,
      status: 'pending' as const,
      payout_method: 'platform_balance',
      metadata: {},
    };

    await (supabase.from('supplier_payouts') as any).insert(payload);
  }

  async getPayment(id: string): Promise<MarketplacePayment> {
    const { data, error } = await supabase
      .from('marketplace_payments')
      .select('*')
      .eq('id', id)
      .single();

    if (error) throw new Error(`Failed to get payment: ${error.message}`);
    return mapPayment(data as any);
  }

  async listPayments(orderId?: string): Promise<MarketplacePayment[]> {
    let query = supabase
      .from('marketplace_payments')
      .select('*')
      .order('created_at', { ascending: false });

    if (orderId) query = query.eq('order_id', orderId);

    const { data, error } = await query;
    if (error) throw new Error(`Failed to list payments: ${error.message}`);
    return ((data ?? []) as Record<string, unknown>[]).map(mapPayment);
  }

  // ── Refunds ──

  async processRefund(req: RefundRequest): Promise<MarketplacePayment> {
    const payment = await this.getPayment(req.paymentId);
    if (payment.status !== 'completed') {
      throw new Error(`Payment is ${payment.status}, cannot refund`);
    }

    const refundAmount = req.amountUsd ?? payment.amountUsd;
    const isPartial = refundAmount < payment.amountUsd;

    const refundFees = calculateRefundFees(
      {
        subtotalUsd: payment.amountUsd,
        platformFeePct: 0,
        platformFeeUsd: payment.platformFeeUsd,
        taxUsd: 0,
        totalUsd: payment.amountUsd,
        supplierPayoutUsd: payment.supplierPayoutUsd,
        tierApplied: '',
      },
      refundAmount,
    );

    const newStatus = isPartial ? 'partially_refunded' : 'refunded';

    const { error } = await (supabase.from('marketplace_payments') as any)
      .update({
        status: newStatus,
        metadata: {
          ...payment.metadata,
          refund: {
            amount: refundAmount,
            reason: req.reason,
            refundedPlatformFee: refundFees.refundPlatformFeeUsd,
            refundedSupplier: refundFees.refundSupplierUsd,
            refundedAt: new Date().toISOString(),
          },
        },
        updated_at: new Date().toISOString(),
      })
      .eq('id', req.paymentId);

    if (error) throw new Error(`Failed to process refund: ${error.message}`);

    // Update order status
    await (supabase.from('marketplace_orders') as any)
      .update({ status: 'refunded', updated_at: new Date().toISOString() })
      .eq('id', payment.orderId);

    return this.getPayment(req.paymentId);
  }

  // ── Supplier Payouts ──

  async listPayouts(supplierId?: string): Promise<SupplierPayout[]> {
    let query = supabase
      .from('supplier_payouts')
      .select('*')
      .order('created_at', { ascending: false });

    if (supplierId) query = query.eq('supplier_id', supplierId);

    const { data, error } = await query;
    if (error) throw new Error(`Failed to list payouts: ${error.message}`);
    return ((data ?? []) as Record<string, unknown>[]).map(mapPayout);
  }

  async completePayout(payoutId: string, externalPayoutId?: string): Promise<void> {
    const { error } = await (supabase.from('supplier_payouts') as any)
      .update({
        status: 'completed',
        external_payout_id: externalPayoutId ?? null,
        processed_at: new Date().toISOString(),
      })
      .eq('id', payoutId);

    if (error) throw new Error(`Failed to complete payout: ${error.message}`);
  }
}

/** Singleton */
export const paymentService = new PaymentService();
