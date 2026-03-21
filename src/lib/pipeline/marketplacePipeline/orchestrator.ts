/**
 * Marketplace Pipeline — Orchestrator
 *
 * Chains modular services into a single end-to-end flow:
 * Geometry → RFQ → Match → Quote → Price → Order → Payment
 *
 * Each stage is independently testable. The orchestrator handles
 * error recovery, timing, and event emission.
 */

import { marketplaceService } from '@/lib/marketplace/service';
import { pricingService } from '@/lib/pricing/service';
import { paymentService } from '@/lib/payments/service';
import type {
  PipelineInput,
  PipelineOutput,
  PipelineStage,
  StageResult,
  PipelineEvent,
  PipelineEventHandler,
  PipelineSummary,
} from './types';
import type { RFQ, MatchResult, RFQQuote, MatchedSupplier } from '@/lib/marketplace/types';
import type { PriceCalculationResult } from '@/lib/pricing/types';
import type { MarketplaceOrder, MarketplacePayment, FeeBreakdown } from '@/lib/payments/types';

// ─── Stage Runner ───────────────────────────────────────────────

async function runStage<T>(
  stageName: PipelineStage,
  fn: () => Promise<T>,
  stages: StageResult[],
  onEvent?: PipelineEventHandler,
): Promise<{ result: T; stage: StageResult } | { result: null; stage: StageResult }> {
  const start = performance.now();
  onEvent?.({ stage: stageName, status: 'started', message: `Starting ${stageName}`, timestamp: Date.now() });

  try {
    const result = await fn();
    const duration = Math.round(performance.now() - start);
    const stage: StageResult = { stage: stageName, status: 'completed', durationMs: duration };
    stages.push(stage);
    onEvent?.({ stage: stageName, status: 'completed', message: `Completed ${stageName} in ${duration}ms`, timestamp: Date.now(), data: result });
    return { result, stage };
  } catch (err) {
    const duration = Math.round(performance.now() - start);
    const error = err instanceof Error ? err.message : 'Unknown error';
    const stage: StageResult = { stage: stageName, status: 'failed', durationMs: duration, error };
    stages.push(stage);
    onEvent?.({ stage: stageName, status: 'failed', message: `Failed ${stageName}: ${error}`, timestamp: Date.now() });
    return { result: null, stage };
  }
}

// ─── Pipeline Orchestrator ──────────────────────────────────────

