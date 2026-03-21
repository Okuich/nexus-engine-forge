/**
 * FORGECAD Graph Construction Module
 *
 * Builds a face-adjacency graph from triangle mesh topology.
 * Nodes = faces, Edges = shared mesh edges between adjacent faces.
 *
 * Uses Cantor-pairing integer hashing for O(1) edge lookups —
 * significantly faster than string-key maps on large meshes.
 *
 * Returns PyTorch Geometric–compatible edge_index [2, num_edges].
 */

// ─── Types ───────────────────────────────────────────────────────

export interface AdjacencyEntry {
  /** Unique id of this adjacency */
  id: number;
  /** Source face index (node) */
  faceA: number;
  /** Target face index (node) */
  faceB: number;
  /** Indices of the two shared vertices in the original mesh */
  sharedVertices: [number, number];
  /** Dihedral angle between face normals (radians) */
  dihedralAngle: number;
  /** True if the junction is concave (interior angle > π) */
  isConcave: boolean;
  /** Length of the shared geometric edge */
  edgeLength: number;
}

export interface FaceAdjacencyGraph {
  /** Number of nodes (faces) */
  numNodes: number;
  /** Number of undirected adjacency edges */
  numEdges: number;
  /** Full adjacency list */
  adjacency: AdjacencyEntry[];
  /**
   * COO edge_index in PyTorch Geometric format: [2, 2*numEdges]
   * Both directions included (undirected graph).
   * Row 0 = source node indices, Row 1 = target node indices.
   */
  edgeIndex: [number[], number[]];
  /**
   * Edge feature matrix [2*numEdges, 3]
   * Features: [dihedral_angle, is_concave (0/1), edge_length]
   * Aligned with edgeIndex columns.
   */
  edgeAttr: number[][];
  /** Per-node adjacency list for fast neighbor lookup */
  neighbors: Map<number, number[]>;
  /** Degree of each node */
  degree: number[];
}

// ─── Integer Edge Hashing ────────────────────────────────────────

/**
 * Cantor pairing function for ordered (a, b) where a ≤ b.
 * Produces a unique integer for each unordered vertex pair.
 * Much faster than string concatenation for large meshes.
 */
function edgeHash(a: number, b: number): number {
  const lo = a < b ? a : b;
  const hi = a < b ? b : a;
  // Szudzik's elegant pairing (handles larger indices than Cantor)
  return hi >= lo ? hi * hi + hi + lo : lo * lo + hi;
}

// ─── Topology Traversal ──────────────────────────────────────────

/**
 * Build face adjacency by traversing mesh topology.
 *
 * Algorithm (O(F) where F = number of faces):
 * 1. For each triangle, insert its 3 half-edges into a hash map.
 * 2. Two faces sharing an edge will map to the same hash.
 * 3. Collect pairs → adjacency entries.
 *
 * This is a single-pass approach — no sorting needed.
 */
