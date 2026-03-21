/**
 * Midwater ML Benchmarking — Data Service
 */

import { supabase } from '@/integrations/supabase/client';
import type { BenchmarkResult, BenchmarkSubmission, BenchmarkComparison } from './benchmarkTypes';

function rowToResult(row: any): BenchmarkResult {
  return {
    id: row.id,
    jobId: row.job_id,
    modelVersionId: row.model_version_id,
    modelType: row.model_type,
    datasetName: row.dataset_name,
    sampleCount: row.sample_count,
    mae: row.mae,
    mse: row.mse,
    rmse: row.rmse,
    mape: row.mape,
    valLoss: row.val_loss,
    trainLoss: row.train_loss,
    accuracy: row.accuracy,
    f1Score: row.f1_score,
    latencyMeanMs: row.latency_mean_ms,
    latencyP50Ms: row.latency_p50_ms,
    latencyP95Ms: row.latency_p95_ms,
    latencyP99Ms: row.latency_p99_ms,
    throughputRps: row.throughput_rps,
    gpuMemoryMb: row.gpu_memory_mb,
    metadata: row.metadata ?? {},
    createdAt: row.created_at,
  };
}

export async function fetchBenchmarks(limit = 50): Promise<BenchmarkResult[]> {
  const { data, error } = await supabase
    .from('model_benchmarks')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw new Error(error.message);
  return (data ?? []).map(rowToResult);
}

export async function submitBenchmark(sub: BenchmarkSubmission): Promise<BenchmarkResult> {
  const row: Record<string, unknown> = {
    model_type: sub.modelType,
    dataset_name: sub.datasetName,
    sample_count: sub.sampleCount,
    mae: sub.mae,
    latency_mean_ms: sub.latencyMeanMs,
    metadata: sub.metadata ?? {},
  };
  if (sub.jobId) row.job_id = sub.jobId;
  if (sub.modelVersionId) row.model_version_id = sub.modelVersionId;
  if (sub.mse != null) row.mse = sub.mse;
  if (sub.rmse != null) row.rmse = sub.rmse;
  if (sub.mape != null) row.mape = sub.mape;
  if (sub.valLoss != null) row.val_loss = sub.valLoss;
  if (sub.trainLoss != null) row.train_loss = sub.trainLoss;
  if (sub.accuracy != null) row.accuracy = sub.accuracy;
  if (sub.f1Score != null) row.f1_score = sub.f1Score;
  if (sub.latencyP50Ms != null) row.latency_p50_ms = sub.latencyP50Ms;
  if (sub.latencyP95Ms != null) row.latency_p95_ms = sub.latencyP95Ms;
  if (sub.latencyP99Ms != null) row.latency_p99_ms = sub.latencyP99Ms;
  if (sub.throughputRps != null) row.throughput_rps = sub.throughputRps;
  if (sub.gpuMemoryMb != null) row.gpu_memory_mb = sub.gpuMemoryMb;

  const { data, error } = await supabase
    .from('model_benchmarks')
    .insert(row as any)
    .select()
    .single();

  if (error) throw new Error(error.message);
  return rowToResult(data);
}

export async function runSimulatedBenchmark(
  jobId: string,
  modelType: string,
): Promise<BenchmarkResult> {
  // Simulate benchmark run for demo/dev
  const mae = +(0.02 + Math.random() * 0.08).toFixed(4);
  const mse = +(mae * mae * (1 + Math.random() * 0.5)).toFixed(6);
  const accuracy = +(0.85 + Math.random() * 0.12).toFixed(4);
  const latency = +(5 + Math.random() * 45).toFixed(1);

  return submitBenchmark({
    jobId,
    modelType,
    datasetName: 'eval-set-v1',
    sampleCount: 500 + Math.floor(Math.random() * 500),
    mae,
    mse,
    rmse: +Math.sqrt(mse).toFixed(5),
    mape: +(mae * 100 * (1 + Math.random() * 0.3)).toFixed(2),
    valLoss: +(0.1 + Math.random() * 0.3).toFixed(4),
    trainLoss: +(0.05 + Math.random() * 0.15).toFixed(4),
    accuracy,
    f1Score: +(accuracy * (0.93 + Math.random() * 0.07)).toFixed(4),
    latencyMeanMs: latency,
    latencyP50Ms: +(latency * 0.85).toFixed(1),
    latencyP95Ms: +(latency * 1.8).toFixed(1),
    latencyP99Ms: +(latency * 2.5).toFixed(1),
    throughputRps: +(1000 / latency).toFixed(1),
  });
}

export function compareBenchmarks(benchmarks: BenchmarkResult[]): BenchmarkComparison {
  if (benchmarks.length === 0) {
    return { models: [], bestMae: null, bestLatency: null, bestAccuracy: null };
  }

  const bestMae = benchmarks.reduce((a, b) => (a.mae < b.mae ? a : b));
  const bestLatency = benchmarks.reduce((a, b) => (a.latencyMeanMs < b.latencyMeanMs ? a : b));
  const bestAccuracy = benchmarks.reduce((a, b) =>
    ((a.accuracy ?? 0) > (b.accuracy ?? 0) ? a : b)
  );

  return { models: benchmarks, bestMae, bestLatency, bestAccuracy };
}
