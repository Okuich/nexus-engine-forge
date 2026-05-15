/**
 * Client for the async simplification job system.
 *
 * Wraps the `simplify-jobs` edge function and provides:
 *   - createJob / cancelJob / getStatus / listJobs
 *   - waitForJob with polling + progress callback
 *   - downloadResult that fetches the signed result URL and parses it
 */
import { supabase } from '@/integrations/supabase/client';

export type SimplificationJobStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type SimplificationJobType = 'lods' | 'graph' | 'inference';

export interface SimplificationJob {
  id: string;
  job_type: SimplificationJobType;
  status: SimplificationJobStatus;
  progress: number;
  message: string | null;
  input_triangles: number | null;
  output_triangles: number | null;
  result_path: string | null;
  result_size_bytes: number | null;
  error_message: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  downloadUrl?: string | null;
}

export interface CreateJobInput {
  mesh: { positions: number[]; indices?: number[] };
  jobType?: SimplificationJobType;
  params?: { levels?: number };
}

async function invoke<T>(path: string, init?: { method?: 'GET' | 'POST'; body?: unknown; query?: Record<string, string> }): Promise<T> {
  const qs = init?.query ? '?' + new URLSearchParams(init.query).toString() : '';
  const { data, error } = await supabase.functions.invoke<T>(`simplify-jobs/${path}${qs}`, {
    method: init?.method ?? 'POST',
    body: init?.body,
  });
  if (error) throw error;
  return data as T;
}

export const simplifyJobsApi = {
  create: (input: CreateJobInput) =>
    invoke<{ jobId: string; status: SimplificationJobStatus }>('create', {
      method: 'POST',
      body: input,
    }),

  status: (jobId: string) =>
    invoke<SimplificationJob>('status', { method: 'GET', query: { id: jobId } }),

  cancel: (jobId: string) =>
    invoke<{ ok: true }>('cancel', { method: 'POST', body: { jobId } }),

  list: (limit = 25) =>
    invoke<{ jobs: SimplificationJob[] }>('list', {
      method: 'GET',
      query: { limit: String(limit) },
    }).then((r) => r.jobs),
};

export interface WaitOptions {
  intervalMs?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  onProgress?: (job: SimplificationJob) => void;
}

/**
 * Poll `status` until the job reaches a terminal state.
 * Resolves with the final job (and `downloadUrl` if completed).
 */
export async function waitForSimplificationJob(
  jobId: string,
  opts: WaitOptions = {},
): Promise<SimplificationJob> {
  const interval = Math.max(500, opts.intervalMs ?? 1500);
  const deadline = Date.now() + (opts.timeoutMs ?? 5 * 60_000);

  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (opts.signal?.aborted) throw new Error('aborted');
    const job = await simplifyJobsApi.status(jobId);
    opts.onProgress?.(job);
    if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
      return job;
    }
    if (Date.now() > deadline) throw new Error('simplification job polling timed out');
    await new Promise((r) => setTimeout(r, interval));
  }
}

/** Fetch the parsed result payload for a completed job. */
export async function downloadSimplificationResult(job: SimplificationJob): Promise<unknown> {
  if (job.status !== 'completed' || !job.downloadUrl) {
    throw new Error('result not available');
  }
  const res = await fetch(job.downloadUrl);
  if (!res.ok) throw new Error(`download failed: ${res.status}`);
  return res.json();
}
