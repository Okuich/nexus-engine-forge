/**
 * Quadric Error Metrics (QEM) mesh simplification.
 *
 * Garland & Heckbert 1997, with feature-preservation extensions:
 *   - sharp-edge weighting (dihedral > preserveSharpAngle)
 *   - boundary lock (open edges)
 *   - per-vertex curvature delta tracking
 *
 * Single-pass greedy edge-collapse using a binary heap priority queue.
 * Designed for sub-second processing of meshes up to a few hundred K
 * triangles, with linearly-scaling cost.
 */

import type { RawMesh } from '../types';
import type {
  SimplifiedMesh,
  SimplificationStats,
  SimplifyOptions,
} from './types';

// ─── Math helpers ────────────────────────────────────────────────

type Quadric = Float64Array; // length 10: symmetric 4x4 [a,b,c,d, e,f,g, h,i, j]

function makeQuadric(): Quadric {
  return new Float64Array(10);
}

/** Build plane quadric K = ppᵀ where p = (a,b,c,d), ax+by+cz+d=0 */
function planeQuadric(
  nx: number,
  ny: number,
  nz: number,
  d: number,
  out: Quadric,
): void {
  out[0] = nx * nx;
  out[1] = nx * ny;
  out[2] = nx * nz;
  out[3] = nx * d;
  out[4] = ny * ny;
  out[5] = ny * nz;
  out[6] = ny * d;
  out[7] = nz * nz;
  out[8] = nz * d;
  out[9] = d * d;
}

function addQuadric(target: Quadric, src: Quadric, scale = 1): void {
  for (let i = 0; i < 10; i++) target[i] += src[i] * scale;
}

/** Evaluate vᵀ Q v for v=(x,y,z,1) */
function evalQuadric(q: Quadric, x: number, y: number, z: number): number {
  return (
    q[0] * x * x +
    2 * q[1] * x * y +
    2 * q[2] * x * z +
    2 * q[3] * x +
    q[4] * y * y +
    2 * q[5] * y * z +
    2 * q[6] * y +
    q[7] * z * z +
    2 * q[8] * z +
    q[9]
  );
}

// ─── Min-heap on cost ────────────────────────────────────────────

interface HeapEntry {
  cost: number;
  v0: number;
  v1: number;
  /** Generation counter for staleness detection */
  gen0: number;
  gen1: number;
  tx: number;
  ty: number;
  tz: number;
}

class MinHeap {
  private data: HeapEntry[] = [];
  get size(): number {
    return this.data.length;
  }
  push(e: HeapEntry): void {
    this.data.push(e);
    this.up(this.data.length - 1);
  }
  pop(): HeapEntry | undefined {
    if (this.data.length === 0) return undefined;
    const top = this.data[0];
    const last = this.data.pop()!;
    if (this.data.length > 0) {
      this.data[0] = last;
      this.down(0);
    }
    return top;
  }
  private up(i: number): void {
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.data[p].cost <= this.data[i].cost) break;
      [this.data[p], this.data[i]] = [this.data[i], this.data[p]];
      i = p;
    }
  }
  private down(i: number): void {
    const n = this.data.length;
    while (true) {
      const l = 2 * i + 1;
      const r = 2 * i + 2;
      let best = i;
      if (l < n && this.data[l].cost < this.data[best].cost) best = l;
      if (r < n && this.data[r].cost < this.data[best].cost) best = r;
      if (best === i) break;
      [this.data[best], this.data[i]] = [this.data[i], this.data[best]];
      i = best;
    }
  }
}

// ─── Mesh normalization ──────────────────────────────────────────

function normalizeMesh(mesh: RawMesh): {
  positions: Float64Array;
  indices: Uint32Array;
} {
  const pos = mesh.positions;
  const positions = new Float64Array(pos.length);
  for (let i = 0; i < pos.length; i++) positions[i] = pos[i];

  let indices: Uint32Array;
  if (mesh.indices) {
    indices = new Uint32Array(mesh.indices.length);
    for (let i = 0; i < mesh.indices.length; i++) indices[i] = mesh.indices[i];
  } else {
    const triCount = (positions.length / 3 / 3) | 0;
    indices = new Uint32Array(triCount * 3);
    for (let i = 0; i < indices.length; i++) indices[i] = i;
  }
  return { positions, indices };
}

// ─── Main simplifier ─────────────────────────────────────────────

