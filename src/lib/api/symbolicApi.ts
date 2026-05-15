/**
 * Client wrapper for the symbolic-api edge function.
 *
 * Provides a typed surface that mirrors `SymbolicEngine` but routes calls
 * to the deployed REST endpoint. All payloads use the shared
 * `lovable.symbolic/v1` envelope from `src/lib/geometry/symbolic/serialization`
 * so the client and server speak the exact same wire format.
 *
 * Backends listed by `/backends` may include unimplemented stubs — calls
 * targeting them surface `SymbolicApiError` with status 501.
 */

import { supabase } from '@/integrations/supabase/client';
import {
  SYMBOLIC_WIRE_VERSION,
  decodeExpr,
  decodePrimitive,
  decodeScalar,
  decodeSolveOutcome,
  encodeBinding,
  encodeConstraint,
  encodeExpr,
  toEnvelope,
} from '@/lib/geometry/symbolic/serialization';
import type {
  SolveOutcome,
  SymbolBinding,
  Symbol as SymbolicSymbol,
  SymbolicConstraint,
  SymbolicExpr,
  SymbolicPrimitive,
  SymbolicPrimitiveKind,
  SymbolicScalar,
} from '@/lib/geometry/symbolic/types';

const FUNCTION = 'symbolic-api';

export interface SymbolicBackendInfo {
  id: string;
  version: string;
  capabilities: Record<string, unknown>;
}

export class SymbolicApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'SymbolicApiError';
  }
}

interface CallOptions {
  /** Force a specific backend by id (server-side registry). */
  backend?: string;
  /** Optional abort signal for in-flight cancellation. */
  signal?: AbortSignal;
}

async function call(path: string, method: 'GET' | 'POST', body?: unknown): Promise<unknown> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
  const url = `https://${projectId}.supabase.co/functions/v1/${FUNCTION}${path}`;

  const res = await fetch(url, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  let parsed: unknown = null;
  try { parsed = await res.json(); } catch { /* keep null */ }

  if (!res.ok) {
    const msg = (parsed as { data?: { message?: string } } | null)?.data?.message
      ?? `symbolic-api request failed (${res.status})`;
    throw new SymbolicApiError(res.status, msg, parsed);
  }
  return parsed;
}

function wrap<T>(data: T, backend?: string) {
  return { $schema: SYMBOLIC_WIRE_VERSION, data: backend ? { ...data, backend } : data };
}

// ─── Public API ─────────────────────────────────────────────────────────────

export const symbolicApi = {
  async listBackends(): Promise<readonly SymbolicBackendInfo[]> {
    const r = await call('/backends', 'GET') as { data?: { backends?: SymbolicBackendInfo[] } };
    return r?.data?.backends ?? [];
  },

  async createSymbol(symbol: SymbolicSymbol, opts?: CallOptions): Promise<SymbolicSymbol> {
    const r = await call('/symbols', 'POST', wrap({ symbol }, opts?.backend));
    // Server currently returns the symbol back; treated as opaque.
    return ((r as { data?: SymbolicSymbol })?.data ?? symbol);
  },

  async createPrimitive(
    kind: SymbolicPrimitiveKind,
    spec: Record<string, unknown>,
    opts?: CallOptions,
  ): Promise<SymbolicPrimitive> {
    const r = await call('/primitives', 'POST', wrap({ kind, spec }, opts?.backend));
    return decodePrimitive((r as { data: unknown }).data);
  },

  async createExpression(
    source: string | Record<string, unknown>,
    opts?: CallOptions,
  ): Promise<SymbolicExpr> {
    const r = await call('/expressions', 'POST', wrap({ source }, opts?.backend));
    return decodeExpr((r as { data: unknown }).data);
  },

  async solve(
    symbols: readonly SymbolicSymbol[],
    constraints: readonly SymbolicConstraint[],
    initialGuess?: readonly SymbolBinding[],
    opts?: CallOptions,
  ): Promise<SolveOutcome> {
    const payload = {
      symbols,
      constraints: constraints.map(encodeConstraint),
      ...(initialGuess ? { initialGuess: initialGuess.map(encodeBinding) } : {}),
    };
    const r = await call('/solve', 'POST', wrap(payload, opts?.backend));
    return decodeSolveOutcome((r as { data: unknown }).data);
  },

  async evaluate(
    expression: SymbolicExpr,
    bindings: readonly SymbolBinding[],
    opts?: CallOptions,
  ): Promise<SymbolicScalar> {
    const r = await call('/evaluate', 'POST', wrap(
      { expression: encodeExpr(expression), bindings: bindings.map(encodeBinding) },
      opts?.backend,
    ));
    return decodeScalar((r as { data: unknown }).data);
  },

  // Re-export envelope builders for callers that need to send raw values.
  envelope: toEnvelope,
};

export type SymbolicApi = typeof symbolicApi;
