/**
 * Midwater Supplier Pricing Engine
 *
 * Pipeline:
 *   QuoteRequest → filterSuppliers → adjustPricing → rankQuotes → SupplierQuote[]
 */

import type {
  Supplier,
  SupplierFilter,
  SupplierQuote,
  PriceAdjustment,
  QuoteRequest,
} from './types';
import { SUPPLIERS } from './catalog';

// ─── Filtering ───────────────────────────────────────────────────

/**
 * Filter suppliers that can fulfill the given requirements.
 */
export function filterSuppliers(
  suppliers: Supplier[],
  filter: SupplierFilter,
): Supplier[] {
  return suppliers.filter((s) => {
    if (!s.active) return false;
    if (!s.materials.includes(filter.materialId)) return false;
    if (!s.processes.includes(filter.processId)) return false;
    if (filter.complexityScore > s.maxComplexity) return false;

    if (filter.maxLeadTimeDays && s.leadTimeDays > filter.maxLeadTimeDays) return false;
    if (filter.region && s.region !== filter.region) return false;

    // Check certifications
    if (filter.requiresCertifications?.length) {
      const hasCerts = filter.requiresCertifications.every((c) =>
        s.certifications.includes(c),
      );
      if (!hasCerts) return false;
    }

    // Check advanced surface capability
    if (filter.surfaceClasses?.length) {
      const needsAdvanced = filter.surfaceClasses.some((sc) =>
        ['freeform', 'toroidal'].includes(sc),
      );
      if (needsAdvanced) {
        const canHandle = filter.surfaceClasses
          .filter((sc) => ['freeform', 'toroidal'].includes(sc))
          .every((sc) => s.advancedSurfaces.includes(sc));
        if (!canHandle) return false;
      }
    }

    return true;
  });
}

// ─── Pricing Adjustment ─────────────────────────────────────────

/**
 * Compute adjusted cost for a single supplier given the base cost.
 */
export function computeAdjustedPrice(
  supplier: Supplier,
  baseCostUsd: number,
  materialId: string,
  processId: string,
  quantity: number,
): { adjustedCostUsd: number; adjustments: PriceAdjustment[] } {
  const adjustments: PriceAdjustment[] = [];
  let cost = baseCostUsd;

  // 1. Base supplier multiplier
  const baseDelta = cost * (supplier.pricingMultiplier - 1);
  if (Math.abs(baseDelta) > 0.01) {
    adjustments.push({
      label: `${supplier.name} base pricing`,
      factor: supplier.pricingMultiplier,
      deltaUsd: +baseDelta.toFixed(2),
    });
    cost += baseDelta;
  }

  // 2. Material-specific override
  const matOverride = supplier.materialPricing[materialId];
  if (matOverride !== undefined && matOverride !== 1) {
    const matDelta = cost * (matOverride - 1);
    adjustments.push({
      label: `Material surcharge (${materialId})`,
      factor: matOverride,
      deltaUsd: +matDelta.toFixed(2),
    });
    cost += matDelta;
  }

  // 3. Process-specific override
  const procOverride = supplier.processPricing[processId];
  if (procOverride !== undefined && procOverride !== 1) {
    const procDelta = cost * (procOverride - 1);
    adjustments.push({
      label: `Process adjustment (${processId})`,
      factor: procOverride,
      deltaUsd: +procDelta.toFixed(2),
    });
    cost += procDelta;
  }

  // 4. Volume discount (largest applicable tier)
  if (quantity > 1 && supplier.volumeDiscounts.length > 0) {
    const applicable = supplier.volumeDiscounts
      .filter((d) => quantity >= d.minQuantity)
      .sort((a, b) => b.discountPct - a.discountPct);

    if (applicable.length > 0) {
      const discount = applicable[0];
      const discountFactor = 1 - discount.discountPct / 100;
      const discountDelta = cost * (discountFactor - 1);
      adjustments.push({
        label: `Volume discount (${discount.discountPct}% @ ${discount.minQuantity}+ units)`,
        factor: discountFactor,
        deltaUsd: +discountDelta.toFixed(2),
      });
      cost += discountDelta;
    }
  }

  return { adjustedCostUsd: +cost.toFixed(2), adjustments };
}

// ─── Quote Generation & Ranking ──────────────────────────────────

/**
 * Generate ranked supplier quotes for a part.
 *
 * @param request - Quote parameters including base cost from costEngine
 * @param supplierPool - Optional custom supplier list (defaults to built-in catalog)
 * @returns Sorted array of SupplierQuotes
 */
export function generateQuotes(
  request: QuoteRequest,
  supplierPool: Supplier[] = SUPPLIERS,
): SupplierQuote[] {
  const {
    baseCostUsd,
    materialId,
    processId,
    complexityScore,
    quantity,
    surfaceClasses,
    requiresCertifications,
    maxLeadTimeDays,
    region,
    sortBy = 'cost',
  } = request;

  // Step 1: Filter eligible suppliers
  const eligible = filterSuppliers(supplierPool, {
    materialId,
    processId,
    complexityScore,
    requiresCertifications,
    maxLeadTimeDays,
    region,
    surfaceClasses,
  });

  // Step 2: Compute adjusted pricing
  const quotes: SupplierQuote[] = eligible.map((supplier) => {
    const { adjustedCostUsd, adjustments } = computeAdjustedPrice(
      supplier,
      baseCostUsd,
      materialId,
      processId,
      quantity,
    );

    // Confidence: higher quality + more certifications = higher confidence
    const certBonus = Math.min(0.1, supplier.certifications.length * 0.02);
    const confidence = Math.min(0.99, supplier.qualityRating * 0.8 + certBonus + 0.1);

    return {
      supplierId: supplier.id,
      supplierName: supplier.name,
      baseCostUsd,
      adjustedCostUsd,
      adjustments,
      leadTimeDays: supplier.leadTimeDays,
      qualityRating: supplier.qualityRating,
      confidence: +confidence.toFixed(3),
      rank: 0, // assigned after sort
    };
  });

  // Step 3: Sort by preference
  const comparators: Record<string, (a: SupplierQuote, b: SupplierQuote) => number> = {
    cost: (a, b) => a.adjustedCostUsd - b.adjustedCostUsd,
    leadTime: (a, b) => a.leadTimeDays - b.leadTimeDays,
    quality: (a, b) => b.qualityRating - a.qualityRating,
  };

  quotes.sort(comparators[sortBy] ?? comparators.cost);

  // Assign ranks
  quotes.forEach((q, i) => { q.rank = i + 1; });

  return quotes;
}
