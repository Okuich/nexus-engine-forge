/**
 * Topology Iteration Preview API — async-iterator wrapper around SIMP that
 * streams per-iteration density, compliance, and constraint metrics suitable
 * for live optimization previews.
 *
 * Designed for the browser (the SIMP engine is a client module). The API
 * supports:
 *   • `streamSIMP()` — AsyncGenerator yielding `IterationSnapshot`s
 *   • `subscribeSIMP()` — callback style with disposer
 *   • `AbortSignal` cancellation
 *   • Optional density downsampling for cheap UI previews
 *   • Throttling (skip every Nth iteration to bound network/render cost)
 *
 * Snapshots are intentionally JSON-friendly: `density` is a `Float32Array`,
 * but `densityPreview` is a plain `number[]` you can ship to a worker, edge
 * function, or websocket without copying.
 */
import type {
  LoadCondition,
  SupportCondition,
  TopoIterationState,
  TopoOptimizerOptions,
} from '@/lib/geometry/topology/types';
import type { VoxelDomain } from '@/lib/geometry/topology/voxelizer';
import { runSIMP } from '@/lib/geometry/topology/simp';

export interface IterationSnapshot {
  iteration: number;
  /** Aggregated compliance under the chosen aggregation strategy. */
  compliance: number;
  /** Per-load-case compliance breakdown. */
  perCaseCompliance?: number[];
  /** Achieved volume fraction at this iteration. */
  volumeFraction: number;
  /** Max abs density delta from previous iteration (convergence proxy). */
  change: number;
  /** Wall-clock elapsed since stream start (ms). */
  elapsedMs: number;
  /** Full-resolution density (zero-copy Float32Array). */
  density: Float32Array;
  /** Optional downsampled density preview (`number[]`, JSON-safe). */
  densityPreview?: number[];
  /** Dimensions of `densityPreview` (set when downsampling is enabled). */
  previewDims?: [number, number, number];
  /** Constraint-penalty diagnostics if penalties are enabled. */
  constraints?: {
    overhangViolations: number;
    minFeatureViolations: number;
    stressViolations: number;
  };
}

