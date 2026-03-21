import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import {
  startPipeline,
  listPipelines,
  runInference,
  runOptimization,
  generateMockGraph,
} from '@/lib/ml/pipeline';
import type {
  InferenceResult,
  OptimizationResult,
  OptimizationConfig,
} from '@/lib/ml/pipeline';
import type { TrainingJob } from '@/lib/ml/types';
import { subscribeToJob } from '@/lib/ml/orchestrator';

export function usePipelines() {
  return useQuery({
    queryKey: ['pipelines'],
    queryFn: listPipelines,
    refetchInterval: 8000,
  });
}

export function useStartPipeline() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: startPipeline,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pipelines'] }),
  });
}

export function useQuickInference() {
  return useMutation({
    mutationFn: async (params: { fileName: string; material: string; process: string }) => {
      const graph = generateMockGraph(params.fileName);
      graph.material = params.material;
      graph.process = params.process;
      return runInference(graph);
    },
  });
}

export function useOptimization() {
  return useMutation({
    mutationFn: async (params: {
      fileName: string;
      material: string;
      process: string;
      config?: OptimizationConfig;
    }) => {
      const graph = generateMockGraph(params.fileName);
      graph.material = params.material;
      graph.process = params.process;
      return runOptimization(graph, params.material, params.config);
    },
  });
}

export function usePipelineRealtime(pipelineId: string | null) {
  const qc = useQueryClient();
  const [liveJob, setLiveJob] = useState<TrainingJob | null>(null);

  useEffect(() => {
    if (!pipelineId) return;
    const sub = subscribeToJob(pipelineId, (job) => {
      setLiveJob(job);
      qc.invalidateQueries({ queryKey: ['pipelines'] });
    });
    return () => { sub.unsubscribe(); setLiveJob(null); };
  }, [pipelineId, qc]);

  return liveJob;
}
