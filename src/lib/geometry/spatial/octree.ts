/**
 * Octree — 8-way recursive subdivision over triangle primitives.
 *
 * Each node represents an AABB; on overflow it splits into 8 octants.
 * Triangles whose AABB straddles octant boundaries are stored at the
 * parent level (loose-octree behavior) to avoid duplication.
 *
 * Optimized for:
 *   • Point membership queries
 *   • Ray traversal with early exit
 *   • Box overlap queries
 *
 * Build: O(n log n). Query: O(log n) expected.
 */

import type { RawMesh, Vec3 } from '../types';
import { normalizeIndexed } from '../core/meshGenerator';
import type { AABB, Ray, RayHit } from '../core/spatialIndex';

interface Triangle {
  index: number;
  v0: Vec3; v1: Vec3; v2: Vec3;
  centroid: Vec3;
  bounds: AABB;
}

interface OctreeNode {
  bounds: AABB;
  center: Vec3;
  /** Triangles stored at this node (do not fit cleanly into a child). */
  triangles: Triangle[];
  children?: OctreeNode[]; // length 8
}

export interface OctreeOptions {
  /** Max triangles before a node subdivides. Default 16. */
  maxTrianglesPerNode?: number;
  /** Max recursion depth. Default 8. */
  maxDepth?: number;
}

export class Octree {
  private root: OctreeNode;
  private tris: Triangle[];

  constructor(mesh: RawMesh, opts: OctreeOptions = {}) {
    this.tris = extractTriangles(mesh);
    const max = opts.maxTrianglesPerNode ?? 16;
    const depth = opts.maxDepth ?? 8;
    const bounds = this.tris.length
      ? this.tris.reduce((acc, t) => unionAABB(acc, t.bounds), this.tris[0].bounds)
      : { min: [0, 0, 0] as Vec3, max: [0, 0, 0] as Vec3 };
    this.root = makeNode(bounds);
    for (const t of this.tris) insert(this.root, t, max, depth, 0);
  }

  get bounds(): AABB { return this.root.bounds; }
  get triangleCount(): number { return this.tris.length; }

  /** Triangle indices intersecting an axis-aligned box. */
  queryBox(box: AABB): number[] {
    const out: number[] = [];
    const stack: OctreeNode[] = [this.root];
    while (stack.length) {
      const n = stack.pop()!;
      if (!aabbsOverlap(n.bounds, box)) continue;
      for (const t of n.triangles) {
        if (aabbsOverlap(t.bounds, box)) out.push(t.index);
      }
      if (n.children) for (const c of n.children) stack.push(c);
    }
    return out;
  }

  /** Triangle indices in the node containing the point. */
  queryPoint(point: Vec3): number[] {
    if (!aabbContainsPoint(this.root.bounds, point)) return [];
    const out: number[] = [];
    let node: OctreeNode | undefined = this.root;
    while (node) {
      for (const t of node.triangles) {
        if (aabbContainsPoint(t.bounds, point)) out.push(t.index);
      }
      if (!node.children) break;
      node = node.children.find((c) => aabbContainsPoint(c.bounds, point));
    }
    return out;
  }

  /** Cast a ray and return the closest triangle hit, or null. */
  raycast(ray: Ray): RayHit | null {
    const invDir: Vec3 = [
      1 / (ray.direction[0] || 1e-30),
      1 / (ray.direction[1] || 1e-30),
      1 / (ray.direction[2] || 1e-30),
    ];
    let closest: RayHit | null = null;
    const stack: OctreeNode[] = [this.root];
    while (stack.length) {
      const n = stack.pop()!;
      if (!rayHitsAABB(ray.origin, invDir, n.bounds, closest?.t ?? Infinity)) continue;
      for (const t of n.triangles) {
        const hit = rayTriangleIntersect(ray, t);
        if (hit && (!closest || hit.t < closest.t)) closest = hit;
      }
      if (n.children) for (const c of n.children) stack.push(c);
    }
    return closest;
  }
}

