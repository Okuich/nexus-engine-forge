/**
 * Full-Scan Orchestrator
 *
 * After an STL / STEP / IGES file is parsed into a `RawMesh`, runs all
 * four Midwater intelligence layers in parallel:
 *
 *   1. Geometry OS           — feature extraction, adjacency graph, stats
 *   2. Computational Geometry — topology (Euler, manifold, genus) + BVH
 *   3. Physics OS            — structural FEA feasibility on extracted features
 *   4. Field OS              — eikonal arrival-time + poisson navigation
 *                              potential on a low-resolution projection
 *
 * Each layer is isolated: a failure in one layer never aborts the
 * scan. Per-layer status, timing, and result/error are reported back
 * so the UI can render a real-time progress matrix.
 *
 * All layer jobs are pushed through a shared concurrency limiter so
 * batch scans across many uploaded files cannot saturate the CPU,
 * worker pool, or remote Field OS API.
 */

import {
  extractFeatures,
  buildSpatialIndex,
  type GeometryFeatureSet,
  type RawMesh,
} from '@/lib/geometry';
import { analyzeTopology, type TopologyReport } from '@/lib/geometry/core';
import {
  runSimulation,
  defaultStructuralConfig,
  type SimulationResult,
} from '@/lib/simulation';
import { fieldOs, type EikonalResponse, type PoissonResponse } from '@/lib/fieldOs';
import { createLimiter, type Limiter } from './concurrencyLimiter';

// ── Layer identifiers ───────────────────────────────────────────
export const FULL_SCAN_LAYERS = [
  'geometryOs',
  'computationalGeometry',
  'physicsOs',
  'fieldOs',
] as const;
export type FullScanLayer = (typeof FULL_SCAN_LAYERS)[number];

// ── Layer result shapes ─────────────────────────────────────────
export interface ComputationalGeometryResult {
  topology: TopologyReport;
  spatialIndex: { kind: string; built: boolean };
}

export interface FieldOsLayerResult {
  arrival: EikonalResponse;
  potential: PoissonResponse;
  grid: { w: number; h: number };
}

export type LayerOutput = {
  geometryOs: GeometryFeatureSet;
  computationalGeometry: ComputationalGeometryResult;
  physicsOs: SimulationResult;
  fieldOs: FieldOsLayerResult;
};

export type LayerStatus = 'pending' | 'running' | 'done' | 'error' | 'skipped';

export interface LayerReport<L extends FullScanLayer = FullScanLayer> {
  layer: L;
  status: LayerStatus;
  startedAt?: number;
  finishedAt?: number;
  durationMs?: number;
  result?: LayerOutput[L];
  error?: { message: string; name?: string };
}

export interface FullScanReport {
  startedAt: number;
  finishedAt: number;
  durationMs: number;
  ok: boolean;
  layers: { [L in FullScanLayer]: LayerReport<L> };
}

// ── Inputs / options ────────────────────────────────────────────
export interface FullScanInput {
  /** Logical source filename (used only for diagnostics). */
  filename?: string;
  /** Parsed mesh. STL/STEP/IGES must be parsed into RawMesh upstream. */
  mesh: RawMesh;
}

export interface FullScanOptions {
  /** Layers to skip (e.g. ['fieldOs'] when offline). */
  skip?: FullScanLayer[];
  /** Field OS projection grid size (square). Default 48. */
  fieldOsGrid?: number;
  /** Called whenever any layer changes state. */
  onLayerUpdate?: (report: LayerReport) => void;
  /** Abort signal cancels in-flight Field OS calls (CPU layers run to completion). */
  signal?: AbortSignal;
  /** Inject a limiter to share budget across files; default = per-call limiter of 4. */
  limiter?: Limiter;
}

// ── Default shared limiter ──────────────────────────────────────
let defaultLimiter: Limiter | null = null;
export function getDefaultScanLimiter(): Limiter {
  if (!defaultLimiter) defaultLimiter = createLimiter(4);
  return defaultLimiter;
}

