/**
 * Watertightness analysis and small-hole sealing for `RawMesh`.
 *
 * A mesh is watertight when every edge is shared by exactly two triangles.
 * Edges shared by exactly one triangle form *boundary loops* — open holes.
 *
 *   • analyzeWatertightness — reports boundary edges + grouped loops
 *   • sealSmallHoles        — fan-triangulates loops with ≤ maxLoopEdges edges
 *   • ensureWatertight      — convenience wrapper that seals then re-checks
 */
import type { RawMesh } from '../types';

export interface WatertightReport {
  isWatertight: boolean;
  triangleCount: number;
  boundaryEdgeCount: number;
  /** Each loop is an ordered list of vertex indices (open polyline closing back to [0]). */
  boundaryLoops: number[][];
  /** Edges used by 3+ triangles — non-manifold; sealing cannot fix these. */
  nonManifoldEdgeCount: number;
}

export interface SealOptions {
  /** Maximum loop length (in edges) eligible for sealing. Default 32. */
  maxLoopEdges?: number;
  /** Vertex-weld epsilon used when the mesh has no `indices`. Default 1e-6. */
  weldEpsilon?: number;
}

export interface SealResult {
  mesh: RawMesh;
  before: WatertightReport;
  after: WatertightReport;
  sealedLoops: number;
  skippedLoops: number;
  addedTriangles: number;
}

// ─────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────

function getIndexed(mesh: RawMesh, weldEpsilon: number): { positions: number[]; indices: number[] } {
  const p = Array.from(mesh.positions as ArrayLike<number>);
  if (mesh.indices && (mesh.indices as ArrayLike<number>).length > 0) {
    return { positions: p, indices: Array.from(mesh.indices as ArrayLike<number>) };
  }
  // Weld sequential-triangle positions.
  const inv = 1 / Math.max(weldEpsilon, 1e-20);
  const map = new Map<string, number>();
  const positions: number[] = [];
  const indices: number[] = [];
  const vertCount = Math.floor(p.length / 3);
  for (let i = 0; i < vertCount; i++) {
    const x = p[i * 3], y = p[i * 3 + 1], z = p[i * 3 + 2];
    const key = `${Math.round(x * inv)}|${Math.round(y * inv)}|${Math.round(z * inv)}`;
    let idx = map.get(key);
    if (idx === undefined) {
      idx = positions.length / 3;
      positions.push(x, y, z);
      map.set(key, idx);
    }
    indices.push(idx);
  }
  return { positions, indices };
}

function edgeKey(a: number, b: number): bigint {
  // Pack as undirected key, but track direction separately for loop tracing.
  const lo = a < b ? a : b;
  const hi = a < b ? b : a;
  return (BigInt(lo) << 32n) | BigInt(hi);
}

interface EdgeStat {
  count: number;
  /** First directed (a, b) instance encountered (used for loop orientation). */
  a: number;
  b: number;
}

function collectEdges(indices: ArrayLike<number>): Map<bigint, EdgeStat> {
  const edges = new Map<bigint, EdgeStat>();
  for (let t = 0; t < indices.length; t += 3) {
    const i0 = indices[t], i1 = indices[t + 1], i2 = indices[t + 2];
    const tri: [number, number][] = [[i0, i1], [i1, i2], [i2, i0]];
    for (const [a, b] of tri) {
      const k = edgeKey(a, b);
      const e = edges.get(k);
      if (e) e.count++;
      else edges.set(k, { count: 1, a, b });
    }
  }
  return edges;
}

function traceLoops(boundaryDirected: Array<[number, number]>): number[][] {
  // Build adjacency: from -> list of to-vertex options.
  const next = new Map<number, number[]>();
  for (const [a, b] of boundaryDirected) {
    const list = next.get(a);
    if (list) list.push(b);
    else next.set(a, [b]);
  }
  const loops: number[][] = [];
  const used = new Set<string>(); // "a|b"
  for (const [startA] of boundaryDirected) {
    const out0 = next.get(startA);
    if (!out0) continue;
    // Try every unused outgoing edge as a starting point.
    for (let oi = 0; oi < out0.length; oi++) {
      const startB = out0[oi];
      if (used.has(`${startA}|${startB}`)) continue;
      const loop = [startA];
      let cur = startA;
      let nxt: number | undefined = startB;
      let safety = boundaryDirected.length + 1;
      while (nxt !== undefined && safety-- > 0) {
        const key = `${cur}|${nxt}`;
        if (used.has(key)) break;
        used.add(key);
        loop.push(nxt);
        if (nxt === startA) break;
        const choices = next.get(nxt);
        if (!choices) { nxt = undefined; break; }
        let pick: number | undefined;
        for (const c of choices) {
          if (!used.has(`${nxt}|${c}`)) { pick = c; break; }
        }
        cur = nxt;
        nxt = pick;
      }
      if (loop.length >= 4 && loop[loop.length - 1] === startA) {
        loop.pop(); // drop closing duplicate
        loops.push(loop);
      }
    }
  }
  return loops;
}

