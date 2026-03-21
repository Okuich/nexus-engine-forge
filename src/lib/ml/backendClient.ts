/**
 * Midwater ML Backend Client
 *
 * Production-ready TypeScript service for communicating with
 * the Python FastAPI ML backend via a Supabase edge function proxy.
 *
 * Features:
 *   - Typed request/response contracts
 *   - Exponential-backoff retries
 *   - Structured logging
 *   - Status polling with configurable intervals
 *   - Abort support via AbortController
 */

import { supabase } from '@/integrations/supabase/client';
import type { GeometryFeatureSet } from '@/lib/geometry/types';
import type { TrainingJob, TrainingJobConfig, EpochMetric } from './types';

// ─── Configuration ───────────────────────────────────────────────

export interface BackendClientConfig {
  /** Max retry attempts for transient failures (default 3) */
  maxRetries: number;
  /** Base delay between retries in ms (default 1000) */
  retryDelayMs: number;
  /** Status polling interval in ms (default 2000) */
  pollIntervalMs: number;
  /** Request timeout in ms (default 30000) */
  timeoutMs: number;
  /** Enable structured console logging (default true) */
  logging: boolean;
}

const DEFAULT_CONFIG: BackendClientConfig = {
  maxRetries: 3,
  retryDelayMs: 1000,
  pollIntervalMs: 2000,
  timeoutMs: 30_000,
  logging: true,
};

// ─── Request / Response Types ────────────────────────────────────

export interface FeatureSubmission {
  /** Unique identifier for this geometry */
  geometryId: string;
  /** 12-d per-face feature matrix */
  nodeFeatures: number[][];
  /** COO edge index [2 × E] */
  edgeIndex: [number[], number[]];
  /** Edge attribute matrix [E × 4] */
  edgeAttr: number[][];
  /** Material specification */
  material: string;
  /** Manufacturing process */
  process: string;
  /** Optional metadata */
  metadata?: Record<string, unknown>;
}

export interface PredictionResponse {
  geometryId: string;
  manufacturabilityScore: number;
  estimatedCostUsd: number;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  riskRegions: Array<{
    faceIndex: number;
    severity: string;
    description: string;
  }>;
  recommendations: string[];
  latencyMs: number;
  modelVersion: string;
}

export interface TrainingRequest {
  name: string;
  modelType: string;
  datasetId: string;
  config: Partial<TrainingJobConfig>;
}

export interface TrainingStatusResponse {
  jobId: string;
  status: TrainingJob['status'];
  progress: number;
  epochsCompleted: number;
  epochsTotal: number;
  metrics: {
    trainLoss?: number;
    valLoss?: number;
    accuracy?: number;
    f1Score?: number;
  };
  error?: string;
  startedAt?: string;
  completedAt?: string;
}

export interface HealthCheckResponse {
  status: 'healthy' | 'degraded' | 'unhealthy';
  version: string;
  gpuAvailable: boolean;
  modelLoaded: boolean;
  uptimeSeconds: number;
}

// ─── Logging ─────────────────────────────────────────────────────

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

function log(
  level: LogLevel,
  message: string,
  data?: Record<string, unknown>,
  enabled = true,
) {
  if (!enabled) return;
  const entry = {
    timestamp: new Date().toISOString(),
    service: 'ml-backend-client',
    level,
    message,
    ...data,
  };
  const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  fn(`[ML] ${level.toUpperCase()} ${message}`, data ? entry : '');
}

// ─── Retry Logic ─────────────────────────────────────────────────

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

async function withRetry<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  config: BackendClientConfig,
  label: string,
  abortController?: AbortController,
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < config.maxRetries; attempt++) {
    const controller = abortController ?? new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeoutMs);

    try {
      log('debug', `${label} attempt ${attempt + 1}/${config.maxRetries}`, undefined, config.logging);
      const result = await fn(controller.signal);
      clearTimeout(timer);
      return result;
    } catch (err) {
      clearTimeout(timer);
      lastError = err instanceof Error ? err : new Error(String(err));

      // Don't retry on user abort
      if (controller.signal.aborted && abortController) throw lastError;

      const isRetryable =
        lastError.message.includes('timeout') ||
        lastError.message.includes('network') ||
        RETRYABLE_STATUS.has(parseStatusFromError(lastError));

      if (!isRetryable || attempt === config.maxRetries - 1) {
        log('error', `${label} failed after ${attempt + 1} attempts`, { error: lastError.message }, config.logging);
        throw lastError;
      }

      const delay = config.retryDelayMs * Math.pow(2, attempt) + Math.random() * 200;
      log('warn', `${label} retry in ${Math.round(delay)}ms`, { attempt: attempt + 1, error: lastError.message }, config.logging);
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  throw lastError ?? new Error(`${label} failed`);
}

function parseStatusFromError(err: Error): number {
  const match = err.message.match(/\b(\d{3})\b/);
  return match ? parseInt(match[1], 10) : 0;
}

// ─── Edge Function Invoker ───────────────────────────────────────

