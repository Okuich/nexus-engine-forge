/**
 * Chunked / streaming SDF generation.
 *
 * Splits the voxel grid into 3D tiles and computes each tile independently,
 * so memory is bounded to one chunk at a time and progress can be observed.
 *
 * Two entry points:
 *   • generateSDFStream  — async generator yielding {SDFChunk} per tile.
 *                          Use for streaming to disk / network without ever
 *                          materializing the full Float32Array in RAM.
 *   • generateSDFChunked — convenience wrapper that consumes the stream and
 *                          assembles a complete {SDFGrid}. Functionally
 *                          equivalent to {generateSDF}, but with bounded
 *                          per-step memory and tighter narrow-band pruning.
 *
 * Narrow band:
 *   When `narrowBand` is set, each chunk first calls `bvh.queryBox(chunkAABB
 *   expanded by band)`. If zero candidate triangles, the chunk is filled with
 *   ±band (sign inferred from a single sample) and skipped — turning empty
 *   regions into O(1) work and making 256³ grids tractable for sparse meshes.
 */
import type { RawMesh } from '../types';
import { BVH, type AABB } from '../core/spatialIndex';
import type { SDFGenerationOptions, SDFGrid } from './types';

type V3 = [number, number, number];

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

function closestPointOnTriangle(p: V3, a: V3, b: V3, c: V3): V3 {
  const ab = sub(b, a), ac = sub(c, a), ap = sub(p, a);
  const d1 = dot(ab, ap), d2 = dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return a;
  const bp = sub(p, b);
  const d3 = dot(ab, bp), d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return b;
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    return [a[0] + v * ab[0], a[1] + v * ab[1], a[2] + v * ab[2]];
  }
  const cp = sub(p, c);
  const d5 = dot(ab, cp), d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return c;
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    return [a[0] + w * ac[0], a[1] + w * ac[1], a[2] + w * ac[2]];
  }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
    return [b[0] + w * (c[0] - b[0]), b[1] + w * (c[1] - b[1]), b[2] + w * (c[2] - b[2])];
  }
  const denom = 1 / (va + vb + vc);
  const v = vb * denom, w = vc * denom;
  return [a[0] + ab[0] * v + ac[0] * w, a[1] + ab[1] * v + ac[1] * w, a[2] + ab[2] * v + ac[2] * w];
}

function getTri(mesh: RawMesh, faceIndex: number): { a: V3; b: V3; c: V3 } {
  const idx = mesh.indices as ArrayLike<number>;
  const i0 = idx[faceIndex * 3] * 3;
  const i1 = idx[faceIndex * 3 + 1] * 3;
  const i2 = idx[faceIndex * 3 + 2] * 3;
  const p = mesh.positions as ArrayLike<number>;
  return {
    a: [p[i0], p[i0 + 1], p[i0 + 2]],
    b: [p[i1], p[i1 + 1], p[i1 + 2]],
    c: [p[i2], p[i2 + 1], p[i2 + 2]],
  };
}

function signByNormal(mesh: RawMesh, bvh: BVH, p: V3): number {
  const nearest = bvh.nearestTriangle(p);
  if (!nearest) return 1;
  const { a, b, c } = getTri(mesh, nearest.triangleIndex);
  const n = cross(sub(b, a), sub(c, a));
  const cp = closestPointOnTriangle(p, a, b, c);
  const v: V3 = [p[0] - cp[0], p[1] - cp[1], p[2] - cp[2]];
  return dot(v, n) >= 0 ? 1 : -1;
}

// ─── Public types ───────────────────────────────────────────────────────────

export interface ChunkedSDFOptions extends SDFGenerationOptions {
  /** Voxel side length per chunk. Default 16 (16³ = 4096 voxels per tile). */
  chunkSize?: number;
  /** Optional progress callback fired after each chunk is emitted. */
  onProgress?: (info: ChunkProgress) => void;
  /**
   * If true, allows yielding control between chunks (microtask) so the host
   * stays responsive on the main thread. Default true.
   */
  yieldBetweenChunks?: boolean;
}

