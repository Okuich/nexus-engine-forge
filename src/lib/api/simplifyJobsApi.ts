/**
 * Client for the async simplification job system.
 *
 * Wraps the `simplify-jobs` edge function and provides:
 *   - createJob / cancelJob / getStatus / listJobs
 *   - waitForJob with polling + progress callback
 *   - downloadResult that fetches the signed result URL and parses it
 */
import { supabase } from '@/integrations/supabase/client';
import { z } from 'zod';

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

export interface SimplificationJobParams {
  /** LOD chain length (1–6). Used by `lods` and `inference`. */
  levels?: number;
  /** Triangle reduction per LOD level. */
  ratioPerLevel?: number;
  /** Floor for LOD output. */
  minTriangles?: number;
  /** Hard target node count for `graph` / `inference`. */
  targetNodes?: number;
  /** Or, fraction of original faces to keep. */
  targetRatio?: number;
}

export interface CreateJobInput {
  mesh: { positions: number[]; indices?: number[] };
  jobType?: SimplificationJobType;
  params?: SimplificationJobParams;
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

  /**
   * Re-run a failed or cancelled job using its original `job_type` + `params`.
   * The mesh is not stored server-side, so the caller must resupply it
   * (typically from the local CAD viewer cache).
   *
   * Returns the **new** jobId; the original row is left untouched. The new
   * job's `params.retry_of` field links back to the original.
   */
  retry: (jobId: string, mesh: { positions: number[]; indices?: number[] }) =>
    invoke<{ jobId: string; status: SimplificationJobStatus; retryOf: string }>('retry', {
      method: 'POST',
      body: { jobId, mesh },
    }),

  list: (limit = 25) =>
    invoke<{ jobs: SimplificationJob[] }>('list', {
      method: 'GET',
      query: { limit: String(limit) },
    }).then((r) => r.jobs),

  // ── Batch (queue-backed bulk) ────────────────────────────────────────────
  createBatch: (input: CreateBatchInput) =>
    invoke<CreateBatchResult>('batch', { method: 'POST', body: input }),

  batchStatus: (batchId: string) =>
    invoke<BatchStatusResult>('batchStatus', {
      method: 'GET',
      query: { id: batchId },
    }),

  cancelBatch: (batchId: string) =>
    invoke<{ ok: true }>('batchCancel', { method: 'POST', body: { batchId } }),

  listBatches: (limit = 25) =>
    invoke<{ batches: SimplificationBatch[] }>('batchList', {
      method: 'GET',
      query: { limit: String(limit) },
    }).then((r) => r.batches),
};

