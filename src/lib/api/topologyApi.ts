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
