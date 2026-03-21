/**
 * ModelManager — Multi-version model registry & selection service.
 *
 * Responsibilities:
 *   1. Register & track multiple model versions with benchmark metrics
 *   2. Select best model based on configurable criteria (MAE, latency, accuracy)
 *   3. Fallback to rule-based engine if no models qualify
 *   4. Retry logic for model invocations with exponential backoff
 *
 * Design decisions:
 *   - In-memory registry backed by Supabase reads for persistence
 *   - Pluggable selection strategy (best-MAE, best-latency, best-accuracy, custom)
 *   - Health tracking per model version — auto-disable unhealthy models
 */

import { supabase } from '@/integrations/supabase/client';
import type { BenchmarkResult } from '@/lib/ml/benchmarkTypes';

// ─── Types ───────────────────────────────────────────────────────

export type SelectionStrategy = 'best-mae' | 'best-latency' | 'best-accuracy' | 'balanced';

export interface ManagedModel {
  id: string;
  versionId: string | null;
  modelType: string;
  /** Latest benchmark metrics snapshot */
  metrics: ModelMetricsSnapshot;
  /** Health: consecutive failure count */
  consecutiveFailures: number;
  /** Is this model currently healthy? */
  healthy: boolean;
  /** When the model was last successfully invoked */
  lastSuccessAt: string | null;
  /** When registered */
  registeredAt: string;
}

export interface ModelMetricsSnapshot {
  mae: number;
  accuracy: number | null;
  f1Score: number | null;
  latencyMeanMs: number;
  latencyP95Ms: number | null;
  throughputRps: number | null;
  sampleCount: number;
}

export interface ModelSelectionResult {
  selectedModel: ManagedModel;
  reason: string;
  fallback: boolean;
}

// ─── Constants ───────────────────────────────────────────────────

const MAX_CONSECUTIVE_FAILURES = 3;
const MAX_RETRIES = 3;
const BASE_RETRY_DELAY_MS = 500;

// ─── ModelManager ────────────────────────────────────────────────

export class ModelManager {
  private models = new Map<string, ManagedModel>();
  private strategy: SelectionStrategy;

  constructor(strategy: SelectionStrategy = 'balanced') {
    this.strategy = strategy;
  }

  // ── Registration ────────────────────────────────────

  /**
   * Register a model version with its benchmark metrics.
   */
  registerModel(params: {
    id: string;
    modelType: string;
    versionId?: string;
    metrics: ModelMetricsSnapshot;
  }): ManagedModel {
    const model: ManagedModel = {
      id: params.id,
      versionId: params.versionId ?? null,
      modelType: params.modelType,
      metrics: params.metrics,
      consecutiveFailures: 0,
      healthy: true,
      lastSuccessAt: null,
      registeredAt: new Date().toISOString(),
    };

    this.models.set(params.id, model);
    return model;
  }

  /**
   * Bulk-register models from benchmark results (e.g. fetched from DB).
   */
  registerFromBenchmarks(benchmarks: BenchmarkResult[]): ManagedModel[] {
    return benchmarks.map((b) =>
      this.registerModel({
        id: b.id,
        modelType: b.modelType,
        versionId: b.modelVersionId ?? undefined,
        metrics: {
          mae: b.mae,
          accuracy: b.accuracy,
          f1Score: b.f1Score,
          latencyMeanMs: b.latencyMeanMs,
          latencyP95Ms: b.latencyP95Ms,
          throughputRps: b.throughputRps,
          sampleCount: b.sampleCount,
        },
      }),
    );
  }

  /**
   * Load models from the database benchmark table.
   */
  async loadFromDatabase(limit = 20): Promise<ManagedModel[]> {
    const { data, error } = await supabase
      .from('model_benchmarks')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw new Error(`Failed to load models: ${error.message}`);

    return (data ?? []).map((row: any) =>
      this.registerModel({
        id: row.id,
        modelType: row.model_type,
        versionId: row.model_version_id,
        metrics: {
          mae: row.mae,
          accuracy: row.accuracy,
          f1Score: row.f1_score,
          latencyMeanMs: row.latency_mean_ms,
          latencyP95Ms: row.latency_p95_ms,
          throughputRps: row.throughput_rps,
          sampleCount: row.sample_count,
        },
      }),
    );
  }

  // ── Selection ───────────────────────────────────────