export async function runMarketplacePipeline(
  input: PipelineInput,
  onEvent?: PipelineEventHandler,
): Promise<PipelineOutput> {
  const pipelineStart = performance.now();
  const stages: StageResult[] = [];

  let rfq: RFQ | null = null;
  let matchResult: MatchResult | null = null;
  let quotes: RFQQuote[] = [];
  let selectedSupplier: MatchedSupplier | null = null;
  let pricingResult: PriceCalculationResult | null = null;
  let order: MarketplaceOrder | null = null;
  let fees: FeeBreakdown | null = null;
  let payment: MarketplacePayment | null = null;

  // ── Stage 1: Generate RFQ from geometry ──
  const rfqResult = await runStage('generating_rfq', async () => {
    return marketplaceService.createRFQ({
      title: `RFQ: ${input.partName} — ${input.materialName}`,
      description: `Auto-generated from geometry analysis. Complexity: ${(input.geometryStats.complexityScore * 100).toFixed(0)}%.`,
      partName: input.partName,
      material: input.materialName,
      process: input.processName,
      quantity: input.quantity,
      complexityScore: input.geometryStats.complexityScore,
      surfaceClasses: Object.entries(input.geometryStats.surfaceClassDistribution)
        .filter(([, count]) => count > 0)
        .map(([cls]) => cls),
      requiredCertifications: input.requiredCertifications ?? [],
      maxLeadTimeDays: input.maxLeadTimeDays,
      region: input.region,
      targetCostUsd: input.baseCostUsd,
      geometryStats: input.geometryStats as unknown as Record<string, unknown>,
    });
  }, stages, onEvent);

  if (!rfqResult.result) {
    return buildOutput('failed', pipelineStart, stages, { rfq, matchResult, quotes, selectedSupplier, pricingResult, order, fees, payment }, input);
  }
  rfq = rfqResult.result;

  // ── Stage 2: Match suppliers ──
  const matchStage = await runStage('matching_suppliers', async () => {
    return marketplaceService.matchSuppliersForRFQ(rfq!.id);
  }, stages, onEvent);

  if (!matchStage.result || matchStage.result.matchedSuppliers.length === 0) {
    return buildOutput('partial', pipelineStart, stages, { rfq, matchResult: matchStage.result, quotes, selectedSupplier, pricingResult, order, fees, payment }, input);
  }
  matchResult = matchStage.result;
  selectedSupplier = matchResult.matchedSuppliers[0]; // Best fit

  // ── Stage 3: Generate quotes (simulate supplier quotes) ──
  const quoteStage = await runStage('generating_quotes', async () => {
    const generatedQuotes: RFQQuote[] = [];

    // Generate quotes from top matched suppliers (up to 5)
    const topSuppliers = matchResult!.matchedSuppliers.slice(0, 5);

    for (const supplier of topSuppliers) {
      try {
        const quote = await marketplaceService.submitQuoteAsSupplier(supplier.supplierId, {
          rfqId: rfq!.id,
          unitPriceUsd: supplier.estimatedUnitCost,
          leadTimeDays: supplier.estimatedLeadDays,
          notes: `Auto-quote. Fit score: ${supplier.fitScore}/100. ${supplier.matchReasons.join('; ')}`,
          confidence: supplier.fitScore / 100,
        });
        generatedQuotes.push(quote);
      } catch {
        // Skip failed quotes, continue with others
      }
    }

    // Rank all quotes
    if (generatedQuotes.length > 0) {
      return marketplaceService.rankQuotesForRFQ(rfq!.id);
    }
    return generatedQuotes;
  }, stages, onEvent);

  if (!quoteStage.result || quoteStage.result.length === 0) {
    return buildOutput('partial', pipelineStart, stages, { rfq, matchResult, quotes, selectedSupplier, pricingResult, order, fees, payment }, input);
  }
  quotes = quoteStage.result;

  // Select the top-ranked quote
  const bestQuote = quotes.reduce((best, q) =>
    (q.rank != null && (best.rank == null || q.rank < best.rank)) ? q : best,
    quotes[0],
  );

  // ── Stage 4: Apply enterprise pricing ──
  const pricingStage = await runStage('applying_pricing', async () => {
    return pricingService.calculatePrice({
      accountId: input.pricingAccountId,
      baseCostUsd: bestQuote.unitPriceUsd,
      quantity: input.quantity,
      material: input.materialName,
      process: input.processName,
      region: input.region,
      supplierId: bestQuote.supplierId,
      complexityScore: input.geometryStats.complexityScore,
      certifications: input.requiredCertifications,
      persist: true,
    });
  }, stages, onEvent);

  if (!pricingStage.result) {
    return buildOutput('partial', pipelineStart, stages, { rfq, matchResult, quotes, selectedSupplier, pricingResult, order, fees, payment }, input);
  }
  pricingResult = pricingStage.result;

  // ── Stage 5: Create order ──
  if (input.autoAward !== false) {
    const orderStage = await runStage('creating_order', async () => {
      // Award the best quote
      await marketplaceService.awardQuote(rfq!.id, bestQuote.id);

      // Create marketplace order with enterprise-priced unit cost
      return paymentService.createOrder({
        rfqId: rfq!.id,
        quoteId: bestQuote.id,
        supplierId: bestQuote.supplierId,
        unitPriceUsd: pricingResult!.unitPriceUsd,
        quantity: input.quantity,
      });
    }, stages, onEvent);

    if (orderStage.result) {
      order = orderStage.result.order;
      fees = orderStage.result.fees;
    }
  }

  // ── Stage 6: Process payment ──
  if (order && input.autoPayment) {
    const paymentStage = await runStage('processing_payment', async () => {
      return paymentService.processPayment({
        orderId: order!.id,
        paymentMethod: 'platform_balance',
      });
    }, stages, onEvent);

    if (paymentStage.result) {
      payment = paymentStage.result;
    }
  }

  const finalStatus = stages.some((s) => s.status === 'failed') ? 'partial' : 'completed';
  return buildOutput(finalStatus, pipelineStart, stages, { rfq, matchResult, quotes, selectedSupplier, pricingResult, order, fees, payment }, input);
}

// ─── Output Builder ─────────────────────────────────────────────

function buildOutput(
  status: PipelineOutput['status'],
  startTime: number,
  stages: StageResult[],
  data: {
    rfq: RFQ | null;
    matchResult: MatchResult | null;
    quotes: RFQQuote[];
    selectedSupplier: MatchedSupplier | null;
    pricingResult: PriceCalculationResult | null;
    order: MarketplaceOrder | null;
    fees: FeeBreakdown | null;
    payment: MarketplacePayment | null;
  },
  input: PipelineInput,
): PipelineOutput {
  const totalDurationMs = Math.round(performance.now() - startTime);

  const summary: PipelineSummary = {
    partName: input.partName,
    material: input.materialName,
    process: input.processName,
    quantity: input.quantity,
    baseCostUsd: input.baseCostUsd,
    unitPriceUsd: data.pricingResult?.unitPriceUsd ?? null,
    totalPriceUsd: data.pricingResult?.totalPriceUsd ?? null,
    platformFeeUsd: data.fees?.platformFeeUsd ?? null,
    supplierPayoutUsd: data.fees?.supplierPayoutUsd ?? null,
    supplierName: data.selectedSupplier?.companyName ?? null,
    matchedSupplierCount: data.matchResult?.matchedSuppliers.length ?? 0,
    quoteCount: data.quotes.length,
    pipelineDurationMs: totalDurationMs,
  };

  return {
    status,
    totalDurationMs,
    stages,
    rfq: data.rfq,
    matchResult: data.matchResult,
    quotes: data.quotes,
    selectedSupplier: data.selectedSupplier,
    pricingResult: data.pricingResult,
    order: data.order,
    fees: data.fees,
    payment: data.payment,
    summary,
  };
}
