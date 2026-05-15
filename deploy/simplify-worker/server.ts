/**
 * Simplification Worker — Kubernetes-ready long-running service.
 *
 * Wraps the same simplification routes as `supabase/functions/simplify-api`
 * but runs as a stateless container suited for horizontal autoscaling.
 *
 * Endpoints:
 *   POST /v1/lods         → LOD generation
 *   POST /v1/graph        → coarsened face graph
 *   POST /v1/inference    → full inference-ready payload
 *   GET  /healthz         → liveness probe
 *   GET  /readyz          → readiness probe (returns 503 when saturated)
 *   GET  /metrics         → Prometheus exposition (for HPA via custom metrics)
 *
 * Concurrency is bounded by MAX_CONCURRENCY so the HPA can scale on either
 * CPU or `simplify_inflight_requests` once the queue saturates.
 */

const PORT = Number(Deno.env.get('PORT') ?? 8080);
const MAX_CONCURRENCY = Number(Deno.env.get('MAX_CONCURRENCY') ?? 8);
const MAX_TRIANGLES = Number(Deno.env.get('MAX_TRIANGLES') ?? 200_000);
const LOG_LEVEL = Deno.env.get('LOG_LEVEL') ?? 'info';

// ── Metrics ────────────────────────────────────────────────────────────────
const metrics = {
  inflight: 0,
  totalRequests: 0,
  totalErrors: 0,
  totalRejected: 0,
  totalLatencyMs: 0,
  startedAt: Date.now(),
};

function log(level: string, msg: string, extra: Record<string, unknown> = {}) {
  if (LOG_LEVEL === 'silent') return;
  console.log(JSON.stringify({ ts: new Date().toISOString(), level, msg, ...extra }));
}

// ── Tiny self-contained simplifier (vertex-cluster) ────────────────────────
// Mirrors the production edge function so the worker has zero local deps.
interface RawMesh { positions: number[]; indices?: number[] }

function b64Encode(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}
function packMesh(positions: Float32Array, indices: Uint32Array) {
  return {
    positions: b64Encode(new Uint8Array(positions.buffer, positions.byteOffset, positions.byteLength)),
    indices: b64Encode(new Uint8Array(indices.buffer, indices.byteOffset, indices.byteLength)),
    vertexCount: positions.length / 3,
    triangleCount: indices.length / 3,
  };
}

function clusterSimplify(mesh: RawMesh, gridResolution: number) {
  const t0 = performance.now();
  const positions = new Float32Array(mesh.positions);
  const indices = mesh.indices ? new Uint32Array(mesh.indices) : new Uint32Array(0);
  const inputTris = indices.length / 3;
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
    const ix = Math.floor((x - minX) / cell);
    const iy = Math.floor((y - minY) / cell);
    const iz = Math.floor((z - minZ) / cell);
    const key = `${ix}|${iy}|${iz}`;
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
  const outIdxArr: number[] = [];
  for (let t = 0; t < inputTris; t++) {
    const a = remap[indices[t * 3]];
    const b = remap[indices[t * 3 + 1]];
    const c = remap[indices[t * 3 + 2]];
    if (a !== b && b !== c && a !== c) outIdxArr.push(a, b, c);
  }
  const outIndices = new Uint32Array(outIdxArr);
  return {
    positions: outVerts,
    indices: outIndices,
    stats: {
      inputTriangles: inputTris,
      outputTriangles: outIndices.length / 3,
      inputVertices: inputVerts,
      outputVertices: outVerts.length / 3,
      elapsedMs: performance.now() - t0,
    },
  };
}

function buildLODs(mesh: RawMesh, levels: number) {
  const out: ReturnType<typeof packMesh>[] = [];
  const stats: unknown[] = [];
  const tris = (mesh.indices?.length ?? 0) / 3;
  for (let l = 0; l < Math.max(1, Math.min(levels, 6)); l++) {
    const ratio = Math.pow(0.5, l);
    const grid = Math.max(8, Math.round(Math.cbrt(tris * ratio) * 4));
    const res = clusterSimplify(mesh, grid);
    out.push(packMesh(res.positions, res.indices));
    stats.push({ level: l, ratio, ...res.stats });
  }
  return { lods: out, stats };
}

