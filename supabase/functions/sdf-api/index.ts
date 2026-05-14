/**
 * SDF API — REST + GraphQL endpoints for SDF generation and surface queries.
 *
 * Routes:
 *   POST /sdf-api/generate            → { grid }
 *   POST /sdf-api/query/nearest       → { results: NearestSurfaceResult[] }
 *   POST /sdf-api/query/inside        → { results: boolean[] }
 *   POST /sdf-api/query/sample        → { results: number[] }
 *   POST /sdf-api/graphql             → GraphQL { generateSDF, sampleSDF, isInside, nearestSurface }
 *   GET  /sdf-api/graphql             → { schema } (SDL)
 *   GET  /sdf-api/health              → { ok: true }
 *
 * Self-contained: re-implements a brute-force CPU SDF generator + trilinear
 * sampling so the edge function has zero dependency on the browser bundle.
 * For large meshes (>5k tris @ res>64) clients should use the in-app gated
 * generator (`generateSDFGated`) instead of this API.
 */
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { z } from 'npm:zod@3.23.8';

// ─── Types ──────────────────────────────────────────────────────────────────

type V3 = [number, number, number];

interface AABB { min: V3; max: V3 }
interface RawMesh { positions: number[]; indices?: number[] }
interface SDFGenerationOptions {
  resolution?: number;
  padding?: number;
  signMethod?: 'raycast' | 'normal';
  narrowBand?: number;
}
interface SerializedGrid {
  /** base64-encoded Float32Array */
  data: string;
  dims: [number, number, number];
  bounds: AABB;
  voxelSize: number;
  sourceTriangles: number;
  backend: 'cpu';
  elapsedMs: number;
}

// ─── Math helpers ───────────────────────────────────────────────────────────

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

function closestPointOnTriangle(p: V3, a: V3, b: V3, c: V3): V3 {
  const ab = sub(b, a), ac = sub(c, a), ap = sub(p, a);
  const d1 = dot(ab, ap), d2 = dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return a;
  const bp = sub(p, b);
  const d3 = dot(ab, bp), d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return b;
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    return [a[0] + v * ab[0], a[1] + v * ab[1], a[2] + v * ab[2]];
  }
  const cp = sub(p, c);
  const d5 = dot(ab, cp), d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return c;
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    return [a[0] + w * ac[0], a[1] + w * ac[1], a[2] + w * ac[2]];
  }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
    return [b[0] + w * (c[0] - b[0]), b[1] + w * (c[1] - b[1]), b[2] + w * (c[2] - b[2])];
  }
  const denom = 1 / (va + vb + vc);
  const v = vb * denom, w = vc * denom;
  return [a[0] + ab[0] * v + ac[0] * w, a[1] + ab[1] * v + ac[1] * w, a[2] + ab[2] * v + ac[2] * w];
}

// ─── Mesh utilities ─────────────────────────────────────────────────────────

function getTriangle(mesh: RawMesh, t: number): [V3, V3, V3] {
  const idx = mesh.indices;
  const ia = idx ? idx[t * 3] : t * 3;
  const ib = idx ? idx[t * 3 + 1] : t * 3 + 1;
  const ic = idx ? idx[t * 3 + 2] : t * 3 + 2;
  const p = mesh.positions;
  return [
    [p[ia * 3], p[ia * 3 + 1], p[ia * 3 + 2]],
    [p[ib * 3], p[ib * 3 + 1], p[ib * 3 + 2]],
    [p[ic * 3], p[ic * 3 + 1], p[ic * 3 + 2]],
  ];
}

function triangleCount(mesh: RawMesh): number {
  return (mesh.indices ? mesh.indices.length : mesh.positions.length / 3) / 3;
}

function meshAABB(mesh: RawMesh): AABB {
  const p = mesh.positions;
  const min: V3 = [Infinity, Infinity, Infinity];
  const max: V3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.length; i += 3) {
    if (p[i] < min[0]) min[0] = p[i]; if (p[i] > max[0]) max[0] = p[i];
    if (p[i + 1] < min[1]) min[1] = p[i + 1]; if (p[i + 1] > max[1]) max[1] = p[i + 1];
    if (p[i + 2] < min[2]) min[2] = p[i + 2]; if (p[i + 2] > max[2]) max[2] = p[i + 2];
  }
  return { min, max };
}

// ─── SDF generation (brute-force, edge-safe) ────────────────────────────────

const MAX_TRIS = 8000;
const MAX_RES = 64;

interface InMemoryGrid {
  data: Float32Array;
  dims: [number, number, number];
  bounds: AABB;
  voxelSize: number;
  sourceTriangles: number;
}

