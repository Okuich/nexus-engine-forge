/**
 * Evaluation Service — Metrics tracking, feedback loop, and retraining signals.
 *
 * Responsibilities:
 *   1. Track MAE, loss, latency per model over time
 *   2. Accept real-world outcome feedback (actual cost)
 *   3. Compute prediction error & correction factors
 *   4. Log feedback for retraining pipeline
 *   5. Surface accuracy statistics for the dashboard
 *
 * Design decisions:
 *   - Dual storage: in-memory ring buffer for fast queries + Supabase for persistence
 *   - Feedback triggers correction factor recompute after threshold
 *   - Retraining signal emitted when error exceeds configured threshold
 */

import { supabase } from '@/integrations/supabase/client';

// ─── Types ───────────────────────────────────────────────────────

export interface EvaluationEntry {
  id: string;
  modelId: string;
  modelType: string;
  timestamp: string;
  /** Mean Absolute Error for this prediction */
  mae: number;
  /** Loss value if available */
  loss: number | null;
  /** Inference latency in ms */
  latencyMs: number;
  /** Predicted cost */
  predictedCost: number;
  /** Actual cost (null if not yet known) */
  actualCost: number | null;
  /** Absolute error (null if actual unknown) */
  absoluteError: number | null;
  /** Percentage error (null if actual unknown) */
  percentageError: number | null;
  /** Material + process context */
  context: {
    material: string;
    process: string;
    complexityScore: number;
  };
}

export interface FeedbackInput {
  /** The prediction/estimate ID to attach feedback to */
  estimateId: string;
  /** The predicted cost from the model */
  predictedCost: number;
  /** The actual manufacturing cost */
  actualCost: number;
  /** Material used */
  material: string;
  /** Process used */
  process: string;
  /** Complexity score of the part */
  complexityScore: number;
  /** Optional notes */
  notes?: string;
}

export interface ModelStats {
  modelId: string;
  modelType: string;
  totalPredictions: number;
  totalFeedback: number;
  /** Mean Absolute Error across all feedback */
  overallMAE: number;
  /** Mean Absolute Percentage Error */
  overallMAPE: number;
  /** Average latency */
  avgLatencyMs: number;
  /** P95 latency */
  p95LatencyMs: number;
  /** Trend: improving, stable, or degrading */
  trend: 'improving' | 'stable' | 'degrading';
  /** Correction factor from feedback */
  correctionFactor: number;
}

export interface RetrainingSignal {
  modelId: string;
  reason: string;
  severity: 'info' | 'warning' | 'critical';
  currentMAE: number;
  threshold: number;
  feedbackCount: number;
  timestamp: string;
}

// ─── Configuration ───────────────────────────────────────────────

const RETRAINING_MAE_THRESHOLD = 0.12;
const RETRAINING_MAPE_THRESHOLD = 15; // percent
const MIN_FEEDBACK_FOR_SIGNAL = 10;
const RING_BUFFER_SIZE = 500;

// ─── In-Memory Ring Buffer ───────────────────────────────────────

class EvaluationBuffer {
  private entries: EvaluationEntry[] = [];
  private maxSize: number;

  constructor(maxSize = RING_BUFFER_SIZE) {
    this.maxSize = maxSize;
  }

  push(entry: EvaluationEntry): void {
    this.entries.push(entry);
    if (this.entries.length > this.maxSize) {
      this.entries.shift();
    }
  }

  getAll(): EvaluationEntry[] {
    return [...this.entries];
  }

  getByModel(modelId: string): EvaluationEntry[] {
    return this.entries.filter((e) => e.modelId === modelId);
  }

  getWithFeedback(): EvaluationEntry[] {
    return this.entries.filter((e) => e.actualCost !== null);
  }

  clear(): void {
    this.entries = [];
  }
}

// ─── EvaluationService ───────────────────────────────────────────

export class EvaluationService {
  private buffer = new EvaluationBuffer();
  private retrainingSignals: RetrainingSignal[] = [];

  // ── Record Prediction ───────────────────────────────

  /**
   * Record a model prediction for tracking.
   */
  recordPrediction(params: {
    modelId: string;
    modelType: string;
    predictedCost: number;
    latencyMs: number;
    loss?: number;
    context: { material: string; process: string; complexityScore: number };
  }): EvaluationEntry {
    const entry: EvaluationEntry = {
      id: crypto.randomUUID(),
      modelId: params.modelId,
      modelType: params.modelType,
      timestamp: new Date().toISOString(),
      mae: 0, // Will be computed when feedback arrives
      loss: params.loss ?? null,
      latencyMs: params.latencyMs,
      predictedCost: params.predictedCost,
      actualCost: null,
      absoluteError: null,
      percentageError: null,
      context: params.context,
    };

    this.buffer.push(entry);
    return entry;
  }

  // ── Submit Feedback ─────────────────────────────────

