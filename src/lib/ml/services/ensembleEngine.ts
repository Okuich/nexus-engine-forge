/**
 * EnsembleEngine — Multi-model inference with averaging/weighting.
 *
 * Design decisions:
 *   - Calls N models in parallel, collects predictions
 *   - Supports simple average, weighted average (by inverse-MAE), and median
 *   - Tolerates partial failures: if ≥1 model succeeds, returns result
 *   - Falls back to rule-based engine if all models fail
 *   - Records per-model latency for monitoring
 *
 * Architecture:
 *   GeometryFeatureSet
 *       │
 *       ├─→ Model A ──┐
 *       ├─→ Model B ──├─→ Aggregation ──→ EnsemblePrediction
 *       └─→ Model C ──┘
 *                      ↓ (all fail)
 *                   Rule Engine (fallback)
 */

import type { GeometryFeatureSet } from '@/lib/geometry/types';
import { estimateCost, MATERIALS, PROCESSES } from '@/lib/ml/costEngine';
import { modelManager, type ManagedModel } from './mlManager';

// ─── Types ───────────────────────────────────────────────────────

export type AggregationMethod = 'mean' | 'weighted' | 'median';

export interface ModelPrediction {
  modelId: string;
  modelType: string;
  costUsd: number;
  manufacturabilityScore: number;
  latencyMs: number;
  success: boolean;
  error?: string;
}

export interface EnsemblePrediction {
  /** Aggregated cost prediction */
  costUsd: number;
  /** Aggregated manufacturability score */
  manufacturabilityScore: number;
  /** Individual model predictions */
  predictions: ModelPrediction[];
  /** How many models succeeded */
  successCount: number;
  /** Total models attempted */
  totalModels: number;
  /** Which aggregation was used */
  aggregation: AggregationMethod;
  /** Whether we fell back to rules */
  usedFallback: boolean;
  /** Total wall-clock time */
  totalLatencyMs: number;
  /** Confidence: higher when models agree */
  confidence: number;
}

export interface EnsembleConfig {
  /** Max models to include (default: 3) */
  maxModels: number;
  /** Aggregation method (default: weighted) */
  aggregation: AggregationMethod;
  /** Timeout per model in ms (default: 4000) */
  perModelTimeoutMs: number;
  /** Minimum models required to trust ensemble (default: 1) */
  minSuccessful: number;
}

const DEFAULT_ENSEMBLE_CONFIG: EnsembleConfig = {
  maxModels: 3,
  aggregation: 'weighted',
  perModelTimeoutMs: 4000,
  minSuccessful: 1,
};

// ─── Simulate Model Call ─────────────────────────────────────────
// In production, each model call goes through the ML backend edge function.
// Here we simulate with noise around the rule-based estimate for dev.

async function callModel(
  model: ManagedModel,
  features: GeometryFeatureSet,
  materialId: string,
  processId: string,
  timeoutMs: number,
): Promise<ModelPrediction> {
  const start = performance.now();

  try {
    // Simulate latency + prediction noise per model type
    const baseLatency = model.metrics.latencyMeanMs;
    const simulatedDelay = Math.max(5, baseLatency * (0.8 + Math.random() * 0.4));
    await new Promise((r) => setTimeout(r, Math.min(simulatedDelay, timeoutMs)));

    if (simulatedDelay > timeoutMs) {
      throw new Error(`Model ${model.id} timed out after ${timeoutMs}ms`);
    }

    // Get rule-based estimate as baseline, add model-specific noise
    const ruleEstimate = estimateCost(features, { materialId, processId });
    const noise = 1 + (Math.random() - 0.5) * 0.15 * (1 + model.metrics.mae);
    const costUsd = +(ruleEstimate.totalCost * noise).toFixed(2);

    // Manufacturability score from model characteristics
    const baseScore = 85 - model.metrics.mae * 100 + (Math.random() - 0.5) * 10;
    const manufacturabilityScore = +Math.max(20, Math.min(98, baseScore)).toFixed(1);

    return {
      modelId: model.id,
      modelType: model.modelType,
      costUsd,
      manufacturabilityScore,
      latencyMs: +(performance.now() - start).toFixed(1),
      success: true,
    };
  } catch (err) {
    return {
      modelId: model.id,
      modelType: model.modelType,
      costUsd: 0,
      manufacturabilityScore: 0,
      latencyMs: +(performance.now() - start).toFixed(1),
      success: false,
      error: (err as Error).message,
    };
  }
}

// ─── Aggregation ─────────────────────────────────────────────────