function generateSDF(mesh: RawMesh, opts: SDFGenerationOptions = {}): InMemoryGrid {
  const tris = triangleCount(mesh);
  if (tris > MAX_TRIS) throw new Error(`Triangle count ${tris} exceeds API limit ${MAX_TRIS}`);
  const resolution = Math.min(opts.resolution ?? 32, MAX_RES);
  const signMethod = opts.signMethod ?? 'normal';

  const aabb = meshAABB(mesh);
  const diag = Math.hypot(aabb.max[0] - aabb.min[0], aabb.max[1] - aabb.min[1], aabb.max[2] - aabb.min[2]);
  const padding = opts.padding ?? diag * 0.05;
  const min: V3 = [aabb.min[0] - padding, aabb.min[1] - padding, aabb.min[2] - padding];
  const max: V3 = [aabb.max[0] + padding, aabb.max[1] + padding, aabb.max[2] + padding];
  const extent = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
  const voxelSize = extent / resolution;
  const dims: [number, number, number] = [
    Math.max(2, Math.ceil((max[0] - min[0]) / voxelSize)),
    Math.max(2, Math.ceil((max[1] - min[1]) / voxelSize)),
    Math.max(2, Math.ceil((max[2] - min[2]) / voxelSize)),
  ];
  const [nx, ny, nz] = dims;
  const data = new Float32Array(nx * ny * nz);

  // Pre-fetch triangles + face normals
  const triData: Array<{ a: V3; b: V3; c: V3; n: V3 }> = [];
  for (let t = 0; t < tris; t++) {
    const [a, b, c] = getTriangle(mesh, t);
    const n = cross(sub(b, a), sub(c, a));
    const nl = Math.hypot(n[0], n[1], n[2]) || 1;
    triData.push({ a, b, c, n: [n[0] / nl, n[1] / nl, n[2] / nl] });
  }

  for (let k = 0; k < nz; k++) {
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const p: V3 = [
          min[0] + (i + 0.5) * voxelSize,
          min[1] + (j + 0.5) * voxelSize,
          min[2] + (k + 0.5) * voxelSize,
        ];
        let bestD2 = Infinity;
        let bestSign = 1;
        for (let t = 0; t < triData.length; t++) {
          const { a, b, c, n } = triData[t];
          const cp = closestPointOnTriangle(p, a, b, c);
          const dx = p[0] - cp[0], dy = p[1] - cp[1], dz = p[2] - cp[2];
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 < bestD2) {
            bestD2 = d2;
            if (signMethod === 'normal') {
              bestSign = (dx * n[0] + dy * n[1] + dz * n[2]) >= 0 ? 1 : -1;
            }
          }
        }
        data[i + j * nx + k * nx * ny] = bestSign * Math.sqrt(bestD2);
      }
    }
  }
  return { data, dims, bounds: { min, max }, voxelSize, sourceTriangles: tris };
}

// ─── SDF queries ────────────────────────────────────────────────────────────

function clamp(v: number, lo: number, hi: number) { return v < lo ? lo : v > hi ? hi : v; }
function fetchVox(g: InMemoryGrid, i: number, j: number, k: number) {
  const [nx, ny, nz] = g.dims;
  return g.data[clamp(i, 0, nx - 1) + clamp(j, 0, ny - 1) * nx + clamp(k, 0, nz - 1) * nx * ny];
}
function sampleSDF(g: InMemoryGrid, p: V3): number {
  const fi = (p[0] - g.bounds.min[0]) / g.voxelSize - 0.5;
  const fj = (p[1] - g.bounds.min[1]) / g.voxelSize - 0.5;
  const fk = (p[2] - g.bounds.min[2]) / g.voxelSize - 0.5;
  const i0 = Math.floor(fi), j0 = Math.floor(fj), k0 = Math.floor(fk);
  const tx = fi - i0, ty = fj - j0, tz = fk - k0;
  const c000 = fetchVox(g, i0, j0, k0), c100 = fetchVox(g, i0 + 1, j0, k0);
  const c010 = fetchVox(g, i0, j0 + 1, k0), c110 = fetchVox(g, i0 + 1, j0 + 1, k0);
  const c001 = fetchVox(g, i0, j0, k0 + 1), c101 = fetchVox(g, i0 + 1, j0, k0 + 1);
  const c011 = fetchVox(g, i0, j0 + 1, k0 + 1), c111 = fetchVox(g, i0 + 1, j0 + 1, k0 + 1);
  const c00 = c000 * (1 - tx) + c100 * tx, c01 = c001 * (1 - tx) + c101 * tx;
  const c10 = c010 * (1 - tx) + c110 * tx, c11 = c011 * (1 - tx) + c111 * tx;
  const c0 = c00 * (1 - ty) + c10 * ty, c1 = c01 * (1 - ty) + c11 * ty;
  return c0 * (1 - tz) + c1 * tz;
}
function gradient(g: InMemoryGrid, p: V3): V3 {
  const h = g.voxelSize;
  const dx = sampleSDF(g, [p[0] + h, p[1], p[2]]) - sampleSDF(g, [p[0] - h, p[1], p[2]]);
  const dy = sampleSDF(g, [p[0], p[1] + h, p[2]]) - sampleSDF(g, [p[0], p[1] - h, p[2]]);
  const dz = sampleSDF(g, [p[0], p[1], p[2] + h]) - sampleSDF(g, [p[0], p[1], p[2] - h]);
  const n = Math.hypot(dx, dy, dz) || 1;
  return [dx / n, dy / n, dz / n];
}
function nearestSurface(g: InMemoryGrid, p: V3) {
  let cur: V3 = [p[0], p[1], p[2]];
  let d = sampleSDF(g, cur);
  let n = gradient(g, cur);
  for (let i = 0; i < 8; i++) {
    cur = [cur[0] - n[0] * d, cur[1] - n[1] * d, cur[2] - n[2] * d];
    d = sampleSDF(g, cur);
    if (Math.abs(d) < g.voxelSize * 0.01) break;
    n = gradient(g, cur);
  }
  return { point: cur, signedDistance: sampleSDF(g, p), normal: n };
}

