/**
 * Topology Compliance API.
 *
 * Exposes a stable REST + GraphQL contract for evaluating multi-load-case
 * compliance under the same input shape consumed by the in-process SIMP
 * optimizer (`loadCases`, `loadCaseAggregation`, `ksRho`). The response
 * always carries `perCaseCompliance` so clients can inspect the breakdown
 * before deciding whether to launch a full optimization.
 *
 * The current implementation computes a deterministic surrogate
 * (sum of squared force magnitudes per case, modulated by support count)
 * matching the aggregation semantics of `runSIMP`. Real solver integration
 * plugs in behind `computePerCaseCompliance` without changing the wire
 * contract.
 *
 * Routes:
 *   GET  /topology-api/health      → { ok }
 *   POST /topology-api/compliance  → ComplianceResponse (REST)
 *   POST /topology-api/graphql     → GraphQL { compliance(...) }
 */

import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { z } from 'npm:zod@3.23.8';
import { evaluateCompliance, type ComplianceRequest as ComplianceRequestT } from './compliance.ts';
import { buildIterationStream, streamHeaders, type StreamOptions } from './stream.ts';
export { evaluateCompliance } from './compliance.ts';
export { buildIterationStream } from './stream.ts';

const SCHEMA = 'lovable.topology/v1' as const;

// ─── Shared validators (mirror src/lib/geometry/topology/types.ts) ──────────

const V3 = z.tuple([z.number(), z.number(), z.number()]);

const LoadConditionJSON = z.object({
  point: V3,
  force: V3,
  radius: z.number().positive().max(1e6).optional(),
});

const SupportConditionJSON = z.object({
  point: V3,
  fixed: z.boolean().optional(),
  radius: z.number().positive().max(1e6).optional(),
});

const LoadCaseJSON = z.object({
  name: z.string().min(1).max(128).optional(),
  loads: z.array(LoadConditionJSON).min(1).max(1024),
  supports: z.array(SupportConditionJSON).max(1024).optional(),
  weight: z.number().positive().max(1e6).optional(),
});

const LoadCaseAggregationEnum = z.enum(['weighted-sum', 'ks']);

const ComplianceRequest = z.object({
  loadCases: z.array(LoadCaseJSON).min(1).max(64),
  loadCaseAggregation: LoadCaseAggregationEnum.optional(),
  ksRho: z.number().positive().max(1e3).optional(),
  /** Top-level supports applied when a case omits its own override. */
  supports: z.array(SupportConditionJSON).max(1024).optional(),
});

const StreamRequest = ComplianceRequest.extend({
  throttleMs: z.number().min(0).max(5000).optional(),
  maxIterations: z.number().int().min(1).max(500).optional(),
  volumeFraction: z.number().min(0.05).max(1).optional(),
  includeDensity: z.boolean().optional(),
  previewSize: z.number().int().min(2).max(16).optional(),
  fullSize: z.number().int().min(4).max(48).optional(),
});


// ─── HTTP plumbing ─────────────────────────────────────────────────────────

class HttpError extends Error {
  constructor(public status: number, message: string, public details?: unknown) { super(message); }
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json' },
  });
}

function envelope<T>(type: string, data: T) {
  return { $schema: SCHEMA, type, data };
}

async function parseRequest(req: Request): Promise<ComplianceRequestT> {
  let raw: unknown;
  try { raw = await req.json(); }
  catch { throw new HttpError(400, 'invalid JSON body'); }
  // Allow either bare body or wrapped envelope { $schema, data }.
  const inner = (raw && typeof raw === 'object' && '$schema' in (raw as object))
    ? (raw as { data: unknown }).data
    : raw;
  const parsed = ComplianceRequest.safeParse(inner);
  if (!parsed.success) {
    throw new HttpError(400, 'invalid request', parsed.error.flatten());
  }
  return parsed.data;
}

// ─── GraphQL (minimal hand-rolled resolver) ────────────────────────────────