  /**
   * Submit actual cost feedback for a prediction.
   * Computes error metrics, persists to DB, and checks retraining thresholds.
   */
  async submitFeedback(input: FeedbackInput): Promise<{
    entry: EvaluationEntry | null;
    correctionFactor: number;
    retrainingNeeded: boolean;
    signal?: RetrainingSignal;
  }> {
    // Find the prediction in our buffer
    const entry = this.buffer.getAll().find((e) => e.id === input.estimateId);

    const absoluteError = Math.abs(input.actualCost - input.predictedCost);
    const percentageError = input.predictedCost > 0
      ? (absoluteError / input.predictedCost) * 100
      : 0;
    const correctionFactor = input.predictedCost > 0
      ? input.actualCost / input.predictedCost
      : 1;

    // Update in-memory entry
    if (entry) {
      entry.actualCost = input.actualCost;
      entry.absoluteError = +absoluteError.toFixed(2);
      entry.percentageError = +percentageError.toFixed(2);
      entry.mae = +absoluteError.toFixed(2);
    }

    // Persist to Supabase
    try {
      await supabase.from('cost_feedback').insert({
        estimate_id: input.estimateId,
        predicted_cost: input.predictedCost,
        actual_cost: input.actualCost,
        material: input.material,
        process: input.process,
        complexity_score: input.complexityScore,
        correction_factor: correctionFactor,
        notes: input.notes ?? null,
      });
    } catch (err) {
      console.error('[EvaluationService] Failed to persist feedback:', (err as Error).message);
    }

    // Check if retraining is needed
    const modelId = entry?.modelId ?? 'unknown';
    const stats = this.getModelStats(modelId);
    let signal: RetrainingSignal | undefined;
    let retrainingNeeded = false;

    if (stats && stats.totalFeedback >= MIN_FEEDBACK_FOR_SIGNAL) {
      if (stats.overallMAE > RETRAINING_MAE_THRESHOLD) {
        signal = {
          modelId,
          reason: `MAE ${stats.overallMAE.toFixed(4)} exceeds threshold ${RETRAINING_MAE_THRESHOLD}`,
          severity: stats.overallMAE > RETRAINING_MAE_THRESHOLD * 1.5 ? 'critical' : 'warning',
          currentMAE: stats.overallMAE,
          threshold: RETRAINING_MAE_THRESHOLD,
          feedbackCount: stats.totalFeedback,
          timestamp: new Date().toISOString(),
        };
        this.retrainingSignals.push(signal);
        retrainingNeeded = true;
      } else if (stats.overallMAPE > RETRAINING_MAPE_THRESHOLD) {
        signal = {
          modelId,
          reason: `MAPE ${stats.overallMAPE.toFixed(1)}% exceeds threshold ${RETRAINING_MAPE_THRESHOLD}%`,
          severity: 'warning',
          currentMAE: stats.overallMAE,
          threshold: RETRAINING_MAE_THRESHOLD,
          feedbackCount: stats.totalFeedback,
          timestamp: new Date().toISOString(),
        };
        this.retrainingSignals.push(signal);
        retrainingNeeded = true;
      }
    }

    return { entry: entry ?? null, correctionFactor, retrainingNeeded, signal };
  }

  // ── Statistics ──────────────────────────────────────

  /**
   * Get aggregated statistics for a specific model.
   */
  getModelStats(modelId: string): ModelStats | null {
    const entries = this.buffer.getByModel(modelId);
    if (entries.length === 0) return null;

    const withFeedback = entries.filter((e) => e.actualCost !== null);
    const latencies = entries.map((e) => e.latencyMs).sort((a, b) => a - b);

    const avgLatency = latencies.reduce((s, l) => s + l, 0) / latencies.length;
    const p95Index = Math.floor(latencies.length * 0.95);
    const p95Latency = latencies[p95Index] ?? latencies[latencies.length - 1];

    let overallMAE = 0;
    let overallMAPE = 0;
    let correctionFactor = 1;

    if (withFeedback.length > 0) {
      overallMAE = withFeedback.reduce((s, e) => s + (e.absoluteError ?? 0), 0) / withFeedback.length;
      overallMAPE = withFeedback.reduce((s, e) => s + (e.percentageError ?? 0), 0) / withFeedback.length;

      const ratios = withFeedback.map((e) => (e.actualCost ?? 0) / Math.max(e.predictedCost, 0.01));
      ratios.sort((a, b) => a - b);
      const mid = Math.floor(ratios.length / 2);
      correctionFactor = ratios.length % 2 === 0
        ? (ratios[mid - 1] + ratios[mid]) / 2
        : ratios[mid];
    }

    // Trend: compare recent vs older feedback
    let trend: ModelStats['trend'] = 'stable';
    if (withFeedback.length >= 6) {
      const half = Math.floor(withFeedback.length / 2);
      const olderMAE = withFeedback.slice(0, half).reduce((s, e) => s + (e.absoluteError ?? 0), 0) / half;
      const recentMAE = withFeedback.slice(half).reduce((s, e) => s + (e.absoluteError ?? 0), 0) / (withFeedback.length - half);
      const delta = recentMAE - olderMAE;
      trend = delta < -0.005 ? 'improving' : delta > 0.005 ? 'degrading' : 'stable';
    }

    return {
      modelId,
      modelType: entries[0].modelType,
      totalPredictions: entries.length,
      totalFeedback: withFeedback.length,
      overallMAE: +overallMAE.toFixed(4),
      overallMAPE: +overallMAPE.toFixed(2),
      avgLatencyMs: +avgLatency.toFixed(1),
      p95LatencyMs: +p95Latency.toFixed(1),
      trend,
      correctionFactor: +correctionFactor.toFixed(4),
    };
  }

  /**
   * Get stats for all tracked models.
   */
  getAllModelStats(): ModelStats[] {
    const modelIds = new Set(this.buffer.getAll().map((e) => e.modelId));
    const stats: ModelStats[] = [];
    for (const id of modelIds) {
      const s = this.getModelStats(id);
      if (s) stats.push(s);
    }
    return stats;
  }

  /**
   * Get retraining signals.
   */
  getRetrainingSignals(): RetrainingSignal[] {
    return [...this.retrainingSignals];
  }

  /**
   * Get all entries (for export/debugging).
   */
  getEntries(): EvaluationEntry[] {
    return this.buffer.getAll();
  }

  /**
   * Get entries with feedback attached.
   */
  getFeedbackEntries(): EvaluationEntry[] {
    return this.buffer.getWithFeedback();
  }

  clear(): void {
    this.buffer.clear();
    this.retrainingSignals = [];
  }
}

/** Singleton instance */
export const evaluationService = new EvaluationService();
