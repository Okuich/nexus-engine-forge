/**
 * Midwater Supplier Pricing — Type Definitions
 */

import type { SurfaceClass } from '@/lib/geometry/types';

// ─── Supplier Data Model ─────────────────────────────────────────

export interface Supplier {
  id: string;
  name: string;
  /** Supported material IDs (from costEngine MATERIALS) */
  materials: string[];
  /** Supported process IDs (from costEngine PROCESSES) */
  processes: string[];
  /** Max complexity score this supplier can handle (0–1) */
  maxComplexity: number;
  /** Surface classes requiring 5-axis — supplier must support */
  advancedSurfaces: SurfaceClass[];
  /** Lead time in business days */
  leadTimeDays: number;
  /** Quality rating (0–1) */
  qualityRating: number;
  /** Geographic region */
  region: string;
  /** Minimum order value in USD */
  minOrderUsd: number;
  /** Pricing multiplier relative to base cost (1.0 = at cost) */
  pricingMultiplier: number;
  /** Per-material price overrides (multiplier) */
  materialPricing: Record<string, number>;
  /** Per-process price overrides (multiplier) */
  processPricing: Record<string, number>;
  /** Volume discount tiers */
  volumeDiscounts: VolumeDiscount[];
  /** Certifications held */
  certifications: string[];
  /** Whether supplier is currently active */
  active: boolean;
}

export interface VolumeDiscount {
  minQuantity: number;
  discountPct: number;
}

// ─── Matching & Quoting ──────────────────────────────────────────

export interface SupplierFilter {
  materialId: string;
  processId: string;
  complexityScore: number;
  requiresCertifications?: string[];
  maxLeadTimeDays?: number;
  region?: string;
  /** Surface classes present in the part */
  surfaceClasses?: SurfaceClass[];
}

export interface SupplierQuote {
  supplierId: string;
  supplierName: string;
  baseCostUsd: number;
  adjustedCostUsd: number;
  adjustments: PriceAdjustment[];
  leadTimeDays: number;
  qualityRating: number;
  confidence: number;
  /** Rank among all quotes (1 = best) */
  rank: number;
}

export interface PriceAdjustment {
  label: string;
  factor: number;
  /** Resulting delta in USD */
  deltaUsd: number;
}

export interface QuoteRequest {
  baseCostUsd: number;
  materialId: string;
  processId: string;
  complexityScore: number;
  quantity: number;
  surfaceClasses: SurfaceClass[];
  requiresCertifications?: string[];
  maxLeadTimeDays?: number;
  region?: string;
  /** Sort preference */
  sortBy?: 'cost' | 'leadTime' | 'quality';
}
