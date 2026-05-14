/**
 * Spatial Index Performance Benchmark
 * ───────────────────────────────────
 * Reproducible micro-benchmark that measures build + query latency for
 * KDTree (vertex queries), BVH and Octree (triangle queries) across a
 * grid of mesh sizes. Designed to validate the "sub-100ms query"
 * performance budget under controlled, deterministic input.
 *
 * Determinism:
 *   • mesh + query payloads are generated from a seedable PRNG (mulberry32)
 *   • warmup pass eliminates JIT noise
 *   • per-op timings collected via performance.now() and reduced to
 *     mean / p50 / p95 / p99 / max
 *
 * Usage (Node / Bun):
 *   bunx tsx src/lib/geometry/spatial/benchmark.ts
 *
 * Programmatic:
 *   import { runSpatialBenchmark } from '@/lib/geometry/spatial/benchmark';
 *   const report = runSpatialBenchmark({ sizes: [1_000, 10_000], seed: 42 });
 */

import type { RawMesh, Vec3 } from '../types';
import { BVH } from '../core/spatialIndex';
import type { AABB, Ray } from '../core/spatialIndex';
import { Octree } from './octree';
import { KDTree } from './kdTree';

// ─── Public types ──────────────────────────────────────────────

export interface BenchmarkOptions {
  /** Triangle counts to sweep over. */
  sizes?: number[];
  /** Number of timed query operations per (size, structure, op). */
  iterations?: number;
  /** Untimed warmup operations (per case) to settle the JIT. */
  warmup?: number;
  /** PRNG seed — same seed → identical mesh + query inputs. */
  seed?: number;
  /** Per-op latency budget in ms. Cases above are flagged. */
  budgetMs?: number;
  /** Optional logger (defaults to no-op). */
  log?: (line: string) => void;
}

export interface LatencyStats {
  count: number;
  mean: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
}

export interface BenchmarkCase {
  structure: 'kdtree' | 'bvh' | 'octree';
  operation: string;
  meshSize: number;
  buildMs: number;
  query: LatencyStats;
  withinBudget: boolean;
}

export interface BenchmarkReport {
  meta: {
    seed: number;
    iterations: number;
    warmup: number;
    budgetMs: number;
    timestamp: string;
    runtime: string;
  };
  cases: BenchmarkCase[];
}

// ─── Deterministic PRNG ────────────────────────────────────────

function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ─── Synthetic mesh generation ─────────────────────────────────

/**
 * Sphere-like point cloud triangulated as independent triangles. Not
 * topologically clean, but gives realistic spatial distribution for
 * acceleration-structure stress tests.
 */
function buildBenchMesh(triCount: number, rand: () => number): RawMesh {
  const positions = new Float32Array(triCount * 9);
  const indices = new Uint32Array(triCount * 3);
  for (let i = 0; i < triCount; i++) {
    // Random triangle anchored on a unit sphere.
    const cx = (rand() - 0.5) * 200;
    const cy = (rand() - 0.5) * 200;
    const cz = (rand() - 0.5) * 200;
    const o = i * 9;
    for (let v = 0; v < 3; v++) {
      positions[o + v * 3 + 0] = cx + (rand() - 0.5) * 2;
      positions[o + v * 3 + 1] = cy + (rand() - 0.5) * 2;
      positions[o + v * 3 + 2] = cz + (rand() - 0.5) * 2;
      indices[i * 3 + v] = i * 3 + v;
    }
  }
  return { positions, indices };
}

function buildBenchPoints(n: number, rand: () => number): Vec3[] {
  const out: Vec3[] = new Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = [(rand() - 0.5) * 200, (rand() - 0.5) * 200, (rand() - 0.5) * 200];
  }
  return out;
}

// ─── Stats ─────────────────────────────────────────────────────

function summarize(samples: number[]): LatencyStats {
  const sorted = [...samples].sort((a, b) => a - b);
  const n = sorted.length;
  const pick = (q: number) => sorted[Math.min(n - 1, Math.floor(q * n))];
  const mean = sorted.reduce((s, v) => s + v, 0) / n;
  return {
    count: n,
    mean,
    p50: pick(0.5),
    p95: pick(0.95),
    p99: pick(0.99),
    max: sorted[n - 1],
  };
}

function timed<T>(fn: () => T): { ms: number; result: T } {
  const t0 = performance.now();
  const result = fn();
  return { ms: performance.now() - t0, result };
}

