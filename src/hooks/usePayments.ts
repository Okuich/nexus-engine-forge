/**
 * usePayments — React hook for marketplace payments.
 */

import { useState, useCallback } from 'react';
import { paymentService } from '@/lib/payments';
import { calculateFees } from '@/lib/payments';
import type {
  MarketplaceOrder,
  MarketplacePayment,
  SupplierPayout,
  FeeBreakdown,
  CreateOrderRequest,
  ProcessPaymentRequest,
  RefundRequest,
} from '@/lib/payments';

export function usePayments() {
  const [orders, setOrders] = useState<MarketplaceOrder[]>([]);
  const [payments, setPayments] = useState<MarketplacePayment[]>([]);
  const [payouts, setPayouts] = useState<SupplierPayout[]>([]);
  const [lastFees, setLastFees] = useState<FeeBreakdown | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const withLoading = useCallback(async <T>(fn: () => Promise<T>): Promise<T> => {
    setLoading(true);
    setError(null);
    try {
      return await fn();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'An error occurred';
      setError(msg);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const previewFees = useCallback((unitPrice: number, quantity: number) => {
    const fees = calculateFees(unitPrice, quantity);
    setLastFees(fees);
    return fees;
  }, []);

  const createOrder = useCallback(async (req: CreateOrderRequest) => {
    return withLoading(async () => {
      const { order, fees } = await paymentService.createOrder(req);
      setOrders((prev) => [order, ...prev]);
      setLastFees(fees);
      return { order, fees };
    });
  }, [withLoading]);

  const loadOrders = useCallback(async (filters?: { status?: string }) => {
    await withLoading(async () => {
      const data = await paymentService.listOrders(filters);
      setOrders(data);
    });
  }, [withLoading]);

  const processPayment = useCallback(async (req: ProcessPaymentRequest) => {
    return withLoading(async () => {
      const payment = await paymentService.processPayment(req);
      setPayments((prev) => [payment, ...prev]);
      // Refresh orders to get updated status
      const updatedOrders = await paymentService.listOrders();
      setOrders(updatedOrders);
      return payment;
    });
  }, [withLoading]);

  const processRefund = useCallback(async (req: RefundRequest) => {
    return withLoading(async () => {
      const payment = await paymentService.processRefund(req);
      setPayments((prev) => prev.map((p) => (p.id === payment.id ? payment : p)));
      return payment;
    });
  }, [withLoading]);

  const loadPayments = useCallback(async (orderId?: string) => {
    await withLoading(async () => {
      const data = await paymentService.listPayments(orderId);
      setPayments(data);
    });
  }, [withLoading]);

  const loadPayouts = useCallback(async (supplierId?: string) => {
    await withLoading(async () => {
      const data = await paymentService.listPayouts(supplierId);
      setPayouts(data);
    });
  }, [withLoading]);

  return {
    orders,
    payments,
    payouts,
    lastFees,
    loading,
    error,
    previewFees,
    createOrder,
    loadOrders,
    processPayment,
    processRefund,
    loadPayments,
    loadPayouts,
    clearError: () => setError(null),
  };
}
