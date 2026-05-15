/**
 * Symbolic Engine REST API.
 *
 * Exposes the SymbolicEngine facade over HTTP so clients (browser, other
 * services) can construct symbols/primitives/expressions and submit
 * constraint systems for solve/evaluation. All requests + responses use
 * the canonical `lovable.symbolic/v1` envelope so the wire format is
 * stable and forward-compatible.
 *
 * Routes:
 *   GET  /symbolic-api/health              → { ok: true }
 *   GET  /symbolic-api/backends            → { backends: [{id, version, capabilities}] }
 *   POST /symbolic-api/symbols             → envelope<expr|primitive>      (createSymbol)
 *   POST /symbolic-api/primitives          → envelope<primitive>           (createPrimitive)
 *   POST /symbolic-api/expressions         → envelope<expr>                (createExpression)
 *   POST /symbolic-api/solve               → envelope<solveOutcome>        (solve)
 *   POST /symbolic-api/evaluate            → envelope<scalar>              (evaluate)
 *
 * The shipping backend is a stub that throws SymbolicNotImplementedError;
 * those failures are surfaced as HTTP 501 with a structured error body.
 * Real backends (exact-rational, CGAL bridge, SymPy-WASM) plug in here
 * without changing the wire contract.
 */

import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { z } from 'npm:zod@3.23.8';

// ─── Wire format (mirrors src/lib/geometry/symbolic/serialization.ts) ───────

const SCHEMA = 'lovable.symbolic/v1' as const;

type WireType =
  | 'scalar' | 'expr' | 'rational' | 'primitive'
  | 'constraint' | 'binding' | 'solveOutcome';

interface Envelope<T extends WireType, D> {
  $schema: typeof SCHEMA;
  type: T;
  data: D;
}

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(value as Record<string, unknown>).sort()) {
    const v = (value as Record<string, unknown>)[k];
    if (v === undefined) continue;
    out[k] = canonicalize(v);
  }
  return out;
}

function envelope<T extends WireType, D>(type: T, data: D): Envelope<T, D> {
  return canonicalize({ $schema: SCHEMA, type, data }) as Envelope<T, D>;
}

// ─── Validators (zod) ──────────────────────────────────────────────────────

const RationalJSON = z.object({ num: z.string(), den: z.string() });

const ExprJSON: z.ZodType<{ backendId: string; handle: unknown; debug?: string }> =
  z.object({
    backendId: z.string().min(1).max(64),
    handle: z.unknown(),
    debug: z.string().max(2048).optional(),
  });

const ScalarJSON = z.object({
  form: z.enum(['number', 'rational', 'expr']),
  value: z.unknown(),
}).superRefine((s, ctx) => {
  if (s.form === 'number') {
    if (typeof s.value !== 'number' || !Number.isFinite(s.value)) {
      ctx.addIssue({ code: 'custom', message: 'scalar.number must be finite' });
    }
  } else if (s.form === 'rational') {
    const r = RationalJSON.safeParse(s.value);
    if (!r.success) ctx.addIssue({ code: 'custom', message: 'invalid rational' });
  } else if (s.form === 'expr') {
    const e = ExprJSON.safeParse(s.value);
    if (!e.success) ctx.addIssue({ code: 'custom', message: 'invalid expr' });
  }
});

const SymbolJSON = z.object({
  id: z.string().min(1).max(128),
  name: z.string().min(1).max(128),
  domain: z.enum(['real', 'integer', 'rational', 'complex', 'boolean']).optional(),
  bounds: z.object({ min: z.number().optional(), max: z.number().optional() }).optional(),
  defaultValue: z.number().optional(),
});

const PRIMITIVE_KINDS = [
  'point', 'line', 'plane', 'circle', 'arc', 'conic',
  'algebraic-curve', 'algebraic-surface',
  'parametric-curve', 'parametric-surface', 'implicit-surface',
  'brep-solid', 'csg-tree',
] as const;

