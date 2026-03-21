import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, useCallback } from 'react';
import { startPipeline, getPipelineStatus, listPipelines, runInference, generateMockGraph } from '@/lib/ml/pipeline';
import type { InferenceResult } from '@/lib/ml/pipeline';
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
