/**
 * Spatial Index Serialization
 * ───────────────────────────
 * Persist BVH / Octree / KD-Tree state so that production callers can
 * cache acceleration structures (e.g. in IndexedDB, the file system,
 * or object storage) and re-hydrate them without rebuilding from a
 * RawMesh.
 *
 * Wire format design goals:
 *   • Self-describing  — `kind` + `version` envelope on every blob
 *   • Compact          — typed arrays for hot data (floats, indices)
 *   • Structured-clone friendly (works through postMessage / IDB)
 *   • JSON fallback    — `toJSON` / `fromJSON` for transport over HTTP
 *
 * Hydration uses `Object.create` to bypass each class's build-from-mesh
 * constructor, which is the whole point: O(n) reload instead of
 * O(n log n) build.
 */

import type { Vec3 } from '../types';
import type { AABB } from '../core/spatialIndex';
import { BVH } from '../core/spatialIndex';
import { Octree } from './octree';
import { KDTree } from './kdTree';

export const SPATIAL_FORMAT_VERSION = 1 as const;

// ─── Envelope ───────────────────────────────────────────────────

export type SerializedKind = 'bvh' | 'octree' | 'kdtree';

interface Envelope<K extends SerializedKind, P> {
  kind: K;
  version: typeof SPATIAL_FORMAT_VERSION;
  payload: P;
}

export type SerializedBVH = Envelope<'bvh', BVHPayload>;
export type SerializedOctree = Envelope<'octree', OctreePayload>;
export type SerializedKDTree = Envelope<'kdtree', KDPayload>;
export type SerializedSpatialIndex =
  | SerializedBVH
  | SerializedOctree
  | SerializedKDTree;

// ─── BVH payload ────────────────────────────────────────────────

interface BVHPayload {
  /** Triangle vertex data, 9 floats per triangle (v0xyz, v1xyz, v2xyz). */
  triVerts: Float32Array;
  /** Original triangle index per slot (so external references stay stable). */
  triIndices: Uint32Array;
  /** Flattened node table (see BVHNodeRecord). */
  nodes: BVHNodeRecord[];
  /** Index of the root node in `nodes`. */
  rootIndex: number;
}

interface BVHNodeRecord {
  bMin: [number, number, number];
  bMax: [number, number, number];
  /** Children indices into `nodes`, or -1 if leaf. */
  left: number;
  right: number;
  /** Triangle slot indices (into triVerts/triIndices) when leaf, else null. */
  leaf: number[] | null;
}

// ─── Octree payload ─────────────────────────────────────────────

interface OctreePayload {
  triVerts: Float32Array;
  triIndices: Uint32Array;
  nodes: OctreeNodeRecord[];
  rootIndex: number;
}

interface OctreeNodeRecord {
  bMin: [number, number, number];
  bMax: [number, number, number];
  /** Triangle slot indices held at this node (loose-octree tail). */
  triangles: number[];
  /** Eight children indices, or null if leaf. */
  children: number[] | null;
}

// ─── KDTree payload ─────────────────────────────────────────────

interface KDPayload {
  /** Point cloud, 3 floats per point. */
  points: Float32Array;
  nodes: KDNodeRecord[];
  rootIndex: number;
}

interface KDNodeRecord {
  index: number;
  axis: 0 | 1 | 2;
  left: number;  // -1 if absent
  right: number; // -1 if absent
}

// ─── Internal triangle shape ────────────────────────────────────
// Mirrors the private Triangle interface used by BVH/Octree at runtime.

interface RuntimeTriangle {
  index: number;
  v0: Vec3; v1: Vec3; v2: Vec3;
  centroid: Vec3;
  bounds: AABB;
}

interface RuntimeBVHNode {
  bounds: AABB;
  left?: RuntimeBVHNode;
  right?: RuntimeBVHNode;
  triangles?: number[];
}

interface RuntimeOctreeNode {
  bounds: AABB;
  center: Vec3;
  triangles: RuntimeTriangle[];
  children?: RuntimeOctreeNode[];
}

interface RuntimeKDNode {
  index: number;
  axis: 0 | 1 | 2;
  point: Vec3;
  left?: RuntimeKDNode;
  right?: RuntimeKDNode;
}

