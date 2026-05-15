/**
 * Mesh Simplification API — REST + GraphQL endpoints.
 *
 * Routes:
 *   POST /simplify-api/lods         → { lods, totalElapsedMs }
 *   POST /simplify-api/graph        → { graph }
 *   POST /simplify-api/inference    → { coarseMesh, lods, graph, features, featureDim }
 *   POST /simplify-api/upload       → multipart/form-data: STL/OBJ → { lods, coarseMesh, graph }
 *   POST /simplify-api/graphql      → GraphQL { simplifyLODs, simplifyGraph, prepareForInference }
 *   GET  /simplify-api/graphql      → { schema } (SDL)
 *   GET  /simplify-api/health       → { ok: true }
 *
 * Self-contained: re-implements vertex-cluster simplification + heaviest-edge
 * graph coarsening so the edge function has zero dependency on the browser
 * bundle. Mirrors the sdf-api precedent.
 *
 * For very large meshes (>200k tris) clients should use the gated in-app
 * simplifier (`prepareForInference`) which runs full QEM with feature
 * preservation.
 */
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { z } from 'npm:zod@3.23.8';
import {
  parseUploadedMesh,
  inferMeshFormat,
  type MeshFormat,
  type RawMeshIn,
} from './parsers.ts';
import { openApiSpec, swaggerHTML } from './openapi.ts';
import {
  responseCache,
  hashMesh,
  hashBytes,
  makeCacheKey,
  type SimplifyRoute,
} from './cache.ts';
export { parseSTL, parseOBJ, parseUploadedMesh, inferMeshFormat } from './parsers.ts';
export { openApiSpec } from './openapi.ts';
export { responseCache, hashMesh, hashBytes, makeCacheKey, canonicalizeOptions, LRUCache } from './cache.ts';

// ─── Core helpers (pure JS, shared with Vitest tests) ──────────────────────

import {
  MAX_TRIANGLES,
  MAX_LODS,
  buildLODs,
  coarsenGraph,
  meshToArrays,
  serializeMesh,
  type RawMesh,
  type SerializedMesh,
  type MeshArrays,
} from './core.ts';
export {
  buildLODs,
  coarsenGraph,
  meshToArrays,
  MAX_TRIANGLES,
  MAX_LODS,
} from './core.ts';

function b64FromBuffer(buf: ArrayBufferView): string {
  const bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, Math.min(i + CHUNK, bytes.length)));
  }
  return btoa(bin);
}

// ─── Schemas ────────────────────────────────────────────────────────────────

const Vec3Schema = z.tuple([z.number(), z.number(), z.number()]);
const MeshSchema = z.object({
  positions: z.array(z.number()).min(9),
  indices: z.array(z.number().int().nonnegative()).optional(),
}).refine(
  (m) => (m.indices ? m.indices.length / 3 : m.positions.length / 9) <= MAX_TRIANGLES,
  { message: `triangle count exceeds ${MAX_TRIANGLES}` },
);

const LODOptionsSchema = z.object({
  levels: z.number().int().min(1).max(MAX_LODS).optional(),
  ratioPerLevel: z.number().min(0.05).max(0.95).optional(),
  minTriangles: z.number().int().min(4).optional(),
  maxLevels: z.number().int().min(1).max(MAX_LODS).optional(),
}).optional();

const GraphOptionsSchema = z.object({
  targetNodes: z.number().int().min(1).optional(),
  targetRatio: z.number().min(0.01).max(0.95).optional(),
}).optional();

const LODsRequestSchema = z.object({ mesh: MeshSchema, options: LODOptionsSchema });
const GraphRequestSchema = z.object({ mesh: MeshSchema, options: GraphOptionsSchema });
const InferenceRequestSchema = z.object({
  mesh: MeshSchema,
  lod: LODOptionsSchema,
  graph: GraphOptionsSchema,
});

// ─── REST handlers ──────────────────────────────────────────────────────────

function json(body: unknown, status = 200, extraHeaders?: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json', ...(extraHeaders ?? {}) },
  });
}
function err(message: string, status = 400, details?: unknown) {
  return json({ error: message, details }, status);
}

/**
 * Read JSON body once, return both the parsed value and a cache key derived
 * from the mesh content hash + route + canonicalized options.
 */
async function withCache<T>(
  route: SimplifyRoute,
  body: { mesh: { positions: number[]; indices?: number[] } } & Record<string, unknown>,
  optionsForKey: unknown,
  compute: () => Promise<T> | T,
): Promise<Response> {
  const meshHash = await hashMesh(body.mesh);
  const key = makeCacheKey({ route, meshHash, options: optionsForKey });
  const cached = responseCache.get(key);
  if (cached !== undefined) {
    return new Response(cached, {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
        'X-Cache': 'HIT',
        'X-Cache-Key': meshHash,
      },
    });
  }
  const value = await compute();
  const serialized = JSON.stringify(value);
  responseCache.set(key, serialized, serialized.length);
  return new Response(serialized, {
    status: 200,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
      'X-Cache': 'MISS',
      'X-Cache-Key': meshHash,
    },
  });
}

