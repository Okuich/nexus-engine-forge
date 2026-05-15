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

// Inlined CORS headers (avoid the `npm:` specifier here so this module is
// importable from vitest unit tests as well as Deno).
const corsHeaders: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': '*',
};
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
  /**
   * Downsampled density grid for live previews. Present on intermediate
   * iterations only; suppressed when `includeDensity === false`.
   * Layout: x-fastest, length = previewDims[0]*previewDims[1]*previewDims[2].
   */
  densityPreview?: number[];
  previewDims?: [number, number, number];
  /**
   * Full-resolution density grid. Emitted only on the FINAL iteration when
   * `includeDensity` is enabled, to keep intermediate payloads small.
   */
  density?: number[];
  dims?: [number, number, number];
  /** True on the last iteration of the run. */
  isFinal?: boolean;
}

export interface StreamOptions {
  /** Minimum ms between emitted iteration events (default 50, max 5000). */
  throttleMs?: number;
  /** Total iterations to simulate (default 50, max 500). */
  maxIterations?: number;
  /** Target volume fraction the simulated run converges toward (default 0.4). */
  volumeFraction?: number;
  /** Emit density data at all (default true). */
  includeDensity?: boolean;
  /** Edge length of the downsampled preview cube (default 8, range 2-16). */
  previewSize?: number;
  /** Edge length of the full density cube emitted on the final iteration (default 24, range 4-48). */
  fullSize?: number;
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

  const includeDensity = opts.includeDensity ?? true;
  const previewN = clamp(Math.floor(opts.previewSize ?? 8), 2, 16);
  const fullN = clamp(Math.floor(opts.fullSize ?? 24), 4, 48);

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

      controller.enqueue(enc.encode(sseEvent('open', envelope('open', {
        maxIterations,
        throttleMs,
        targetVolumeFraction: targetVf,
        includeDensity,
        previewDims: includeDensity ? [previewN, previewN, previewN] : undefined,
        finalDims: includeDensity ? [fullN, fullN, fullN] : undefined,
      }))));

      let i = 0;
      let prevCompliance = startCompliance;

      const tick = () => {
        if (cancelled) return;
        i += 1;
        const t = i / maxIterations;
        const decay = Math.exp(-3 * t);
        const compliance = targetCompliance + (startCompliance - targetCompliance) * decay;
        const perCase = final.perCaseCompliance.map((c) => c + (c * 8 - c) * decay);
        const change = Math.abs(prevCompliance - compliance) / Math.max(1e-9, prevCompliance);
        prevCompliance = compliance;
        const vf = 1 - (1 - targetVf) * (1 - decay);
        const isFinal = i >= maxIterations;

        const snap: IterationSnapshot = {
          iteration: i,
          compliance,
          perCaseCompliance: perCase,
          volumeFraction: vf,
          change,
          elapsedMs: Date.now() - startedAt,
          isFinal,
        };

        if (includeDensity) {
          if (isFinal) {
            // Full-resolution density only on the final iteration to keep
            // intermediate payloads small.
            snap.density = synthesizeDensity(fullN, vf, decay);
            snap.dims = [fullN, fullN, fullN];
          } else {
            snap.densityPreview = synthesizeDensity(previewN, vf, decay);
            snap.previewDims = [previewN, previewN, previewN];
          }
        }

        try {
          controller.enqueue(enc.encode(sseEvent('iteration', envelope('iteration', snap))));
        } catch {
          cancelled = true;
          return;
        }

        if (isFinal) {
          try {
            controller.enqueue(enc.encode(sseEvent('done', envelope('done', final))));
            controller.close();
          } catch { /* closed */ }
          return;
        }
        timer = setTimeout(tick, throttleMs) as unknown as number;
      };

      timer = setTimeout(tick, throttleMs) as unknown as number;
    },
    cancel() {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
    },
  });
}

/**
 * Cheap deterministic density field for previews: a soft-edged sphere whose
 * average density tracks `targetVf`, modulated by `decay` to look like a
 * converging SIMP run. Values quantized to 3 decimals to keep payloads tight.
 */
function synthesizeDensity(n: number, targetVf: number, decay: number): number[] {
  const out = new Array<number>(n * n * n);
  const c = (n - 1) / 2;
  // Pick a radius so the sphere volume ≈ targetVf * n^3.
  const r = Math.cbrt((3 / (4 * Math.PI)) * targetVf) * n;
  const edge = Math.max(0.5, n * 0.08);
  let idx = 0;
  for (let z = 0; z < n; z++) {
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++, idx++) {
        const d = Math.hypot(x - c, y - c, z - c);
        const sharp = clamp(0.5 + (r - d) / edge, 0, 1);
        // Early iterations are mushy (decay≈1 → blend toward targetVf);
        // late iterations crisp toward the sphere.
        const v = sharp * (1 - decay) + targetVf * decay;
        out[idx] = Math.round(v * 1000) / 1000;
      }
    }
  }
  return out;
}

function envelope<T>(type: string, data: T) {
  return { $schema: SCHEMA, type, data };
}
