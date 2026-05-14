/**
 * Topology Analysis — Euler characteristic, manifold checks, genus.
 *
 * Computes structural invariants of triangulated meshes:
 *   V - E + F = χ = 2 − 2g − b   (Euler-Poincaré)
 * where g = genus, b = boundary loop count.
 *
 * All routines are pure and operate on RawMesh.
 */

import type { RawMesh } from '../types';
import { normalizeIndexed } from './meshGenerator';

/** Stable undirected-edge string key. */
function edgeKey(a: number, b: number): string {
  return a < b ? `${a}_${b}` : `${b}_${a}`;
}

export interface TopologyReport {
  /** Vertex count (unique positions referenced). */
  vertices: number;
  /** Triangle face count. */
  faces: number;
  /** Unique undirected edge count. */
  edges: number;
  /** Euler characteristic χ = V - E + F. */
  eulerCharacteristic: number;
  /** Estimated genus g (assuming closed orientable manifold). */
  genus: number;
  /** Edges shared by exactly 2 faces (manifold edges). */
  manifoldEdges: number;
  /** Edges adjacent to exactly 1 face (open boundary). */
  boundaryEdges: number;
  /** Edges shared by ≥3 faces (non-manifold). */
  nonManifoldEdges: number;
  /** Number of distinct boundary loops. */
  boundaryLoops: number;
  /** True if every edge has exactly 2 incident faces. */
  isClosed: boolean;
  /** True when no non-manifold edges exist. */
  isManifold: boolean;
  /** Number of disconnected face components. */
  connectedComponents: number;
  /** True if mesh is closed, manifold, single-component. */
  isWatertight: boolean;
}

/**
 * Run a full topology analysis on a triangle mesh.
 */
export function analyzeTopology(input: RawMesh): TopologyReport {
  const mesh = normalizeIndexed(input);
  const indices = mesh.indices as ArrayLike<number>;
  const positions = mesh.positions as ArrayLike<number>;

  const faces = indices.length / 3;
  const vertexCount = positions.length / 3;
  const usedVertices = new Set<number>();

  // edgeKey -> [faceA, faceB?, ...]
  const edgeFaces = new Map<string, number[]>();
  // Boundary edges as undirected vertex pairs
  const boundaryPairs: Array<[number, number]> = [];

  for (let f = 0; f < faces; f++) {
    const a = indices[f * 3];
    const b = indices[f * 3 + 1];
    const c = indices[f * 3 + 2];
    usedVertices.add(a); usedVertices.add(b); usedVertices.add(c);

    for (const [u, v] of [[a, b], [b, c], [c, a]] as Array<[number, number]>) {
      const key = edgeKey(u, v);
      const arr = edgeFaces.get(key);
      if (arr) arr.push(f);
      else edgeFaces.set(key, [f]);
    }
  }

  let manifoldEdges = 0;
  let boundaryEdges = 0;
  let nonManifoldEdges = 0;
  for (const [key, fs] of edgeFaces) {
    if (fs.length === 1) {
      boundaryEdges++;
      const [u, v] = key.split('_').map(Number);
      boundaryPairs.push([u, v]);
    } else if (fs.length === 2) manifoldEdges++;
    else nonManifoldEdges++;
  }

  const edges = edgeFaces.size;
  const eulerChar = usedVertices.size - edges + faces;

  const components = countConnectedComponents(faces, edgeFaces);
  const boundaryLoops = countBoundaryLoops(boundaryPairs);

  const isClosed = boundaryEdges === 0;
  const isManifold = nonManifoldEdges === 0;
  const isWatertight = isClosed && isManifold && components === 1;

  // χ = 2 − 2g − b for a closed orientable manifold (b = boundary loops, treat as 0 for genus calc).
  const genus = isClosed && isManifold
    ? Math.max(0, Math.round((2 - eulerChar) / 2))
    : 0;

  return {
    vertices: usedVertices.size,
    faces,
    edges,
    eulerCharacteristic: eulerChar,
    genus,
    manifoldEdges,
    boundaryEdges,
    nonManifoldEdges,
    boundaryLoops,
    isClosed,
    isManifold,
    connectedComponents: components,
    isWatertight,
  };
  // vertexCount kept available for callers that want raw position count
  void vertexCount;
}

// ─── Internals ──────────────────────────────────────────────────

function countConnectedComponents(
  faces: number,
  edgeFaces: Map<string, number[]>,
): number {
  if (faces === 0) return 0;
  const adj: number[][] = Array.from({ length: faces }, () => []);
  for (const fs of edgeFaces.values()) {
    if (fs.length < 2) continue;
    for (let i = 0; i < fs.length; i++) {
      for (let j = i + 1; j < fs.length; j++) {
        adj[fs[i]].push(fs[j]);
        adj[fs[j]].push(fs[i]);
      }
    }
  }
  const visited = new Uint8Array(faces);
  let components = 0;
  for (let i = 0; i < faces; i++) {
    if (visited[i]) continue;
    components++;
    const stack = [i];
    while (stack.length) {
      const n = stack.pop()!;
      if (visited[n]) continue;
      visited[n] = 1;
      for (const m of adj[n]) if (!visited[m]) stack.push(m);
    }
  }
  return components;
}

/**
 * Count boundary loops as connected components of the undirected
 * boundary-edge graph. On a clean manifold, each boundary vertex has
 * exactly two boundary edges, so each component is a simple cycle.
 */
function countBoundaryLoops(pairs: Array<[number, number]>): number {
  if (pairs.length === 0) return 0;
  const adj = new Map<number, Set<number>>();
  const verts = new Set<number>();
  for (const [u, v] of pairs) {
    verts.add(u); verts.add(v);
    if (!adj.has(u)) adj.set(u, new Set());
    if (!adj.has(v)) adj.set(v, new Set());
    adj.get(u)!.add(v);
    adj.get(v)!.add(u);
  }
  const visited = new Set<number>();
  let components = 0;
  for (const start of verts) {
    if (visited.has(start)) continue;
    components++;
    const stack = [start];
    while (stack.length) {
      const n = stack.pop()!;
      if (visited.has(n)) continue;
      visited.add(n);
      for (const m of adj.get(n) ?? []) if (!visited.has(m)) stack.push(m);
    }
  }
  return components;
}