// ─── Helpers ────────────────────────────────────────────────────

function packTriangles(tris: RuntimeTriangle[]): {
  triVerts: Float32Array;
  triIndices: Uint32Array;
} {
  const n = tris.length;
  const triVerts = new Float32Array(n * 9);
  const triIndices = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    const t = tris[i];
    const o = i * 9;
    triVerts[o + 0] = t.v0[0]; triVerts[o + 1] = t.v0[1]; triVerts[o + 2] = t.v0[2];
    triVerts[o + 3] = t.v1[0]; triVerts[o + 4] = t.v1[1]; triVerts[o + 5] = t.v1[2];
    triVerts[o + 6] = t.v2[0]; triVerts[o + 7] = t.v2[1]; triVerts[o + 8] = t.v2[2];
    triIndices[i] = t.index;
  }
  return { triVerts, triIndices };
}

function unpackTriangles(
  triVerts: Float32Array,
  triIndices: Uint32Array,
): RuntimeTriangle[] {
  const n = triIndices.length;
  const out: RuntimeTriangle[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const o = i * 9;
    const v0: Vec3 = [triVerts[o], triVerts[o + 1], triVerts[o + 2]];
    const v1: Vec3 = [triVerts[o + 3], triVerts[o + 4], triVerts[o + 5]];
    const v2: Vec3 = [triVerts[o + 6], triVerts[o + 7], triVerts[o + 8]];
    out[i] = {
      index: triIndices[i],
      v0, v1, v2,
      centroid: [
        (v0[0] + v1[0] + v2[0]) / 3,
        (v0[1] + v1[1] + v2[1]) / 3,
        (v0[2] + v1[2] + v2[2]) / 3,
      ],
      bounds: {
        min: [
          Math.min(v0[0], v1[0], v2[0]),
          Math.min(v0[1], v1[1], v2[1]),
          Math.min(v0[2], v1[2], v2[2]),
        ],
        max: [
          Math.max(v0[0], v1[0], v2[0]),
          Math.max(v0[1], v1[1], v2[1]),
          Math.max(v0[2], v1[2], v2[2]),
        ],
      },
    };
  }
  return out;
}

const aabbRec = (b: AABB): { bMin: [number, number, number]; bMax: [number, number, number] } => ({
  bMin: [b.min[0], b.min[1], b.min[2]],
  bMax: [b.max[0], b.max[1], b.max[2]],
});

const aabbFrom = (r: { bMin: number[]; bMax: number[] }): AABB => ({
  min: [r.bMin[0], r.bMin[1], r.bMin[2]],
  max: [r.bMax[0], r.bMax[1], r.bMax[2]],
});

// Map a triangle slot lookup table for fast leaf re-mapping.
function buildTriIndexMap(triIndices: Uint32Array): Map<number, number> {
  const m = new Map<number, number>();
  for (let i = 0; i < triIndices.length; i++) m.set(triIndices[i], i);
  return m;
}

// ─── BVH serialization ──────────────────────────────────────────

export function serializeBVH(bvh: BVH): SerializedBVH {
  const internal = bvh as unknown as { root: RuntimeBVHNode; tris: RuntimeTriangle[] };
  const { triVerts, triIndices } = packTriangles(internal.tris);
  const triIdxMap = buildTriIndexMap(triIndices);

  const nodes: BVHNodeRecord[] = [];
  const visit = (n: RuntimeBVHNode): number => {
    const id = nodes.length;
    nodes.push({
      ...aabbRec(n.bounds),
      left: -1, right: -1,
      leaf: n.triangles ? n.triangles.map((triId) => triIdxMap.get(triId) ?? -1) : null,
    });
    if (n.left) nodes[id].left = visit(n.left);
    if (n.right) nodes[id].right = visit(n.right);
    return id;
  };
  const rootIndex = visit(internal.root);

  return {
    kind: 'bvh',
    version: SPATIAL_FORMAT_VERSION,
    payload: { triVerts, triIndices, nodes, rootIndex },
  };
}