// ─── Internals ──────────────────────────────────────────────────

function makeNode(bounds: AABB): OctreeNode {
  return {
    bounds,
    center: [
      (bounds.min[0] + bounds.max[0]) / 2,
      (bounds.min[1] + bounds.max[1]) / 2,
      (bounds.min[2] + bounds.max[2]) / 2,
    ],
    triangles: [],
  };
}

function insert(
  node: OctreeNode,
  tri: Triangle,
  maxTris: number,
  maxDepth: number,
  depth: number,
) {
  // Try to push into a single child if it fits entirely within one octant.
  if (depth < maxDepth) {
    if (!node.children && node.triangles.length >= maxTris) {
      subdivide(node);
      // redistribute existing triangles
      const existing = node.triangles;
      node.triangles = [];
      for (const t of existing) placeOrKeep(node, t, maxTris, maxDepth, depth);
    }
  }
  placeOrKeep(node, tri, maxTris, maxDepth, depth);
}

function placeOrKeep(
  node: OctreeNode,
  tri: Triangle,
  maxTris: number,
  maxDepth: number,
  depth: number,
) {
  if (!node.children) {
    node.triangles.push(tri);
    return;
  }
  // Find an octant that fully contains the triangle bounds.
  for (const child of node.children) {
    if (aabbContainsAABB(child.bounds, tri.bounds)) {
      insert(child, tri, maxTris, maxDepth, depth + 1);
      return;
    }
  }
  // Straddles boundary → keep at parent (loose octree).
  node.triangles.push(tri);
}

function subdivide(node: OctreeNode) {
  const { min, max } = node.bounds;
  const c = node.center;
  node.children = [];
  for (let ix = 0; ix < 2; ix++) {
    for (let iy = 0; iy < 2; iy++) {
      for (let iz = 0; iz < 2; iz++) {
        const childMin: Vec3 = [
          ix === 0 ? min[0] : c[0],
          iy === 0 ? min[1] : c[1],
          iz === 0 ? min[2] : c[2],
        ];
        const childMax: Vec3 = [
          ix === 0 ? c[0] : max[0],
          iy === 0 ? c[1] : max[1],
          iz === 0 ? c[2] : max[2],
        ];
        node.children.push(makeNode({ min: childMin, max: childMax }));
      }
    }
  }
}

// ─── Triangle extraction & geometry helpers ────────────────────

function extractTriangles(input: RawMesh): Triangle[] {
  const mesh = normalizeIndexed(input);
  const indices = mesh.indices as ArrayLike<number>;
  const positions = mesh.positions as ArrayLike<number>;
  const tris: Triangle[] = [];
  const triCount = indices.length / 3;
  for (let i = 0; i < triCount; i++) {
    const i0 = indices[i * 3], i1 = indices[i * 3 + 1], i2 = indices[i * 3 + 2];
    const v0: Vec3 = [positions[i0 * 3], positions[i0 * 3 + 1], positions[i0 * 3 + 2]];
    const v1: Vec3 = [positions[i1 * 3], positions[i1 * 3 + 1], positions[i1 * 3 + 2]];
    const v2: Vec3 = [positions[i2 * 3], positions[i2 * 3 + 1], positions[i2 * 3 + 2]];
    tris.push({
      index: i, v0, v1, v2,
      centroid: [
        (v0[0] + v1[0] + v2[0]) / 3,
        (v0[1] + v1[1] + v2[1]) / 3,
        (v0[2] + v1[2] + v2[2]) / 3,
      ],
      bounds: {
        min: [Math.min(v0[0], v1[0], v2[0]), Math.min(v0[1], v1[1], v2[1]), Math.min(v0[2], v1[2], v2[2])],
        max: [Math.max(v0[0], v1[0], v2[0]), Math.max(v0[1], v1[1], v2[1]), Math.max(v0[2], v1[2], v2[2])],
      },
    });
  }
  return tris;
}

