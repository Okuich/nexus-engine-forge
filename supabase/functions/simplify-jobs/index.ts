/**
 * Async Simplification Job Runner.
 *
 * Routes (POST unless noted):
 *   POST /simplify-jobs/create        { mesh, jobType?, params? } → { jobId }
 *   GET  /simplify-jobs/status?id=…   → full job row + downloadUrl when ready
 *   POST /simplify-jobs/cancel        { jobId }
 *   GET  /simplify-jobs/list?limit=…  → recent jobs for the caller
 *   GET  /simplify-jobs/health        → { ok }
 *
 * The actual simplification runs in a background task via
 * `EdgeRuntime.waitUntil`, so the HTTP response returns immediately
 * and the client polls `/status` for progress (0–100). Result payloads
 * (LOD chain, coarsened graph, or inference bundle) are written to the
 * private `simplification-results` storage bucket under
 * `<userId>/<jobId>.json` and surfaced via short-lived signed URLs.
 */
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { z } from 'npm:zod@3.23.8';
import { buildLODs, coarsenGraph, meshToArrays } from '../simplify-api/core.ts';
import {
  Span,
  log,
  startSpanFromRequest,
  traceResponseHeaders,
  newTraceId,
  newSpanId,
} from './tracing.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const BUCKET = 'simplification-results';
const MAX_INPUT_TRIANGLES = 2_000_000; // async path: 10× the sync /lods cap

// ─── EdgeRuntime shim (typings) ─────────────────────────────────────────────
// deno-lint-ignore no-explicit-any
const EdgeRuntime = (globalThis as any).EdgeRuntime as
  | { waitUntil: (p: Promise<unknown>) => void }
  | undefined;

// ─── Validation ─────────────────────────────────────────────────────────────
const MeshSchema = z.object({
  positions: z.array(z.number()).min(9),
  indices: z.array(z.number()).optional(),
});
const ParamsSchema = z
  .object({
    levels: z.number().int().min(1).max(8).optional(),
    ratioPerLevel: z.number().min(0.05).max(0.95).optional(),
    minTriangles: z.number().int().min(4).optional(),
    targetNodes: z.number().int().min(1).optional(),
    targetRatio: z.number().min(0.01).max(0.95).optional(),
  })
  .partial()
  .default({});
const CreateBody = z.object({
  mesh: MeshSchema,
  jobType: z.enum(['lods', 'graph', 'inference']).default('lods'),
  params: ParamsSchema,
});

// Batch: up to 64 meshes per request, optional shared defaults.
const BatchItemSchema = z.object({
  label: z.string().max(120).optional(),
  mesh: MeshSchema,
  jobType: z.enum(['lods', 'graph', 'inference']).optional(),
  params: ParamsSchema.optional(),
});
const BatchBody = z.object({
  name: z.string().max(120).optional(),
  defaults: z
    .object({
      jobType: z.enum(['lods', 'graph', 'inference']).optional(),
      params: ParamsSchema.optional(),
    })
    .optional(),
  /** Max parallel job runs while draining the batch (1–8). */
  concurrency: z.number().int().min(1).max(8).optional(),
  items: z.array(BatchItemSchema).min(1).max(64),
});

// ─── Helpers ────────────────────────────────────────────────────────────────
function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// Legacy JWT-only resolver, kept for reference; auth flows through ./auth.ts.
// deno-lint-ignore no-unused-vars
async function getUser(req: Request): Promise<{
  user: { id: string } | null;
  client: SupabaseClient;
}> {
  const auth = req.headers.get('Authorization') ?? '';
  const client = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: auth } },
  });
  const { data } = await client.auth.getUser();
  return { user: data.user ? { id: data.user.id } : null, client };
}

function admin(): SupabaseClient {
  return createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

type RawMesh = z.infer<typeof MeshSchema>;
type Params = z.infer<typeof ParamsSchema>;

function b64FromBuffer(buf: ArrayBufferView): string {
  const bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, Math.min(i + CHUNK, bytes.length)));
  }
  return btoa(bin);
}

