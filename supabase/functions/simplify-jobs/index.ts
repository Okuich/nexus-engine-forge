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
) {
  const db = admin();
  const update = (patch: Record<string, unknown>) =>
    db.from('simplification_jobs').update({ ...patch }).eq('id', jobId);
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
  } catch (err) {
    await update({
      status: 'failed',
      error_message: (err as Error).message,
      completed_at: new Date().toISOString(),
    });
  }
}

// ─── HTTP handler ───────────────────────────────────────────────────────────
async function handle(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const url = new URL(req.url);
  const route = url.pathname.split('/').pop() ?? '';

  if (route === 'health') return jsonResponse({ ok: true });

  const { user } = await getUser(req);
  if (!user) return jsonResponse({ error: 'unauthorized' }, 401);

  const db = admin();

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

  return jsonResponse({ error: 'not found' }, 404);
}

Deno.serve(handle);
