/**
 * Client wrapper for the topology-api edge function.
 *
 * Mirrors the multi-load-case inputs consumed by `runSIMP` so a caller can
 * obtain `perCaseCompliance` (and the aggregated objective) without having
 * to spin up the full optimizer locally. Speaks both the REST envelope
 * (`POST /compliance`) and the GraphQL endpoint (`POST /graphql`).
 */
import { supabase } from '@/integrations/supabase/client';
import type { LoadCase, LoadCaseAggregation, SupportCondition } from '@/lib/geometry/topology/types';

const FUNCTION = 'topology-api';
export const TOPOLOGY_WIRE_VERSION = 'lovable.topology/v1' as const;

export interface ComplianceRequest {
  loadCases: LoadCase[];
  loadCaseAggregation?: LoadCaseAggregation;
  ksRho?: number;
  supports?: SupportCondition[];
}

export interface PerCaseEntry {
  name: string;
  weight: number;
  compliance: number;
}

export interface ComplianceResponse {
  perCaseCompliance: number[];
  perCase: PerCaseEntry[];
  loadCaseAggregation: LoadCaseAggregation;
  ksRho?: number;
  aggregatedCompliance: number;
  surrogate: boolean;
}

export class TopologyApiError extends Error {
  constructor(public readonly status: number, message: string, public readonly details?: unknown) {
    super(message);
    this.name = 'TopologyApiError';
  }
}

function endpoint(path: string): string {
  const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
  return `https://${projectId}.supabase.co/functions/v1/${FUNCTION}${path}`;
}

async function authHeader(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { authorization: `Bearer ${token}` } : {};
}

/** Call the REST endpoint. Returns `perCaseCompliance` + aggregated value. */
export async function evaluateCompliance(
  req: ComplianceRequest,
  options: { signal?: AbortSignal } = {},
): Promise<ComplianceResponse> {
  const res = await fetch(endpoint('/compliance'), {
    method: 'POST',
    signal: options.signal,
    headers: { 'content-type': 'application/json', ...(await authHeader()) },
    body: JSON.stringify({ $schema: TOPOLOGY_WIRE_VERSION, data: req }),
  });
  let payload: unknown = null;
  try { payload = await res.json(); } catch { /* keep null */ }
  if (!res.ok) {
    const err = (payload as { data?: { message?: string; details?: unknown } } | null)?.data;
    throw new TopologyApiError(res.status, err?.message ?? `HTTP ${res.status}`, err?.details);
  }
  const data = (payload as { data: ComplianceResponse }).data;
  return data;
}

/** Call the GraphQL endpoint with the same logical inputs. */
export async function evaluateComplianceGraphQL(
  req: ComplianceRequest,
  options: { signal?: AbortSignal } = {},
): Promise<ComplianceResponse> {
  const query = `
    mutation Compliance(
      $loadCases: [LoadCaseInput!]!,
      $loadCaseAggregation: String,
      $ksRho: Float,
      $supports: [SupportInput!],
    ) {
      compliance(
        loadCases: $loadCases,
        loadCaseAggregation: $loadCaseAggregation,
        ksRho: $ksRho,
        supports: $supports,
      ) {
        perCaseCompliance
        perCase { name weight compliance }
        loadCaseAggregation
        ksRho
        aggregatedCompliance
        surrogate
      }
    }
  `;
  const res = await fetch(endpoint('/graphql'), {
    method: 'POST',
    signal: options.signal,
    headers: { 'content-type': 'application/json', ...(await authHeader()) },
    body: JSON.stringify({ query, variables: req }),
  });
  const payload = await res.json() as {
    data?: { compliance: ComplianceResponse };
    errors?: Array<{ message: string; extensions?: unknown }>;
  };
  if (!res.ok || payload.errors?.length) {
    const first = payload.errors?.[0];
    throw new TopologyApiError(res.status, first?.message ?? `HTTP ${res.status}`, first?.extensions);
  }
  return payload.data!.compliance;
}

// ─── Streaming (SSE) ───────────────────────────────────────────────────────

export interface IterationSnapshot {
  iteration: number;
  compliance: number;
  perCaseCompliance: number[];
  volumeFraction: number;
  change: number;
  elapsedMs: number;
}

export interface StreamComplianceOptions {
  /** Minimum ms between iteration events (server-side throttle). */
  throttleMs?: number;
  /** Total simulated iterations (1-500). */
  maxIterations?: number;
  /** Target volume fraction the simulated run converges toward. */
  volumeFraction?: number;
  signal?: AbortSignal;
  onOpen?: (info: { maxIterations: number; throttleMs: number; targetVolumeFraction: number }) => void;
  onIteration?: (snap: IterationSnapshot) => void;
  onError?: (err: Error) => void;
}

/**
 * Stream `IterationSnapshot` updates over SSE. Resolves with the final
 * `ComplianceResponse` when the server emits `done`.
 *
 * Implementation note: uses fetch + ReadableStream rather than EventSource
 * so we can POST the request body and forward the auth header.
 */
export async function streamCompliance(
  req: ComplianceRequest,
  options: StreamComplianceOptions = {},
): Promise<ComplianceResponse> {
  const { signal, onOpen, onIteration, onError, ...streamOpts } = options;
  const res = await fetch(endpoint('/stream'), {
    method: 'POST',
    signal,
    headers: { 'content-type': 'application/json', accept: 'text/event-stream', ...(await authHeader()) },
    body: JSON.stringify({ $schema: TOPOLOGY_WIRE_VERSION, data: { ...req, ...streamOpts } }),
  });
  if (!res.ok || !res.body) {
    let detail: unknown = undefined;
    try { detail = await res.json(); } catch { /* ignore */ }
    throw new TopologyApiError(res.status, `stream failed: HTTP ${res.status}`, detail);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let final: ComplianceResponse | null = null;

  const handleEvent = (event: string, data: string) => {
    let parsed: { data?: unknown } = {};
    try { parsed = JSON.parse(data) as { data?: unknown }; } catch { return; }
    const payload = parsed.data ?? parsed;
    if (event === 'open') onOpen?.(payload as never);
    else if (event === 'iteration') onIteration?.(payload as IterationSnapshot);
    else if (event === 'done') final = payload as ComplianceResponse;
    else if (event === 'error') onError?.(new Error((payload as { message?: string })?.message ?? 'stream error'));
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let sep: number;
    // SSE messages are separated by a blank line.
    while ((sep = buffer.indexOf('\n\n')) >= 0) {
      const block = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      let event = 'message';
      const dataLines: string[] = [];
      for (const line of block.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
      }
      if (dataLines.length) handleEvent(event, dataLines.join('\n'));
    }
  }
  if (!final) throw new TopologyApiError(0, 'stream ended before done event');
  return final;
}