// ── Helpers ─────────────────────────────────────────────────────
function emptyReport(): FullScanReport['layers'] {
  return {
    geometryOs: { layer: 'geometryOs', status: 'pending' },
    computationalGeometry: { layer: 'computationalGeometry', status: 'pending' },
    physicsOs: { layer: 'physicsOs', status: 'pending' },
    fieldOs: { layer: 'fieldOs', status: 'pending' },
  };
}

function meshToFieldOsGrid(mesh: RawMesh, grid: number): {
  speed: number[];
  source: [number, number];
  target: [number, number];
} {
  // Project vertices into a [grid x grid] occupancy map; occupied cells
  // get speed = 1 (free), empty cells get speed = 0.6 (cheaper to cross
  // but still defined). Source = densest cell, target = farthest cell.
  const occ = new Array<number>(grid * grid).fill(0);
  const pos = mesh.positions;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < pos.length; i += 3) {
    const x = pos[i], y = pos[i + 1];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const rx = maxX - minX || 1;
  const ry = maxY - minY || 1;
  let maxOcc = 0;
  let densest = 0;
  for (let i = 0; i < pos.length; i += 3) {
    const cx = Math.min(grid - 1, Math.max(0, Math.floor(((pos[i] - minX) / rx) * grid)));
    const cy = Math.min(grid - 1, Math.max(0, Math.floor(((pos[i + 1] - minY) / ry) * grid)));
    const idx = cy * grid + cx;
    occ[idx]++;
    if (occ[idx] > maxOcc) { maxOcc = occ[idx]; densest = idx; }
  }
  const speed = occ.map((v) => (v > 0 ? 1 : 0.6));
  // Farthest grid cell from densest (Chebyshev).
  const sx = densest % grid, sy = Math.floor(densest / grid);
  let bestD = -1, tx = (sx + grid / 2) % grid, ty = (sy + grid / 2) % grid;
  for (let y = 0; y < grid; y++) {
    for (let x = 0; x < grid; x++) {
      const d = Math.max(Math.abs(x - sx), Math.abs(y - sy));
      if (d > bestD) { bestD = d; tx = x; ty = y; }
    }
  }
  return { speed, source: [sx, sy], target: [tx, ty] };
}

async function runLayer<L extends FullScanLayer>(
  layer: L,
  fn: () => Promise<LayerOutput[L]> | LayerOutput[L],
  limiter: Limiter,
  layers: FullScanReport['layers'],
  emit?: (r: LayerReport) => void,
): Promise<void> {
  const update = (patch: Partial<LayerReport<L>>) => {
    layers[layer] = { ...layers[layer], ...patch } as LayerReport<L>;
    emit?.(layers[layer]);
  };
  update({ status: 'running', startedAt: performance.now() });
  try {
    const result = await limiter(fn);
    const finishedAt = performance.now();
    update({
      status: 'done',
      finishedAt,
      durationMs: finishedAt - (layers[layer].startedAt ?? finishedAt),
      result,
    });
  } catch (err) {
    const finishedAt = performance.now();
    const e = err as Error;
    update({
      status: 'error',
      finishedAt,
      durationMs: finishedAt - (layers[layer].startedAt ?? finishedAt),
      error: { message: e?.message ?? String(err), name: e?.name },
    });
  }
}