// ─────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────

export function analyzeWatertightness(mesh: RawMesh, weldEpsilon = 1e-6): WatertightReport {
  const { indices } = getIndexed(mesh, weldEpsilon);
  const edges = collectEdges(indices);
  const boundaryDirected: Array<[number, number]> = [];
  let nonManifold = 0;
  for (const e of edges.values()) {
    if (e.count === 1) boundaryDirected.push([e.a, e.b]);
    else if (e.count > 2) nonManifold++;
  }
  const loops = traceLoops(boundaryDirected);
  return {
    isWatertight: boundaryDirected.length === 0 && nonManifold === 0,
    triangleCount: Math.floor(indices.length / 3),
    boundaryEdgeCount: boundaryDirected.length,
    boundaryLoops: loops,
    nonManifoldEdgeCount: nonManifold,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Ear-clipping triangulation for boundary loops
// ─────────────────────────────────────────────────────────────────────────

type Vec3 = [number, number, number];

function getVertex(positions: ArrayLike<number>, idx: number): Vec3 {
  return [positions[idx * 3], positions[idx * 3 + 1], positions[idx * 3 + 2]];
}

/** Newell's method: robust polygon normal for arbitrary (incl. non-planar) loops. */
function loopNormal(positions: ArrayLike<number>, loop: number[]): Vec3 {
  let nx = 0, ny = 0, nz = 0;
  for (let i = 0; i < loop.length; i++) {
    const [ax, ay, az] = getVertex(positions, loop[i]);
    const [bx, by, bz] = getVertex(positions, loop[(i + 1) % loop.length]);
    nx += (ay - by) * (az + bz);
    ny += (az - bz) * (ax + bx);
    nz += (ax - bx) * (ay + by);
  }
  const len = Math.hypot(nx, ny, nz);
  if (len < 1e-20) return [0, 0, 1];
  return [nx / len, ny / len, nz / len];
}

/** Project loop vertices onto the plane orthogonal to `normal` to get 2D coords. */
function projectTo2D(positions: ArrayLike<number>, loop: number[], normal: Vec3): Array<[number, number]> {
  // Build an orthonormal basis (u, v) for the plane.
  const [nx, ny, nz] = normal;
  const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
  // Pick a helper axis least aligned with the normal.
  let hx = 1, hy = 0, hz = 0;
  if (ax >= ay && ax >= az) { hx = 0; hy = 1; hz = 0; }
  // u = normalize(normal × helper)
  let ux = ny * hz - nz * hy;
  let uy = nz * hx - nx * hz;
  let uz = nx * hy - ny * hx;
  const ul = Math.hypot(ux, uy, uz) || 1;
  ux /= ul; uy /= ul; uz /= ul;
  // v = normal × u
  const vx = ny * uz - nz * uy;
  const vy = nz * ux - nx * uz;
  const vz = nx * uy - ny * ux;
  const out: Array<[number, number]> = [];
  for (const idx of loop) {
    const [px, py, pz] = getVertex(positions, idx);
    out.push([px * ux + py * uy + pz * uz, px * vx + py * vy + pz * vz]);
  }
  return out;
}

function signed2DArea(poly: Array<[number, number]>): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % poly.length];
    s += x1 * y2 - x2 * y1;
  }
  return s * 0.5;
}