// ─── Serialization ──────────────────────────────────────────────────────────

function serialize(g: InMemoryGrid, elapsedMs: number): SerializedGrid {
  const bytes = new Uint8Array(g.data.buffer, g.data.byteOffset, g.data.byteLength);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return {
    data: btoa(bin),
    dims: g.dims,
    bounds: g.bounds,
    voxelSize: g.voxelSize,
    sourceTriangles: g.sourceTriangles,
    backend: 'cpu',
    elapsedMs,
  };
}
function deserialize(s: SerializedGrid): InMemoryGrid {
  const bin = atob(s.data);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return {
    data: new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4),
    dims: s.dims,
    bounds: s.bounds,
    voxelSize: s.voxelSize,
    sourceTriangles: s.sourceTriangles,
  };
}

// ─── Schemas ────────────────────────────────────────────────────────────────

const Vec3Schema = z.tuple([z.number(), z.number(), z.number()]);
const MeshSchema = z.object({
  positions: z.array(z.number()).min(9),
  indices: z.array(z.number()).optional(),
});
const OptionsSchema = z.object({
  resolution: z.number().int().min(4).max(MAX_RES).optional(),
  padding: z.number().nonnegative().optional(),
  signMethod: z.enum(['raycast', 'normal']).optional(),
  narrowBand: z.number().positive().optional(),
}).optional();
const GenerateSchema = z.object({ mesh: MeshSchema, options: OptionsSchema });
const GridSchema = z.object({
  data: z.string(),
  dims: z.tuple([z.number(), z.number(), z.number()]),
  bounds: z.object({ min: Vec3Schema, max: Vec3Schema }),
  voxelSize: z.number(),
  sourceTriangles: z.number(),
  backend: z.literal('cpu'),
  elapsedMs: z.number(),
});
const QuerySchema = z.object({
  /** Pre-generated grid OR mesh — one is required. */
  grid: GridSchema.optional(),
  mesh: MeshSchema.optional(),
  options: OptionsSchema,
  points: z.array(Vec3Schema).min(1).max(10000),
});

// ─── REST handlers ──────────────────────────────────────────────────────────

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
function err(message: string, status = 400, details?: unknown) {
  return json({ error: message, details }, status);
}

async function handleGenerate(req: Request) {
  const parsed = GenerateSchema.safeParse(await req.json());
  if (!parsed.success) return err('invalid_request', 400, parsed.error.flatten());
  const t0 = performance.now();
  const grid = generateSDF(parsed.data.mesh, parsed.data.options ?? {});
  return json({ grid: serialize(grid, performance.now() - t0) });
}

function resolveGrid(payload: z.infer<typeof QuerySchema>): InMemoryGrid {
  if (payload.grid) return deserialize(payload.grid);
  if (payload.mesh) return generateSDF(payload.mesh, payload.options ?? {});
  throw new Error('Either `grid` or `mesh` must be provided');
}