export function deserializeBVH(data: SerializedBVH): BVH {
  if (data.kind !== 'bvh') throw new Error(`expected kind=bvh, got ${data.kind}`);
  if (data.version !== SPATIAL_FORMAT_VERSION) {
    throw new Error(`unsupported BVH format version ${data.version}`);
  }
  const { triVerts, triIndices, nodes, rootIndex } = data.payload;
  const tris = unpackTriangles(triVerts, triIndices);

  const hydrate = (id: number): RuntimeBVHNode => {
    const r = nodes[id];
    const node: RuntimeBVHNode = { bounds: aabbFrom(r) };
    if (r.leaf) {
      // Map slot indices back to original triangle ids stored in BVH leaves.
      node.triangles = r.leaf.map((slot) => triIndices[slot]);
    } else {
      if (r.left >= 0) node.left = hydrate(r.left);
      if (r.right >= 0) node.right = hydrate(r.right);
    }
    return node;
  };

  // Reorder tris so `tris[index]` lookup used by raycast/queryBox stays correct.
  // BVH leaves index into `this.tris` by ORIGINAL triangle index, so we must
  // rebuild a sparse-friendly array indexed by original id.
  const maxOrig = tris.reduce((m, t) => Math.max(m, t.index), -1);
  const indexed: RuntimeTriangle[] = new Array(maxOrig + 1);
  for (const t of tris) indexed[t.index] = t;

  const bvh = Object.create(BVH.prototype) as BVH;
  Object.assign(bvh as unknown as Record<string, unknown>, {
    root: hydrate(rootIndex),
    tris: indexed,
  });
  return bvh;
}

// ─── Octree serialization ───────────────────────────────────────

export function serializeOctree(octree: Octree): SerializedOctree {
  const internal = octree as unknown as {
    root: RuntimeOctreeNode; tris: RuntimeTriangle[];
  };
  const { triVerts, triIndices } = packTriangles(internal.tris);
  // Octree leaves hold the actual Triangle objects; map by original index.
  const triIdxMap = buildTriIndexMap(triIndices);

  const nodes: OctreeNodeRecord[] = [];
  const visit = (n: RuntimeOctreeNode): number => {
    const id = nodes.length;
    nodes.push({
      ...aabbRec(n.bounds),
      triangles: n.triangles.map((t) => triIdxMap.get(t.index) ?? -1),
      children: null,
    });
    if (n.children) {
      nodes[id].children = n.children.map(visit);
    }
    return id;
  };
  const rootIndex = visit(internal.root);

  return {
    kind: 'octree',
    version: SPATIAL_FORMAT_VERSION,
    payload: { triVerts, triIndices, nodes, rootIndex },
  };
}

export function deserializeOctree(data: SerializedOctree): Octree {
  if (data.kind !== 'octree') throw new Error(`expected kind=octree, got ${data.kind}`);
  if (data.version !== SPATIAL_FORMAT_VERSION) {
    throw new Error(`unsupported Octree format version ${data.version}`);
  }
  const { triVerts, triIndices, nodes, rootIndex } = data.payload;
  const trisBySlot = unpackTriangles(triVerts, triIndices);

  const hydrate = (id: number): RuntimeOctreeNode => {
    const r = nodes[id];
    const bounds = aabbFrom(r);
    const node: RuntimeOctreeNode = {
      bounds,
      center: [
        (bounds.min[0] + bounds.max[0]) / 2,
        (bounds.min[1] + bounds.max[1]) / 2,
        (bounds.min[2] + bounds.max[2]) / 2,
      ],
      triangles: r.triangles.map((slot) => trisBySlot[slot]),
    };
    if (r.children) node.children = r.children.map(hydrate);
    return node;
  };

  const octree = Object.create(Octree.prototype) as Octree;
  Object.assign(octree as unknown as Record<string, unknown>, {
    root: hydrate(rootIndex),
    tris: trisBySlot,
  });
  return octree;
}

// ─── KDTree serialization ───────────────────────────────────────

export function serializeKDTree(kd: KDTree): SerializedKDTree {
  const internal = kd as unknown as { root: RuntimeKDNode | null; points: Vec3[] };
  const pts = internal.points;
  const points = new Float32Array(pts.length * 3);
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    points[i * 3] = p[0]; points[i * 3 + 1] = p[1]; points[i * 3 + 2] = p[2];
  }

  const nodes: KDNodeRecord[] = [];
  const visit = (n: RuntimeKDNode | undefined): number => {
    if (!n) return -1;
    const id = nodes.length;
    nodes.push({ index: n.index, axis: n.axis, left: -1, right: -1 });
    nodes[id].left = visit(n.left);
    nodes[id].right = visit(n.right);
    return id;
  };
  const rootIndex = internal.root ? visit(internal.root) : -1;

  return {
    kind: 'kdtree',
    version: SPATIAL_FORMAT_VERSION,
    payload: { points, nodes, rootIndex },
  };
}