// ── Handler ────────────────────────────────────────────────────────────────
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
};

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function handle(req: Request): Promise<Response> {
  const url = new URL(req.url);

  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  // Probes & metrics — never count toward inflight
  if (url.pathname === '/healthz') return jsonResponse({ ok: true, uptimeMs: Date.now() - metrics.startedAt });
  if (url.pathname === '/readyz') {
    if (metrics.inflight >= MAX_CONCURRENCY) {
      return jsonResponse({ ok: false, reason: 'saturated', inflight: metrics.inflight }, 503);
    }
    return jsonResponse({ ok: true, inflight: metrics.inflight, max: MAX_CONCURRENCY });
  }
  if (url.pathname === '/metrics') {
    const uptime = (Date.now() - metrics.startedAt) / 1000;
    const avg = metrics.totalRequests > 0 ? metrics.totalLatencyMs / metrics.totalRequests : 0;
    const body = [
      `# TYPE simplify_inflight_requests gauge\nsimplify_inflight_requests ${metrics.inflight}`,
      `# TYPE simplify_requests_total counter\nsimplify_requests_total ${metrics.totalRequests}`,
      `# TYPE simplify_errors_total counter\nsimplify_errors_total ${metrics.totalErrors}`,
      `# TYPE simplify_rejected_total counter\nsimplify_rejected_total ${metrics.totalRejected}`,
      `# TYPE simplify_latency_ms_avg gauge\nsimplify_latency_ms_avg ${avg.toFixed(3)}`,
      `# TYPE simplify_uptime_seconds counter\nsimplify_uptime_seconds ${uptime.toFixed(0)}`,
      `# TYPE simplify_max_concurrency gauge\nsimplify_max_concurrency ${MAX_CONCURRENCY}`,
      '',
    ].join('\n');
    return new Response(body, { status: 200, headers: { 'Content-Type': 'text/plain; version=0.0.4' } });
  }

  // Backpressure: shed load instead of queuing unbounded requests.
  if (metrics.inflight >= MAX_CONCURRENCY) {
    metrics.totalRejected++;
    return jsonResponse({ error: 'saturated', retryAfterMs: 250 }, 503);
  }

  metrics.inflight++;
  metrics.totalRequests++;
  const t0 = performance.now();
  try {
    if (req.method !== 'POST') return jsonResponse({ error: 'method not allowed' }, 405);
    const body = await req.json().catch(() => null) as { mesh?: RawMesh; levels?: number } | null;
    if (!body?.mesh?.positions?.length) return jsonResponse({ error: 'mesh.positions[] required' }, 400);
    const tris = (body.mesh.indices?.length ?? 0) / 3;
    if (tris > MAX_TRIANGLES) return jsonResponse({ error: `triangle count ${tris} exceeds MAX_TRIANGLES=${MAX_TRIANGLES}` }, 413);

    if (url.pathname === '/v1/lods') {
      const { lods, stats } = buildLODs(body.mesh, body.levels ?? 4);
      return jsonResponse({ lods, stats });
    }
    if (url.pathname === '/v1/graph' || url.pathname === '/v1/inference') {
      // Reuse the cluster simplifier as the coarse pass; full graph coarsening
      // is provided by the edge function and in-app simplifier — the worker
      // returns a coarse mesh stub so callers can fan out to either backend.
      const coarse = clusterSimplify(body.mesh, 24);
      const packed = packMesh(coarse.positions, coarse.indices);
      return jsonResponse({ coarseMesh: packed, stats: coarse.stats });
    }
    return jsonResponse({ error: 'not found' }, 404);
  } catch (err) {
    metrics.totalErrors++;
    log('error', 'request failed', { err: (err as Error).message });
    return jsonResponse({ error: (err as Error).message }, 500);
  } finally {
    metrics.totalLatencyMs += performance.now() - t0;
    metrics.inflight--;
  }
}

log('info', 'simplify-worker starting', { port: PORT, maxConcurrency: MAX_CONCURRENCY, maxTriangles: MAX_TRIANGLES });
Deno.serve({ port: PORT, hostname: '0.0.0.0' }, handle);