function timeOps(label: string, n: number, op: (i: number) => void): LatencyStats {
  void label;
  const samples = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const t0 = performance.now();
    op(i);
    samples[i] = performance.now() - t0;
  }
  return summarize(samples);
}

// ─── Case runners ──────────────────────────────────────────────

interface RunCtx {
  rand: () => number;
  iterations: number;
  warmup: number;
  budgetMs: number;
}

function runBVHCase(size: number, ctx: RunCtx): BenchmarkCase[] {
  const mesh = buildBenchMesh(size, ctx.rand);
  const { ms: buildMs, result: bvh } = timed(() => new BVH(mesh));

  const rays: Ray[] = Array.from({ length: ctx.iterations + ctx.warmup }, () => ({
    origin: [(ctx.rand() - 0.5) * 200, (ctx.rand() - 0.5) * 200, 500],
    direction: [0, 0, -1],
  }));
  const boxes: AABB[] = Array.from({ length: ctx.iterations + ctx.warmup }, () => {
    const c: Vec3 = [(ctx.rand() - 0.5) * 200, (ctx.rand() - 0.5) * 200, (ctx.rand() - 0.5) * 200];
    return { min: [c[0] - 5, c[1] - 5, c[2] - 5], max: [c[0] + 5, c[1] + 5, c[2] + 5] };
  });
  const points: Vec3[] = Array.from({ length: ctx.iterations + ctx.warmup }, () =>
    [(ctx.rand() - 0.5) * 200, (ctx.rand() - 0.5) * 200, (ctx.rand() - 0.5) * 200]);

  // Warmup
  for (let i = 0; i < ctx.warmup; i++) bvh.raycast(rays[i]);
  for (let i = 0; i < ctx.warmup; i++) bvh.queryBox(boxes[i]);
  for (let i = 0; i < ctx.warmup; i++) bvh.nearestTriangle(points[i]);

  const cast = timeOps('bvh.raycast', ctx.iterations,
    (i) => { bvh.raycast(rays[ctx.warmup + i]); });
  const box = timeOps('bvh.queryBox', ctx.iterations,
    (i) => { bvh.queryBox(boxes[ctx.warmup + i]); });
  const near = timeOps('bvh.nearestTriangle', ctx.iterations,
    (i) => { bvh.nearestTriangle(points[ctx.warmup + i]); });

  return [
    mkCase('bvh', 'raycast', size, buildMs, cast, ctx.budgetMs),
    mkCase('bvh', 'queryBox', size, buildMs, box, ctx.budgetMs),
    mkCase('bvh', 'nearestTriangle', size, buildMs, near, ctx.budgetMs),
  ];
}

function runOctreeCase(size: number, ctx: RunCtx): BenchmarkCase[] {
  const mesh = buildBenchMesh(size, ctx.rand);
  const { ms: buildMs, result: oct } = timed(() => new Octree(mesh));

  const rays: Ray[] = Array.from({ length: ctx.iterations + ctx.warmup }, () => ({
    origin: [(ctx.rand() - 0.5) * 200, (ctx.rand() - 0.5) * 200, 500],
    direction: [0, 0, -1],
  }));
  const boxes: AABB[] = Array.from({ length: ctx.iterations + ctx.warmup }, () => {
    const c: Vec3 = [(ctx.rand() - 0.5) * 200, (ctx.rand() - 0.5) * 200, (ctx.rand() - 0.5) * 200];
    return { min: [c[0] - 5, c[1] - 5, c[2] - 5], max: [c[0] + 5, c[1] + 5, c[2] + 5] };
  });

  for (let i = 0; i < ctx.warmup; i++) oct.raycast(rays[i]);
  for (let i = 0; i < ctx.warmup; i++) oct.queryBox(boxes[i]);

  const cast = timeOps('oct.raycast', ctx.iterations,
    (i) => { oct.raycast(rays[ctx.warmup + i]); });
  const box = timeOps('oct.queryBox', ctx.iterations,
    (i) => { oct.queryBox(boxes[ctx.warmup + i]); });

  return [
    mkCase('octree', 'raycast', size, buildMs, cast, ctx.budgetMs),
    mkCase('octree', 'queryBox', size, buildMs, box, ctx.budgetMs),
  ];
}