function pointInTri2D(
  p: [number, number], a: [number, number], b: [number, number], c: [number, number],
): boolean {
  const d1 = (p[0] - b[0]) * (a[1] - b[1]) - (a[0] - b[0]) * (p[1] - b[1]);
  const d2 = (p[0] - c[0]) * (b[1] - c[1]) - (b[0] - c[0]) * (p[1] - c[1]);
  const d3 = (p[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (p[1] - a[1]);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}

/**
 * Ear-clip a simple polygon defined by 2D coords + parallel `loopIdx` (mesh
 * vertex indices). Returns an array of triangle index triples (mesh indices).
 * Output winding is CCW in the projected plane.
 */
function earClip2D(poly2D: Array<[number, number]>, loopIdx: number[]): number[][] {
  const n = poly2D.length;
  if (n < 3) return [];
  // Ensure CCW; if signed area is negative, reverse working copies.
  const ccw = signed2DArea(poly2D) >= 0;
  const verts = ccw ? poly2D.slice() : poly2D.slice().reverse();
  const idx = ccw ? loopIdx.slice() : loopIdx.slice().reverse();

  // Doubly-linked list of remaining vertex positions in `verts`.
  const prev: number[] = new Array(n);
  const next: number[] = new Array(n);
  for (let i = 0; i < n; i++) { prev[i] = (i + n - 1) % n; next[i] = (i + 1) % n; }

  const triangles: number[][] = [];
  let remaining = n;
  let guard = n * n; // worst-case ear search budget
  let i = 0;
  while (remaining > 3 && guard-- > 0) {
    const ai = prev[i], bi = i, ci = next[i];
    const a = verts[ai], b = verts[bi], c = verts[ci];
    // Convex test (CCW): cross(b-a, c-a) > 0
    const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    let isEar = cross > 0;
    if (isEar) {
      // No other vertex inside triangle abc.
      let k = next[ci];
      while (k !== ai) {
        if (pointInTri2D(verts[k], a, b, c)) { isEar = false; break; }
        k = next[k];
      }
    }
    if (isEar) {
      triangles.push([idx[ai], idx[bi], idx[ci]]);
      next[ai] = ci;
      prev[ci] = ai;
      remaining--;
      i = ai;
    } else {
      i = ci;
    }
  }
  if (remaining === 3) {
    triangles.push([idx[prev[i]], idx[i], idx[next[i]]]);
  }
  return triangles;
}

export function sealSmallHoles(mesh: RawMesh, options: SealOptions = {}): SealResult {
  const maxLoopEdges = options.maxLoopEdges ?? 32;
  const weldEpsilon = options.weldEpsilon ?? 1e-6;
  const { positions, indices } = getIndexed(mesh, weldEpsilon);
  const before = analyzeWatertightness({ positions, indices }, weldEpsilon);

  let sealedLoops = 0;
  let skippedLoops = 0;
  let addedTriangles = 0;
  const newIndices = indices.slice();

  for (const loop of before.boundaryLoops) {
    if (loop.length > maxLoopEdges || loop.length < 3) {
      skippedLoops++;
      continue;
    }
    // Project the (possibly non-planar) loop onto its best-fit plane and
    // ear-clip in 2D. This handles concave / irregular rims that a fan
    // triangulation would mis-cover with overlapping or zero-area faces.
    const normal = loopNormal(positions, loop);
    const poly2D = projectTo2D(positions, loop, normal);
    const tris = earClip2D(poly2D, loop);
    if (tris.length === 0) {
      // Degenerate (collinear / zero-area) loop — cannot triangulate reliably.
      skippedLoops++;
      continue;
    }
    // Reverse winding so the new face's outward normal opposes the boundary
    // half-edge direction (interior lies to the left of the directed rim).
    for (const [a, b, c] of tris) {
      newIndices.push(a, c, b);
      addedTriangles++;
    }
    sealedLoops++;
  }

  const sealedMesh: RawMesh = {
    positions: new Float32Array(positions),
    indices: new Uint32Array(newIndices),
  };
  const after = analyzeWatertightness(sealedMesh, weldEpsilon);
  return { mesh: sealedMesh, before, after, sealedLoops, skippedLoops, addedTriangles };
}

export function ensureWatertight(mesh: RawMesh, options: SealOptions = {}): SealResult {
  const initial = analyzeWatertightness(mesh, options.weldEpsilon ?? 1e-6);
  if (initial.isWatertight) {
    return {
      mesh,
      before: initial,
      after: initial,
      sealedLoops: 0,
      skippedLoops: 0,
      addedTriangles: 0,
    };
  }
  return sealSmallHoles(mesh, options);
}