// ─── Background processing ──────────────────────────────────────────────────
async function processJob(
  jobId: string,
  userId: string,
  mesh: RawMesh,
  jobType: 'lods' | 'graph' | 'inference',
  params: Params,
  parentSpan?: Span,
) {
  const span = parentSpan
    ? parentSpan.child(`processJob.${jobType}`)
    : new Span(`processJob.${jobType}`, {
        traceId: newTraceId(),
        spanId: newSpanId(),
        sampled: true,
      });
  span.setAttrs({ 'job.id': jobId, 'job.type': jobType, 'user.id': userId });

  const db = admin();
  const update = (patch: Record<string, unknown>) =>
    db.from('simplification_jobs')
      .update({ ...patch })
      .eq('id', jobId);
  const cancelled = async () => {
    const { data: row } = await db
      .from('simplification_jobs').select('status').eq('id', jobId).single();
    return row?.status === 'cancelled';
  };

  try {
    await update({
      status: 'running',
      started_at: new Date().toISOString(),
      progress: 5,
      message: 'preparing',
    });

    const tris = mesh.indices
      ? mesh.indices.length / 3
      : (mesh.positions.length / 9) | 0;
    if (tris > MAX_INPUT_TRIANGLES) {
      throw new Error(`triangle count ${tris} exceeds ${MAX_INPUT_TRIANGLES}`);
    }

    let payload: unknown;
    let outputT = 0;

    if (jobType === 'lods') {
      const levels = Math.max(1, Math.min(6, params.levels ?? 4));
      await update({ progress: 15, message: `building ${levels} LODs` });
      if (await cancelled()) return;

      const result = buildLODs(mesh, {
        levels,
        ratioPerLevel: params.ratioPerLevel,
        minTriangles: params.minTriangles,
      });
      outputT = result.lods[result.lods.length - 1]?.stats.outputTriangles ?? 0;
      payload = { jobType, lods: result.lods, totalElapsedMs: result.totalElapsedMs };
      await update({ progress: 85, message: `produced ${result.lods.length} LODs` });
    } else if (jobType === 'graph') {
      await update({ progress: 20, message: 'coarsening face graph' });
      if (await cancelled()) return;
      const m = meshToArrays(mesh);
      const graph = coarsenGraph(m, params.targetNodes, params.targetRatio);
      outputT = graph.nodeCount;
      payload = { jobType, graph };
      await update({ progress: 85, message: `${graph.nodeCount} nodes / ${graph.edgeCount} edges` });
    } else {
      // inference: LODs + graph + flat feature matrix
      await update({ progress: 15, message: 'building LODs' });
      if (await cancelled()) return;
      const lod = buildLODs(mesh, {
        levels: Math.max(1, Math.min(6, params.levels ?? 3)),
        ratioPerLevel: params.ratioPerLevel,
        minTriangles: params.minTriangles,
      });
      await update({ progress: 50, message: 'coarsening graph' });
      if (await cancelled()) return;
      const m = meshToArrays(mesh);
      const graph = coarsenGraph(m, params.targetNodes, params.targetRatio);

      const featureDim = 7;
      const features = new Float32Array(graph.nodeCount * featureDim);
      for (let i = 0; i < graph.nodeCount; i++) {
        const nf = graph.nodeFeatures[i];
        const off = i * featureDim;
        features[off] = nf.area;
        features[off + 1] = nf.avgNormal[0];
        features[off + 2] = nf.avgNormal[1];
        features[off + 3] = nf.avgNormal[2];
        features[off + 4] = nf.avgCurvature;
        features[off + 5] = graph.clusters[i].length;
        features[off + 6] = lod.lods.length - 1;
      }

      outputT = graph.nodeCount;
      payload = {
        jobType,
        coarseMesh: lod.lods[lod.lods.length - 1].mesh,
        lods: lod.lods,
        graph,
        features: b64FromBuffer(features),
        featureDim,
        nodeToFaces: graph.clusters,
      };
      await update({ progress: 85, message: 'serializing inference bundle' });
    }

    if (await cancelled()) return;

    // Upload result to private storage
    const path = `${userId}/${jobId}.json`;
    const serialized = JSON.stringify(payload);
    const { error: upErr } = await db.storage
      .from(BUCKET)
      .upload(path, new Blob([serialized], { type: 'application/json' }), {
        upsert: true,
        contentType: 'application/json',
      });
    if (upErr) throw upErr;

    await update({
      status: 'completed',
      progress: 100,
      message: 'done',
      input_triangles: tris,
      output_triangles: outputT,
      result_path: path,
      result_size_bytes: serialized.length,
      completed_at: new Date().toISOString(),
    });
    span.event('job.completed', { input_triangles: tris, output_triangles: outputT });
    span.setAttrs({ 'job.input_triangles': tris, 'job.output_triangles': outputT });
  } catch (err) {
    const message = (err as Error).message;
    span.event('job.failed', { error: message }, 'error');
    span.setStatus('error', message);
    await update({
      status: 'failed',
      error_message: message,
      completed_at: new Date().toISOString(),
    });
  }
}

