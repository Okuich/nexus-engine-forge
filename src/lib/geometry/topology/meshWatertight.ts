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
    // Fan triangulation around loop[0]. Boundary directed edges run a -> b
    // such that the *interior* lies on one side; flipping fan order matches it.
    const a = loop[0];
    for (let i = 1; i < loop.length - 1; i++) {
      // Reverse winding so the new face's outward normal opposes the boundary
      // half-edge direction (which points along the hole rim with interior on the left).
      newIndices.push(a, loop[i + 1], loop[i]);
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
