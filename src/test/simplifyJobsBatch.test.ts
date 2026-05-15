/**
 * Tests for the queue-backed batch endpoints on the simplify-jobs API.
 *
 * Mocks `supabase.functions.invoke` to validate:
 *   - createBatch posts the correct payload shape
 *   - batchStatus / cancelBatch / listBatches route correctly
 *   - waitForSimplificationBatch polls until a terminal status
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: { functions: { invoke: invokeMock } },
}));

import {
  simplifyJobsApi,
  waitForSimplificationBatch,
  type BatchStatusResult,
  type SimplificationBatch,
} from '../lib/api/simplifyJobsApi';

beforeEach(() => invokeMock.mockReset());

const tri = { positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], indices: [0, 1, 2] };

const makeBatch = (
  status: SimplificationBatch['status'],
  overrides: Partial<SimplificationBatch> = {},
): SimplificationBatch => ({
  id: 'batch-1',
  user_id: 'u1',
  name: 'set-A',
  total_jobs: 2,
  status,
  metadata: {},
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  completed_at: null,
  ...overrides,
});

describe('simplifyJobsApi.createBatch', () => {
  it('posts items + defaults + concurrency to /batch', async () => {
    invokeMock.mockResolvedValueOnce({
      data: { batchId: 'batch-1', status: 'queued', total: 2, concurrency: 2, jobIds: ['j1', 'j2'] },
      error: null,
    });
    const res = await simplifyJobsApi.createBatch({
      name: 'set-A',
      defaults: { jobType: 'lods', params: { levels: 3 } },
      concurrency: 2,
      items: [
        { label: 'cube', mesh: tri },
        { label: 'sphere', mesh: tri, jobType: 'graph' },
      ],
    });
    expect(res.batchId).toBe('batch-1');
    expect(res.jobIds).toHaveLength(2);
    const [path, opts] = invokeMock.mock.calls[0];
    expect(path).toBe('simplify-jobs/batch');
    expect(opts.method).toBe('POST');
    expect(opts.body.items).toHaveLength(2);
    expect(opts.body.defaults.jobType).toBe('lods');
    expect(opts.body.concurrency).toBe(2);
  });

  it('surfaces edge-function errors verbatim', async () => {
    invokeMock.mockResolvedValueOnce({ data: null, error: new Error('items required') });
    await expect(
      simplifyJobsApi.createBatch({ items: [{ mesh: tri }] }),
    ).rejects.toThrow(/items required/);
  });
});

describe('simplifyJobsApi.batchStatus / cancelBatch / listBatches', () => {
  it('GETs batchStatus by id', async () => {
    const snap: BatchStatusResult = {
      batch: makeBatch('running'),
      jobs: [],
      tally: { queued: 1, running: 1, completed: 0, failed: 0, cancelled: 0 },
      progress: 25,
    };
    invokeMock.mockResolvedValueOnce({ data: snap, error: null });
    const res = await simplifyJobsApi.batchStatus('batch-1');
    expect(res.progress).toBe(25);
    const [path, opts] = invokeMock.mock.calls[0];
    expect(path).toBe('simplify-jobs/batchStatus?id=batch-1');
    expect(opts.method).toBe('GET');
  });

  it('POSTs cancelBatch with the batchId', async () => {
    invokeMock.mockResolvedValueOnce({ data: { ok: true }, error: null });
    await simplifyJobsApi.cancelBatch('batch-1');
    const [path, opts] = invokeMock.mock.calls[0];
    expect(path).toBe('simplify-jobs/batchCancel');
    expect(opts.body).toEqual({ batchId: 'batch-1' });
  });

  it('GETs listBatches with limit', async () => {
    invokeMock.mockResolvedValueOnce({ data: { batches: [makeBatch('completed')] }, error: null });
    const list = await simplifyJobsApi.listBatches(10);
    expect(list).toHaveLength(1);
    expect(invokeMock.mock.calls[0][0]).toBe('simplify-jobs/batchList?limit=10');
  });
});

describe('waitForSimplificationBatch', () => {
  it('polls until a terminal status (completed/failed/cancelled/partial)', async () => {
    const running: BatchStatusResult = {
      batch: makeBatch('running'),
      jobs: [],
      tally: { queued: 0, running: 2, completed: 0, failed: 0, cancelled: 0 },
      progress: 50,
    };
    const partial: BatchStatusResult = {
      batch: makeBatch('partial', { completed_at: new Date().toISOString() }),
      jobs: [],
      tally: { queued: 0, running: 0, completed: 1, failed: 1, cancelled: 0 },
      progress: 100,
    };
    invokeMock
      .mockResolvedValueOnce({ data: running, error: null })
      .mockResolvedValueOnce({ data: running, error: null })
      .mockResolvedValueOnce({ data: partial, error: null });

    const seen: number[] = [];
    const final = await waitForSimplificationBatch('batch-1', {
      intervalMs: 1,
      onProgress: (s) => seen.push(s.progress),
    });
    expect(final.batch.status).toBe('partial');
    expect(seen).toEqual([50, 50, 100]);
  });

  it('respects AbortSignal', async () => {
    invokeMock.mockResolvedValue({
      data: {
        batch: makeBatch('running'),
        jobs: [],
        tally: { queued: 0, running: 1, completed: 0, failed: 0, cancelled: 0 },
        progress: 10,
      },
      error: null,
    });
    const ctl = new AbortController();
    ctl.abort();
    await expect(
      waitForSimplificationBatch('batch-1', { signal: ctl.signal }),
    ).rejects.toThrow(/aborted/);
  });
});
