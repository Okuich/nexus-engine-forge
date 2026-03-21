import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import {
  createTrainingJob,
  fetchTrainingJobs,
  fetchJobMetrics,
  startTraining,
  cancelTraining,
  subscribeToJob,
  subscribeToMetrics,
} from '@/lib/ml/orchestrator';
import type { TrainingJob, EpochMetric, StartTrainingRequest } from '@/lib/ml/types';

export function useTrainingJobs() {
  return useQuery({
    queryKey: ['training-jobs'],
    queryFn: fetchTrainingJobs,
    refetchInterval: 10000,
  });
}

export function useJobMetrics(jobId: string | null) {
  return useQuery({
    queryKey: ['job-metrics', jobId],
    queryFn: () => (jobId ? fetchJobMetrics(jobId) : Promise.resolve([])),
    enabled: !!jobId,
    refetchInterval: 5000,
  });
}

export function useCreateAndStartJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (req: StartTrainingRequest) => {
      const job = await createTrainingJob(req);
      await startTraining(job.id);
      return job;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['training-jobs'] }),
  });
}

export function useCancelJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: cancelTraining,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['training-jobs'] }),
  });
}

export function useRealtimeJob(jobId: string | null) {
  const qc = useQueryClient();
  const [liveMetrics, setLiveMetrics] = useState<EpochMetric[]>([]);

  useEffect(() => {
    if (!jobId) return;

    const jobSub = subscribeToJob(jobId, () => {
      qc.invalidateQueries({ queryKey: ['training-jobs'] });
    });

    const metricSub = subscribeToMetrics(jobId, (metric) => {
      setLiveMetrics((prev) => [...prev, metric]);
    });

    return () => {
      jobSub.unsubscribe();
      metricSub.unsubscribe();
      setLiveMetrics([]);
    };
  }, [jobId, qc]);

  return liveMetrics;
}
