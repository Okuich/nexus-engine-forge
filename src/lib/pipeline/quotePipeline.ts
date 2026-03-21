/**
 * Midwater End-to-End Quoting Pipeline
 *
 * Orchestrates the full flow:
 *   GeometryFeatureSet → Inference → Supplier Matching → Pricing → Ranked Quotes
 *
 * Each stage is independently testable and composable.
 */

import type { GeometryFeatureSet, SurfaceClass } from '@/lib/geometry/types';
import { runInferenceEngine } from '@/lib/ml/inferenceEngine';
import type { ExplainedAssessment } from '@/lib/ml/inferenceEngine';
import { generateQuotes } from '@/lib/suppliers';
import type { SupplierQuote, Supplier } from '@/lib/suppliers';

// ─── Pipeline Types ──────────────────────────────────────────────

export interface PipelineRequest {
  features: GeometryFeatureSet;
  materialId: string;
  processId: string;
  quantity: number;
  /** Optional constraints */
  requiresCertifications?: string[];
  maxLeadTimeDays?: number;
  region?: string;
  sortBy?: 'cost' | 'leadTime' | 'quality';
  /** Skip ML backend (rules only) */
  rulesOnly?: boolean;
  /** Custom supplier pool */
  suppliers?: Supplier[];
}

export interface PipelineResult {
  /** Unique pipeline run ID */
  pipelineId: string;
  /** ISO timestamp */
  timestamp: string;
  /** Full inference assessment (cost, manufacturability, risks, explanations) */
  assessment: ExplainedAssessment;
  /** Ranked supplier quotes */
  quotes: SupplierQuote[];
  /** Best quote (lowest cost by default) */
  bestQuote: SupplierQuote | null;
  /** Total pipeline latency in ms */
  totalLatencyMs: number;
  /** Stage-level timing */
  stageTiming: {
    inferenceMs: number;
    quotingMs: number;
  };
}

// ─── Pipeline Execution ──────────────────────────────────────────

/**
 * Run the full quoting pipeline: inference → supplier matching → pricing → ranking.
 */
export async function runPipeline(req: PipelineRequest): Promise<PipelineResult> {
  const pipelineStart = performance.now();

  // ── Stage 1: Inference ────────────────────────────
  const inferenceStart = performance.now();
  const assessment = await runInferenceEngine({
    features: req.features,
    materialId: req.materialId,
    processId: req.processId,
    rulesOnly: req.rulesOnly,
  });
  const inferenceMs = +(performance.now() - inferenceStart).toFixed(1);

  // ── Stage 2: Supplier Quoting ─────────────────────
  const quotingStart = performance.now();

  // Extract surface classes present in the part
  const surfaceClasses = extractSurfaceClasses(req.features);

  const quotes = generateQuotes(
    {
      baseCostUsd: assessment.costUsd,
      materialId: req.materialId,
      processId: req.processId,
      complexityScore: assessment.inputs.complexityScore,
      quantity: req.quantity,
      surfaceClasses,
      requiresCertifications: req.requiresCertifications,
      maxLeadTimeDays: req.maxLeadTimeDays,
      region: req.region,
      sortBy: req.sortBy ?? 'cost',
    },
    req.suppliers,
  );
  const quotingMs = +(performance.now() - quotingStart).toFixed(1);

  const totalLatencyMs = +(performance.now() - pipelineStart).toFixed(1);

  return {
    pipelineId: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    assessment,
    quotes,
    bestQuote: quotes[0] ?? null,
    totalLatencyMs,
    stageTiming: { inferenceMs, quotingMs },
  };
}

// ─── Helpers ─────────────────────────────────────────────────────

function extractSurfaceClasses(features: GeometryFeatureSet): SurfaceClass[] {
  const classes = new Set<SurfaceClass>();
  for (const face of features.faces) {
    classes.add(face.surfaceClass);
  }
  return [...classes];
}