export function buildFaceAdjacency(
  index: ArrayLike<number>,
  positions: ArrayLike<number>,
  faceNormals: Array<[number, number, number]>,
): FaceAdjacencyGraph {
  const numTris = (index.length / 3) | 0;

  // Phase 1: Hash all half-edges → face ownership
  // Key: edge hash, Value: [faceIndex, vertexA, vertexB]
  const edgeMap = new Map<number, { face: number; va: number; vb: number }>();
  const adjacency: AdjacencyEntry[] = [];
  const edgeIndexSrc: number[] = [];
  const edgeIndexDst: number[] = [];
  const edgeAttr: number[][] = [];

  // Per-node neighbor lists
  const neighbors = new Map<number, number[]>();
  const degree = new Int32Array(numTris);

  const ensureNeighbor = (node: number, neighbor: number) => {
    let arr = neighbors.get(node);
    if (!arr) { arr = []; neighbors.set(node, arr); }
    arr.push(neighbor);
  };

  let adjId = 0;

  for (let f = 0; f < numTris; f++) {
    const base = f * 3;
    const i0 = index[base];
    const i1 = index[base + 1];
    const i2 = index[base + 2];

    // Three edges per triangle
    const triEdges: [number, number][] = [[i0, i1], [i1, i2], [i2, i0]];

    for (const [va, vb] of triEdges) {
      const hash = edgeHash(va, vb);
      const existing = edgeMap.get(hash);

      if (existing) {
        // Found adjacent face — create adjacency entry
        const fa = existing.face;
        const fb = f;

        // Dihedral angle between face normals
        const na = faceNormals[fa];
        const nb = faceNormals[fb];
        const dot = na[0] * nb[0] + na[1] * nb[1] + na[2] * nb[2];
        const dihedralAngle = Math.acos(Math.max(-1, Math.min(1, dot)));

        // Shared edge length
        const ax = positions[va * 3], ay = positions[va * 3 + 1], az = positions[va * 3 + 2];
        const bx = positions[vb * 3], by = positions[vb * 3 + 1], bz = positions[vb * 3 + 2];
        const edgeLength = Math.sqrt(
          (bx - ax) ** 2 + (by - ay) ** 2 + (bz - az) ** 2,
        );

        // Concavity test: cross(na, nb) · edgeDir
        const cx = na[1] * nb[2] - na[2] * nb[1];
        const cy = na[2] * nb[0] - na[0] * nb[2];
        const cz = na[0] * nb[1] - na[1] * nb[0];
        const dx = bx - ax, dy = by - ay, dz = bz - az;
        const isConcave = (cx * dx + cy * dy + cz * dz) < 0;

        adjacency.push({
          id: adjId,
          faceA: fa,
          faceB: fb,
          sharedVertices: [va, vb],
          dihedralAngle,
          isConcave,
          edgeLength,
        });

        // Undirected: push both directions for PyG
        edgeIndexSrc.push(fa, fb);
        edgeIndexDst.push(fb, fa);

        const feat = [dihedralAngle, isConcave ? 1 : 0, edgeLength];
        edgeAttr.push(feat, feat); // same features both directions

        ensureNeighbor(fa, fb);
        ensureNeighbor(fb, fa);
        degree[fa]++;
        degree[fb]++;

        adjId++;

        // Remove from map (each mesh edge is shared by at most 2 faces)
        edgeMap.delete(hash);
      } else {
        // First face to register this edge
        edgeMap.set(hash, { face: f, va, vb });
      }
    }
  }

  return {
    numNodes: numTris,
    numEdges: adjacency.length,
    adjacency,
    edgeIndex: [edgeIndexSrc, edgeIndexDst],
    edgeAttr,
    neighbors,
    degree: Array.from(degree),
  };
}

// ─── Utilities ───────────────────────────────────────────────────

/**
 * Convert the graph to a plain JSON object for serialization.
 * Compatible with PyTorch Geometric Data format.
 */
export function graphToDict(graph: FaceAdjacencyGraph, nodeFeatures?: number[][]) {
  return {
    num_nodes: graph.numNodes,
    num_edges: graph.numEdges * 2, // undirected, both directions
    edge_index: graph.edgeIndex,
    edge_attr: graph.edgeAttr,
    degree: graph.degree,
    ...(nodeFeatures ? { x: nodeFeatures } : {}),
    adjacency_list: Object.fromEntries(graph.neighbors),
  };
}

/**
 * Compute connected components using BFS on the face-adjacency graph.
 * Useful for detecting disconnected parts in the mesh.
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

/**
 * Extract a k-hop subgraph around a seed face.
 * Returns the set of face indices within k hops.
 */
export function kHopSubgraph(
  graph: FaceAdjacencyGraph,
  seed: number,
  k: number,
): Set<number> {
  const visited = new Set<number>([seed]);
  let frontier = [seed];

  for (let hop = 0; hop < k; hop++) {
    const nextFrontier: number[] = [];
    for (const node of frontier) {
      const nbrs = graph.neighbors.get(node);
      if (nbrs) {
        for (const n of nbrs) {
          if (!visited.has(n)) {
            visited.add(n);
            nextFrontier.push(n);
          }
        }
      }
    }
    frontier = nextFrontier;
    if (frontier.length === 0) break;
  }

  return visited;
}