async function handleLODs(req: Request) {
  const parsed = LODsRequestSchema.safeParse(await req.json());
  if (!parsed.success) return err('invalid_request', 400, parsed.error.flatten());
  return withCache('lods', parsed.data, parsed.data.options ?? null, () =>
    buildLODs(parsed.data.mesh, parsed.data.options ?? {}),
  );
}

async function handleGraph(req: Request) {
  const parsed = GraphRequestSchema.safeParse(await req.json());
  if (!parsed.success) return err('invalid_request', 400, parsed.error.flatten());
  return withCache('graph', parsed.data, parsed.data.options ?? null, () => {
    const m = meshToArrays(parsed.data.mesh);
    const t0 = performance.now();
    const graph = coarsenGraph(m, parsed.data.options?.targetNodes, parsed.data.options?.targetRatio);
    return { graph, elapsedMs: performance.now() - t0 };
  });
}

async function handleInference(req: Request) {
  const parsed = InferenceRequestSchema.safeParse(await req.json());
  if (!parsed.success) return err('invalid_request', 400, parsed.error.flatten());
  return withCache('inference', parsed.data,
    { lod: parsed.data.lod ?? null, graph: parsed.data.graph ?? null },
    () => {
      const t0 = performance.now();
      const lodResult = buildLODs(parsed.data.mesh, parsed.data.lod ?? {});
      const m = meshToArrays(parsed.data.mesh);
      const graph = coarsenGraph(m, parsed.data.graph?.targetNodes, parsed.data.graph?.targetRatio);

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
        features[off + 6] = lodResult.lods.length - 1;
      }

      return {
        coarseMesh: lodResult.lods[lodResult.lods.length - 1].mesh,
        lods: lodResult.lods,
        graph,
        features: b64FromBuffer(features),
        featureDim,
        nodeToFaces: graph.clusters,
        elapsedMs: performance.now() - t0,
      };
    },
  );
}

// ─── GraphQL (minimal hand-rolled resolver) ─────────────────────────────────

const SDL = `
"""Mesh Simplification API — generate LODs and coarsened face graphs."""
type Query {
  health: String!
  schema: String!
}
type Mutation {
  simplifyLODs(mesh: MeshInput!, options: LODOptions): LODResult!
  simplifyGraph(mesh: MeshInput!, options: GraphOptions): GraphResult!
  prepareForInference(mesh: MeshInput!, lod: LODOptions, graph: GraphOptions): InferencePayload!
}
input MeshInput { positions: [Float!]!, indices: [Int!] }
input LODOptions {
  levels: Int
  ratioPerLevel: Float
  minTriangles: Int
  maxLevels: Int
}
input GraphOptions { targetNodes: Int, targetRatio: Float }

type SerializedMesh {
  positions: String!
  indices: String!
  vertexCount: Int!
  triangleCount: Int!
}
type LODStats {
  inputTriangles: Int!
  outputTriangles: Int!
  inputVertices: Int!
  outputVertices: Int!
  elapsedMs: Float!
}
type LOD { level: Int!, ratio: Float!, mesh: SerializedMesh!, stats: LODStats! }
type LODResult { lods: [LOD!]!, totalElapsedMs: Float! }

type NodeFeat { area: Float!, avgNormal: [Float!]!, avgCurvature: Float! }
type GraphPayload {
  nodeCount: Int!
  edgeCount: Int!
  edges: [[Int!]!]!
  clusters: [[Int!]!]!
  nodeFeatures: [NodeFeat!]!
  edgeCompression: Float!
}
type GraphResult { graph: GraphPayload!, elapsedMs: Float! }

type InferencePayload {
  coarseMesh: SerializedMesh!
  lods: [LOD!]!
  graph: GraphPayload!
  features: String!
  featureDim: Int!
  nodeToFaces: [[Int!]!]!
  elapsedMs: Float!
}
`.trim();

interface GqlReq { query?: string; variables?: Record<string, unknown> }

