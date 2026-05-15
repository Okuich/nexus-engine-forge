/**
 * Pure-JS core for simplify-api: vertex-cluster simplification, LOD chain,
 * and heaviest-edge graph coarsening. No Deno-only imports — safe to import
 * from Vitest tests running under Node.
 */

export type V3 = [number, number, number];
export interface RawMesh { positions: number[]; indices?: number[] }
export interface SerializedMesh {
  positions: string;
  indices: string;
  vertexCount: number;
  triangleCount: number;
}
export interface SimplifiedLODOut {
  level: number;
  ratio: number;
  mesh: SerializedMesh;
  stats: {
    inputTriangles: number;
    outputTriangles: number;
    inputVertices: number;
    outputVertices: number;
    elapsedMs: number;
  };
}
export interface SimplifiedGraphOut {
  nodeCount: number;
  edgeCount: number;
  edges: Array<[number, number]>;
  clusters: number[][];
  nodeFeatures: Array<{ area: number; avgNormal: V3; avgCurvature: number }>;
  edgeCompression: number;
}
export interface MeshArrays {
  positions: Float32Array;
  indices: Uint32Array;
}

export const MAX_TRIANGLES = 200_000;
export const MAX_LODS = 6;

export function meshToArrays(m: RawMesh): MeshArrays {
  const positions = new Float32Array(m.positions);
  const indices = m.indices && m.indices.length > 0
    ? new Uint32Array(m.indices)
    : (() => {
        const triCount = (positions.length / 3 / 3) | 0;
        const idx = new Uint32Array(triCount * 3);
        for (let i = 0; i < idx.length; i++) idx[i] = i;
        return idx;
      })();
  return { positions, indices };
}

function meshBounds(positions: Float32Array): { min: V3; max: V3 } {
  const min: V3 = [Infinity, Infinity, Infinity];
  const max: V3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let a = 0; a < 3; a++) {
      const v = positions[i + a];
      if (v < min[a]) min[a] = v;
      if (v > max[a]) max[a] = v;
    }
  }
  return { min, max };
}

