/**
 * Field OS client — thin fetch wrapper over the Field Core Intelligence
 * HTTP API. Base URL is configured via `VITE_FIELD_OS_URL`; falls back
 * to the published Field OS Lovable preview if unset.
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

const DEFAULT_BASE =
  'https://preview--d49fa3ac-a383-4fec-b9a9-7a8d88266fe1.lovable.app';

export function getFieldOsBaseUrl(): string {
  const env = (import.meta as unknown as { env?: Record<string, string> }).env;
  const raw = env?.VITE_FIELD_OS_URL?.trim();
  return (raw && raw.length > 0 ? raw : DEFAULT_BASE).replace(/\/+$/, '');
}

async function post<TReq, TRes>(path: string, body: TReq, signal?: AbortSignal): Promise<TRes> {
  const url = `${getFieldOsBaseUrl()}${path}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    throw new FieldOsError(
      `Field OS unreachable at ${url}: ${(err as Error).message}`,
    );
  }
  const text = await res.text();
  if (!res.ok) {
    throw new FieldOsError(
      `Field OS ${path} failed (${res.status}): ${text.slice(0, 240)}`,
      res.status,
    );
  }
  try {
    return JSON.parse(text) as TRes;
  } catch {
    throw new FieldOsError(`Field OS ${path} returned non-JSON: ${text.slice(0, 240)}`);
  }
}

export const fieldOs = {
  baseUrl: getFieldOsBaseUrl,

  health: async (signal?: AbortSignal): Promise<FieldOsHealth> => {
    const url = `${getFieldOsBaseUrl()}/api/health`;
    const res = await fetch(url, { signal }).catch((err) => {
      throw new FieldOsError(`Field OS unreachable: ${(err as Error).message}`);
    });
    if (!res.ok) throw new FieldOsError(`Field OS health ${res.status}`, res.status);
    return (await res.json()) as FieldOsHealth;
  },

  eikonal: (req: EikonalRequest, signal?: AbortSignal) =>
    post<EikonalRequest, EikonalResponse>('/api/op/eikonal', req, signal),

  poisson: (req: PoissonRequest, signal?: AbortSignal) =>
    post<PoissonRequest, PoissonResponse>('/api/op/poisson', req, signal),

  laplacian: (req: LaplacianRequest, signal?: AbortSignal) =>
    post<LaplacianRequest, LaplacianResponse>('/api/op/laplacian', req, signal),
};

export type { EikonalRequest, EikonalResponse, PoissonRequest, PoissonResponse, LaplacianRequest, LaplacianResponse, FieldOsHealth };
export { FieldOsError };