function unionAABB(a: AABB, b: AABB): AABB {
  return {
    min: [Math.min(a.min[0], b.min[0]), Math.min(a.min[1], b.min[1]), Math.min(a.min[2], b.min[2])],
    max: [Math.max(a.max[0], b.max[0]), Math.max(a.max[1], b.max[1]), Math.max(a.max[2], b.max[2])],
  };
}

function aabbsOverlap(a: AABB, b: AABB): boolean {
  return a.min[0] <= b.max[0] && a.max[0] >= b.min[0]
    && a.min[1] <= b.max[1] && a.max[1] >= b.min[1]
    && a.min[2] <= b.max[2] && a.max[2] >= b.min[2];
}

function aabbContainsPoint(box: AABB, p: Vec3): boolean {
  return p[0] >= box.min[0] && p[0] <= box.max[0]
    && p[1] >= box.min[1] && p[1] <= box.max[1]
    && p[2] >= box.min[2] && p[2] <= box.max[2];
}

function aabbContainsAABB(outer: AABB, inner: AABB): boolean {
  return inner.min[0] >= outer.min[0] && inner.max[0] <= outer.max[0]
    && inner.min[1] >= outer.min[1] && inner.max[1] <= outer.max[1]
    && inner.min[2] >= outer.min[2] && inner.max[2] <= outer.max[2];
}

function rayHitsAABB(origin: Vec3, invDir: Vec3, box: AABB, maxT: number): boolean {
  let tmin = -Infinity, tmax = Infinity;
  for (let i = 0; i < 3; i++) {
    const t1 = (box.min[i] - origin[i]) * invDir[i];
    const t2 = (box.max[i] - origin[i]) * invDir[i];
    const lo = Math.min(t1, t2);
    const hi = Math.max(t1, t2);
    tmin = Math.max(tmin, lo);
    tmax = Math.min(tmax, hi);
    if (tmax < tmin) return false;
  }
  return tmax >= 0 && tmin <= maxT;
}

function rayTriangleIntersect(ray: Ray, tri: Triangle): RayHit | null {
  const EPS = 1e-9;
  const e1: Vec3 = [tri.v1[0] - tri.v0[0], tri.v1[1] - tri.v0[1], tri.v1[2] - tri.v0[2]];
  const e2: Vec3 = [tri.v2[0] - tri.v0[0], tri.v2[1] - tri.v0[1], tri.v2[2] - tri.v0[2]];
  const p: Vec3 = [
    ray.direction[1] * e2[2] - ray.direction[2] * e2[1],
    ray.direction[2] * e2[0] - ray.direction[0] * e2[2],
    ray.direction[0] * e2[1] - ray.direction[1] * e2[0],
  ];
  const det = e1[0] * p[0] + e1[1] * p[1] + e1[2] * p[2];
  if (Math.abs(det) < EPS) return null;
  const invDet = 1 / det;
  const s: Vec3 = [
    ray.origin[0] - tri.v0[0],
    ray.origin[1] - tri.v0[1],
    ray.origin[2] - tri.v0[2],
  ];
  const u = invDet * (s[0] * p[0] + s[1] * p[1] + s[2] * p[2]);
  if (u < 0 || u > 1) return null;
  const q: Vec3 = [
    s[1] * e1[2] - s[2] * e1[1],
    s[2] * e1[0] - s[0] * e1[2],
    s[0] * e1[1] - s[1] * e1[0],
  ];
  const v = invDet * (ray.direction[0] * q[0] + ray.direction[1] * q[1] + ray.direction[2] * q[2]);
  if (v < 0 || u + v > 1) return null;
  const t = invDet * (e2[0] * q[0] + e2[1] * q[1] + e2[2] * q[2]);
  if (t < EPS) return null;
  return {
    triangleIndex: tri.index,
    t,
    point: [
      ray.origin[0] + ray.direction[0] * t,
      ray.origin[1] + ray.direction[1] * t,
      ray.origin[2] + ray.direction[2] * t,
    ],
    uv: [u, v],
  };
}
