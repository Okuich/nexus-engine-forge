/**
 * Tests for the async simplification job client wrapper.
 *
 * Mocks `supabase.functions.invoke` to validate:
 *   - create/status/cancel/list payload shapes
 *   - waitForSimplificationJob terminal-state polling and cancellation
 *   - downloadSimplificationResult fetches and parses the signed URL
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: { functions: { invoke: invokeMock } },
}));

import {
  simplifyJobsApi,
  waitForSimplificationJob,
  downloadSimplificationResult,
  type SimplificationJob,
} from '../lib/api/simplifyJobsApi';

const baseJob: SimplificationJob = {
  id: 'job-1',
  job_type: 'lods',
  status: 'queued',
  progress: 0,
  message: 'queued',
  input_triangles: 250_000,
  output_triangles: null,
  result_path: null,
  result_size_bytes: null,
  error_message: null,
  created_at: new Date().toISOString(),
  started_at: null,
  completed_at: null,
};

beforeEach(() => {
  invokeMock.mockReset();
});

describe('simplifyJobsApi.create', () => {
  it('routes to /create with mesh + jobType + params', async () => {
    invokeMock.mockResolvedValueOnce({ data: { jobId: 'job-1', status: 'queued' }, error: null });
    const res = await simplifyJobsApi.create({
      mesh: { positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], indices: [0, 1, 2] },
      jobType: 'inference',
      params: { levels: 3, targetRatio: 0.25 },
    });
    expect(res.jobId).toBe('job-1');
    const [path, opts] = invokeMock.mock.calls[0];
    expect(path).toBe('simplify-jobs/create');
    expect(opts.method).toBe('POST');
    expect(opts.body.jobType).toBe('inference');
    expect(opts.body.params.targetRatio).toBe(0.25);
  });

  it('throws on edge-function error', async () => {
    invokeMock.mockResolvedValueOnce({ data: null, error: new Error('boom') });
    await expect(
      simplifyJobsApi.create({ mesh: { positions: [0, 0, 0, 1, 0, 0, 0, 1, 0] } }),
    ).rejects.toThrow('boom');
  });
});

describe('simplifyJobsApi.status / cancel / list', () => {
  it('status calls GET with id query param', async () => {
    invokeMock.mockResolvedValueOnce({ data: baseJob, error: null });
    await simplifyJobsApi.status('job-1');
    const [path, opts] = invokeMock.mock.calls[0];
    expect(path).toBe('simplify-jobs/status?id=job-1');
    expect(opts.method).toBe('GET');
  });

  it('cancel posts the jobId', async () => {
    invokeMock.mockResolvedValueOnce({ data: { ok: true }, error: null });
    await simplifyJobsApi.cancel('job-1');
    const [, opts] = invokeMock.mock.calls[0];
    expect(opts.body).toEqual({ jobId: 'job-1' });
  });

  it('list returns the jobs array', async () => {
    invokeMock.mockResolvedValueOnce({ data: { jobs: [baseJob] }, error: null });
    const jobs = await simplifyJobsApi.list(10);
    expect(jobs).toHaveLength(1);
    const [path] = invokeMock.mock.calls[0];
    expect(path).toBe('simplify-jobs/list?limit=10');
  });
});

describe('waitForSimplificationJob', () => {
  it('polls until completed and emits progress', async () => {
    invokeMock
      .mockResolvedValueOnce({ data: { ...baseJob, status: 'running', progress: 30 }, error: null })
      .mockResolvedValueOnce({ data: { ...baseJob, status: 'running', progress: 70 }, error: null })
      .mockResolvedValueOnce({
        data: {
          ...baseJob,
          status: 'completed',
          progress: 100,
          result_path: 'u/job-1.json',
          downloadUrl: 'https://example.test/signed',
        },
        error: null,
      });

    const seen: number[] = [];
    const final = await waitForSimplificationJob('job-1', {
      intervalMs: 500,
      onProgress: (j) => seen.push(j.progress),
    });
    expect(final.status).toBe('completed');
    expect(final.downloadUrl).toBe('https://example.test/signed');
    expect(seen).toEqual([30, 70, 100]);
    expect(invokeMock).toHaveBeenCalledTimes(3);
  });

  it('returns immediately on terminal failed status', async () => {
    invokeMock.mockResolvedValueOnce({
      data: { ...baseJob, status: 'failed', error_message: 'oom' },
      error: null,
    });
    const j = await waitForSimplificationJob('job-1', { intervalMs: 500 });
    expect(j.status).toBe('failed');
    expect(j.error_message).toBe('oom');
  });

  it('honours abort signal between polls', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      waitForSimplificationJob('job-1', { intervalMs: 500, signal: controller.signal }),
    ).rejects.toThrow('aborted');
  });
});

describe('downloadSimplificationResult', () => {
  it('fetches the signed URL and parses JSON', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ jobType: 'lods', lods: [] }), { status: 200 }),
    );
    const out = await downloadSimplificationResult({
      ...baseJob,
      status: 'completed',
      downloadUrl: 'https://example.test/signed',
    });
    expect(out).toEqual({ jobType: 'lods', lods: [] });
    expect(fetchSpy).toHaveBeenCalledWith('https://example.test/signed');
    fetchSpy.mockRestore();
  });

  it('throws when result not yet ready', async () => {
    await expect(
      downloadSimplificationResult({ ...baseJob, status: 'running', downloadUrl: null }),
    ).rejects.toThrow('result not available');
  });
});