function runKDCase(size: number, ctx: RunCtx): BenchmarkCase[] {
  const points = buildBenchPoints(size, ctx.rand);
  const { ms: buildMs, result: kd } = timed(() => new KDTree(points));

  const targets: Vec3[] = Array.from({ length: ctx.iterations + ctx.warmup }, () =>
    [(ctx.rand() - 0.5) * 200, (ctx.rand() - 0.5) * 200, (ctx.rand() - 0.5) * 200]);

  for (let i = 0; i < ctx.warmup; i++) kd.nearest(targets[i]);
  for (let i = 0; i < ctx.warmup; i++) kd.knn(targets[i], 16);
  for (let i = 0; i < ctx.warmup; i++) kd.withinRadius(targets[i], 5);

  const near = timeOps('kd.nearest', ctx.iterations,
    (i) => { kd.nearest(targets[ctx.warmup + i]); });
  const knn = timeOps('kd.knn(k=16)', ctx.iterations,
    (i) => { kd.knn(targets[ctx.warmup + i], 16); });
  const radius = timeOps('kd.withinRadius(r=5)', ctx.iterations,
    (i) => { kd.withinRadius(targets[ctx.warmup + i], 5); });

  return [
    mkCase('kdtree', 'nearest', size, buildMs, near, ctx.budgetMs),
    mkCase('kdtree', 'knn(k=16)', size, buildMs, knn, ctx.budgetMs),
    mkCase('kdtree', 'withinRadius(r=5)', size, buildMs, radius, ctx.budgetMs),
  ];
}

function mkCase(
  structure: BenchmarkCase['structure'],
  operation: string,
  meshSize: number,
  buildMs: number,
  query: LatencyStats,
  budgetMs: number,
): BenchmarkCase {
  return {
    structure,
    operation,
    meshSize,
    buildMs: round(buildMs),
    query: {
      count: query.count,
      mean: round(query.mean),
      p50: round(query.p50),
      p95: round(query.p95),
      p99: round(query.p99),
      max: round(query.max),
    },
    withinBudget: query.p95 <= budgetMs,
  };
}

function round(n: number): number { return Math.round(n * 1000) / 1000; }

// ─── Public entry ──────────────────────────────────────────────

export function runSpatialBenchmark(opts: BenchmarkOptions = {}): BenchmarkReport {
  const sizes = opts.sizes ?? [1_000, 10_000, 50_000];
  const iterations = opts.iterations ?? 200;
  const warmup = opts.warmup ?? 20;
  const seed = opts.seed ?? 0xC0FFEE;
  const budgetMs = opts.budgetMs ?? 100;
  const log = opts.log ?? (() => {});

  const cases: BenchmarkCase[] = [];
  for (const size of sizes) {
    // Fresh PRNG per size keeps each row independently reproducible.
    const ctx: RunCtx = {
      rand: mulberry32(seed ^ size),
      iterations, warmup, budgetMs,
    };
    log(`▶ size=${size}`);
    cases.push(...runKDCase(size, ctx));
    cases.push(...runBVHCase(size, ctx));
    cases.push(...runOctreeCase(size, ctx));
  }

  return {
    meta: {
      seed, iterations, warmup, budgetMs,
      timestamp: new Date().toISOString(),
      runtime: typeof navigator !== 'undefined' ? navigator.userAgent : 'node',
    },
    cases,
  };
}

export function formatReport(report: BenchmarkReport): string {
  const header = ['structure', 'operation', 'mesh', 'build(ms)', 'mean', 'p50', 'p95', 'p99', 'max', 'budget'];
  const rows = report.cases.map((c) => [
    c.structure, c.operation, String(c.meshSize),
    c.buildMs.toFixed(2),
    c.query.mean.toFixed(3),
    c.query.p50.toFixed(3),
    c.query.p95.toFixed(3),
    c.query.p99.toFixed(3),
    c.query.max.toFixed(3),
    c.withinBudget ? 'PASS' : 'FAIL',
  ]);
  const widths = header.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => r[i].length)));
  const pad = (cells: string[]) =>
    cells.map((c, i) => c.padEnd(widths[i])).join('  ');
  return [
    `Spatial Index Benchmark — seed=${report.meta.seed} iters=${report.meta.iterations} budget=${report.meta.budgetMs}ms`,
    pad(header),
    pad(widths.map((w) => '-'.repeat(w))),
    ...rows.map(pad),
  ].join('\n');
}

// ─── CLI entry ─────────────────────────────────────────────────

// Run when invoked directly via `bunx tsx <this-file>` or `node`.
const isDirectRun =
  typeof process !== 'undefined' &&
  process.argv?.[1] &&
  /benchmark\.[tj]s$/.test(process.argv[1]);

if (isDirectRun) {
  const report = runSpatialBenchmark({ log: (l) => console.log(l) });
  console.log(formatReport(report));
}