const PrimitiveJSON = z.object({
  id: z.string().min(1).max(128),
  kind: z.enum(PRIMITIVE_KINDS),
  symbols: z.array(z.string().min(1).max(128)).max(512),
  representation: ExprJSON,
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const CONSTRAINT_KINDS = [
  'distance', 'angle', 'parallel', 'perpendicular', 'tangent',
  'coincident', 'concentric', 'symmetric', 'fixed', 'equation', 'inequality',
] as const;

const ConstraintJSON = z.object({
  id: z.string().min(1).max(128),
  kind: z.enum(CONSTRAINT_KINDS),
  operands: z.array(z.string().min(1).max(128)).max(64),
  value: ScalarJSON.optional(),
  expression: ExprJSON.optional(),
});

const BindingJSON = z.object({
  symbolId: z.string().min(1).max(128),
  value: ScalarJSON,
});

// ─── Request envelopes ─────────────────────────────────────────────────────

const RequestEnvelope = z.object({
  $schema: z.literal(SCHEMA),
  data: z.unknown(),
});

const SymbolReq = z.object({ symbol: SymbolJSON, backend: z.string().max(64).optional() });
const PrimitiveReq = z.object({
  kind: z.enum(PRIMITIVE_KINDS),
  spec: z.record(z.string(), z.unknown()),
  backend: z.string().max(64).optional(),
});
const ExpressionReq = z.object({
  source: z.union([z.string().max(8192), z.record(z.string(), z.unknown())]),
  backend: z.string().max(64).optional(),
});
const SolveReq = z.object({
  symbols: z.array(SymbolJSON).max(1024),
  constraints: z.array(ConstraintJSON).max(4096),
  initialGuess: z.array(BindingJSON).max(1024).optional(),
  backend: z.string().max(64).optional(),
});
const EvaluateReq = z.object({
  expression: ExprJSON,
  bindings: z.array(BindingJSON).max(1024),
  backend: z.string().max(64).optional(),
});

// ─── Backend resolution ────────────────────────────────────────────────────

interface BackendInfo {
  id: string;
  version: string;
  capabilities: Record<string, unknown>;
}

/**
 * Server-side backend registry. Currently only the stub is registered —
 * matching the in-process default. Real backends (CGAL/SymPy-WASM) will
 * register here and the dispatch logic below stays unchanged.
 */
const BACKENDS: Record<string, BackendInfo> = {
  stub: {
    id: 'stub',
    version: '0.0.0-interface-only',
    capabilities: {
      primitiveKinds: PRIMITIVE_KINDS,
      exact: false,
      implemented: false,
    },
  },
};

function resolveBackendId(requested?: string): string {
  if (!requested) return 'stub';
  if (!BACKENDS[requested]) {
    throw new HttpError(400, `unknown backend: ${requested}`);
  }
  return requested;
}

/** Mirror of SymbolicNotImplementedError surfaced to HTTP. */
class HttpError extends Error {
  constructor(public status: number, message: string, public details?: unknown) {
    super(message);
  }
}

function notImplemented(op: string, backendId: string): never {
  throw new HttpError(
    501,
    `Symbolic operation '${op}' is not yet implemented (backend: ${backendId})`,
    { op, backendId },
  );
}

// ─── Operation handlers (delegate to backend) ───────────────────────────────

function ok<T extends WireType, D>(type: T, data: D, status = 200): Response {
  return new Response(JSON.stringify(envelope(type, data)), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json' },
  });
}

function error(status: number, message: string, details?: unknown): Response {
  return new Response(
    JSON.stringify({ $schema: SCHEMA, type: 'error', data: { message, details } }),
    { status, headers: { ...corsHeaders, 'content-type': 'application/json' } },
  );
}

async function parseEnvelope<S extends z.ZodTypeAny>(
  req: Request,
  schema: S,
): Promise<z.infer<S>> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new HttpError(400, 'invalid JSON body');
  }
  const env = RequestEnvelope.safeParse(raw);
  if (!env.success) {
    throw new HttpError(400, 'invalid envelope', env.error.flatten());
  }
  const parsed = schema.safeParse(env.data.data);
  if (!parsed.success) {
    throw new HttpError(400, 'invalid request', parsed.error.flatten());
  }
  return parsed.data;
}

// ─── Routes ─────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const url = new URL(req.url);
  const path = url.pathname.replace(/^.*\/symbolic-api/, '') || '/';

  try {
    if (req.method === 'GET' && path === '/health') {
      return ok('scalar', { form: 'number', value: 1 });
    }

    if (req.method === 'GET' && path === '/backends') {
      return new Response(
        JSON.stringify(canonicalize({
          $schema: SCHEMA,
          type: 'backends',
          data: { backends: Object.values(BACKENDS) },
        })),
        { headers: { ...corsHeaders, 'content-type': 'application/json' } },
      );
    }

    if (req.method !== 'POST') {
      return error(405, `method not allowed: ${req.method}`);
    }

    switch (path) {
      case '/symbols': {
        const body = await parseEnvelope(req, SymbolReq);
        const backendId = resolveBackendId(body.backend);
        notImplemented('createSymbol', backendId);
      }
      case '/primitives': {
        const body = await parseEnvelope(req, PrimitiveReq);
        const backendId = resolveBackendId(body.backend);
        notImplemented('createPrimitive', backendId);
      }
      case '/expressions': {
        const body = await parseEnvelope(req, ExpressionReq);
        const backendId = resolveBackendId(body.backend);
        notImplemented('createExpression', backendId);
      }
      case '/solve': {
        const body = await parseEnvelope(req, SolveReq);
        const backendId = resolveBackendId(body.backend);
        notImplemented('solve', backendId);
      }
      case '/evaluate': {
        const body = await parseEnvelope(req, EvaluateReq);
        const backendId = resolveBackendId(body.backend);
        notImplemented('evaluate', backendId);
      }
      default:
        return error(404, `route not found: ${path}`);
    }
  } catch (e) {
    if (e instanceof HttpError) return error(e.status, e.message, e.details);
    const msg = e instanceof Error ? e.message : 'internal error';
    return error(500, msg);
  }
});
