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
 * and the client polls `/status` for progress (0–100). Result meshes
 * are written to the private `simplification-results` storage bucket
 * under `<userId>/<jobId>.json` and surfaced via short-lived signed URLs.
 */
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { z } from 'npm:zod@3.23.8';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const BUCKET = 'simplification-results';
const MAX_INPUT_TRIANGLES = 1_000_000;

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
const CreateBody = z.object({
  mesh: MeshSchema,
  jobType: z.enum(['lods', 'graph', 'inference']).default('lods'),
  params: z
    .object({ levels: z.number().int().min(1).max(8).optional() })
    .partial()
    .default({}),
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
} > {
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

// ─── Inline cluster simplifier (no bundle deps) ─────────────────────────────
type RawMesh = z.infer<typeof MeshSchema>;

function clusterSimplify(mesh: RawMesh, gridResolution: number) {
  const positions = new Float32Array(mesh.positions);
  const indices = mesh.indices ? new Uint32Array(mesh.indices) : new Uint32Array(0);
  const inputVerts = positions.length / 3;

  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i], y = positions[i + 1], z = positions[i + 2];
    if (x < minX) minX = x; if (y < minY) minY = y; if (z < minZ) minZ = z;
    if (x > maxX) maxX = x; if (y > maxY) maxY = y; if (z > maxZ) maxZ = z;
  }
  const size = Math.max(maxX - minX, maxY - minY, maxZ - minZ) || 1;
  const cell = size / Math.max(2, gridResolution);

  const map = new Map<string, { idx: number; sx: number; sy: number; sz: number; n: number }>();
  const remap = new Uint32Array(inputVerts);
  for (let v = 0; v < inputVerts; v++) {
    const x = positions[v * 3], y = positions[v * 3 + 1], z = positions[v * 3 + 2];
    const key = `${Math.floor((x - minX) / cell)}|${Math.floor((y - minY) / cell)}|${Math.floor((z - minZ) / cell)}`;
    const e = map.get(key);
    if (e) { e.sx += x; e.sy += y; e.sz += z; e.n++; remap[v] = e.idx; }
    else { const idx = map.size; map.set(key, { idx, sx: x, sy: y, sz: z, n: 1 }); remap[v] = idx; }
  }
  const outVerts = new Float32Array(map.size * 3);
  for (const e of map.values()) {
    outVerts[e.idx * 3] = e.sx / e.n;
    outVerts[e.idx * 3 + 1] = e.sy / e.n;
    outVerts[e.idx * 3 + 2] = e.sz / e.n;
  }
  const outIdx: number[] = [];
  for (let t = 0; t < indices.length; t += 3) {
    const a = remap[indices[t]], b = remap[indices[t + 1]], c = remap[indices[t + 2]];
    if (a !== b && b !== c && a !== c) outIdx.push(a, b, c);
  }
  return {
    positions: Array.from(outVerts),
    indices: outIdx,
    inputTriangles: indices.length / 3,
    outputTriangles: outIdx.length / 3,
    inputVertices: inputVerts,
    outputVertices: outVerts.length / 3,
  };
}

// ─── Background processing ──────────────────────────────────────────────────
async function processJob(jobId: string, userId: string, mesh: RawMesh, jobType: string, params: { levels?: number }) {
  const db = admin();
  const update = (patch: Record<string, unknown>) =>
    db.from('simplification_jobs').update({ ...patch }).eq('id', jobId);

  try {
    await update({ status: 'running', started_at: new Date().toISOString(), progress: 5, message: 'preparing' });

    const tris = (mesh.indices?.length ?? 0) / 3;
    if (tris > MAX_INPUT_TRIANGLES) throw new Error(`triangle count ${tris} exceeds ${MAX_INPUT_TRIANGLES}`);

    const levels = jobType === 'lods' ? Math.max(1, Math.min(6, params.levels ?? 4)) : 1;
    const lods: ReturnType<typeof clusterSimplify>[] = [];
    let inputT = 0;
    let outputT = 0;

    for (let l = 0; l < levels; l++) {
      // Cancellation check
      const { data: row } = await db
        .from('simplification_jobs').select('status').eq('id', jobId).single();
      if (row?.status === 'cancelled') return;

      const ratio = Math.pow(0.5, l);
      const grid = Math.max(8, Math.round(Math.cbrt(Math.max(tris, 8) * ratio) * 4));
      const res = clusterSimplify(mesh, grid);
      lods.push(res);
      if (l === 0) inputT = res.inputTriangles;
      outputT = res.outputTriangles;

      const pct = 10 + Math.floor(((l + 1) / levels) * 80);
      await update({
        progress: pct,
        message: `level ${l + 1}/${levels} · ${res.outputTriangles} tris`,
      });
    }

    // Upload result to private storage
    const path = `${userId}/${jobId}.json`;
    const payload = JSON.stringify({ jobType, levels: lods });
    const { error: upErr } = await db.storage
      .from(BUCKET)
      .upload(path, new Blob([payload], { type: 'application/json' }), {
        upsert: true,
        contentType: 'application/json',
      });
    if (upErr) throw upErr;

    await update({
      status: 'completed',
      progress: 100,
      message: 'done',
      input_triangles: inputT,
      output_triangles: outputT,
      result_path: path,
      result_size_bytes: payload.length,
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

    const tris = (parsed.data.mesh.indices?.length ?? 0) / 3;
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

    const work = processJob(data.id, user.id, parsed.data.mesh, parsed.data.jobType, parsed.data.params);
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
      .update({ status: 'cancelled', message: 'cancelled by user', completed_at: new Date().toISOString() })
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