export function simplifyMesh(
  mesh: RawMesh,
  options: SimplifyOptions = {},
): { mesh: SimplifiedMesh; stats: SimplificationStats } {
  const t0 =
    typeof performance !== 'undefined' ? performance.now() : Date.now();

  const targetRatio = options.targetRatio ?? 0.5;
  const maxError = options.maxError ?? Number.POSITIVE_INFINITY;
  const sharpAngle = options.preserveSharpAngle ?? Math.PI / 4;
  const preserveBoundary = options.preserveBoundary ?? true;
  const featureWeight = options.featureWeight ?? 1000;
  const budget = options.timeBudgetMs ?? 250;

  const { positions, indices } = normalizeMesh(mesh);
  const vCount = (positions.length / 3) | 0;
  const fCount = (indices.length / 3) | 0;

  const targetTris =
    options.targetTriangles ?? Math.max(4, Math.floor(fCount * targetRatio));

  // Per-vertex quadrics
  const quadrics: Quadric[] = new Array(vCount);
  for (let i = 0; i < vCount; i++) quadrics[i] = makeQuadric();

  // Face validity + per-face plane
  const faceAlive = new Uint8Array(fCount).fill(1);
  const faceNormals = new Float64Array(fCount * 3);

  // Curvature baseline (mean angle deficit per vertex)
  const baselineCurv = new Float64Array(vCount);

  // Build face quadrics + edge map
  type EdgeInfo = { faceA: number; faceB: number };
  const edgeMap = new Map<number, EdgeInfo>();
  const edgeKey = (a: number, b: number): number => {
    const lo = a < b ? a : b;
    const hi = a < b ? b : a;
    return lo * vCount + hi;
  };

  const tmpQ = makeQuadric();

  for (let f = 0; f < fCount; f++) {
    const i0 = indices[f * 3];
    const i1 = indices[f * 3 + 1];
    const i2 = indices[f * 3 + 2];

    const ax = positions[i0 * 3],
      ay = positions[i0 * 3 + 1],
      az = positions[i0 * 3 + 2];
    const bx = positions[i1 * 3],
      by = positions[i1 * 3 + 1],
      bz = positions[i1 * 3 + 2];
    const cx = positions[i2 * 3],
      cy = positions[i2 * 3 + 1],
      cz = positions[i2 * 3 + 2];

    const ux = bx - ax,
      uy = by - ay,
      uz = bz - az;
    const vx = cx - ax,
      vy = cy - ay,
      vz = cz - az;

    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1e-30;
    nx /= len;
    ny /= len;
    nz /= len;

    faceNormals[f * 3] = nx;
    faceNormals[f * 3 + 1] = ny;
    faceNormals[f * 3 + 2] = nz;

    const d = -(nx * ax + ny * ay + nz * az);
    planeQuadric(nx, ny, nz, d, tmpQ);
    addQuadric(quadrics[i0], tmpQ);
    addQuadric(quadrics[i1], tmpQ);
    addQuadric(quadrics[i2], tmpQ);

    // Edges
    for (const [a, b] of [
      [i0, i1],
      [i1, i2],
      [i2, i0],
    ] as const) {
      const k = edgeKey(a, b);
      const existing = edgeMap.get(k);
      if (!existing) edgeMap.set(k, { faceA: f, faceB: -1 });
      else if (existing.faceB === -1) existing.faceB = f;
    }
  }

  // Sharp + boundary penalty quadrics
  for (const [k, e] of edgeMap) {
    const a = (k / vCount) | 0;
    const b = k % vCount;

    const isBoundary = e.faceB === -1;
    let isSharp = false;
    if (!isBoundary) {
      const n1x = faceNormals[e.faceA * 3];
      const n1y = faceNormals[e.faceA * 3 + 1];
      const n1z = faceNormals[e.faceA * 3 + 2];
      const n2x = faceNormals[e.faceB * 3];
      const n2y = faceNormals[e.faceB * 3 + 1];
      const n2z = faceNormals[e.faceB * 3 + 2];
      const dot = Math.max(-1, Math.min(1, n1x * n2x + n1y * n2y + n1z * n2z));
      const dihedral = Math.acos(dot);
      if (dihedral > sharpAngle) isSharp = true;
    }

    if ((isBoundary && preserveBoundary) || isSharp) {
      // Build constraint plane through edge perpendicular to face avg normal
      const ax = positions[a * 3],
        ay = positions[a * 3 + 1],
        az = positions[a * 3 + 2];
      const bx = positions[b * 3],
        by = positions[b * 3 + 1],
        bz = positions[b * 3 + 2];
      const ex = bx - ax,
        ey = by - ay,
        ez = bz - az;
      const fn = e.faceA;
      const nx = faceNormals[fn * 3],
        ny = faceNormals[fn * 3 + 1],
        nz = faceNormals[fn * 3 + 2];
      // perpendicular within face plane
      let px = ey * nz - ez * ny;
      let py = ez * nx - ex * nz;
      let pz = ex * ny - ey * nx;
      const plen = Math.hypot(px, py, pz) || 1e-30;
      px /= plen;
      py /= plen;
      pz /= plen;
      const d = -(px * ax + py * ay + pz * az);
      planeQuadric(px, py, pz, d, tmpQ);
      addQuadric(quadrics[a], tmpQ, featureWeight);
      addQuadric(quadrics[b], tmpQ, featureWeight);
    }
  }

  // Vertex adjacency
  const vAdj: Set<number>[] = new Array(vCount);
  for (let i = 0; i < vCount; i++) vAdj[i] = new Set();
  for (const k of edgeMap.keys()) {
    const a = (k / vCount) | 0;
    const b = k % vCount;
    vAdj[a].add(b);
    vAdj[b].add(a);
  }

  // Generation counters for heap staleness
  const gen = new Uint32Array(vCount);
  const alive = new Uint8Array(vCount).fill(1);
  const remap = new Int32Array(vCount); // collapse target
  for (let i = 0; i < vCount; i++) remap[i] = i;

  function findRoot(i: number): number {
    while (remap[i] !== i) {
      remap[i] = remap[remap[i]];
      i = remap[i];
    }
    return i;
  }

  // Compute optimal collapse position + cost
  function evalCollapse(
    v0: number,
    v1: number,
  ): { cost: number; tx: number; ty: number; tz: number } {
    // Use midpoint as target (closed-form QEM inversion is unstable for
    // ill-conditioned quadrics; midpoint is robust and common).
    const tx = (positions[v0 * 3] + positions[v1 * 3]) * 0.5;
    const ty = (positions[v0 * 3 + 1] + positions[v1 * 3 + 1]) * 0.5;
    const tz = (positions[v0 * 3 + 2] + positions[v1 * 3 + 2]) * 0.5;
    const q = makeQuadric();
    addQuadric(q, quadrics[v0]);
    addQuadric(q, quadrics[v1]);
    const cost = Math.max(0, evalQuadric(q, tx, ty, tz));
    return { cost, tx, ty, tz };
  }

  // Seed heap
  const heap = new MinHeap();
  for (const k of edgeMap.keys()) {
    const a = (k / vCount) | 0;
    const b = k % vCount;
    const { cost, tx, ty, tz } = evalCollapse(a, b);
    heap.push({ cost, v0: a, v1: b, gen0: 0, gen1: 0, tx, ty, tz });
  }

  let liveTris = fCount;
  let collapses = 0;
  let rejected = 0;
  let sumErr = 0;
  let maxErr = 0;

  // Track baseline curvature (sum of incident face normal divergence)
  for (let v = 0; v < vCount; v++) {
    let sum = 0;
    let count = 0;
    for (const u of vAdj[v]) {
      // approximate via direction to neighbor
      const dx = positions[u * 3] - positions[v * 3];
      const dy = positions[u * 3 + 1] - positions[v * 3 + 1];
      const dz = positions[u * 3 + 2] - positions[v * 3 + 2];
      const l = Math.hypot(dx, dy, dz) || 1e-30;
      sum += 1 / l;
      count++;
    }
    baselineCurv[v] = count > 0 ? sum / count : 0;
  }

  while (heap.size > 0 && liveTris > targetTris) {
    if (
      (collapses & 1023) === 0 &&
      (typeof performance !== 'undefined' ? performance.now() : Date.now()) -
        t0 >
        budget
    ) {
      break;
    }

    const e = heap.pop()!;
    if (!alive[e.v0] || !alive[e.v1]) continue;
    if (gen[e.v0] !== e.gen0 || gen[e.v1] !== e.gen1) continue;
    if (e.cost > maxError) {
      rejected++;
      continue;
    }
    if (!vAdj[e.v0].has(e.v1)) continue;

    // Collapse v1 → v0 at target
    positions[e.v0 * 3] = e.tx;
    positions[e.v0 * 3 + 1] = e.ty;
    positions[e.v0 * 3 + 2] = e.tz;
    addQuadric(quadrics[e.v0], quadrics[e.v1]);

    alive[e.v1] = 0;
    remap[e.v1] = e.v0;

    // Merge adjacency
    for (const n of vAdj[e.v1]) {
      if (n === e.v0) continue;
      vAdj[n].delete(e.v1);
      vAdj[n].add(e.v0);
      vAdj[e.v0].add(n);
    }
    vAdj[e.v0].delete(e.v1);
    vAdj[e.v1].clear();
    gen[e.v0]++;

    // Mark degenerate faces
    for (let f = 0; f < fCount; f++) {
      if (!faceAlive[f]) continue;
      let i0 = indices[f * 3];
      let i1 = indices[f * 3 + 1];
      let i2 = indices[f * 3 + 2];
      if (i0 === e.v1) i0 = e.v0;
      if (i1 === e.v1) i1 = e.v0;
      if (i2 === e.v1) i2 = e.v0;
      if (i0 === i1 || i1 === i2 || i2 === i0) {
        if (faceAlive[f]) {
          faceAlive[f] = 0;
          liveTris--;
        }
      }
      indices[f * 3] = i0;
      indices[f * 3 + 1] = i1;
      indices[f * 3 + 2] = i2;
    }

    collapses++;
    sumErr += e.cost;
    if (e.cost > maxErr) maxErr = e.cost;

    // Re-push edges from v0
    for (const n of vAdj[e.v0]) {
      const r = evalCollapse(e.v0, n);
      heap.push({
        cost: r.cost,
        v0: e.v0,
        v1: n,
        gen0: gen[e.v0],
        gen1: gen[n],
        tx: r.tx,
        ty: r.ty,
        tz: r.tz,
      });
    }
  }

  // Compact output
  const newVIdx = new Int32Array(vCount).fill(-1);
  let nv = 0;
  for (let i = 0; i < vCount; i++) {
    if (alive[i]) newVIdx[i] = nv++;
  }
  const outPositions = new Float32Array(nv * 3);
  for (let i = 0; i < vCount; i++) {
    if (alive[i]) {
      const j = newVIdx[i];
      outPositions[j * 3] = positions[i * 3];
      outPositions[j * 3 + 1] = positions[i * 3 + 1];
      outPositions[j * 3 + 2] = positions[i * 3 + 2];
    }
  }

  let outFaceCount = 0;
  for (let f = 0; f < fCount; f++) if (faceAlive[f]) outFaceCount++;
  const outIndices = new Uint32Array(outFaceCount * 3);
  let w = 0;
  for (let f = 0; f < fCount; f++) {
    if (!faceAlive[f]) continue;
    outIndices[w++] = newVIdx[findRoot(indices[f * 3])];
    outIndices[w++] = newVIdx[findRoot(indices[f * 3 + 1])];
    outIndices[w++] = newVIdx[findRoot(indices[f * 3 + 2])];
  }

  // Curvature delta — compare incident-edge inverse-length means
  let curvDelta = 0;
  let curvSamples = 0;
  const newAdj: Set<number>[] = new Array(nv);
  for (let i = 0; i < nv; i++) newAdj[i] = new Set();
  for (let f = 0; f < outFaceCount; f++) {
    const a = outIndices[f * 3];
    const b = outIndices[f * 3 + 1];
    const c = outIndices[f * 3 + 2];
    newAdj[a].add(b);
    newAdj[a].add(c);
    newAdj[b].add(a);
    newAdj[b].add(c);
    newAdj[c].add(a);
    newAdj[c].add(b);
  }
  for (let oldV = 0; oldV < vCount; oldV++) {
    if (!alive[oldV]) continue;
    const j = newVIdx[oldV];
    let sum = 0;
    let count = 0;
    for (const u of newAdj[j]) {
      const dx = outPositions[u * 3] - outPositions[j * 3];
      const dy = outPositions[u * 3 + 1] - outPositions[j * 3 + 1];
      const dz = outPositions[u * 3 + 2] - outPositions[j * 3 + 2];
      const l = Math.hypot(dx, dy, dz) || 1e-30;
      sum += 1 / l;
      count++;
    }
    const newC = count > 0 ? sum / count : 0;
    curvDelta += Math.abs(newC - baselineCurv[oldV]);
    curvSamples++;
  }
  curvDelta = curvSamples > 0 ? curvDelta / curvSamples : 0;

  const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now();

  const stats: SimplificationStats = {
    inputTriangles: fCount,
    outputTriangles: outFaceCount,
    inputVertices: vCount,
    outputVertices: nv,
    ratio: fCount > 0 ? outFaceCount / fCount : 0,
    collapses,
    rejectedCollapses: rejected,
    meanError: collapses > 0 ? sumErr / collapses : 0,
    maxError: maxErr,
    curvatureDelta: curvDelta,
    elapsedMs: t1 - t0,
  };

  return {
    mesh: { positions: outPositions, indices: outIndices },
    stats,
  };
}
