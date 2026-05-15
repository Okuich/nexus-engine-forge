import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  downloadSimplificationResult,
  SimplificationResultError,
  type SimplificationJob,
} from '@/lib/api/simplifyJobsApi';

const baseJob: SimplificationJob = {
  id: 'job-1',
  job_type: 'lods',
  status: 'completed',
  progress: 100,
  message: 'done',
  input_triangles: 1000,
  output_triangles: 250,
  result_path: 'u/job-1.json',
  result_size_bytes: 1234,
  error_message: null,
  created_at: new Date().toISOString(),
  started_at: null,
  completed_at: new Date().toISOString(),
  downloadUrl: 'https://example.com/result.json',
};

const validLods = {
  jobType: 'lods',
  totalElapsedMs: 42,
  lods: [
    {
      level: 0,
      mesh: { positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], indices: [0, 1, 2] },
      stats: { inputTriangles: 1, outputTriangles: 1, elapsedMs: 1 },
    },
  ],
};

function mockFetch(body: unknown, init: { ok?: boolean; status?: number; raw?: string } = {}) {
  const ok = init.ok ?? true;
  const status = init.status ?? 200;
  const fetchMock = vi.fn().mockResolvedValue({
    ok,
    status,
    json: async () => {
      if (init.raw !== undefined) throw new SyntaxError('Unexpected token');
      return body;
    },
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('downloadSimplificationResult', () => {
  beforeEach(() => vi.unstubAllGlobals());
  afterEach(() => vi.unstubAllGlobals());

  it('returns the typed payload when the result matches the schema', async () => {
    mockFetch(validLods);
    const result = await downloadSimplificationResult(baseJob);
    expect(result.jobType).toBe('lods');
    if (result.jobType === 'lods') {
      expect(result.lods[0].stats.outputTriangles).toBe(1);
    }
  });

  it('throws not_ready when the job is not completed', async () => {
    await expect(
      downloadSimplificationResult({ ...baseJob, status: 'running', downloadUrl: null }),
    ).rejects.toMatchObject({
      name: 'SimplificationResultError',
      code: 'not_ready',
      jobId: 'job-1',
    });
  });

  it('throws http_error with status code on non-2xx download', async () => {
    mockFetch(null, { ok: false, status: 503 });
    await expect(downloadSimplificationResult(baseJob)).rejects.toMatchObject({
      code: 'http_error',
      httpStatus: 503,
    });
  });

  it('throws invalid_json when body cannot be parsed', async () => {
    mockFetch(undefined, { raw: 'not json' });
    await expect(downloadSimplificationResult(baseJob)).rejects.toMatchObject({
      code: 'invalid_json',
    });
  });

  it('throws schema_mismatch with Zod issues when payload is malformed', async () => {
    // Missing `lods` array entirely.
    mockFetch({ jobType: 'lods', totalElapsedMs: 1 });
    try {
      await downloadSimplificationResult(baseJob);
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(SimplificationResultError);
      const e = err as SimplificationResultError;
      expect(e.code).toBe('schema_mismatch');
      expect(e.issues?.length).toBeGreaterThan(0);
      expect(e.issues?.some((i) => i.path.includes('lods'))).toBe(true);
      expect(e.message).toMatch(/lods/);
    }
  });

  it('rejects unknown jobType values via the discriminated union', async () => {
    mockFetch({ jobType: 'something-else', payload: {} });
    await expect(downloadSimplificationResult(baseJob)).rejects.toMatchObject({
      code: 'schema_mismatch',
    });
  });
});
