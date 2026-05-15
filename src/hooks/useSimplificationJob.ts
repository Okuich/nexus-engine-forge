import { useCallback, useEffect, useRef, useState } from 'react';
import {
  simplifyJobsApi,
  waitForSimplificationJob,
  downloadSimplificationResult,
  type SimplificationJob,
  type CreateJobInput,
} from '@/lib/api/simplifyJobsApi';

/**
 * React hook for the async simplification job pipeline.
 *
 * Tracks the current job's lifecycle, polls progress, and exposes
 * helpers for cancellation + result download.
 */
export function useSimplificationJob() {
  const [job, setJob] = useState<SimplificationJob | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const submit = useCallback(async (input: CreateJobInput) => {
    setError(null);
    setLoading(true);
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const { jobId } = await simplifyJobsApi.create(input);
      const initial = await simplifyJobsApi.status(jobId);
      setJob(initial);
      const final = await waitForSimplificationJob(jobId, {
        signal: ctrl.signal,
        onProgress: setJob,
      });
      setJob(final);
      return final;
    } catch (e) {
      const msg = (e as Error).message;
      if (msg !== 'aborted') setError(msg);
      throw e;
    } finally {
      setLoading(false);
    }
  }, []);

  const cancel = useCallback(async () => {
    if (!job) return;
    await simplifyJobsApi.cancel(job.id);
    abortRef.current?.abort();
    setJob({ ...job, status: 'cancelled', message: 'cancelled by user' });
  }, [job]);

  const download = useCallback(async () => {
    if (!job) throw new Error('no job');
    return downloadSimplificationResult(job);
  }, [job]);

  return { job, loading, error, submit, cancel, download };
}

/** List recent jobs for the current user. */
export function useSimplificationJobList(limit = 25) {
  const [jobs, setJobs] = useState<SimplificationJob[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setJobs(await simplifyJobsApi.list(limit));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [limit]);

  useEffect(() => { void refresh(); }, [refresh]);

  return { jobs, loading, error, refresh };
}