function simplifyVertexCluster(input: MeshArrays, gridResolution: number): MeshArrays {
  const { min, max } = meshBounds(input.positions);
  const span = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2], 1e-9);
  const cell = span / Math.max(2, gridResolution);

  const vertCount = (input.positions.length / 3) | 0;
  const vertexToCluster = new Int32Array(vertCount);
  const clusterMap = new Map<number, number>();
  const sumX: number[] = [], sumY: number[] = [], sumZ: number[] = [], counts: number[] = [];

  for (let v = 0; v < vertCount; v++) {
    const x = input.positions[v * 3];
    const y = input.positions[v * 3 + 1];
    const z = input.positions[v * 3 + 2];
    const ix = Math.floor((x - min[0]) / cell);
    const iy = Math.floor((y - min[1]) / cell);
    const iz = Math.floor((z - min[2]) / cell);
    const G = gridResolution + 2;
    const key = ix + iy * G + iz * G * G;
    let cid = clusterMap.get(key);
    if (cid === undefined) {
      cid = sumX.length;
      clusterMap.set(key, cid);
      sumX.push(0); sumY.push(0); sumZ.push(0); counts.push(0);
    }
    sumX[cid] += x; sumY[cid] += y; sumZ[cid] += z; counts[cid]++;
    vertexToCluster[v] = cid;
  }

  const newPositions = new Float32Array(sumX.length * 3);
  for (let i = 0; i < sumX.length; i++) {
    newPositions[i * 3] = sumX[i] / counts[i];
    newPositions[i * 3 + 1] = sumY[i] / counts[i];
    newPositions[i * 3 + 2] = sumZ[i] / counts[i];
  }

  const newIdx: number[] = [];
  const seen = new Set<string>();
  for (let t = 0; t < input.indices.length; t += 3) {
    const a = vertexToCluster[input.indices[t]];
    const b = vertexToCluster[input.indices[t + 1]];
    const c = vertexToCluster[input.indices[t + 2]];
    if (a === b || b === c || a === c) continue;
    const key = `${Math.min(a, b, c)}_${a + b + c}_${Math.max(a, b, c)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    newIdx.push(a, b, c);
  }

  return { positions: newPositions, indices: new Uint32Array(newIdx) };
}

function b64FromBuffer(buf: ArrayBufferView): string {
  const bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, Math.min(i + CHUNK, bytes.length)));
  }
  return btoa(bin);
}

export function serializeMesh(m: MeshArrays): SerializedMesh {
  return {
    positions: b64FromBuffer(m.positions),
    indices: b64FromBuffer(m.indices),
    vertexCount: m.positions.length / 3,
    triangleCount: m.indices.length / 3,
  };
}

export function buildLODs(
  mesh: RawMesh,
  options: { levels?: number; ratioPerLevel?: number; minTriangles?: number; maxLevels?: number },
): { lods: SimplifiedLODOut[]; totalElapsedMs: number } {
  const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const requested = options.levels ?? 3;
  const cap = Math.min(options.maxLevels ?? requested, MAX_LODS);
  const levels = Math.min(requested, cap);
  const ratio = options.ratioPerLevel ?? 0.5;
  const minTris = options.minTriangles ?? 64;

  const base = meshToArrays(mesh);
  const baseTri = (base.indices.length / 3) | 0;

  const lods: SimplifiedLODOut[] = [];
  lods.push({
    level: 0,
    ratio: 1,
    mesh: serializeMesh(base),
    stats: {
      inputTriangles: baseTri,
      outputTriangles: baseTri,
      inputVertices: base.positions.length / 3,
      outputVertices: base.positions.length / 3,
      elapsedMs: 0,
    },
  });

  let prev = base;
  for (let lvl = 1; lvl <= levels; lvl++) {
    const targetTri = Math.max(minTris, Math.floor(baseTri * Math.pow(ratio, lvl)));
    if (targetTri >= ((prev.indices.length / 3) | 0)) break;
    if ((prev.indices.length / 3) <= minTris) break;
    const gridRes = Math.max(4, Math.round(Math.sqrt(targetTri * 2)));
    const tStart = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const simplified = simplifyVertexCluster(prev, gridRes);
    const tElapsed = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - tStart;
    const outTri = (simplified.indices.length / 3) | 0;
    if (outTri < 4) break;
    lods.push({
      level: lvl,
      ratio: outTri / baseTri,
      mesh: serializeMesh(simplified),
      stats: {
        inputTriangles: (prev.indices.length / 3) | 0,
        outputTriangles: outTri,
        inputVertices: prev.positions.length / 3,
        outputVertices: simplified.positions.length / 3,
        elapsedMs: tElapsed,
      },
    });
    prev = simplified;
  }

  const tEnd = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  return { lods, totalElapsedMs: tEnd - t0 };
}

interface FaceFeat { area: number; normal: V3; centroid: V3; }

function buildFaceAdjacency(m: MeshArrays): {
  faces: FaceFeat[];
  adjacency: Map<number, Set<number>>;
} {
  const faceCount = (m.indices.length / 3) | 0;
  const faces: FaceFeat[] = new Array(faceCount);
  const edgeMap = new Map<string, number[]>();

  for (let f = 0; f < faceCount; f++) {
    const ia = m.indices[f * 3], ib = m.indices[f * 3 + 1], ic = m.indices[f * 3 + 2];
    const ax = m.positions[ia * 3], ay = m.positions[ia * 3 + 1], az = m.positions[ia * 3 + 2];
    const bx = m.positions[ib * 3], by = m.positions[ib * 3 + 1], bz = m.positions[ib * 3 + 2];
    const cx = m.positions[ic * 3], cy = m.positions[ic * 3 + 1], cz = m.positions[ic * 3 + 2];
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    const area = len * 0.5;
    const inv = len > 1e-20 ? 1 / len : 0;
    faces[f] = {
      area,
      normal: [nx * inv, ny * inv, nz * inv],
      centroid: [(ax + bx + cx) / 3, (ay + by + cy) / 3, (az + bz + cz) / 3],
    };
    const triEdges: Array<[number, number]> = [
      [Math.min(ia, ib), Math.max(ia, ib)],
      [Math.min(ib, ic), Math.max(ib, ic)],
      [Math.min(ia, ic), Math.max(ia, ic)],
    ];
    for (const [u, v] of triEdges) {
      const k = `${u}_${v}`;
      let arr = edgeMap.get(k);
      if (!arr) { arr = []; edgeMap.set(k, arr); }
      arr.push(f);
    }
  }

  const adjacency = new Map<number, Set<number>>();
  for (let f = 0; f < faceCount; f++) adjacency.set(f, new Set());
  for (const arr of edgeMap.values()) {
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) {
        adjacency.get(arr[i])!.add(arr[j]);
        adjacency.get(arr[j])!.add(arr[i]);
      }
    }
  }
  return { faces, adjacency };
}

export function coarsenGraph(
  m: MeshArrays,
  targetNodes?: number,
  targetRatio?: number,
): SimplifiedGraphOut {
  const { faces, adjacency } = buildFaceAdjacency(m);
  const faceCount = faces.length;
  const target = Math.max(
    1,
    targetNodes ?? Math.floor(faceCount * (targetRatio ?? 0.25)),
  );

  const parent = new Int32Array(faceCount);
  for (let i = 0; i < faceCount; i++) parent[i] = i;
  const find = (x: number): number => {
    while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; }
    return x;
  };

  type Edge = { a: number; b: number; w: number };
  const edges: Edge[] = [];
  for (const [u, set] of adjacency.entries()) {
    for (const v of set) {
      if (v <= u) continue;
      const fa = faces[u], fb = faces[v];
      const cos = Math.max(0, fa.normal[0] * fb.normal[0] + fa.normal[1] * fb.normal[1] + fa.normal[2] * fb.normal[2]);
      edges.push({ a: u, b: v, w: Math.min(fa.area, fb.area) * (0.25 + cos) });
    }
  }
  edges.sort((p, q) => q.w - p.w);

  let active = faceCount;
  for (const e of edges) {
    if (active <= target) break;
    const ra = find(e.a), rb = find(e.b);
    if (ra === rb) continue;
    parent[rb] = ra;
    active--;
  }

  const clusterIdMap = new Map<number, number>();
  const clusters: number[][] = [];
  for (let f = 0; f < faceCount; f++) {
    const r = find(f);
    let id = clusterIdMap.get(r);
    if (id === undefined) {
      id = clusters.length;
      clusterIdMap.set(r, id);
      clusters.push([]);
    }
    clusters[id].push(f);
  }
  const nodeCount = clusters.length;

  const nodeFeatures = clusters.map((cluster) => {
    let area = 0;
    let nx = 0, ny = 0, nz = 0;
    for (const f of cluster) {
      const fa = faces[f];
      area += fa.area;
      nx += fa.normal[0] * fa.area;
      ny += fa.normal[1] * fa.area;
      nz += fa.normal[2] * fa.area;
    }
    const len = Math.hypot(nx, ny, nz) || 1;
    return {
      area,
      avgNormal: [nx / len, ny / len, nz / len] as V3,
      avgCurvature: 0,
    };
  });

  const coarseEdgeSet = new Set<string>();
  const outEdges: Array<[number, number]> = [];
  for (const [u, set] of adjacency.entries()) {
    const cu = clusterIdMap.get(find(u))!;
    for (const v of set) {
      const cv = clusterIdMap.get(find(v))!;
      if (cu === cv) continue;
      const a = Math.min(cu, cv), b = Math.max(cu, cv);
      const key = `${a}_${b}`;
      if (coarseEdgeSet.has(key)) continue;
      coarseEdgeSet.add(key);
      outEdges.push([a, b]);
    }
  }

  let origEdges = 0;
  for (const set of adjacency.values()) origEdges += set.size;
  origEdges = Math.max(1, origEdges / 2);

  return {
    nodeCount,
    edgeCount: outEdges.length,
    edges: outEdges,
    clusters,
    nodeFeatures,
    edgeCompression: outEdges.length / origEdges,
  };
}
