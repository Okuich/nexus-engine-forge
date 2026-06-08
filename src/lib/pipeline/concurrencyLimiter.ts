/**
 * Generic in-flight concurrency limiter.
 *
 * Bounds the number of simultaneously running async tasks so batch
 * operations (e.g. a full-scan over many uploaded CAD files) cannot
 * saturate the browser main thread, worker pool, or remote APIs.
 *
 * Usage:
 *   const limit = createLimiter(4);
 *   const results = await Promise.all(items.map((it) => limit(() => work(it))));
 *
 * Features:
 *   • FIFO scheduling, no starvation
 *   • Resolves/rejects exactly when the wrapped task does
 *   • `pending()` and `active()` for live telemetry
 *   • `setConcurrency(n)` for dynamic tuning (drains or releases slots)
 */

export type LimitedFn = <T>(task: () => Promise<T> | T) => Promise<T>;

export interface Limiter extends LimitedFn {
  /** Tasks currently executing (≤ concurrency). */
  active(): number;
  /** Tasks queued waiting for a slot. */
  pending(): number;
  /** Current concurrency cap. */
  concurrency(): number;
  /** Adjust cap at runtime. New slots are drained immediately. */
  setConcurrency(n: number): void;
  /** Resolves when every currently scheduled task has settled. */
  idle(): Promise<void>;
}

export function createLimiter(concurrency: number): Limiter {
  if (!Number.isFinite(concurrency) || concurrency < 1) {
    throw new RangeError(`createLimiter: concurrency must be >= 1, got ${concurrency}`);
  }
  let cap = Math.floor(concurrency);
  let active = 0;
  const queue: Array<() => void> = [];
  const idleWaiters: Array<() => void> = [];

  const drain = () => {
    while (active < cap && queue.length > 0) {
      const next = queue.shift();
      if (next) next();
    }
    if (active === 0 && queue.length === 0 && idleWaiters.length > 0) {
      const waiters = idleWaiters.splice(0);
      for (const w of waiters) w();
    }
  };

  const run: LimitedFn = <T>(task: () => Promise<T> | T): Promise<T> => {
    return new Promise<T>((resolve, reject) => {
      const start = () => {
        active++;
        Promise.resolve()
          .then(task)
          .then(
            (v) => {
              active--;
              resolve(v);
              drain();
            },
            (err) => {
              active--;
              reject(err);
              drain();
            },
          );
      };
      if (active < cap) start();
      else queue.push(start);
    });
  };

  const limiter = run as Limiter;
  limiter.active = () => active;
  limiter.pending = () => queue.length;
  limiter.concurrency = () => cap;
  limiter.setConcurrency = (n: number) => {
    if (!Number.isFinite(n) || n < 1) {
      throw new RangeError(`setConcurrency: must be >= 1, got ${n}`);
    }
    cap = Math.floor(n);
    drain();
  };
  limiter.idle = () =>
    active === 0 && queue.length === 0
      ? Promise.resolve()
      : new Promise<void>((resolve) => idleWaiters.push(resolve));

  return limiter;
}