  /**
   * Select the best model based on the configured strategy.
   * Only considers healthy models.
   */
  selectBest(): ModelSelectionResult {
    const healthy = Array.from(this.models.values()).filter((m) => m.healthy);

    if (healthy.length === 0) {
      // Fallback: create a synthetic "rule-based" model entry
      const ruleModel: ManagedModel = {
        id: 'rule-engine-fallback',
        versionId: null,
        modelType: 'rules',
        metrics: { mae: 0.15, accuracy: null, f1Score: null, latencyMeanMs: 1, latencyP95Ms: 2, throughputRps: 1000, sampleCount: 0 },
        consecutiveFailures: 0,
        healthy: true,
        lastSuccessAt: null,
        registeredAt: new Date().toISOString(),
      };

      return {
        selectedModel: ruleModel,
        reason: 'No healthy ML models available — falling back to rule-based engine',
        fallback: true,
      };
    }

    let selected: ManagedModel;
    let reason: string;

    switch (this.strategy) {
      case 'best-mae':
        selected = healthy.reduce((best, m) => (m.metrics.mae < best.metrics.mae ? m : best));
        reason = `Lowest MAE: ${selected.metrics.mae.toFixed(4)}`;
        break;

      case 'best-latency':
        selected = healthy.reduce((best, m) =>
          m.metrics.latencyMeanMs < best.metrics.latencyMeanMs ? m : best,
        );
        reason = `Lowest latency: ${selected.metrics.latencyMeanMs.toFixed(1)}ms`;
        break;

      case 'best-accuracy':
        selected = healthy.reduce((best, m) =>
          (m.metrics.accuracy ?? 0) > (best.metrics.accuracy ?? 0) ? m : best,
        );
        reason = `Highest accuracy: ${((selected.metrics.accuracy ?? 0) * 100).toFixed(1)}%`;
        break;

      case 'balanced':
      default: {
        // Weighted score: 40% MAE (inverted), 30% accuracy, 30% latency (inverted)
        const score = (m: ManagedModel) => {
          const maeScore = Math.max(0, 1 - m.metrics.mae * 10); // MAE 0.1 → 0, MAE 0 → 1
          const accScore = m.metrics.accuracy ?? 0.5;
          const latScore = Math.max(0, 1 - m.metrics.latencyMeanMs / 100); // 100ms → 0
          return maeScore * 0.4 + accScore * 0.3 + latScore * 0.3;
        };
        selected = healthy.reduce((best, m) => (score(m) > score(best) ? m : best));
        reason = `Balanced score — MAE: ${selected.metrics.mae.toFixed(4)}, Acc: ${((selected.metrics.accuracy ?? 0) * 100).toFixed(1)}%, Lat: ${selected.metrics.latencyMeanMs.toFixed(1)}ms`;
        break;
      }
    }

    return { selectedModel: selected, reason, fallback: false };
  }

  // ── Health Tracking ─────────────────────────────────

  /**
   * Record a successful invocation for a model.
   */
  recordSuccess(modelId: string): void {
    const model = this.models.get(modelId);
    if (!model) return;
    model.consecutiveFailures = 0;
    model.healthy = true;
    model.lastSuccessAt = new Date().toISOString();
  }

  /**
   * Record a failed invocation. Marks model unhealthy after MAX_CONSECUTIVE_FAILURES.
   */
  recordFailure(modelId: string): void {
    const model = this.models.get(modelId);
    if (!model) return;
    model.consecutiveFailures++;
    if (model.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      model.healthy = false;
      console.warn(`[ModelManager] Model ${modelId} marked unhealthy after ${model.consecutiveFailures} failures`);
    }
  }

  // ── Retry Wrapper ───────────────────────────────────

  /**
   * Execute a function with retry logic and exponential backoff.
   * On exhausted retries, falls back to rule-based engine.
   */
  async withRetry<T>(
    fn: () => Promise<T>,
    modelId: string,
    retries = MAX_RETRIES,
  ): Promise<{ result: T; retried: boolean } | { fallback: true }> {
    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        const result = await fn();
        this.recordSuccess(modelId);
        return { result, retried: attempt > 0 };
      } catch (err) {
        this.recordFailure(modelId);
        console.warn(
          `[ModelManager] Model ${modelId} attempt ${attempt + 1}/${retries} failed:`,
          (err as Error).message,
        );

        if (attempt < retries - 1) {
          const delay = BASE_RETRY_DELAY_MS * Math.pow(2, attempt) + Math.random() * 200;
          await new Promise((r) => setTimeout(r, delay));
        }
      }
    }

    return { fallback: true };
  }

  // ── Accessors ───────────────────────────────────────

  getModel(id: string): ManagedModel | undefined {
    return this.models.get(id);
  }

  listModels(): ManagedModel[] {
    return Array.from(this.models.values());
  }

  listHealthy(): ManagedModel[] {
    return this.listModels().filter((m) => m.healthy);
  }

  setStrategy(strategy: SelectionStrategy): void {
    this.strategy = strategy;
  }

  getStrategy(): SelectionStrategy {
    return this.strategy;
  }

  clear(): void {
    this.models.clear();
  }
}

/** Singleton instance */
export const modelManager = new ModelManager('balanced');