const SDL = `
"""Topology Compliance API — multi-load-case evaluation."""
scalar JSON

type Query {
  health: String!
  schema: String!
}

type Mutation {
  compliance(
    loadCases: [LoadCaseInput!]!,
    loadCaseAggregation: String,
    ksRho: Float,
    supports: [SupportInput!],
  ): ComplianceResult!
}

input V3Input { x: Float!, y: Float!, z: Float! }
input LoadInput { point: [Float!]!, force: [Float!]!, radius: Float }
input SupportInput { point: [Float!]!, fixed: Boolean, radius: Float }
input LoadCaseInput {
  name: String
  loads: [LoadInput!]!
  supports: [SupportInput!]
  weight: Float
}

type PerCase { name: String!, weight: Float!, compliance: Float! }
type ComplianceResult {
  perCaseCompliance: [Float!]!
  perCase: [PerCase!]!
  loadCaseAggregation: String!
  ksRho: Float
  aggregatedCompliance: Float!
  surrogate: Boolean!
}
`.trim();

interface GqlReq { query?: string; variables?: Record<string, unknown> }

function detectGqlOp(query: string): string | null {
  const m = query.match(/\b(compliance|health|schema)\b/);
  return m ? m[1] : null;
}

async function handleGraphQL(req: Request): Promise<Response> {
  if (req.method === 'GET') return json({ data: { schema: SDL } });
  let body: GqlReq;
  try { body = await req.json() as GqlReq; }
  catch { return json({ errors: [{ message: 'invalid JSON body' }] }, 400); }
  const op = detectGqlOp(body.query ?? '');
  if (!op) return json({ errors: [{ message: 'unsupported_operation' }] });

  if (op === 'health') return json({ data: { health: 'ok' } });
  if (op === 'schema') return json({ data: { schema: SDL } });

  const parsed = ComplianceRequest.safeParse(body.variables ?? {});
  if (!parsed.success) {
    return json({
      errors: [{ message: 'invalid_variables', extensions: { issues: parsed.error.flatten() } }],
    }, 400);
  }
  const result = evaluateCompliance(parsed.data);
  return json({ data: { compliance: result } });
}

async function handleStream(req: Request): Promise<Response> {
  let raw: unknown;
  if (req.method === 'GET') {
    const u = new URL(req.url);
    const b64 = u.searchParams.get('body');
    if (!b64) return json({ error: 'missing body query param' }, 400);
    try { raw = JSON.parse(atob(b64)); }
    catch { return json({ error: 'invalid base64 JSON body' }, 400); }
  } else if (req.method === 'POST') {
    try { raw = await req.json(); }
    catch { return json({ error: 'invalid JSON body' }, 400); }
  } else {
    return json({ error: `method not allowed: ${req.method}` }, 405);
  }
  const inner = (raw && typeof raw === 'object' && '$schema' in (raw as object))
    ? (raw as { data: unknown }).data : raw;
  const parsed = StreamRequest.safeParse(inner);
  if (!parsed.success) {
    return json({ error: 'invalid request', details: parsed.error.flatten() }, 400);
  }
  const { throttleMs, maxIterations, volumeFraction, ...complianceReq } = parsed.data;
  const opts: StreamOptions = { throttleMs, maxIterations, volumeFraction };
  const stream = buildIterationStream(complianceReq, opts, req.signal);
  return new Response(stream, { headers: streamHeaders() });
}

// ─── Routes ─────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const url = new URL(req.url);
  const path = url.pathname.replace(/^.*\/topology-api/, '') || '/';

  try {
    if (req.method === 'GET' && path === '/health') {
      return json(envelope('health', { ok: true }));
    }
    if (path === '/graphql') return await handleGraphQL(req);
    if (req.method === 'GET' && path === '/schema') {
      return json(envelope('schema', { sdl: SDL }));
    }

    if (req.method !== 'POST') {
      return json({ error: `method not allowed: ${req.method}` }, 405);
    }

    if (path === '/compliance') {
      const body = await parseRequest(req);
      const result = evaluateCompliance(body);
      return json(envelope('compliance', result));
    }
    if (path === '/stream') {
      return await handleStream(req);
    }
    return json({ error: `route not found: ${path}` }, 404);
  } catch (e) {
    if (e instanceof HttpError) {
      return json({ $schema: SCHEMA, type: 'error', data: { message: e.message, details: e.details } }, e.status);
    }
    const msg = e instanceof Error ? e.message : 'internal error';
    return json({ $schema: SCHEMA, type: 'error', data: { message: msg } }, 500);
  }
});