export function deserializeKDTree(data: SerializedKDTree): KDTree {
  if (data.kind !== 'kdtree') throw new Error(`expected kind=kdtree, got ${data.kind}`);
  if (data.version !== SPATIAL_FORMAT_VERSION) {
    throw new Error(`unsupported KDTree format version ${data.version}`);
  }
  const { points, nodes, rootIndex } = data.payload;
  const pts: Vec3[] = [];
  for (let i = 0; i + 2 < points.length; i += 3) {
    pts.push([points[i], points[i + 1], points[i + 2]]);
  }

  const hydrate = (id: number): RuntimeKDNode | undefined => {
    if (id < 0) return undefined;
    const r = nodes[id];
    const node: RuntimeKDNode = {
      index: r.index, axis: r.axis, point: pts[r.index],
    };
    const l = hydrate(r.left); if (l) node.left = l;
    const rt = hydrate(r.right); if (rt) node.right = rt;
    return node;
  };

  const kd = Object.create(KDTree.prototype) as KDTree;
  Object.assign(kd as unknown as Record<string, unknown>, {
    root: rootIndex >= 0 ? hydrate(rootIndex) ?? null : null,
    points: pts,
  });
  return kd;
}

// ─── Polymorphic helpers ────────────────────────────────────────

export function serializeSpatialIndex(
  idx: BVH | Octree | KDTree,
): SerializedSpatialIndex {
  if (idx instanceof BVH) return serializeBVH(idx);
  if (idx instanceof Octree) return serializeOctree(idx);
  if (idx instanceof KDTree) return serializeKDTree(idx);
  throw new Error('unknown spatial index type');
}

export function deserializeSpatialIndex(
  data: SerializedSpatialIndex,
): BVH | Octree | KDTree {
  switch (data.kind) {
    case 'bvh': return deserializeBVH(data);
    case 'octree': return deserializeOctree(data);
    case 'kdtree': return deserializeKDTree(data);
  }
}

// ─── JSON transport (typed arrays → plain arrays) ───────────────

type JsonEnvelope = {
  kind: SerializedKind;
  version: number;
  payload: Record<string, unknown>;
};

export function toJSON(data: SerializedSpatialIndex): JsonEnvelope {
  const p = data.payload as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(p)) {
    if (v instanceof Float32Array || v instanceof Uint32Array) {
      out[k] = Array.from(v);
    } else {
      out[k] = v;
    }
  }
  return { kind: data.kind, version: data.version, payload: out };
}

export function fromJSON(json: JsonEnvelope): SerializedSpatialIndex {
  const p = json.payload;
  switch (json.kind) {
    case 'bvh':
      return {
        kind: 'bvh',
        version: SPATIAL_FORMAT_VERSION,
        payload: {
          triVerts: new Float32Array(p.triVerts as number[]),
          triIndices: new Uint32Array(p.triIndices as number[]),
          nodes: p.nodes as BVHNodeRecord[],
          rootIndex: p.rootIndex as number,
        },
      };
    case 'octree':
      return {
        kind: 'octree',
        version: SPATIAL_FORMAT_VERSION,
        payload: {
          triVerts: new Float32Array(p.triVerts as number[]),
          triIndices: new Uint32Array(p.triIndices as number[]),
          nodes: p.nodes as OctreeNodeRecord[],
          rootIndex: p.rootIndex as number,
        },
      };
    case 'kdtree':
      return {
        kind: 'kdtree',
        version: SPATIAL_FORMAT_VERSION,
        payload: {
          points: new Float32Array(p.points as number[]),
          nodes: p.nodes as KDNodeRecord[],
          rootIndex: p.rootIndex as number,
        },
      };
    default:
      throw new Error(`unknown serialized kind: ${(json as { kind: string }).kind}`);
  }
}
