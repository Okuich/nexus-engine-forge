/**
 * Field OS client — thin fetch wrapper over the Field Core Intelligence
 * HTTP API with Zod-validated requests and responses.
 *
 * Base URL comes from `VITE_FIELD_OS_URL`.
 *
 * Endpoints (TanStack Start API routes):
 *   POST  {base}/api/op/eikonal
 *   POST  {base}/api/op/poisson
 *   POST  {base}/api/op/laplacian
 *   GET   {base}/api/health
 */

import type { z, ZodTypeAny } from 'zod';
import { FieldOsError } from './types';
import {
  EikonalRequestSchema,
  EikonalResponseSchema,
  FieldOsHealthSchema,
  LaplacianRequestSchema,
  LaplacianResponseSchema,
  PoissonRequestSchema,
  PoissonResponseSchema,
  type EikonalRequest,
  type EikonalResponse,
  type FieldOsHealth,
  type LaplacianRequest,
  type LaplacianResponse,
  type PoissonRequest,
  type PoissonResponse,
} from './schemas';

const HEALTH_TIMEOUT_MS = 6000;
const OP_TIMEOUT_MS = 30000;

// ── Config ──────────────────────────────────────────────────────
export type FieldOsConfigStatus =
  | { ok: true; baseUrl: string }
  | { ok: false; reason: 'missing' | 'invalid'; message: string; raw?: string };

type BadCfg = Extract<FieldOsConfigStatus, { ok: false }>;

export function getFieldOsConfig(): FieldOsConfigStatus {
  const env = (import.meta as unknown as { env?: Record<string, string> }).env;
  const raw = env?.VITE_FIELD_OS_URL?.trim();
  if (!raw) {
    return {
      ok: false,
      reason: 'missing',
      message:
        'VITE_FIELD_OS_URL is not set. Add it to your environment, e.g. ' +
        'VITE_FIELD_OS_URL="https://<your-field-os-deployment>".',
    };
  }
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return {
      ok: false,
      reason: 'invalid',
      raw,
      message: `VITE_FIELD_OS_URL is not a valid URL: "${raw}". Expected an absolute http(s) URL.`,
    };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return {
      ok: false,
      reason: 'invalid',
      raw,
      message: `VITE_FIELD_OS_URL must use http(s); got "${parsed.protocol}".`,
    };
  }
  return { ok: true, baseUrl: raw.replace(/\/+$/, '') };
}

export function getFieldOsBaseUrl(): string {
  const cfg = getFieldOsConfig();
  if (cfg.ok !== true) throw new FieldOsError((cfg as BadCfg).message);
  return cfg.baseUrl;
}

// ── Helpers ─────────────────────────────────────────────────────
function describeFetchError(url: string, err: unknown): string {
  const msg = (err as Error)?.message ?? String(err);
  if ((err as Error)?.name === 'AbortError') {
    return `Field OS request timed out at ${url}. The deployment may be cold-starting or unreachable.`;
  }
  if (/failed to fetch|networkerror|load failed/i.test(msg)) {
    return (
      `Field OS unreachable at ${url}. ` +
      `Check that the deployment is live, that VITE_FIELD_OS_URL is correct, ` +
      `and that the server allows CORS from this origin.`
    );
  }
  return `Field OS request failed at ${url}: ${msg}`;
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  externalSignal?: AbortSignal,
) {
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  externalSignal?.addEventListener('abort', onAbort);
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener('abort', onAbort);
  }
}

function validate<S extends ZodTypeAny>(
  schema: S,
  value: unknown,
  context: string,
): z.infer<S> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => ({
      path: i.path as (string | number)[],
      message: i.message,
    }));
    const preview = issues
      .slice(0, 3)
      .map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`)
      .join('; ');
    throw new FieldOsError(
      `${context} failed schema validation: ${preview}${issues.length > 3 ? ` (+${issues.length - 3} more)` : ''}`,
      { issues },
    );
  }
  return parsed.data as z.infer<S>;
}

// ── Core POST with validation ───────────────────────────────────
async function postValidated<TReqSchema extends ZodTypeAny, TResSchema extends ZodTypeAny>(
  path: string,
  reqSchema: TReqSchema,
  resSchema: TResSchema,
  body: z.input<TReqSchema>,
  signal?: AbortSignal,
): Promise<z.infer<TResSchema>> {
  const cfg = getFieldOsConfig();
  if (cfg.ok !== true) throw new FieldOsError((cfg as BadCfg).message);

  const validatedBody = validate(reqSchema, body, `${path} request`);

  const url = `${cfg.baseUrl}${path}`;
  let res: Response;
  try {
    res = await fetchWithTimeout(
      url,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(validatedBody),
      },
      OP_TIMEOUT_MS,
      signal,
    );
  } catch (err) {
    throw new FieldOsError(describeFetchError(url, err));
  }

  const text = await res.text();
  if (!res.ok) {
    const hint =
      res.status === 404
        ? ` — endpoint not found. Make sure ${path} is deployed in Field OS.`
        : res.status === 405
          ? ' — method not allowed. The route exists but does not accept POST.'
          : res.status === 422 || res.status === 400
            ? ' — Field OS rejected the request payload.'
            : res.status >= 500
              ? ' — server error. Check Field OS logs.'
              : '';
    throw new FieldOsError(
      `Field OS ${path} failed (${res.status})${hint}: ${text.slice(0, 240)}`,
      { status: res.status },
    );
  }

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new FieldOsError(
      `Field OS ${path} returned non-JSON (got "${text.slice(0, 80)}…"). ` +
        `This usually means the URL points at the SPA shell instead of the API.`,
    );
  }
  return validate(resSchema, json, `${path} response`);
}

// ── Public API ──────────────────────────────────────────────────
export const fieldOs = {
  config: getFieldOsConfig,
  baseUrl: getFieldOsBaseUrl,

  health: async (signal?: AbortSignal): Promise<FieldOsHealth> => {
    const cfg = getFieldOsConfig();
    if (cfg.ok !== true) throw new FieldOsError((cfg as BadCfg).message);
    const url = `${cfg.baseUrl}/api/health`;
    let res: Response;
    try {
      res = await fetchWithTimeout(
        url,
        { headers: { accept: 'application/json' } },
        HEALTH_TIMEOUT_MS,
        signal,
      );
    } catch (err) {
      throw new FieldOsError(describeFetchError(url, err));
    }
    if (!res.ok) {
      throw new FieldOsError(
        `Field OS health check failed (${res.status}). ` +
          `Verify /api/health is deployed at ${cfg.baseUrl}.`,
        { status: res.status },
      );
    }
    const text = await res.text();
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new FieldOsError(
        `Field OS /api/health returned non-JSON. The URL likely points at the SPA shell, not the API.`,
      );
    }
    return validate(FieldOsHealthSchema, json, '/api/health response');
  },

  eikonal: (req: EikonalRequest, signal?: AbortSignal) =>
    postValidated('/api/op/eikonal', EikonalRequestSchema, EikonalResponseSchema, req, signal),

  poisson: (req: PoissonRequest, signal?: AbortSignal) =>
    postValidated('/api/op/poisson', PoissonRequestSchema, PoissonResponseSchema, req, signal),

  laplacian: (req: LaplacianRequest, signal?: AbortSignal) =>
    postValidated('/api/op/laplacian', LaplacianRequestSchema, LaplacianResponseSchema, req, signal),
};

export type {
  EikonalRequest,
  EikonalResponse,
  PoissonRequest,
  PoissonResponse,
  LaplacianRequest,
  LaplacianResponse,
  FieldOsHealth,
};
export { FieldOsError };
