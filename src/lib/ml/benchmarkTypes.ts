/**
 * Midwater ML Benchmarking — Types
 */

export interface BenchmarkResult {
  id: string;
  jobId: string | null;
  modelVersionId: string | null;
  modelType: string;
  datasetName: string;
  sampleCount: number;
  /** Mean Absolute Error */
  mae: number;
  mse: number | null;
  rmse: number | null;
  mape: number | null;
  valLoss: number | null;
  trainLoss: number | null;
  accuracy: number | null;
  f1Score: number | null;
  /** Mean latency in ms */
  latencyMeanMs: number;
  latencyP50Ms: number | null;
  latencyP95Ms: number | null;
  latencyP99Ms: number | null;
  throughputRps: number | null;
  gpuMemoryMb: number | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface BenchmarkSubmission {
  jobId?: string;
  modelVersionId?: string;
  modelType: string;
  datasetName: string;
  sampleCount: number;
  mae: number;
  mse?: number;
  rmse?: number;
  mape?: number;
  valLoss?: number;
  trainLoss?: number;
  accuracy?: number;
  f1Score?: number;
  latencyMeanMs: number;
  latencyP50Ms?: number;
  latencyP95Ms?: number;
  latencyP99Ms?: number;
  throughputRps?: number;
  gpuMemoryMb?: number;
  metadata?: Record<string, unknown>;
}

export interface BenchmarkComparison {
  models: BenchmarkResult[];
  bestMae: BenchmarkResult | null;
  bestLatency: BenchmarkResult | null;
  bestAccuracy: BenchmarkResult | null;
}
