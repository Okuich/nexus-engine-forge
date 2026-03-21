/**
 * Supplier Marketplace — Matching Engine
 *
 * Matches suppliers to RFQs based on capability, capacity,
 * certifications, and geographic fit.
 */

import type { SupplierProfile, MatchResult, MatchedSupplier } from './types';

interface MatchCriteria {
  material: string;
  process: string;
  complexityScore: number;
  surfaceClasses: string[];
  requiredCertifications: string[];
  maxLeadTimeDays: number | null;
  region: string | null;
  targetCostUsd: number | null;
  quantity: number;
}

/**
 * Match suppliers to an RFQ based on capabilities.
 */
export function matchSuppliersToRFQ(
  suppliers: SupplierProfile[],
  criteria: MatchCriteria,
): MatchResult {
  const matched: MatchedSupplier[] = [];
  const activeSuppliers = suppliers.filter((s) => s.active);

  for (const supplier of activeSuppliers) {
    const matchReasons: string[] = [];
    const disqualifyReasons: string[] = [];
    let fitScore = 0;

    // Material check
    if (supplier.materials.includes(criteria.material)) {
      matchReasons.push(`Supports ${criteria.material}`);
      fitScore += 20;
    } else {
      disqualifyReasons.push(`Does not support material: ${criteria.material}`);
      continue; // hard filter
    }

    // Process check
    if (supplier.processes.includes(criteria.process)) {
      matchReasons.push(`Supports ${criteria.process}`);
      fitScore += 20;
    } else {
      disqualifyReasons.push(`Does not support process: ${criteria.process}`);
      continue; // hard filter
    }

    // Complexity check
    if (criteria.complexityScore <= supplier.maxComplexity) {
      matchReasons.push(`Handles complexity ${(criteria.complexityScore * 100).toFixed(0)}%`);
      fitScore += 15;
    } else {
      disqualifyReasons.push(`Complexity ${(criteria.complexityScore * 100).toFixed(0)}% exceeds max ${(supplier.maxComplexity * 100).toFixed(0)}%`);
      continue; // hard filter
    }

    // Certification check
    if (criteria.requiredCertifications.length > 0) {
      const hasCerts = criteria.requiredCertifications.every((c) =>
        supplier.certifications.includes(c),
      );
      if (hasCerts) {
        matchReasons.push(`Has required certifications: ${criteria.requiredCertifications.join(', ')}`);
        fitScore += 15;
      } else {
        const missing = criteria.requiredCertifications.filter((c) => !supplier.certifications.includes(c));
        disqualifyReasons.push(`Missing certifications: ${missing.join(', ')}`);
        continue; // hard filter
      }
    } else {
      fitScore += 10;
    }

    // Lead time (soft filter)
    if (criteria.maxLeadTimeDays != null) {
      if (supplier.leadTimeDays <= criteria.maxLeadTimeDays) {
        matchReasons.push(`Lead time ${supplier.leadTimeDays}d within ${criteria.maxLeadTimeDays}d limit`);
        fitScore += 15;
      } else {
        disqualifyReasons.push(`Lead time ${supplier.leadTimeDays}d exceeds ${criteria.maxLeadTimeDays}d limit`);
        fitScore -= 10;
      }
    } else {
      fitScore += 10;
    }

    // Region preference (soft)
    if (criteria.region && supplier.region === criteria.region) {
      matchReasons.push(`In preferred region: ${criteria.region}`);
      fitScore += 10;
    }

    // Quality bonus
    fitScore += Math.round(supplier.qualityRating * 15);
    if (supplier.qualityRating >= 0.95) {
      matchReasons.push(`Premium quality rating: ${(supplier.qualityRating * 100).toFixed(0)}%`);
    }

    // Advanced surface capability
    const needsAdvanced = criteria.surfaceClasses.some((sc) =>
      ['freeform', 'toroidal'].includes(sc),
    );
    if (needsAdvanced) {
      const canHandle = criteria.surfaceClasses
        .filter((sc) => ['freeform', 'toroidal'].includes(sc))
        .every((sc) => supplier.advancedSurfaces.includes(sc));
      if (canHandle) {
        matchReasons.push('Supports required advanced surfaces');
        fitScore += 5;
      } else {
        disqualifyReasons.push('Cannot handle required advanced surfaces');
        fitScore -= 15;
      }
    }

    // Estimated cost
    const baseCost = criteria.targetCostUsd ?? 1000;
    const estimatedUnitCost = Math.round(baseCost * supplier.pricingMultiplier * 100) / 100;

    matched.push({
      supplierId: supplier.id,
      companyName: supplier.companyName,
      fitScore: Math.max(0, Math.min(100, fitScore)),
      matchReasons,
      disqualifyReasons,
      estimatedUnitCost,
      estimatedLeadDays: supplier.leadTimeDays,
    });
  }

  // Sort by fit score descending
  matched.sort((a, b) => b.fitScore - a.fitScore);

  const matchCriteria: string[] = [
    `Material: ${criteria.material}`,
    `Process: ${criteria.process}`,
    `Complexity: ${(criteria.complexityScore * 100).toFixed(0)}%`,
  ];
  if (criteria.requiredCertifications.length > 0) {
    matchCriteria.push(`Certs: ${criteria.requiredCertifications.join(', ')}`);
  }
  if (criteria.maxLeadTimeDays != null) {
    matchCriteria.push(`Max lead: ${criteria.maxLeadTimeDays}d`);
  }

  return {
    rfqId: '', // set by caller
    matchedSuppliers: matched,
    totalEligible: matched.length,
    totalFiltered: activeSuppliers.length - matched.length,
    matchCriteria,
  };
}
