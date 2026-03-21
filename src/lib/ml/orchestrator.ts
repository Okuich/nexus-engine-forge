import { supabase } from '@/integrations/supabase/client';
import type {
  TrainingJob,
  EpochMetric,
  StartTrainingRequest,
} from './types';

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

async function withRetry<T>(fn: () => Promise<T>, retries = MAX_RETRIES): Promise<T> {
  let lastError: Error | null = null;
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (i < retries - 1) {
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * Math.pow(2, i)));
      }
    }
  }
  throw lastError;
}

// ─── Job CRUD ───────────────────────────────────────────────────

export async function createTrainingJob(req: StartTrainingRequest): Promise<TrainingJob> {
  return withRetry(async () => {
    const { data, error } = await supabase
      .from('training_jobs')
      .insert({
        name: req.name,
        model_type: req.model_type ?? 'gat',
        dataset_id: req.dataset_id ?? null,
        config: req.config ?? {},
        epochs_total: req.config?.epochs ?? 100,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data as unknown as TrainingJob;
  });
}

export async function fetchTrainingJobs(): Promise<TrainingJob[]> {
  return withRetry(async () => {
    const { data, error } = await supabase
      .from('training_jobs')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as TrainingJob[];
  });
}

export async function fetchTrainingJob(id: string): Promise<TrainingJob> {
  return withRetry(async () => {
    const { data, error } = await supabase
      .from('training_jobs')
      .select('*')
      .eq('id', id)
      .single();
    if (error) throw new Error(error.message);
    return data as unknown as TrainingJob;
  });
}

export async function fetchJobMetrics(jobId: string): Promise<EpochMetric[]> {
  return withRetry(async () => {
    const { data, error } = await supabase
      .from('training_metrics')
      .select('*')
      .eq('job_id', jobId)
      .order('epoch', { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as EpochMetric[];
  });
}

// ─── Training Trigger ───────────────────────────────────────────

export async function startTraining(jobId: string): Promise<void> {
  return withRetry(async () => {
    const { error } = await supabase.functions.invoke('ml-train', {
      body: { action: 'start', job_id: jobId },
    });
    if (error) throw new Error(error.message);
  });
}

export async function cancelTraining(jobId: string): Promise<void> {
  return withRetry(async () => {
    const { error } = await supabase
      .from('training_jobs')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() } as any)
      .eq('id', jobId);
    if (error) throw new Error(error.message);
  });
}

// ─── Realtime Subscription ──────────────────────────────────────

export function subscribeToJob(
  jobId: string,
  onUpdate: (job: TrainingJob) => void
) {
  return supabase
    .channel(`job-${jobId}`)
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'training_jobs',
        filter: `id=eq.${jobId}`,
      },
      (payload) => onUpdate(payload.new as unknown as TrainingJob)
    )
    .subscribe();
}

export function subscribeToMetrics(
  jobId: string,
  onMetric: (metric: EpochMetric) => void
) {
  return supabase
    .channel(`metrics-${jobId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'training_metrics',
        filter: `job_id=eq.${jobId}`,
      },
      (payload) => onMetric(payload.new as unknown as EpochMetric)
    )
    .subscribe();
}