export interface StreamOptions {
  /** Cancel the run. The generator/subscription stops at the next iteration. */
  signal?: AbortSignal;
  /** Emit every Nth iteration (default 1 = every iteration). */
  throttle?: number;
  /** Downsample density to a coarser grid for cheap previews. */
  preview?: {
    /** Target voxel count along the longest axis. Default 24. */
    maxAxis?: number;
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function mapDiagnostics(
  d: TopoIterationState['penaltyDiagnostics'],
): IterationSnapshot['constraints'] {
  if (!d) return undefined;
  return {
    overhangViolations: d.overhangViolations,
    minFeatureViolations: d.minFeatureViolations,
    stressViolations: d.stressViolations,
  };
}

/**
 * Box-average downsample a 3D density field to a coarser grid suitable for
 * streaming previews. Returns a plain `number[]` so it round-trips through
 * JSON.stringify without typed-array serialization quirks.
 */
export function downsampleDensity(
  density: Float32Array,
  dims: [number, number, number],
  maxAxis: number,
): { values: number[]; dims: [number, number, number] } {
  const [nx, ny, nz] = dims;
  const longest = Math.max(nx, ny, nz);
  if (longest <= maxAxis) {
    return { values: Array.from(density), dims: [nx, ny, nz] };
  }
  const scale = maxAxis / longest;
  const ox = Math.max(1, Math.round(nx * scale));
  const oy = Math.max(1, Math.round(ny * scale));
  const oz = Math.max(1, Math.round(nz * scale));
  const out = new Array<number>(ox * oy * oz);
  for (let k = 0; k < oz; k++) {
    const k0 = Math.floor((k * nz) / oz);
    const k1 = Math.max(k0 + 1, Math.floor(((k + 1) * nz) / oz));
    for (let j = 0; j < oy; j++) {
      const j0 = Math.floor((j * ny) / oy);
      const j1 = Math.max(j0 + 1, Math.floor(((j + 1) * ny) / oy));
      for (let i = 0; i < ox; i++) {
        const i0 = Math.floor((i * nx) / ox);
        const i1 = Math.max(i0 + 1, Math.floor(((i + 1) * nx) / ox));
        let sum = 0;
        let n = 0;
        for (let kk = k0; kk < k1; kk++) {
          for (let jj = j0; jj < j1; jj++) {
            for (let ii = i0; ii < i1; ii++) {
              sum += density[ii + nx * (jj + ny * kk)];
              n++;
            }
          }
        }
        out[i + ox * (j + oy * k)] = n > 0 ? sum / n : 0;
      }
    }
  }
  return { values: out, dims: [ox, oy, oz] };
}

function toSnapshot(
  state: TopoIterationState,
  dims: [number, number, number],
  preview: StreamOptions['preview'] | undefined,
): IterationSnapshot {
  const snap: IterationSnapshot = {
    iteration: state.iteration,
    compliance: state.compliance,
    perCaseCompliance: state.perCaseCompliance?.slice(),
    volumeFraction: state.volumeFraction,
    change: state.change,
    elapsedMs: state.elapsedMs,
    density: state.density,
    constraints: mapDiagnostics(state.penaltyDiagnostics),
  };
  if (preview) {
    const ds = downsampleDensity(state.density, dims, preview.maxAxis ?? 24);
    snap.densityPreview = ds.values;
    snap.previewDims = ds.dims;
  }
  return snap;
}

// ─── Subscribe (callback) API ─────────────────────────────────────────────

export interface SimpRunResultDTO {
  density: Float32Array;
  compliance: number;
  perCaseCompliance: number[];
  iterations: number;
  converged: boolean;
  history: number[];
  /** True if the run was stopped early via AbortSignal. */
  cancelled?: boolean;
}

/**
 * Sentinel thrown from `onIteration` to break out of the synchronous SIMP
 * loop the moment cancellation is requested. `runSIMP` doesn't know about
 * AbortSignal, so we hijack the per-iteration callback it already invokes —
 * throwing here unwinds the stack out of `runSIMP` immediately.
 */
class SimpCancelled extends Error {
  constructor() { super('SIMP cancelled'); this.name = 'SimpCancelled'; }
}

export function subscribeSIMP(
  domain: VoxelDomain,
  loads: LoadCondition[],
  supports: SupportCondition[],
  options: TopoOptimizerOptions,
  onSnapshot: (snap: IterationSnapshot) => void,
  streamOptions: StreamOptions = {},
): { promise: Promise<SimpRunResultDTO>; cancel: () => void } {
  const throttle = Math.max(1, streamOptions.throttle ?? 1);
  let cancelled = streamOptions.signal?.aborted ?? false;
  // Track the latest observed state so a cancellation can resolve with a
  // meaningful partial result instead of throwing data away.
  let lastState: TopoIterationState | null = null;
  const history: number[] = [];

  const cancel = () => { cancelled = true; };
  if (streamOptions.signal && !cancelled) {
    streamOptions.signal.addEventListener('abort', cancel, { once: true });
  }

  const userOnIter = options.onIteration;
  const merged: TopoOptimizerOptions = {
    ...options,
    onIteration: (state) => {
      userOnIter?.(state);
      lastState = state;
      history.push(state.compliance);
      if (!cancelled && (state.iteration % throttle) === 0) {
        onSnapshot(toSnapshot(state, domain.dims, streamOptions.preview));
      }
      // Abort *after* surfacing the snapshot so consumers see the iteration
      // they just paid for. Throw a typed sentinel to unwind runSIMP now.
      if (cancelled) throw new SimpCancelled();
    },
  };

  const promise = new Promise<SimpRunResultDTO>((resolve, reject) => {
    if (cancelled) {
      // Pre-aborted: skip the run entirely.
      resolve({
        density: new Float32Array(domain.dims[0] * domain.dims[1] * domain.dims[2]),
        compliance: Infinity,
        perCaseCompliance: [],
        iterations: 0,
        converged: false,
        history: [],
        cancelled: true,
      });
      return;
    }
    try {
      const r = runSIMP(domain, loads, supports, merged);
      resolve({
        density: r.density,
        compliance: r.compliance,
        perCaseCompliance: r.perCaseCompliance,
        iterations: r.iterations,
        converged: r.converged,
        history: r.history,
        cancelled: false,
      });
    } catch (e) {
      if (e instanceof SimpCancelled) {
        const last = lastState;
        resolve({
          density: last
            ? new Float32Array(last.density)
            : new Float32Array(domain.dims[0] * domain.dims[1] * domain.dims[2]),
          compliance: last?.compliance ?? Infinity,
          perCaseCompliance: last?.perCaseCompliance?.slice() ?? [],
          iterations: last ? last.iteration + 1 : 0,
          converged: false,
          history,
          cancelled: true,
        });
      } else reject(e);
    }
  });

  return { promise, cancel };
}

// ─── Async-iterator API ───────────────────────────────────────────────────

/**
 * Stream per-iteration snapshots via AsyncGenerator. The generator yields
 * each snapshot in order and finally returns the run result. Cancellation
 * via `signal` stops the underlying SIMP run on the next iteration boundary
 * (via a thrown sentinel inside the run callback).
 */
export async function* streamSIMP(
  domain: VoxelDomain,
  loads: LoadCondition[],
  supports: SupportCondition[],
  options: TopoOptimizerOptions,
  streamOptions: StreamOptions = {},
): AsyncGenerator<IterationSnapshot, SimpRunResultDTO, void> {
  const queue: IterationSnapshot[] = [];
  let waiter: (() => void) | null = null;
  let done = false;
  let result: SimpRunResultDTO | null = null;
  let error: unknown = null;

  const wake = () => { const w = waiter; waiter = null; w?.(); };

  const { promise, cancel } = subscribeSIMP(
    domain, loads, supports, options,
    (snap) => { queue.push(snap); wake(); },
    streamOptions,
  );

  // Forward external aborts directly to the underlying run.
  if (streamOptions.signal) {
    if (streamOptions.signal.aborted) cancel();
    else streamOptions.signal.addEventListener('abort', () => { cancel(); wake(); }, { once: true });
  }

  promise.then(
    (r) => { result = r; done = true; wake(); },
    (e) => { error = e; done = true; wake(); },
  );

  while (true) {
    while (queue.length > 0) yield queue.shift()!;
    if (done) break;
    await new Promise<void>((r) => { waiter = r; });
  }

  if (error) throw error;
  if (!result) throw new Error('SIMP stream ended without result');
  return result;
}

// ─── Pure helpers (exported for tests/UI) ─────────────────────────────────

export const __test = { downsampleDensity };
