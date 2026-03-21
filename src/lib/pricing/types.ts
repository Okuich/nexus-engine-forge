/**
 * Enterprise Pricing Engine — Type Definitions
 *
 * Models for pricing accounts, rules, quote generation,
 * and per-account configuration.
 */

// ─── Rule Types ──────────────────────────────────────────────────

export type PricingRuleType =
  | 'volume_discount'
  | 'margin_override'
  | 'preferred_supplier'
  | 'material_markup'
  | 'process_markup'
  | 'certification_surcharge'
  | 'region_adjustment';

// ─── Pricing Account ────────────────────────────────────────────

export interface PricingAccount {
  id: string;
  tenantId: string | null;
  accountName: string;
  accountType: 'standard' | 'enterprise' | 'partner' | 'internal';
  baseMarginPct: number;
  preferredSupplierIds: string[];
  metadata: Record<string, unknown>;
  active: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

// ─── Pricing Rule ───────────────────────────────────────────────

export interface PricingRule {
  id: string;
  accountId: string;
  ruleType: PricingRuleType;
  priority: number;
  conditions: RuleConditions;
  adjustments: RuleAdjustments;
  active: boolean;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Conditions that must be met for a rule to apply */
export interface RuleConditions {
  minQuantity?: number;
  maxQuantity?: number;
  materials?: string[];
  processes?: string[];
  regions?: string[];
  supplierIds?: string[];
  minComplexity?: number;
  maxComplexity?: number;
  certifications?: string[];
}

/** Adjustments applied when rule conditions are met */
export interface RuleAdjustments {
  /** Flat discount/surcharge in USD */
  flatUsd?: number;
  /** Percentage discount (negative) or surcharge (positive) */
  percentagePct?: number;
  /** Override margin percentage */
  marginOverridePct?: number;
  /** Multiplier applied to unit cost */
  multiplier?: number;
  /** Preferred supplier discount percentage */
  preferredDiscountPct?: number;
}

// ─── Price Quote ────────────────────────────────────────────────

export interface PriceQuote {
  id: string;
  accountId: string | null;
  baseCostUsd: number;
  finalPriceUsd: number;
  marginPct: number;
  quantity: number;
  material: string;
  process: string;
  appliedRules: AppliedRule[];
  lineItems: PriceLineItem[];
  metadata: Record<string, unknown>;
  createdBy: string;
  createdAt: string;
}

export interface AppliedRule {
  ruleId: string;
  ruleType: PricingRuleType;
  description: string;
  adjustmentUsd: number;
  priority: number;
}

export interface PriceLineItem {
  label: string;
  amount: number;
  type: 'base' | 'adjustment' | 'margin' | 'discount' | 'surcharge' | 'subtotal' | 'total';
}

// ─── API Requests ───────────────────────────────────────────────

export interface CreateAccountRequest {
  accountName: string;
  accountType?: string;
  baseMarginPct?: number;
  preferredSupplierIds?: string[];
  metadata?: Record<string, unknown>;
}

export interface CreateRuleRequest {
  accountId: string;
  ruleType: PricingRuleType;
  priority?: number;
  conditions: RuleConditions;
  adjustments: RuleAdjustments;
  description?: string;
}

export interface CalculatePriceRequest {
  accountId?: string;
  baseCostUsd: number;
  quantity: number;
  material: string;
  process: string;
  region?: string;
  supplierId?: string;
  complexityScore?: number;
  certifications?: string[];
  persist?: boolean;
}

export interface PriceCalculationResult {
  baseCostUsd: number;
  unitPriceUsd: number;
  totalPriceUsd: number;
  marginPct: number;
  marginUsd: number;
  appliedRules: AppliedRule[];
  lineItems: PriceLineItem[];
  volumeDiscountPct: number;
  preferredSupplierDiscountPct: number;
}