async function handleGraphQL(req: Request) {
  if (req.method === 'GET') return json({ schema: SDL });
  let body: GqlReq;
  try { body = await req.json() as GqlReq; } catch { return err('invalid_json', 400); }
  const q = body.query ?? '';
  const vars = body.variables ?? {};
  try {
    if (/\bsimplifyLODs\s*\(/.test(q)) {
      const parsed = LODsRequestSchema.parse({ mesh: vars.mesh, options: vars.options });
      const r = buildLODs(parsed.mesh, parsed.options ?? {});
      return json({ data: { simplifyLODs: r } });
    }
    if (/\bsimplifyGraph\s*\(/.test(q)) {
      const parsed = GraphRequestSchema.parse({ mesh: vars.mesh, options: vars.options });
      const m = meshToArrays(parsed.mesh);
      const t0 = performance.now();
      const graph = coarsenGraph(m, parsed.options?.targetNodes, parsed.options?.targetRatio);
      return json({ data: { simplifyGraph: { graph, elapsedMs: performance.now() - t0 } } });
    }
    if (/\bprepareForInference\s*\(/.test(q)) {
      const parsed = InferenceRequestSchema.parse({ mesh: vars.mesh, lod: vars.lod, graph: vars.graph });
      const fakeReq = new Request('http://x/inference', { method: 'POST', body: JSON.stringify(parsed) });
      const r = await handleInference(fakeReq);
      const data = await r.json();
      return json({ data: { prepareForInference: data } });
    }
    if (/\bhealth\b/.test(q)) return json({ data: { health: 'ok' } });
    if (/\bschema\b/.test(q)) return json({ data: { schema: SDL } });
    return json({ errors: [{ message: 'unsupported_operation' }] }, 400);
  } catch (e) {
    return json({ errors: [{ message: (e as Error).message }] }, 400);
  }
}

// ─── Multipart upload (STL/OBJ → LODs + coarsened graph) ───────────────────

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // 25 MB

function parsePositiveInt(v: FormDataEntryValue | null): number | undefined {
  if (typeof v !== 'string') return undefined;
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}
function parseFloatField(v: FormDataEntryValue | null): number | undefined {
  if (typeof v !== 'string') return undefined;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : undefined;
}

async function handleUpload(req: Request) {
  const ct = req.headers.get('content-type') ?? '';
  if (!ct.toLowerCase().startsWith('multipart/form-data')) {
    return err('expected_multipart_form_data', 415);
  }

  let form: FormData;
  try { form = await req.formData(); }
  catch { return err('invalid_multipart_body', 400); }

  const file = form.get('file');
  if (!(file instanceof File)) return err('missing_file_field', 400);
  if (file.size > MAX_UPLOAD_BYTES) {
    return err(`file_too_large (>${MAX_UPLOAD_BYTES} bytes)`, 413);
  }

  // Allow client to override the inferred format.
  const formatOverride = (form.get('format') as string | null)?.toLowerCase();
  const inferred = formatOverride === 'stl' || formatOverride === 'obj'
    ? (formatOverride as MeshFormat)
    : inferMeshFormat(file.name, file.type);
  if (!inferred) return err('unsupported_mesh_format (expected .stl or .obj)', 415);

  const bytes = new Uint8Array(await file.arrayBuffer());

  let mesh: RawMeshIn;
  try { mesh = parseUploadedMesh(bytes, inferred); }
  catch (e) { return err(`parse_failed: ${(e as Error).message}`, 400); }

  // Cap triangle count post-parse — same MAX_TRIANGLES contract as JSON path.
  const triCount = mesh.indices ? mesh.indices.length / 3 : mesh.positions.length / 9;
  if (triCount > MAX_TRIANGLES) {
    return err(`triangle_count_exceeds_limit (${triCount} > ${MAX_TRIANGLES})`, 413);
  }

  // Optional knobs (mirrors JSON LODOptions/GraphOptions).
  const lodOptions = {
    levels: parsePositiveInt(form.get('levels')),
    ratioPerLevel: parseFloatField(form.get('ratioPerLevel')),
    minTriangles: parsePositiveInt(form.get('minTriangles')),
    maxLevels: parsePositiveInt(form.get('maxLevels')),
  };
  const graphOptions = {
    targetNodes: parsePositiveInt(form.get('targetNodes')),
    targetRatio: parseFloatField(form.get('targetRatio')),
  };

  const t0 = performance.now();
  const lodResult = buildLODs(mesh, lodOptions);
  const m = meshToArrays(mesh);
  const graph = coarsenGraph(m, graphOptions.targetNodes, graphOptions.targetRatio);

  return json({
    upload: {
      filename: file.name,
      format: inferred,
      bytes: file.size,
      triangleCount: triCount,
      vertexCount: mesh.positions.length / 3,
    },
    lods: lodResult.lods,
    coarseMesh: lodResult.lods[lodResult.lods.length - 1].mesh,
    graph,
    elapsedMs: performance.now() - t0,
  });
}

// ─── Router ─────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const url = new URL(req.url);
  const path = url.pathname.replace(/^.*\/simplify-api/, '') || '/';
  try {
    if (req.method === 'GET' && path === '/health') return json({ ok: true });
    if (req.method === 'GET' && (path === '/openapi.json' || path === '/openapi')) {
      return json(openApiSpec);
    }
    if (req.method === 'GET' && (path === '/docs' || path === '/docs/')) {
      return new Response(swaggerHTML, {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'text/html; charset=utf-8' },
      });
    }
    if (path === '/graphql') return await handleGraphQL(req);
    if (req.method !== 'POST') return err('method_not_allowed', 405);
    if (path === '/lods') return await handleLODs(req);
    if (path === '/graph') return await handleGraph(req);
    if (path === '/inference') return await handleInference(req);
    if (path === '/upload') return await handleUpload(req);
    return err('not_found', 404);
  } catch (e) {
    return err((e as Error).message, 500);
  }
});
