/**
 * Server-Sent Events streaming for topology iteration snapshots.
 *
 * Wire format (one event per iteration, throttled):
 *   event: iteration
 *   data: {"$schema":"lovable.topology/v1","type":"iteration","data":{ ...IterationSnapshot }}
 *
 * Terminal events:
 *   event: done   → final ComplianceResult
 *   event: error  → { message }
 *
 * The snapshot payload mirrors `TopoIterationState` from
 * src/lib/geometry/topology/types.ts (minus the `density` Float32Array,
 * which is not transport-friendly). The server simulates iterative
 * convergence by exponential decay from an initial compliance toward the
 * deterministic surrogate, so clients can wire and validate the live-update
 * pipeline before the real solver runs server-side.
 */

import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import {
  evaluateCompliance,
  type ComplianceRequest,
  type ComplianceResult,
} from './compliance.ts';

const SCHEMA = 'lovable.topology/v1' as const;

export interface IterationSnapshot {
  iteration: number;
  compliance: number;
  perCaseCompliance: number[];
  volumeFraction: number;
  change: number;
  elapsedMs: number;
}

export interface StreamOptions {
  /** Minimum ms between emitted iteration events (default 50, max 5000). */
  throttleMs?: number;
  /** Total iterations to simulate (default 50, max 500). */
  maxIterations?: number;
  /** Target volume fraction the simulated run converges toward (default 0.4). */
  volumeFraction?: number;
}

function sseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

export function streamHeaders(): HeadersInit {
  return {
    ...corsHeaders,
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    'x-accel-buffering': 'no',
    connection: 'keep-alive',
  };
}

/**
 * Build the SSE ReadableStream for a request. Pure-ish: uses setTimeout for
 * throttling but does not touch any global state. Aborts cleanly when the
 * client disconnects via `signal`.
 */
export function buildIterationStream(
  req: ComplianceRequest,
  opts: StreamOptions,
  signal?: AbortSignal,
): ReadableStream<Uint8Array> {
  const throttleMs = clamp(opts.throttleMs ?? 50, 0, 5000);
  const maxIterations = clamp(Math.floor(opts.maxIterations ?? 50), 1, 500);
  const targetVf = clamp(opts.volumeFraction ?? 0.4, 0.05, 1);

  const final: ComplianceResult = evaluateCompliance(req);
  const targetCompliance = final.aggregatedCompliance;
  const startCompliance = Math.max(targetCompliance * 8, targetCompliance + 1);

  const enc = new TextEncoder();
  let timer: number | undefined;
  let cancelled = false;

  return new ReadableStream<Uint8Array>({
    start(controller) {
      const startedAt = Date.now();

      const onAbort = () => {
        cancelled = true;
        if (timer !== undefined) clearTimeout(timer);
        try { controller.close(); } catch { /* already closed */ }
      };
      signal?.addEventListener('abort', onAbort, { once: true });

      // Initial open event lets clients confirm the channel before the first
      // throttled iteration arrives.
      controller.enqueue(enc.encode(sseEvent('open', envelope('open', {
        maxIterations, throttleMs, targetVolumeFraction: targetVf,
      }))));

      let i = 0;
      let prevCompliance = startCompliance;

      const tick = () => {
        if (cancelled) return;
        i += 1;
        // Exponential decay toward the surrogate target.
        const t = i / maxIterations;
        const decay = Math.exp(-3 * t);
        const compliance = targetCompliance + (startCompliance - targetCompliance) * decay;
        const perCase = final.perCaseCompliance.map(
          (c) => c + (c * 8 - c) * decay,
        );
        const change = Math.abs(prevCompliance - compliance) / Math.max(1e-9, prevCompliance);
        prevCompliance = compliance;
        const vf = 1 - (1 - targetVf) * (1 - decay);

        const snap: IterationSnapshot = {
          iteration: i,
          compliance,
          perCaseCompliance: perCase,
          volumeFraction: vf,
          change,
          elapsedMs: Date.now() - startedAt,
        };

        try {
          controller.enqueue(enc.encode(sseEvent('iteration', envelope('iteration', snap))));
        } catch {
          cancelled = true;
          return;
        }

        if (i >= maxIterations) {
          try {
            controller.enqueue(enc.encode(sseEvent('done', envelope('done', final))));
            controller.close();
          } catch { /* closed */ }
          return;
        }
        timer = setTimeout(tick, throttleMs) as unknown as number;
      };

      // Kick off — first iteration after one throttle tick so clients can
      // attach handlers between `open` and `iteration`.
      timer = setTimeout(tick, throttleMs) as unknown as number;
    },
    cancel() {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
    },
  });
}

function envelope<T>(type: string, data: T) {
  return { $schema: SCHEMA, type, data };
}