// ── Public API ──────────────────────────────────────────────────
export async function runFullScan(
  input: FullScanInput,
  opts: FullScanOptions = {},
): Promise<FullScanReport> {
  const startedAt = performance.now();
  const layers = emptyReport();
  const skip = new Set(opts.skip ?? []);
  const limiter = opts.limiter ?? getDefaultScanLimiter();
  const emit = opts.onLayerUpdate;
  const grid = Math.max(8, Math.min(128, opts.fieldOsGrid ?? 48));

  for (const l of FULL_SCAN_LAYERS) {
    if (skip.has(l)) {
      layers[l] = { layer: l, status: 'skipped' };
      emit?.(layers[l]);
    }
  }

  // Geometry OS — feature extraction is the upstream dep for Physics OS.
  // We still kick off Computational Geometry + Field OS in parallel.
  let featuresPromise: Promise<GeometryFeatureSet> | null = null;
  const tasks: Array<Promise<void>> = [];

  if (!skip.has('geometryOs')) {
    featuresPromise = (async () => {
      let result: GeometryFeatureSet | undefined;
      await runLayer(
        'geometryOs',
        () => {
          result = extractFeatures(input.mesh);
          return result;
        },
        limiter,
        layers,
        emit,
      );
      if (!result) throw new Error('geometryOs failed');
      return result;
    })();
    tasks.push(featuresPromise.then(() => undefined).catch(() => undefined));
  }

  if (!skip.has('computationalGeometry')) {
    tasks.push(
      runLayer(
        'computationalGeometry',
        () => {
          const topology = analyzeTopology(input.mesh);
          // BVH build is best-effort; small meshes use uniform grid.
          let kind = 'bvh';
          let built = false;
          try {
            buildSpatialIndex(input.mesh, { kind: 'bvh' });
            built = true;
          } catch {
            try {
              buildSpatialIndex(input.mesh, { kind: 'kdtree' });
              kind = 'kdtree';
              built = true;
            } catch {
              built = false;
              kind = 'none';
            }
          }
          return { topology, spatialIndex: { kind, built } };
        },
        limiter,
        layers,
        emit,
      ),
    );
  }

  if (!skip.has('physicsOs')) {
    tasks.push(
      (async () => {
        if (!featuresPromise) {
          layers.physicsOs = {
            layer: 'physicsOs',
            status: 'skipped',
            error: { message: 'physicsOs requires geometryOs' },
          };
          emit?.(layers.physicsOs);
          return;
        }
        let features: GeometryFeatureSet;
        try {
          features = await featuresPromise;
        } catch {
          layers.physicsOs = {
            layer: 'physicsOs',
            status: 'skipped',
            error: { message: 'upstream geometryOs failed' },
          };
          emit?.(layers.physicsOs);
          return;
        }
        await runLayer(
          'physicsOs',
          () => runSimulation(features, defaultStructuralConfig([0])),
          limiter,
          layers,
          emit,
        );
      })(),
    );
  }

  if (!skip.has('fieldOs')) {
    tasks.push(
      runLayer(
        'fieldOs',
        async () => {
          const { speed, source, target } = meshToFieldOsGrid(input.mesh, grid);
          const f = new Array<number>(grid * grid).fill(0);
          f[target[1] * grid + target[0]] = -1;
          f[source[1] * grid + source[0]] = 1;
          const [arrival, potential] = await Promise.all([
            fieldOs.eikonal(
              { w: grid, h: grid, speed, sources: [target], sweeps: 4 },
              opts.signal,
            ),
            fieldOs.poisson(
              { w: grid, h: grid, f, iterations: 120, h2: 1 },
              opts.signal,
            ),
          ]);
          return { arrival, potential, grid: { w: grid, h: grid } };
        },
        limiter,
        layers,
        emit,
      ),
    );
  }

  await Promise.all(tasks);

  const finishedAt = performance.now();
  const ok = (Object.values(layers) as LayerReport[]).every(
    (l) => l.status === 'done' || l.status === 'skipped',
  );

  return {
    startedAt,
    finishedAt,
    durationMs: finishedAt - startedAt,
    ok,
    layers,
  };
}

/**
 * Batch helper: run a full scan over many meshes, sharing one limiter
 * so total in-flight work never exceeds `concurrency` across all files.
 */
export async function runFullScanBatch(
  inputs: FullScanInput[],
  opts: Omit<FullScanOptions, 'limiter'> & { concurrency?: number } = {},
): Promise<FullScanReport[]> {
  const limiter = createLimiter(opts.concurrency ?? 4);
  return Promise.all(inputs.map((inp) => runFullScan(inp, { ...opts, limiter })));
}