export interface SimplificationBatch {
  id: string;
  user_id: string;
  name: string | null;
  total_jobs: number;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'partial';
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface BatchItemInput {
  label?: string;
  mesh: { positions: number[]; indices?: number[] };
  jobType?: SimplificationJobType;
  params?: SimplificationJobParams;
}

export interface CreateBatchInput {
  name?: string;
  defaults?: { jobType?: SimplificationJobType; params?: SimplificationJobParams };
  /** Max parallel job runs (1–8). Defaults to 3 server-side. */
  concurrency?: number;
  items: BatchItemInput[];
}

export interface CreateBatchResult {
  batchId: string;
  status: 'queued';
  total: number;
  concurrency: number;
  jobIds: string[];
}

export interface BatchStatusResult {
  batch: SimplificationBatch;
  jobs: Array<
    Pick<
      SimplificationJob,
      | 'id'
      | 'job_type'
      | 'status'
      | 'progress'
      | 'message'
      | 'input_triangles'
      | 'output_triangles'
      | 'result_path'
      | 'error_message'
      | 'started_at'
      | 'completed_at'
    > & { batch_index: number; batch_label: string | null }
  >;
  tally: { queued: number; running: number; completed: number; failed: number; cancelled: number };
  progress: number;
}


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

// ─── Result-payload schemas (Zod) ──────────────────────────────────────────
//
// Every `simplify-jobs` worker writes one of these JSON shapes to storage.
// Keep these in sync with `processJob` in supabase/functions/simplify-jobs/index.ts.

const MeshArraysSchema = z.object({
  positions: z.array(z.number()),
  indices: z.array(z.number()).optional(),
  normals: z.array(z.number()).optional(),
});

const LodLevelSchema = z.object({
  level: z.number().int().nonnegative(),
  mesh: MeshArraysSchema,
  stats: z.object({
    inputTriangles: z.number().int().nonnegative(),
    outputTriangles: z.number().int().nonnegative(),
    elapsedMs: z.number().nonnegative(),
  }).passthrough(),
}).passthrough();

const GraphSchema = z.object({
  nodeCount: z.number().int().nonnegative(),
  edgeCount: z.number().int().nonnegative(),
  nodeFeatures: z.array(
    z.object({
      area: z.number(),
      avgNormal: z.tuple([z.number(), z.number(), z.number()]),
      avgCurvature: z.number(),
    }).passthrough(),
  ),
  clusters: z.array(z.array(z.number().int().nonnegative())),
}).passthrough();

export const LodsResultSchema = z.object({
  jobType: z.literal('lods'),
  lods: z.array(LodLevelSchema).min(1),
  totalElapsedMs: z.number().nonnegative(),
});
export const GraphResultSchema = z.object({
  jobType: z.literal('graph'),
  graph: GraphSchema,
});
export const InferenceResultSchema = z.object({
  jobType: z.literal('inference'),
  coarseMesh: MeshArraysSchema,
  lods: z.array(LodLevelSchema).min(1),
  graph: GraphSchema,
  /** Base64-encoded Float32Array of length `nodeCount * featureDim`. */
  features: z.string().min(1),
  featureDim: z.number().int().positive(),
  nodeToFaces: z.array(z.array(z.number().int().nonnegative())),
});

export const SimplificationResultSchema = z.discriminatedUnion('jobType', [
  LodsResultSchema,
  GraphResultSchema,
  InferenceResultSchema,
]);

export type LodsResult = z.infer<typeof LodsResultSchema>;
export type GraphResult = z.infer<typeof GraphResultSchema>;
export type InferenceResult = z.infer<typeof InferenceResultSchema>;
export type SimplificationResult = z.infer<typeof SimplificationResultSchema>;

/**
 * Thrown when a downloaded result fails validation. Carries the original
 * Zod issues so callers can surface field-level diagnostics in the UI.
 */
export class SimplificationResultError extends Error {
  readonly code:
    | 'not_ready'
    | 'http_error'
    | 'invalid_json'
    | 'schema_mismatch';
  readonly jobId: string;
  readonly httpStatus?: number;
  readonly issues?: z.ZodIssue[];