async function invokeBackend<T>(
  action: string,
  payload: Record<string, unknown>,
  config: BackendClientConfig,
  abortController?: AbortController,
): Promise<T> {
  return withRetry(
    async () => {
      const { data, error } = await supabase.functions.invoke('ml-backend', {
        body: { action, ...payload },
      });

      if (error) {
        throw new Error(`ml-backend/${action}: ${error.message}`);
      }

      if (data?.error) {
        throw new Error(`ml-backend/${action}: ${data.error}`);
      }

      return data as T;
    },
    config,
    `ml-backend/${action}`,
    abortController,
  );
}

// ─── Public API ──────────────────────────────────────────────────

/**
 * Create a configured ML backend client instance.
 *
 * Usage:
 * ```ts
 * const ml = createBackendClient();
 * const prediction = await ml.predict(features, 'Al 7075-T6', 'CNC Milling');
 * ```
 */
export function createBackendClient(overrides?: Partial<BackendClientConfig>) {
  const config: BackendClientConfig = { ...DEFAULT_CONFIG, ...overrides };

  return {
    /**
     * Health check — verify backend is running and GPU is available.
     */
    async healthCheck(): Promise<HealthCheckResponse> {
      log('info', 'Health check', undefined, config.logging);
      return invokeBackend<HealthCheckResponse>('health', {}, config);
    },

    /**
     * Submit geometry features for manufacturability prediction.
     * Converts a GeometryFeatureSet into the backend's expected format.
     */
    async predict(
      features: GeometryFeatureSet,
      material: string,
      process: string,
      geometryId?: string,
    ): Promise<PredictionResponse> {
      const submission: FeatureSubmission = {
        geometryId: geometryId ?? crypto.randomUUID(),
        nodeFeatures: features.nodeFeatures,
        edgeIndex: features.edgeIndex,
        edgeAttr: features.edgeAttr,
        material,
        process,
      };

      log('info', 'Submitting prediction', {
        geometryId: submission.geometryId,
        nodes: features.nodeFeatures.length,
        edges: features.edgeIndex[0].length,
        material,
        process,
      }, config.logging);

      return invokeBackend<PredictionResponse>('predict', { submission }, config);
    },

    /**
     * Submit raw feature arrays for prediction (when GeometryFeatureSet is not available).
     */
    async predictRaw(submission: FeatureSubmission): Promise<PredictionResponse> {
      log('info', 'Submitting raw prediction', {
        geometryId: submission.geometryId,
        nodes: submission.nodeFeatures.length,
      }, config.logging);

      return invokeBackend<PredictionResponse>('predict', { submission }, config);
    },

    /**
     * Trigger a training job on the Python backend.
     * Returns the job ID for status polling.
     */
    async startTraining(request: TrainingRequest): Promise<{ jobId: string }> {
      log('info', 'Starting training job', { name: request.name, model: request.modelType }, config.logging);
      return invokeBackend<{ jobId: string }>('train', { request }, config);
    },

    /**
     * Poll training job status once.
     */
    async getTrainingStatus(jobId: string): Promise<TrainingStatusResponse> {
      return invokeBackend<TrainingStatusResponse>('training_status', { jobId }, config);
    },

    /**
     * Poll training status until terminal state.
     * Calls `onProgress` with each status update.
     * Returns the final status.
     */
    async pollTrainingUntilDone(
      jobId: string,
      onProgress?: (status: TrainingStatusResponse) => void,
      abortController?: AbortController,
    ): Promise<TrainingStatusResponse> {
      const terminalStates = new Set(['completed', 'failed', 'cancelled']);

      log('info', 'Polling training job', { jobId, intervalMs: config.pollIntervalMs }, config.logging);

      // eslint-disable-next-line no-constant-condition
      while (true) {
        if (abortController?.signal.aborted) {
          throw new Error('Polling aborted');
        }

        const status = await this.getTrainingStatus(jobId);
        onProgress?.(status);

        log('debug', 'Training status', {
          jobId,
          status: status.status,
          progress: status.progress,
          epoch: `${status.epochsCompleted}/${status.epochsTotal}`,
        }, config.logging);

        if (terminalStates.has(status.status)) {
          log('info', `Training ${status.status}`, {
            jobId,
            accuracy: status.metrics.accuracy,
            f1: status.metrics.f1Score,
          }, config.logging);
          return status;
        }

        await new Promise((r) => setTimeout(r, config.pollIntervalMs));
      }
    },

    /**
     * Get epoch-level metrics for a completed or in-progress job.
     */
    async getJobMetrics(jobId: string): Promise<EpochMetric[]> {
      return invokeBackend<EpochMetric[]>('job_metrics', { jobId }, config);
    },

    /**
     * Submit a batch of geometry features for prediction.
     */
    async predictBatch(
      submissions: FeatureSubmission[],
    ): Promise<{ results: PredictionResponse[]; latencyMs: number }> {
      log('info', 'Batch prediction', { count: submissions.length }, config.logging);
      return invokeBackend('predict_batch', { submissions }, config);
    },
  };
}

/** Singleton default client */
export const mlBackend = createBackendClient();