// ─── HTTP handler ───────────────────────────────────────────────────────────
import {
  resolvePrincipal,
  rateLimit,
  rateLimitHeaders,
  ROUTE_LIMITS,
  mintApiKey,
  type Scope,
} from './auth.ts';

function unauth(msg: string, status = 401) {
  return new Response(JSON.stringify({ error: msg }), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
      'WWW-Authenticate': 'Bearer realm="simplify-jobs", ApiKey realm="simplify-jobs"',
    },
  });
}

async function handle(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const url = new URL(req.url);
  const route = url.pathname.split('/').pop() ?? '';

  if (route === 'health') return jsonResponse({ ok: true });

  const principal = await resolvePrincipal(req);
  if (!principal) return unauth('unauthorized');

  // Per-route rate limit + scope check.
  const cfg = ROUTE_LIMITS[route];
  if (cfg) {
    if (cfg.scope && !principal.scopes.includes(cfg.scope as Scope)) {
      return unauth(`missing scope: ${cfg.scope}`, 403);
    }
    const rl = rateLimit(principal, route, cfg);
    if (!rl.allowed) {
      return new Response(JSON.stringify({ error: 'rate limit exceeded' }), {
        status: 429,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
          ...rateLimitHeaders(rl, cfg),
        },
      });
    }
    // Stash for later response decoration via closure.
    (req as unknown as { _rl: ReturnType<typeof rateLimitHeaders> })._rl =
      rateLimitHeaders(rl, cfg);
  }

  // Shadow legacy `user` reference and use a single client (RLS-aware for JWT,
  // service-role for API keys; both code paths still scope by principal.userId).
  const user = { id: principal.userId };
  const db = principal.via === 'api_key' ? principal.client : admin();


  // ── create ────────────────────────────────────────────────────────────────
  if (route === 'create' && req.method === 'POST') {
    const parsed = CreateBody.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return jsonResponse({ error: parsed.error.flatten() }, 400);

    const tris = parsed.data.mesh.indices
      ? parsed.data.mesh.indices.length / 3
      : (parsed.data.mesh.positions.length / 9) | 0;
    if (tris > MAX_INPUT_TRIANGLES) {
      return jsonResponse({ error: `triangles exceed ${MAX_INPUT_TRIANGLES}` }, 413);
    }

    const { data, error } = await db
      .from('simplification_jobs')
      .insert({
        user_id: user.id,
        job_type: parsed.data.jobType,
        status: 'queued',
        progress: 0,
        message: 'queued',
        params: parsed.data.params,
        input_triangles: tris,
      })
      .select('id')
      .single();
    if (error) return jsonResponse({ error: error.message }, 500);

    const work = processJob(
      data.id,
      user.id,
      parsed.data.mesh,
      parsed.data.jobType,
      parsed.data.params,
    );
    if (EdgeRuntime?.waitUntil) EdgeRuntime.waitUntil(work);
    else void work;

    return jsonResponse({ jobId: data.id, status: 'queued' }, 202);
  }

  // ── status ────────────────────────────────────────────────────────────────
  if (route === 'status' && req.method === 'GET') {
    const id = url.searchParams.get('id');
    if (!id) return jsonResponse({ error: 'id required' }, 400);
    const { data, error } = await db
      .from('simplification_jobs')
      .select('*')
      .eq('id', id)
      .eq('user_id', user.id)
      .maybeSingle();
    if (error) return jsonResponse({ error: error.message }, 500);
    if (!data) return jsonResponse({ error: 'not found' }, 404);

    let downloadUrl: string | null = null;
    if (data.status === 'completed' && data.result_path) {
      const { data: signed } = await db.storage
        .from(BUCKET)
        .createSignedUrl(data.result_path, 60 * 10);
      downloadUrl = signed?.signedUrl ?? null;
    }
    return jsonResponse({ ...data, downloadUrl });
  }

  // ── cancel ────────────────────────────────────────────────────────────────
  if (route === 'cancel' && req.method === 'POST') {
    const body = await req.json().catch(() => ({})) as { jobId?: string };
    if (!body.jobId) return jsonResponse({ error: 'jobId required' }, 400);
    const { error } = await db
      .from('simplification_jobs')
      .update({
        status: 'cancelled',
        message: 'cancelled by user',
        completed_at: new Date().toISOString(),
      })
      .eq('id', body.jobId)
      .eq('user_id', user.id)
      .in('status', ['queued', 'running']);
    if (error) return jsonResponse({ error: error.message }, 500);
    return jsonResponse({ ok: true });
  }

  // ── list ──────────────────────────────────────────────────────────────────
  if (route === 'list' && req.method === 'GET') {
    const limit = Math.min(100, Number(url.searchParams.get('limit') ?? 25));
    const { data, error } = await db
      .from('simplification_jobs')
      .select('id,job_type,status,progress,message,input_triangles,output_triangles,created_at,completed_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) return jsonResponse({ error: error.message }, 500);
    return jsonResponse({ jobs: data });
  }

  // ── batch: queue many meshes under one parent batch ──────────────────────
  if (route === 'batch' && req.method === 'POST') {
    const parsed = BatchBody.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return jsonResponse({ error: parsed.error.flatten() }, 400);

    const defaults = parsed.data.defaults ?? {};
    const concurrency = parsed.data.concurrency ?? 3;

    // Validate triangle ceilings up-front so we never half-enqueue.
    const prepared = parsed.data.items.map((item, idx) => {
      const mesh = item.mesh;
      const tris = mesh.indices ? mesh.indices.length / 3 : (mesh.positions.length / 9) | 0;
      if (tris > MAX_INPUT_TRIANGLES) {
        throw new Error(`item ${idx} (${item.label ?? 'unnamed'}) has ${tris} triangles > ${MAX_INPUT_TRIANGLES}`);
      }
      return {
        idx,
        label: item.label ?? null,
        mesh,
        jobType: item.jobType ?? defaults.jobType ?? 'lods',
        params: item.params ?? defaults.params ?? {},
        tris,
      };
    });

    const { data: batch, error: batchErr } = await db
      .from('simplification_batches')
      .insert({
        user_id: user.id,
        name: parsed.data.name ?? null,
        total_jobs: prepared.length,
        status: 'queued',
        metadata: { concurrency, defaults },
      })
      .select('id')
      .single();
    if (batchErr) return jsonResponse({ error: batchErr.message }, 500);

    const rows = prepared.map((p) => ({
      user_id: user.id,
      job_type: p.jobType,
      status: 'queued',
      progress: 0,
      message: 'queued (batch)',
      params: p.params,
      input_triangles: p.tris,
      batch_id: batch.id,
      batch_index: p.idx,
      batch_label: p.label,
    }));
    const { data: jobRows, error: jobsErr } = await db
      .from('simplification_jobs')
      .insert(rows)
      .select('id,batch_index');
    if (jobsErr) return jsonResponse({ error: jobsErr.message }, 500);

    // Drain the queue with bounded concurrency in the background.
    const indexToId = new Map(jobRows.map((r) => [r.batch_index as number, r.id as string]));
    const drain = async () => {
      let nextIdx = 0;
      const workers: Promise<void>[] = [];
      const runOne = async () => {
        while (true) {
          const myIdx = nextIdx++;
          if (myIdx >= prepared.length) return;
          const p = prepared[myIdx];
          const jobId = indexToId.get(p.idx)!;
          try {
            await processJob(jobId, user.id, p.mesh, p.jobType, p.params);
          } catch (_) {
            // processJob already records failure; keep draining.
          }
        }
      };
      for (let i = 0; i < Math.min(concurrency, prepared.length); i++) workers.push(runOne());
      await Promise.all(workers);

      // Roll up batch status.
      const { data: counts } = await admin()
        .from('simplification_jobs')
        .select('status', { count: 'exact', head: false })
        .eq('batch_id', batch.id);
      const tally = { completed: 0, failed: 0, cancelled: 0, other: 0 };
      for (const r of counts ?? []) {
        if (r.status === 'completed') tally.completed++;
        else if (r.status === 'failed') tally.failed++;
        else if (r.status === 'cancelled') tally.cancelled++;
        else tally.other++;
      }
      const finalStatus =
        tally.other > 0
          ? 'running'
          : tally.failed === 0 && tally.cancelled === 0
            ? 'completed'
            : tally.completed === 0
              ? 'failed'
              : 'partial';
      await admin()
        .from('simplification_batches')
        .update({
          status: finalStatus,
          completed_at: tally.other === 0 ? new Date().toISOString() : null,
        })
        .eq('id', batch.id);
    };

    if (EdgeRuntime?.waitUntil) EdgeRuntime.waitUntil(drain());
    else void drain();

    return jsonResponse(
      {
        batchId: batch.id,
        status: 'queued',
        total: prepared.length,
        concurrency,
        jobIds: jobRows.map((r) => r.id),
      },
      202,
    );
  }

  // ── batch status ─────────────────────────────────────────────────────────
  if (route === 'batchStatus' && req.method === 'GET') {
    const id = url.searchParams.get('id');
    if (!id) return jsonResponse({ error: 'id required' }, 400);
    const { data: batch, error: be } = await db
      .from('simplification_batches')
      .select('*')
      .eq('id', id)
      .eq('user_id', user.id)
      .maybeSingle();
    if (be) return jsonResponse({ error: be.message }, 500);
    if (!batch) return jsonResponse({ error: 'not found' }, 404);

    const { data: jobs, error: je } = await db
      .from('simplification_jobs')
      .select('id,job_type,status,progress,message,batch_index,batch_label,input_triangles,output_triangles,result_path,error_message,started_at,completed_at')
      .eq('batch_id', id)
      .eq('user_id', user.id)
      .order('batch_index', { ascending: true });
    if (je) return jsonResponse({ error: je.message }, 500);

    const tally = { queued: 0, running: 0, completed: 0, failed: 0, cancelled: 0 };
    let progressSum = 0;
    for (const j of jobs ?? []) {
      tally[j.status as keyof typeof tally] = (tally[j.status as keyof typeof tally] ?? 0) + 1;
      progressSum += j.progress ?? 0;
    }
    const progress = jobs && jobs.length > 0 ? Math.round(progressSum / jobs.length) : 0;
    return jsonResponse({ batch, jobs, tally, progress });
  }

  // ── batch cancel: cancels all non-terminal jobs in batch ─────────────────
  if (route === 'batchCancel' && req.method === 'POST') {
    const body = (await req.json().catch(() => ({}))) as { batchId?: string };
    if (!body.batchId) return jsonResponse({ error: 'batchId required' }, 400);
    const { error } = await db
      .from('simplification_jobs')
      .update({
        status: 'cancelled',
        message: 'cancelled (batch)',
        completed_at: new Date().toISOString(),
      })
      .eq('batch_id', body.batchId)
      .eq('user_id', user.id)
      .in('status', ['queued', 'running']);
    if (error) return jsonResponse({ error: error.message }, 500);
    await db
      .from('simplification_batches')
      .update({ status: 'cancelled', completed_at: new Date().toISOString() })
      .eq('id', body.batchId)
      .eq('user_id', user.id);
    return jsonResponse({ ok: true });
  }

  // ── batch list ───────────────────────────────────────────────────────────
  if (route === 'batchList' && req.method === 'GET') {
    const limit = Math.min(100, Number(url.searchParams.get('limit') ?? 25));
    const { data, error } = await db
      .from('simplification_batches')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) return jsonResponse({ error: error.message }, 500);
    return jsonResponse({ batches: data });
  }

  // ── API key management (JWT only — never expose to API-key callers) ─────
  if (route.startsWith('keys')) {
    if (principal.via !== 'jwt') return unauth('api keys cannot manage keys', 403);
    const adminDb = admin();

    if (route === 'keys' && req.method === 'GET') {
      const { data, error } = await adminDb
        .from('simplify_api_keys')
        .select('id,name,prefix,scopes,last_used_at,expires_at,revoked_at,created_at')
        .eq('user_id', principal.userId)
        .order('created_at', { ascending: false });
      if (error) return jsonResponse({ error: error.message }, 500);
      return jsonResponse({ keys: data });
    }

    if (route === 'keys' && req.method === 'POST') {
      const body = (await req.json().catch(() => ({}))) as {
        name?: string;
        scopes?: string[];
        expiresInDays?: number;
      };
      if (!body.name || body.name.length > 80) {
        return jsonResponse({ error: 'name required (≤80 chars)' }, 400);
      }
      const allowed: Scope[] = ['jobs:read', 'jobs:write'];
      const scopes = (body.scopes ?? ['jobs:read', 'jobs:write']).filter(
        (s): s is Scope => allowed.includes(s as Scope),
      );
      if (scopes.length === 0) return jsonResponse({ error: 'at least one scope required' }, 400);

      const minted = await mintApiKey();
      const expiresAt = body.expiresInDays
        ? new Date(Date.now() + body.expiresInDays * 86_400_000).toISOString()
        : null;
      const { data, error } = await adminDb
        .from('simplify_api_keys')
        .insert({
          user_id: principal.userId,
          name: body.name,
          prefix: minted.prefix,
          key_hash: minted.hash,
          scopes,
          expires_at: expiresAt,
        })
        .select('id,name,prefix,scopes,expires_at,created_at')
        .single();
      if (error) return jsonResponse({ error: error.message }, error.code === '23505' ? 409 : 500);
      // The raw key is returned exactly once.
      return jsonResponse({ ...data, key: minted.raw }, 201);
    }

    if (route === 'keysRevoke' && req.method === 'POST') {
      const body = (await req.json().catch(() => ({}))) as { id?: string };
      if (!body.id) return jsonResponse({ error: 'id required' }, 400);
      const { error } = await adminDb
        .from('simplify_api_keys')
        .update({ revoked_at: new Date().toISOString() })
        .eq('id', body.id)
        .eq('user_id', principal.userId);
      if (error) return jsonResponse({ error: error.message }, 500);
      return jsonResponse({ ok: true });
    }
  }

  return jsonResponse({ error: 'not found' }, 404);
}

// Wrap handle() to decorate successful responses with rate-limit headers.
async function handleWithHeaders(req: Request): Promise<Response> {
  const res = await handle(req);
  const rl = (req as unknown as { _rl?: Record<string, string> })._rl;
  if (!rl) return res;
  const merged = new Headers(res.headers);
  for (const [k, v] of Object.entries(rl)) merged.set(k, v);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: merged });
}

Deno.serve(handleWithHeaders);
