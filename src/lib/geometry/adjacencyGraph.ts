/**
 * Midwater Geometry Engine — Graph Construction
 *
 * Builds a face-adjacency graph from raw mesh topology.
 * Uses Szudzik integer hashing for O(F) edge deduplication.
 *
 * Framework-agnostic: operates on plain typed arrays.
 */

import type { Vec3, FaceAdjacencyGraph, EdgeFeatures } from './types';
import {
  edgeHash,
  dihedralAngle,
  isConcaveJunction,
  distance,
} from './meshMath';

interface HalfEdgeEntry {
  face: number;
  va: number;
  vb: number;
}

/**
 * Build the face-adjacency graph from mesh topology.
 *
 * Algorithm (single-pass, O(F)):
 *   1. For each triangle, hash its 3 edges via Szudzik pairing.
 *   2. Two faces sharing a mesh edge map to the same hash.
 *   3. Collect pairs into adjacency entries with edge features.
 *
 * @param indices  - Triangle index array (length = 3 × numFaces)
 * @param positions - Flat vertex position array (length = 3 × numVertices)
 * @param normals  - Per-face unit normals
 * @returns Complete face-adjacency graph
 */
export function buildAdjacencyGraph(
  indices: ArrayLike<number>,
  positions: ArrayLike<number>,
  normals: Vec3[],
): FaceAdjacencyGraph {
  const numFaces = (indices.length / 3) | 0;

  // Half-edge map: hash → first face to claim this edge
  const edgeMap = new Map<number, HalfEdgeEntry>();

  const adjacency: EdgeFeatures[] = [];
  const srcNodes: number[] = [];
  const dstNodes: number[] = [];
  const edgeAttrs: number[][] = [];

  // Per-node adjacency
  const neighbors = new Map<number, number[]>();
  const degreeArr = new Int32Array(numFaces);

  const addNeighbor = (node: number, neighbor: number) => {
    let list = neighbors.get(node);
    if (!list) {
      list = [];
      neighbors.set(node, list);
    }
    list.push(neighbor);
  };

  const getVertex = (idx: number): Vec3 => [
    positions[idx * 3],
    positions[idx * 3 + 1],
    positions[idx * 3 + 2],
  ];

  let edgeId = 0;

  for (let f = 0; f < numFaces; f++) {
    const base = f * 3;
    const i0 = indices[base];
    const i1 = indices[base + 1];
    const i2 = indices[base + 2];

    const triEdges: [number, number][] = [
      [i0, i1],
      [i1, i2],
      [i2, i0],
    ];

    for (const [va, vb] of triEdges) {
      const hash = edgeHash(va, vb);
      const existing = edgeMap.get(hash);

      if (existing) {
        // Adjacent face found — create adjacency entry
        const faceA = existing.face;
        const faceB = f;
        const nA = normals[faceA];
        const nB = normals[faceB];

        const dAngle = dihedralAngle(nA, nB);
        const vStart = getVertex(va);
        const vEnd = getVertex(vb);
        const edgeLen = distance(vStart, vEnd);
        const concave = isConcaveJunction(nA, nB, vStart, vEnd);

        // Curvature discontinuity: abs difference in dihedral from π (flat)
        const curvatureDisc = Math.abs(dAngle - Math.PI);

        adjacency.push({
          id: edgeId,
          faceA,
          faceB,
          sharedVertices: [va, vb],
          dihedralAngle: dAngle,
          isConcave: concave,
          length: edgeLen,
        });

        // Undirected: both directions for GNN message passing
        srcNodes.push(faceA, faceB);
        dstNodes.push(faceB, faceA);

        const attr = [dAngle, concave ? 1 : 0, edgeLen, curvatureDisc];
        edgeAttrs.push(attr, attr);

        addNeighbor(faceA, faceB);
        addNeighbor(faceB, faceA);
        degreeArr[faceA]++;
        degreeArr[faceB]++;

        edgeId++;
        edgeMap.delete(hash);
      } else {
        edgeMap.set(hash, { face: f, va, vb });
      }
    }
  }

  return {
    numNodes: numFaces,
    numEdges: adjacency.length,
    adjacency,
    edgeIndex: [srcNodes, dstNodes],
    edgeAttr: edgeAttrs,
    neighbors,
    degree: Array.from(degreeArr),
  };
}

/**
 * Compute connected components via BFS.
 * Returns array of component arrays (face indices).
 */
export function connectedComponents(graph: FaceAdjacencyGraph): number[][] {
  const visited = new Uint8Array(graph.numNodes);
  const components: number[][] = [];

  for (let start = 0; start < graph.numNodes; start++) {
    if (visited[start]) continue;

    const component: number[] = [];
    const queue: number[] = [start];
    visited[start] = 1;

    while (queue.length > 0) {
      const node = queue.shift()!;
      component.push(node);

      const nbrs = graph.neighbors.get(node);
      if (nbrs) {
        for (const n of nbrs) {
          if (!visited[n]) {
            visited[n] = 1;
            queue.push(n);
          }
        }
      }
    }
    components.push(component);
  }

  return components;
}
