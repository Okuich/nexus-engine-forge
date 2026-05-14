/**
 * Face-adjacency graph coarsening via Heavy-Edge Matching (HEM).
 *
 * Reduces graph density while preserving feature edges (high dihedral)
 * and aggregating per-cluster features for downstream inference.
 */

import type { FaceAdjacencyGraph, Vec3 } from '../types';
import type { GraphSimplifyOptions, SimplifiedGraph } from './types';

interface FaceAdjacencyGraphLike {
  nodeCount: number;
  edges: Array<{
    faceA: number;
    faceB: number;
    dihedralAngle: number;
    isConcave?: boolean;
    length?: number;
  }>;
  faces?: Array<{
    area: number;
    normal: Vec3;
    curvatureMean?: number;
  }>;
}

export function simplifyGraph(
  graph: FaceAdjacencyGraph | FaceAdjacencyGraphLike,
  options: GraphSimplifyOptions = {},
): SimplifiedGraph {
  const g = graph as FaceAdjacencyGraphLike;
  const n = g.nodeCount;
  const sharpAngle = options.preserveSharpAngle ?? Math.PI / 4;
  const targetRatio = options.targetRatio ?? 0.5;
  const targetNodes =
    options.targetNodes ?? Math.max(2, Math.floor(n * targetRatio));

  // Sort edges by weight desc; weight = inverse dihedral (smooth pairs collapse first)
  const candidates = g.edges
    .filter((e) => e.dihedralAngle <= sharpAngle)
    .map((e) => ({
      a: e.faceA,
      b: e.faceB,
      w: Math.cos(e.dihedralAngle),
    }))
    .sort((x, y) => y.w - x.w);

  const parent = new Int32Array(n);
  for (let i = 0; i < n; i++) parent[i] = i;
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };

  let activeNodes = n;
  for (const c of candidates) {
    if (activeNodes <= targetNodes) break;
    const ra = find(c.a);
    const rb = find(c.b);
    if (ra === rb) continue;
    parent[ra] = rb;
    activeNodes--;
  }

  // Collect clusters
  const clusterMap = new Map<number, number>();
  const clusters: number[][] = [];
  for (let i = 0; i < n; i++) {
    const r = find(i);
    let idx = clusterMap.get(r);
    if (idx === undefined) {
      idx = clusters.length;
      clusterMap.set(r, idx);
      clusters.push([]);
    }
    clusters[idx].push(i);
  }

  // Build coarse edges (dedup)
  const edgeSet = new Set<number>();
  const edges: Array<[number, number]> = [];
  const nc = clusters.length;
  for (const e of g.edges) {
    const ca = clusterMap.get(find(e.faceA))!;
    const cb = clusterMap.get(find(e.faceB))!;
    if (ca === cb) continue;
    const lo = Math.min(ca, cb);
    const hi = Math.max(ca, cb);
    const key = lo * nc + hi;
    if (edgeSet.has(key)) continue;
    edgeSet.add(key);
    edges.push([lo, hi]);
  }

  // Aggregate node features
  const faces = g.faces ?? [];
  const nodeFeatures = clusters.map((members) => {
    let area = 0;
    let nx = 0,
      ny = 0,
      nz = 0;
    let curv = 0;
    let count = 0;
    for (const m of members) {
      const f = faces[m];
      if (!f) continue;
      area += f.area;
      nx += f.normal[0] * f.area;
      ny += f.normal[1] * f.area;
      nz += f.normal[2] * f.area;
      curv += f.curvatureMean ?? 0;
      count++;
    }
    const len = Math.hypot(nx, ny, nz) || 1;
    return {
      area,
      avgNormal: [nx / len, ny / len, nz / len] as [number, number, number],
      avgCurvature: count > 0 ? curv / count : 0,
    };
  });

  return {
    nodeCount: clusters.length,
    edgeCount: edges.length,
    clusters,
    edges,
    nodeFeatures,
    edgeCompression:
      g.edges.length > 0 ? edges.length / g.edges.length : 0,
  };
}
