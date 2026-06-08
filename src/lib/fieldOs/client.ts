/**
 * Field OS client — thin fetch wrapper over the Field Core Intelligence
 * HTTP API. Base URL comes from `VITE_FIELD_OS_URL`.
 *
 * Endpoints (TanStack Start API routes):
 *   POST  {base}/api/op/eikonal
 *   POST  {base}/api/op/poisson
 *   POST  {base}/api/op/laplacian
 *   GET   {base}/api/health
 */

import {
  FieldOsError,
  type EikonalRequest,
  type EikonalResponse,
  type FieldOsHealth,
  type LaplacianRequest,
  type LaplacianResponse,
  type PoissonRequest,
  type PoissonResponse,
} from './types';

const HEALTH_TIMEOUT_MS = 6000;
const OP_TIMEOUT_MS = 30000;

export type FieldOsConfigStatus =
  | { ok: true; baseUrl: string }
  | { ok: false; reason: 'missing' | 'invalid'; message: string; raw?: string };

/** Inspect the configured base URL without throwing. */
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
  if (!cfg.ok) { const m = cfg.message; throw new FieldOsError(m); }
  return cfg.baseUrl;
}

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

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number, externalSignal?: AbortSignal) {
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

async function post<TReq, TRes>(path: string, body: TReq, signal?: AbortSignal): Promise<TRes> {
  const cfg = getFieldOsConfig();
  if (!cfg.ok) { const m = cfg.message; throw new FieldOsError(m); }
  const url = `${cfg.baseUrl}${path}`;
  let res: Response;
  try {
    res = await fetchWithTimeout(
      url,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(body),
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
          : res.status >= 500
            ? ' — server error. Check Field OS logs.'
            : '';
    throw new FieldOsError(
      `Field OS ${path} failed (${res.status})${hint}: ${text.slice(0, 240)}`,
      res.status,
    );
  }
  try {
    return JSON.parse(text) as TRes;
  } catch {
    throw new FieldOsError(
      `Field OS ${path} returned non-JSON (got "${text.slice(0, 80)}…"). ` +
        `This usually means the URL points at the SPA shell instead of the API.`,
    );
  }
}

export const fieldOs = {
  config: getFieldOsConfig,
  baseUrl: getFieldOsBaseUrl,

  health: async (signal?: AbortSignal): Promise<FieldOsHealth> => {
    const cfg = getFieldOsConfig();
    if (!cfg.ok) { const m = cfg.message; throw new FieldOsError(m); }
    const url = `${cfg.baseUrl}/api/health`;
    let res: Response;
    try {
      res = await fetchWithTimeout(url, { headers: { accept: 'application/json' } }, HEALTH_TIMEOUT_MS, signal);
    } catch (err) {
      throw new FieldOsError(describeFetchError(url, err));
    }
    if (!res.ok) {
      throw new FieldOsError(
        `Field OS health check failed (${res.status}). ` +
          `Verify /api/health is deployed at ${cfg.baseUrl}.`,
        res.status,
      );
    }
    const text = await res.text();
    try {
      return JSON.parse(text) as FieldOsHealth;
    } catch {
      throw new FieldOsError(
        `Field OS /api/health returned non-JSON. The URL likely points at the SPA shell, not the API.`,
      );
    }
  },

  eikonal: (req: EikonalRequest, signal?: AbortSignal) =>
    post<EikonalRequest, EikonalResponse>('/api/op/eikonal', req, signal),

  poisson: (req: PoissonRequest, signal?: AbortSignal) =>
    post<PoissonRequest, PoissonResponse>('/api/op/poisson', req, signal),

  laplacian: (req: LaplacianRequest, signal?: AbortSignal) =>
    post<LaplacianRequest, LaplacianResponse>('/api/op/laplacian', req, signal),
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