function aggregate(
  predictions: ModelPrediction[],
  method: AggregationMethod,
): { costUsd: number; manufacturabilityScore: number } {
  const successful = predictions.filter((p) => p.success);
  if (successful.length === 0) return { costUsd: 0, manufacturabilityScore: 0 };
  if (successful.length === 1) {
    return {
      costUsd: successful[0].costUsd,
      manufacturabilityScore: successful[0].manufacturabilityScore,
    };
  }

  switch (method) {
    case 'mean': {
      const avgCost = successful.reduce((s, p) => s + p.costUsd, 0) / successful.length;
      const avgScore = successful.reduce((s, p) => s + p.manufacturabilityScore, 0) / successful.length;
      return { costUsd: +avgCost.toFixed(2), manufacturabilityScore: +avgScore.toFixed(1) };
    }

    case 'weighted': {
      // Weight by inverse MAE from the model manager
      const weights = successful.map((p) => {
        const model = modelManager.getModel(p.modelId);
        const mae = model?.metrics.mae ?? 0.1;
        return 1 / Math.max(mae, 0.001);
      });
      const totalWeight = weights.reduce((s, w) => s + w, 0);

      const wCost = successful.reduce((s, p, i) => s + p.costUsd * weights[i], 0) / totalWeight;
      const wScore = successful.reduce((s, p, i) => s + p.manufacturabilityScore * weights[i], 0) / totalWeight;
      return { costUsd: +wCost.toFixed(2), manufacturabilityScore: +wScore.toFixed(1) };
    }

    case 'median': {
      const sortedCosts = successful.map((p) => p.costUsd).sort((a, b) => a - b);
      const sortedScores = successful.map((p) => p.manufacturabilityScore).sort((a, b) => a - b);
      const mid = Math.floor(sortedCosts.length / 2);

      const medianCost = sortedCosts.length % 2 === 0
        ? (sortedCosts[mid - 1] + sortedCosts[mid]) / 2
        : sortedCosts[mid];
      const medianScore = sortedScores.length % 2 === 0
        ? (sortedScores[mid - 1] + sortedScores[mid]) / 2
        : sortedScores[mid];

      return { costUsd: +medianCost.toFixed(2), manufacturabilityScore: +medianScore.toFixed(1) };
    }
  }
}

// ─── Confidence from agreement ───────────────────────────────────

function computeConfidence(predictions: ModelPrediction[]): number {
  const successful = predictions.filter((p) => p.success);
  if (successful.length <= 1) return 0.5;

  const costs = successful.map((p) => p.costUsd);
  const mean = costs.reduce((s, c) => s + c, 0) / costs.length;
  const variance = costs.reduce((s, c) => s + (c - mean) ** 2, 0) / costs.length;
  const cv = mean > 0 ? Math.sqrt(variance) / mean : 1; // coefficient of variation

  // Low CV = high agreement = high confidence
  return +Math.max(0.3, Math.min(0.95, 1 - cv * 2)).toFixed(3);
}

// ─── Public API ──────────────────────────────────────────────────

/**
 * Run ensemble inference across multiple models.
 *
 * Calls top N models in parallel, aggregates predictions,
 * falls back to rule-based engine if all fail.
 */
export async function runEnsemble(params: {
  features: GeometryFeatureSet;
  materialId: string;
  processId: string;
  config?: Partial<EnsembleConfig>;
}): Promise<EnsemblePrediction> {
  const config = { ...DEFAULT_ENSEMBLE_CONFIG, ...params.config };
  const start = performance.now();

  // Validate material/process
  if (!MATERIALS[params.materialId]) throw new Error(`Unknown material: ${params.materialId}`);
  if (!PROCESSES[params.processId]) throw new Error(`Unknown process: ${params.processId}`);

  // Select top models
  const healthyModels = modelManager.listHealthy();
  const modelsToUse = healthyModels.slice(0, config.maxModels);

  if (modelsToUse.length === 0) {
    // Full fallback to rule engine
    const ruleEstimate = estimateCost(params.features, {
      materialId: params.materialId,
      processId: params.processId,
    });

    return {
      costUsd: ruleEstimate.totalCost,
      manufacturabilityScore: 75,
      predictions: [],
      successCount: 0,
      totalModels: 0,
      aggregation: config.aggregation,
      usedFallback: true,
      totalLatencyMs: +(performance.now() - start).toFixed(1),
      confidence: 0.4,
    };
  }

  // Call all models in parallel
  const predictions = await Promise.all(
    modelsToUse.map((model) =>
      callModel(model, params.features, params.materialId, params.processId, config.perModelTimeoutMs),
    ),
  );

  // Track health
  for (const pred of predictions) {
    if (pred.success) {
      modelManager.recordSuccess(pred.modelId);
    } else {
      modelManager.recordFailure(pred.modelId);
    }
  }

  const successCount = predictions.filter((p) => p.success).length;

  // If not enough successful predictions, fall back
  if (successCount < config.minSuccessful) {
    const ruleEstimate = estimateCost(params.features, {
      materialId: params.materialId,
      processId: params.processId,
    });

    return {
      costUsd: ruleEstimate.totalCost,
      manufacturabilityScore: 70,
      predictions,
      successCount,
      totalModels: modelsToUse.length,
      aggregation: config.aggregation,
      usedFallback: true,
      totalLatencyMs: +(performance.now() - start).toFixed(1),
      confidence: 0.35,
    };
  }

  // Aggregate
  const { costUsd, manufacturabilityScore } = aggregate(predictions, config.aggregation);
  const confidence = computeConfidence(predictions);

  return {
    costUsd,
    manufacturabilityScore,
    predictions,
    successCount,
    totalModels: modelsToUse.length,
    aggregation: config.aggregation,
    usedFallback: false,
    totalLatencyMs: +(performance.now() - start).toFixed(1),
    confidence,
  };
}
