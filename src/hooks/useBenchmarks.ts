/**
 * Midwater ML Benchmarking — React Hooks
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchBenchmarks, submitBenchmark, runSimulatedBenchmark } from '@/lib/ml/benchmarkService';
import type { BenchmarkSubmission } from '@/lib/ml/benchmarkTypes';

export function useBenchmarks() {
  return useQuery({
    queryKey: ['benchmarks'],
    queryFn: () => fetchBenchmarks(50),
    refetchInterval: 15000,
  });
}

export function useSubmitBenchmark() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sub: BenchmarkSubmission) => submitBenchmark(sub),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['benchmarks'] }),
  });
}

export function useRunBenchmark() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ jobId, modelType }: { jobId: string; modelType: string }) =>
      runSimulatedBenchmark(jobId, modelType),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['benchmarks'] }),
  });
}