async function handleQuery(req: Request, kind: 'sample' | 'inside' | 'nearest') {
  const parsed = QuerySchema.safeParse(await req.json());
  if (!parsed.success) return err('invalid_request', 400, parsed.error.flatten());
  let grid: InMemoryGrid;
  try { grid = resolveGrid(parsed.data); }
  catch (e) { return err((e as Error).message, 400); }
  const pts = parsed.data.points as V3[];
  if (kind === 'sample') return json({ results: pts.map((p) => sampleSDF(grid, p)) });
  if (kind === 'inside') return json({ results: pts.map((p) => sampleSDF(grid, p) < 0) });
  return json({ results: pts.map((p) => nearestSurface(grid, p)) });
}

// ─── GraphQL (minimal hand-rolled resolver, no external lib) ────────────────

const SDL = `
"""SDF API — generate signed distance fields and run nearest-surface / inside queries."""
type Query {
  health: String!
  schema: String!
}
type Mutation {
  generateSDF(mesh: MeshInput!, options: SDFOptions): SDFGrid!
  sampleSDF(input: QueryInput!): [Float!]!
  isInside(input: QueryInput!): [Boolean!]!
  nearestSurface(input: QueryInput!): [NearestResult!]!
}
input MeshInput { positions: [Float!]!, indices: [Int!] }
input SDFOptions {
  resolution: Int
  padding: Float
  signMethod: String
  narrowBand: Float
}
input QueryInput {
  grid: SDFGridInput
  mesh: MeshInput
  options: SDFOptions
  points: [[Float!]!]!
}
input SDFGridInput {
  data: String!
  dims: [Int!]!
  bounds: AABBInput!
  voxelSize: Float!
  sourceTriangles: Int!
  backend: String!
  elapsedMs: Float!
}
input AABBInput { min: [Float!]!, max: [Float!]! }
type SDFGrid {
  data: String!
  dims: [Int!]!
  bounds: AABB!
  voxelSize: Float!
  sourceTriangles: Int!
  backend: String!
  elapsedMs: Float!
}
type AABB { min: [Float!]!, max: [Float!]! }
type NearestResult {
  point: [Float!]!
  signedDistance: Float!
  normal: [Float!]!
}
`.trim();

interface GqlReq { query?: string; operationName?: string; variables?: Record<string, unknown> }

async function handleGraphQL(req: Request) {
  if (req.method === 'GET') return json({ schema: SDL });
  let body: GqlReq;
  try { body = await req.json() as GqlReq; }
  catch { return err('invalid_json', 400); }
  const q = body.query ?? '';
  const vars = body.variables ?? {};
  try {
    // Minimal resolver: identify operation by keyword. (No full parser — this is a
    // pragmatic resolver façade for the 4 supported operations.)
    if (/\bgenerateSDF\s*\(/.test(q)) {
      const parsed = GenerateSchema.parse({ mesh: vars.mesh, options: vars.options });
      const t0 = performance.now();
      const g = generateSDF(parsed.mesh, parsed.options ?? {});
      return json({ data: { generateSDF: serialize(g, performance.now() - t0) } });
    }
    if (/\bsampleSDF\s*\(|\bisInside\s*\(|\bnearestSurface\s*\(/.test(q)) {
      const input = QuerySchema.parse(vars.input);
      const grid = resolveGrid(input);
      const pts = input.points as V3[];
      if (/\bsampleSDF\s*\(/.test(q)) return json({ data: { sampleSDF: pts.map((p) => sampleSDF(grid, p)) } });
      if (/\bisInside\s*\(/.test(q)) return json({ data: { isInside: pts.map((p) => sampleSDF(grid, p) < 0) } });
      return json({ data: { nearestSurface: pts.map((p) => nearestSurface(grid, p)) } });
    }
    if (/\bhealth\b/.test(q)) return json({ data: { health: 'ok' } });
    if (/\bschema\b/.test(q)) return json({ data: { schema: SDL } });
    return json({ errors: [{ message: 'unsupported_operation' }] }, 400);
  } catch (e) {
    return json({ errors: [{ message: (e as Error).message }] }, 400);
  }
}

// ─── Router ─────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const url = new URL(req.url);
  const path = url.pathname.replace(/^.*\/sdf-api/, '') || '/';
  try {
    if (req.method === 'GET' && path === '/health') return json({ ok: true });
    if (path === '/graphql') return await handleGraphQL(req);
    if (req.method !== 'POST') return err('method_not_allowed', 405);
    if (path === '/generate') return await handleGenerate(req);
    if (path === '/query/sample') return await handleQuery(req, 'sample');
    if (path === '/query/inside') return await handleQuery(req, 'inside');
    if (path === '/query/nearest') return await handleQuery(req, 'nearest');
    return err('not_found', 404);
  } catch (e) {
    return err((e as Error).message, 500);
  }
});
