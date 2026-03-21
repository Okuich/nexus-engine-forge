/**
 * Enterprise Pricing Engine — Rules Engine
 *
 * Pure-function evaluation of pricing rules against a request context.
 * No side effects, no DB calls — fully testable.
 */

import type {
  PricingRule,
  RuleConditions,
  RuleAdjustments,
  CalculatePriceRequest,
  AppliedRule,
  PriceLineItem,
  PriceCalculationResult,
} from './types';

interface RuleContext {
  baseCostUsd: number;
  quantity: number;
  material: string;
  process: string;
  region?: string;
  supplierId?: string;
  complexityScore: number;
  certifications: string[];
  preferredSupplierIds: string[];
}

// ─── Condition Matching ─────────────────────────────────────────

function matchesConditions(conditions: RuleConditions, ctx: RuleContext): boolean {
  if (conditions.minQuantity != null && ctx.quantity < conditions.minQuantity) return false;
  if (conditions.maxQuantity != null && ctx.quantity > conditions.maxQuantity) return false;

  if (conditions.materials?.length && !conditions.materials.includes(ctx.material)) return false;
  if (conditions.processes?.length && !conditions.processes.includes(ctx.process)) return false;
  if (conditions.regions?.length && ctx.region && !conditions.regions.includes(ctx.region)) return false;

  if (conditions.supplierIds?.length && ctx.supplierId && !conditions.supplierIds.includes(ctx.supplierId)) return false;

  if (conditions.minComplexity != null && ctx.complexityScore < conditions.minComplexity) return false;
  if (conditions.maxComplexity != null && ctx.complexityScore > conditions.maxComplexity) return false;

  if (conditions.certifications?.length) {
    const hasCerts = conditions.certifications.every((c) => ctx.certifications.includes(c));
    if (!hasCerts) return false;
  }

  return true;
}

// ─── Adjustment Calculation ─────────────────────────────────────

function calculateAdjustment(adjustments: RuleAdjustments, unitCost: number): number {
  let delta = 0;

  if (adjustments.flatUsd != null) {
    delta += adjustments.flatUsd;
  }

  if (adjustments.percentagePct != null) {
    delta += unitCost * (adjustments.percentagePct / 100);
  }

  if (adjustments.multiplier != null) {
    delta += unitCost * (adjustments.multiplier - 1);
  }

  if (adjustments.preferredDiscountPct != null) {
    delta -= unitCost * (adjustments.preferredDiscountPct / 100);
  }

  return Math.round(delta * 100) / 100;
}

// ─── Main Engine ────────────────────────────────────────────────

export function evaluatePricingRules(
  rules: PricingRule[],
  request: CalculatePriceRequest,
  baseMarginPct: number,
  preferredSupplierIds: string[],
): PriceCalculationResult {
  const ctx: RuleContext = {
    baseCostUsd: request.baseCostUsd,
    quantity: request.quantity,
    material: request.material,
    process: request.process,
    region: request.region,
    supplierId: request.supplierId,
    complexityScore: request.complexityScore ?? 0.5,
    certifications: request.certifications ?? [],
    preferredSupplierIds,
  };

  // Sort rules by priority (higher first)
  const sortedRules = [...rules]
    .filter((r) => r.active)
    .sort((a, b) => b.priority - a.priority);

  let unitCost = request.baseCostUsd;
  let marginPct = baseMarginPct;
  let volumeDiscountPct = 0;
  let preferredSupplierDiscountPct = 0;
  const appliedRules: AppliedRule[] = [];
  const lineItems: PriceLineItem[] = [
    { label: 'Base Cost', amount: request.baseCostUsd, type: 'base' },
  ];

  // Evaluate each matching rule
  for (const rule of sortedRules) {
    if (!matchesConditions(rule.conditions, ctx)) continue;

    // Handle margin override separately
    if (rule.ruleType === 'margin_override' && rule.adjustments.marginOverridePct != null) {
      marginPct = rule.adjustments.marginOverridePct;
      appliedRules.push({
        ruleId: rule.id,
        ruleType: rule.ruleType,
        description: rule.description ?? `Margin override to ${marginPct}%`,
        adjustmentUsd: 0,
        priority: rule.priority,
      });
      lineItems.push({
        label: rule.description ?? `Margin → ${marginPct}%`,
        amount: 0,
        type: 'adjustment',
      });
      continue;
    }

    // Preferred supplier check
    if (rule.ruleType === 'preferred_supplier') {
      const isPreferred = ctx.supplierId && preferredSupplierIds.includes(ctx.supplierId);
      if (!isPreferred) continue;
      if (rule.adjustments.preferredDiscountPct) {
        preferredSupplierDiscountPct = rule.adjustments.preferredDiscountPct;
      }
    }

    // Track volume discount
    if (rule.ruleType === 'volume_discount' && rule.adjustments.percentagePct) {
      volumeDiscountPct = Math.abs(rule.adjustments.percentagePct);
    }

    const delta = calculateAdjustment(rule.adjustments, unitCost);
    if (delta === 0 && rule.ruleType !== 'preferred_supplier') continue;

    unitCost += delta;

    appliedRules.push({
      ruleId: rule.id,
      ruleType: rule.ruleType,
      description: rule.description ?? `${rule.ruleType} adjustment`,
      adjustmentUsd: delta,
      priority: rule.priority,
    });

    lineItems.push({
      label: rule.description ?? rule.ruleType,
      amount: delta,
      type: delta < 0 ? 'discount' : 'surcharge',
    });
  }

  // Apply margin
  const marginUsd = Math.round(unitCost * (marginPct / 100) * 100) / 100;
  const unitPrice = Math.round((unitCost + marginUsd) * 100) / 100;
  const totalPrice = Math.round(unitPrice * request.quantity * 100) / 100;

  lineItems.push(
    { label: `Margin (${marginPct}%)`, amount: marginUsd, type: 'margin' },
    { label: 'Unit Price', amount: unitPrice, type: 'subtotal' },
    { label: `Total (×${request.quantity})`, amount: totalPrice, type: 'total' },
  );

  return {
    baseCostUsd: request.baseCostUsd,
    unitPriceUsd: unitPrice,
    totalPriceUsd: totalPrice,
    marginPct,
    marginUsd,
    appliedRules,
    lineItems,
    volumeDiscountPct,
    preferredSupplierDiscountPct,
  };
}