  constructor(args: {
    code: SimplificationResultError['code'];
    message: string;
    jobId: string;
    httpStatus?: number;
    issues?: z.ZodIssue[];
  }) {
    super(args.message);
    this.name = 'SimplificationResultError';
    this.code = args.code;
    this.jobId = args.jobId;
    this.httpStatus = args.httpStatus;
    this.issues = args.issues;
  }
}

/**
 * Fetch and validate the parsed result payload for a completed job.
 * Throws `SimplificationResultError` (with `code` + Zod `issues`) on any
 * failure so the caller can render typed, actionable feedback.
 */
export async function downloadSimplificationResult(
  job: SimplificationJob,
): Promise<SimplificationResult> {
  if (job.status !== 'completed' || !job.downloadUrl) {
    throw new SimplificationResultError({
      code: 'not_ready',
      jobId: job.id,
      message: `result not available (status=${job.status})`,
    });
  }
  const res = await fetch(job.downloadUrl);
  if (!res.ok) {
    throw new SimplificationResultError({
      code: 'http_error',
      jobId: job.id,
      httpStatus: res.status,
      message: `download failed: HTTP ${res.status}`,
    });
  }

  let raw: unknown;
  try {
    raw = await res.json();
  } catch (err) {
    throw new SimplificationResultError({
      code: 'invalid_json',
      jobId: job.id,
      message: `result body is not valid JSON: ${(err as Error).message}`,
    });
  }

  const parsed = SimplificationResultSchema.safeParse(raw);
  if (!parsed.success) {
    const summary = parsed.error.issues
      .slice(0, 3)
      .map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`)
      .join('; ');
    throw new SimplificationResultError({
      code: 'schema_mismatch',
      jobId: job.id,
      issues: parsed.error.issues,
      message: `result payload failed schema validation (${parsed.error.issues.length} issue${
        parsed.error.issues.length === 1 ? '' : 's'
      }): ${summary}`,
    });
  }
  return parsed.data;
}

/**
 * Poll a batch until every job reaches a terminal state.
 * Calls `onProgress` with the rolled-up tally + per-job snapshots.
 */
export async function waitForSimplificationBatch(
  batchId: string,
  opts: WaitOptions & {
    onProgress?: (snapshot: BatchStatusResult) => void;
  } = {},
): Promise<BatchStatusResult> {
  const interval = Math.max(750, opts.intervalMs ?? 2000);
  const deadline = Date.now() + (opts.timeoutMs ?? 30 * 60_000);
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (opts.signal?.aborted) throw new Error('aborted');
    const snap = await simplifyJobsApi.batchStatus(batchId);
    opts.onProgress?.(snap);
    const terminal = ['completed', 'failed', 'cancelled', 'partial'];
    if (terminal.includes(snap.batch.status)) return snap;
    if (Date.now() > deadline) throw new Error('batch polling timed out');
    await new Promise((r) => setTimeout(r, interval));
  }
}

// ─── Server-Sent Events (push, no polling) ─────────────────────────────────
//
// EventSource cannot send custom headers, so we pass the access token as a
// query parameter. The edge function accepts `?access_token=…` for SSE routes.
const FN_BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/simplify-jobs`;

async function buildSseUrl(
  route: 'stream' | 'batchStream',
  id: string,
  intervalMs?: number,
): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) throw new Error('not authenticated');
  const params = new URLSearchParams({ id, access_token: token });
  if (intervalMs) params.set('intervalMs', String(intervalMs));
  return `${FN_BASE}/${route}?${params.toString()}`;
}

export interface StreamHandlers<T> {
  onSnapshot?: (snap: T) => void;
  onProgress?: (snap: T) => void;
  onDone?: (reason: 'terminal' | 'timeout') => void;
  onError?: (err: Error) => void;
  /** Server-side polling cadence in ms (250–5000). Default 750. */
  intervalMs?: number;
  signal?: AbortSignal;
}

/**
 * Subscribe to live job updates via SSE (push). Resolves with the final
 * snapshot when the job reaches a terminal state. Rejects on error/abort.
 */
export function streamSimplificationJob(
  jobId: string,
  handlers: StreamHandlers<SimplificationJob> = {},
): Promise<SimplificationJob> {
  return openStream<SimplificationJob>('stream', jobId, handlers);
}

/** Subscribe to live batch updates via SSE. */
export function streamSimplificationBatch(
  batchId: string,
  handlers: StreamHandlers<BatchStatusResult> = {},
): Promise<BatchStatusResult> {
  return openStream<BatchStatusResult>('batchStream', batchId, handlers);
}

function openStream<T>(
  route: 'stream' | 'batchStream',
  id: string,
  handlers: StreamHandlers<T>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    let es: EventSource | null = null;
    let last: T | undefined;

    const cleanup = () => {
      es?.close();
      es = null;
      handlers.signal?.removeEventListener('abort', onAbort);
    };
    const onAbort = () => {
      cleanup();
      reject(new Error('aborted'));
    };
    if (handlers.signal?.aborted) return reject(new Error('aborted'));
    handlers.signal?.addEventListener('abort', onAbort);

    buildSseUrl(route, id, handlers.intervalMs)
      .then((url) => {
        es = new EventSource(url);

        es.addEventListener('snapshot', (e) => {
          last = JSON.parse((e as MessageEvent).data) as T;
          handlers.onSnapshot?.(last);
        });
        es.addEventListener('progress', (e) => {
          last = JSON.parse((e as MessageEvent).data) as T;
          handlers.onProgress?.(last);
        });
        es.addEventListener('done', (e) => {
          const { reason } = JSON.parse((e as MessageEvent).data) as {
            reason: 'terminal' | 'timeout';
          };
          handlers.onDone?.(reason);
          cleanup();
          if (last) resolve(last);
          else reject(new Error('stream closed without snapshot'));
        });
        // Server-emitted errors arrive as `event: error` with a JSON payload.
        es.addEventListener('error', (e) => {
          const data = (e as MessageEvent).data;
          if (data) {
            try {
              const { error } = JSON.parse(data) as { error: string };
              const err = new Error(error);
              handlers.onError?.(err);
              cleanup();
              reject(err);
              return;
            } catch {
              /* not a server payload — fall through */
            }
          }
          // Transport-level error (network blip). EventSource auto-reconnects;
          // we only fail the promise once the connection is permanently CLOSED.
          if (es?.readyState === EventSource.CLOSED) {
            const err = new Error('stream connection closed');
            handlers.onError?.(err);
            cleanup();
            reject(err);
          }
        });
      })
      .catch((err) => {
        cleanup();
        reject(err);
      });
  });
}