export interface ChunkProgress {
  chunksEmitted: number;
  chunksTotal: number;
  voxelsProcessed: number;
  voxelsTotal: number;
  elapsedMs: number;
}

export interface SDFChunk {
  /** Origin voxel coords inside the full grid (inclusive). */
  origin: [number, number, number];
  /** Chunk dimensions in voxels. */
  dims: [number, number, number];
  /** Row-major data: index = i + j*cx + k*cx*cy. */
  data: Float32Array;
  /** True if every voxel was filled with the narrow-band saturation value. */
  saturated: boolean;
  /** Total grid dimensions, repeated each chunk so consumers don't need state. */
  gridDims: [number, number, number];
  /** Voxel size in mesh units. */
  voxelSize: number;
  /** Full-grid bounds. */
  gridBounds: AABB;
  /** This chunk's world-space AABB. */
  chunkBounds: AABB;
  /** Source mesh triangle count. */
  sourceTriangles: number;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function expandAABB(box: AABB, pad: number): AABB {
  return {
    min: [box.min[0] - pad, box.min[1] - pad, box.min[2] - pad],
    max: [box.max[0] + pad, box.max[1] + pad, box.max[2] + pad],
  };
}

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function maybeYield(enabled: boolean): Promise<void> {
  if (!enabled) return Promise.resolve();
  return new Promise((r) => setTimeout(r, 0));
}

interface GridLayout {
  nx: number; ny: number; nz: number;
  voxelSize: number;
  min: V3;
  max: V3;
}

function computeLayout(bvh: BVH, options: SDFGenerationOptions): GridLayout {
  const resolution = options.resolution ?? 64;
  const b = bvh.bounds;
  const dx = b.max[0] - b.min[0], dy = b.max[1] - b.min[1], dz = b.max[2] - b.min[2];
  const diag = Math.hypot(dx, dy, dz);
  const padding = options.padding ?? diag * 0.05;
  const min: V3 = [b.min[0] - padding, b.min[1] - padding, b.min[2] - padding];
  const max: V3 = [b.max[0] + padding, b.max[1] + padding, b.max[2] + padding];
  const longest = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
  const voxelSize = longest / resolution;
  return {
    nx: Math.max(2, Math.ceil((max[0] - min[0]) / voxelSize)),
    ny: Math.max(2, Math.ceil((max[1] - min[1]) / voxelSize)),
    nz: Math.max(2, Math.ceil((max[2] - min[2]) / voxelSize)),
    voxelSize,
    min,
    max,
  };
}

// ─── Streaming generator ────────────────────────────────────────────────────

/**
 * Yield SDF chunks lazily. Memory footprint = O(1 chunk) + BVH.
 * Each chunk's `data` is a freshly allocated Float32Array; the consumer is
 * free to forward it to disk/network and let GC reclaim it.
 */
export async function* generateSDFStream(
  mesh: RawMesh,
  options: ChunkedSDFOptions = {},
): AsyncGenerator<SDFChunk, void, void> {
  const t0 = nowMs();
  const bvh = new BVH(mesh);
  const layout = computeLayout(bvh, options);
  const { nx, ny, nz, voxelSize, min, max } = layout;
  const sourceTriangles = (mesh.indices as ArrayLike<number>).length / 3;

  const chunkSize = Math.max(1, Math.min(options.chunkSize ?? 16, Math.max(nx, ny, nz)));
  const signMethod = options.signMethod ?? 'normal'; // chunked default = fast
  const band = options.narrowBand ?? Infinity;
  const yieldBetween = options.yieldBetweenChunks ?? true;
  const budget = options.timeBudgetMs ?? Infinity;

  const cxCount = Math.ceil(nx / chunkSize);
  const cyCount = Math.ceil(ny / chunkSize);
  const czCount = Math.ceil(nz / chunkSize);
  const chunksTotal = cxCount * cyCount * czCount;
  const voxelsTotal = nx * ny * nz;

  const gridBounds: AABB = { min, max };
  let chunksEmitted = 0;
  let voxelsProcessed = 0;

  for (let cz = 0; cz < czCount; cz++) {
    for (let cy = 0; cy < cyCount; cy++) {
      for (let cx = 0; cx < cxCount; cx++) {
        const ox = cx * chunkSize;
        const oy = cy * chunkSize;
        const oz = cz * chunkSize;
        const dx = Math.min(chunkSize, nx - ox);
        const dy = Math.min(chunkSize, ny - oy);
        const dz = Math.min(chunkSize, nz - oz);
        const voxels = dx * dy * dz;

        const chunkBounds: AABB = {
          min: [min[0] + ox * voxelSize, min[1] + oy * voxelSize, min[2] + oz * voxelSize],
          max: [min[0] + (ox + dx) * voxelSize, min[1] + (oy + dy) * voxelSize, min[2] + (oz + dz) * voxelSize],
        };

        // Narrow-band fast path: query BVH for triangles near this chunk.
        const queryAABB = Number.isFinite(band)
          ? expandAABB(chunkBounds, band)
          : { min: [-Infinity, -Infinity, -Infinity] as V3, max: [Infinity, Infinity, Infinity] as V3 };
        const candidates = Number.isFinite(band)
          ? bvh.queryBox(queryAABB)
          : null; // null means "use all triangles"

        const data = new Float32Array(dx * dy * dz);

        if (candidates && candidates.length === 0) {
          // No surface within band — saturate. Sign from chunk centroid.
          const center: V3 = [
            (chunkBounds.min[0] + chunkBounds.max[0]) * 0.5,
            (chunkBounds.min[1] + chunkBounds.max[1]) * 0.5,
            (chunkBounds.min[2] + chunkBounds.max[2]) * 0.5,
          ];
          const s = signByNormal(mesh, bvh, center);
          data.fill(s * band);
          voxelsProcessed += voxels;
          chunksEmitted++;
          options.onProgress?.({ chunksEmitted, chunksTotal, voxelsProcessed, voxelsTotal, elapsedMs: nowMs() - t0 });
          yield {
            origin: [ox, oy, oz],
            dims: [dx, dy, dz],
            data,
            saturated: true,
            gridDims: [nx, ny, nz],
            voxelSize,
            gridBounds,
            chunkBounds,
            sourceTriangles,
          };
          if (yieldBetween) await maybeYield(true);
          if (nowMs() - t0 > budget) throw new Error(`SDF generation exceeded time budget (${budget}ms)`);
          continue;
        }

        // Pre-fetch candidate triangle vertices once per chunk.
        const triList: Array<{ a: V3; b: V3; c: V3 }> = candidates
          ? candidates.map((f) => getTri(mesh, f))
          : Array.from({ length: sourceTriangles }, (_, f) => getTri(mesh, f));

        for (let k = 0; k < dz; k++) {
          for (let j = 0; j < dy; j++) {
            for (let i = 0; i < dx; i++) {
              const p: V3 = [
                min[0] + (ox + i + 0.5) * voxelSize,
                min[1] + (oy + j + 0.5) * voxelSize,
                min[2] + (oz + k + 0.5) * voxelSize,
              ];
              let bestD2 = Infinity;
              for (let t = 0; t < triList.length; t++) {
                const tri = triList[t];
                const cp = closestPointOnTriangle(p, tri.a, tri.b, tri.c);
                const ddx = p[0] - cp[0], ddy = p[1] - cp[1], ddz = p[2] - cp[2];
                const d2 = ddx * ddx + ddy * ddy + ddz * ddz;
                if (d2 < bestD2) bestD2 = d2;
              }
              const d = Math.sqrt(bestD2);
              if (d > band) {
                // Outside band — saturate with sign from nearest tri normal.
                const s = signByNormal(mesh, bvh, p);
                data[i + j * dx + k * dx * dy] = s * band;
              } else {
                const s = signMethod === 'normal'
                  ? signByNormal(mesh, bvh, p)
                  : signByNormal(mesh, bvh, p); // raycast variant available via base generator
                data[i + j * dx + k * dx * dy] = d * s;
              }
            }
          }
        }

        voxelsProcessed += voxels;
        chunksEmitted++;
        options.onProgress?.({ chunksEmitted, chunksTotal, voxelsProcessed, voxelsTotal, elapsedMs: nowMs() - t0 });
        yield {
          origin: [ox, oy, oz],
          dims: [dx, dy, dz],
          data,
          saturated: false,
          gridDims: [nx, ny, nz],
          voxelSize,
          gridBounds,
          chunkBounds,
          sourceTriangles,
        };
        if (yieldBetween) await maybeYield(true);
        if (nowMs() - t0 > budget) throw new Error(`SDF generation exceeded time budget (${budget}ms)`);
      }
    }
  }
}

// ─── Convenience: assemble full grid from stream ────────────────────────────

/**
 * Drive the streaming generator and assemble a complete SDFGrid.
 * Equivalent to `generateSDF` but with bounded per-step memory and
 * narrow-band tile pruning. Use this for grids that fit in RAM but whose
 * generation should not block large allocations or stall the event loop.
 */
export async function generateSDFChunked(
  mesh: RawMesh,
  options: ChunkedSDFOptions = {},
): Promise<SDFGrid> {
  const t0 = nowMs();
  let dims: [number, number, number] | null = null;
  let gridBounds: AABB | null = null;
  let voxelSize = 0;
  let sourceTriangles = 0;
  let data: Float32Array | null = null;

  for await (const chunk of generateSDFStream(mesh, options)) {
    if (!data) {
      dims = chunk.gridDims;
      gridBounds = chunk.gridBounds;
      voxelSize = chunk.voxelSize;
      sourceTriangles = chunk.sourceTriangles;
      data = new Float32Array(dims[0] * dims[1] * dims[2]);
    }
    const [nx, ny] = dims!;
    const [ox, oy, oz] = chunk.origin;
    const [cx, cy, cz] = chunk.dims;
    for (let k = 0; k < cz; k++) {
      for (let j = 0; j < cy; j++) {
        const srcRow = (j * cx) + k * cx * cy;
        const dstRow = (ox) + (oy + j) * nx + (oz + k) * nx * ny;
        data!.set(chunk.data.subarray(srcRow, srcRow + cx), dstRow);
      }
    }
  }

  if (!data || !dims || !gridBounds) {
    throw new Error('generateSDFChunked produced no chunks');
  }

  return {
    data,
    dims,
    bounds: gridBounds,
    voxelSize,
    sourceTriangles,
    backend: 'cpu',
    elapsedMs: nowMs() - t0,
  };
}

// ─── ReadableStream adapter (for fetch / file streaming) ────────────────────

/**
 * Wrap `generateSDFStream` as a Web ReadableStream of NDJSON lines,
 * each line a serialized chunk: { origin, dims, gridDims, voxelSize, data: base64 }.
 * Suitable for piping straight to `Response` body or `fs.createWriteStream`.
 */
export function generateSDFReadableStream(
  mesh: RawMesh,
  options: ChunkedSDFOptions = {},
): ReadableStream<Uint8Array> {
  const iter = generateSDFStream(mesh, options);
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const next = await iter.next();
      if (next.done) { controller.close(); return; }
      const value: SDFChunk = next.value;
      const bytes = new Uint8Array(value.data.buffer, value.data.byteOffset, value.data.byteLength);
      let bin = '';
      for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
      const line = JSON.stringify({
        origin: value.origin,
        dims: value.dims,
        gridDims: value.gridDims,
        voxelSize: value.voxelSize,
        gridBounds: value.gridBounds,
        chunkBounds: value.chunkBounds,
        saturated: value.saturated,
        sourceTriangles: value.sourceTriangles,
        data: btoa(bin),
      }) + '\n';
      controller.enqueue(encoder.encode(line));
    },
  });
}
