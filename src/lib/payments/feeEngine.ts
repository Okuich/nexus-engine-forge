/**
 * Marketplace Payments — Fee Engine
 *
 * Pure-function fee calculation with tiered pricing,
 * volume discounts, and tax computation.
 */

import type { FeeSchedule, FeeBreakdown, FeeTier } from './types';
import { DEFAULT_FEE_SCHEDULE } from './types';

/**
 * Calculate platform fees, tax, and supplier payout for a given order amount.
 */
export function calculateFees(
  unitPriceUsd: number,
  quantity: number,
  schedule: FeeSchedule = DEFAULT_FEE_SCHEDULE,
): FeeBreakdown {
  const subtotal = round(unitPriceUsd * quantity);

  // Determine applicable fee tier
  const { feePct, tierLabel } = resolveFeeTier(subtotal, schedule);

  // Calculate platform fee with min/max bounds
  let platformFee = round(subtotal * (feePct / 100));
  platformFee = Math.max(platformFee, schedule.minFeeUsd);
  if (schedule.maxFeeUsd != null) {
    platformFee = Math.min(platformFee, schedule.maxFeeUsd);
  }

  // Tax (applied to subtotal, not fee)
  const tax = round(subtotal * (schedule.taxRatePct / 100));

  // Supplier gets subtotal minus platform fee
  const supplierPayout = round(subtotal - platformFee);

  // Buyer pays subtotal + tax (platform fee comes from subtotal)
  const total = round(subtotal + tax);

  return {
    subtotalUsd: subtotal,
    platformFeePct: feePct,
    platformFeeUsd: platformFee,
    taxUsd: tax,
    totalUsd: total,
    supplierPayoutUsd: supplierPayout,
    tierApplied: tierLabel,
  };
}

/**
 * Resolve which fee tier applies based on subtotal.
 * Tiers are sorted descending — first match wins.
 */
function resolveFeeTier(
  subtotalUsd: number,
  schedule: FeeSchedule,
): { feePct: number; tierLabel: string } {
  const sorted = [...schedule.volumeTiers].sort(
    (a, b) => b.minSubtotalUsd - a.minSubtotalUsd,
  );

  for (const tier of sorted) {
    if (subtotalUsd >= tier.minSubtotalUsd) {
      return {
        feePct: tier.feePct,
        tierLabel: `Volume ≥$${tier.minSubtotalUsd.toLocaleString()} → ${tier.feePct}%`,
      };
    }
  }

  return {
    feePct: schedule.basePlatformFeePct,
    tierLabel: `Base rate ${schedule.basePlatformFeePct}%`,
  };
}

/**
 * Calculate the fee for a partial refund.
 * Platform fee is proportionally refunded.
 */
export function calculateRefundFees(
  originalFeeBreakdown: FeeBreakdown,
  refundAmountUsd: number,
): { refundPlatformFeeUsd: number; refundSupplierUsd: number } {
  const refundRatio = refundAmountUsd / originalFeeBreakdown.subtotalUsd;
  const refundPlatformFee = round(originalFeeBreakdown.platformFeeUsd * refundRatio);
  const refundSupplier = round(refundAmountUsd - refundPlatformFee);

  return {
    refundPlatformFeeUsd: refundPlatformFee,
    refundSupplierUsd: refundSupplier,
  };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
