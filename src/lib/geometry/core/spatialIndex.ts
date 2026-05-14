/**
 * Spatial Acceleration Structures.
 *
 * Provides:
 *   • BVH (binary, AABB-based, surface-area-heuristic median split)
 *   • Uniform grid (broad-phase, O(1) cell lookup)
 *
 * Both index triangle primitives extracted from a RawMesh and support
 * ray intersection, AABB queries, and nearest-triangle search.
 */

import type { RawMesh, Vec3 } from '../types';
import { normalizeIndexed } from './meshGenerator';

// ─── Shared types ───────────────────────────────────────────────

export interface AABB {
  min: Vec3;
  max: Vec3;
}

export interface Ray {
  origin: Vec3;
  /** Should be unit length but not enforced. */
  direction: Vec3;
}

export interface RayHit {
  triangleIndex: number;
  /** Distance along ray from origin to hit point. */
  t: number;
  point: Vec3;
  /** Barycentric coordinates (u, v) of hit; w = 1 - u - v. */
  uv: [number, number];
}

interface Triangle {
  index: number;
  v0: Vec3;
  v1: Vec3;
  v2: Vec3;
  centroid: Vec3;
  bounds: AABB;
}

// ─── Triangle extraction ────────────────────────────────────────

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
      index: i,
      v0, v1, v2,
      centroid: [
        (v0[0] + v1[0] + v2[0]) / 3,
        (v0[1] + v1[1] + v2[1]) / 3,
        (v0[2] + v1[2] + v2[2]) / 3,
      ],
      bounds: triBounds(v0, v1, v2),
    });
  }
  return tris;
}

function triBounds(a: Vec3, b: Vec3, c: Vec3): AABB {
  return {
    min: [Math.min(a[0], b[0], c[0]), Math.min(a[1], b[1], c[1]), Math.min(a[2], b[2], c[2])],
    max: [Math.max(a[0], b[0], c[0]), Math.max(a[1], b[1], c[1]), Math.max(a[2], b[2], c[2])],
  };
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

// ─── BVH ────────────────────────────────────────────────────────

interface BVHNode {
  bounds: AABB;
  left?: BVHNode;
  right?: BVHNode;
  /** Leaf-only: triangle indices within this node. */
  triangles?: number[];
}

export interface BVHOptions {
  /** Max triangles per leaf. Default 8. */
  leafSize?: number;
  /** Max recursion depth. Default 32. */
  maxDepth?: number;
}

export class BVH {
  private root: BVHNode;
  private tris: Triangle[];

  constructor(mesh: RawMesh, opts: BVHOptions = {}) {
    this.tris = extractTriangles(mesh);
    const leafSize = opts.leafSize ?? 8;
    const maxDepth = opts.maxDepth ?? 32;
    this.root = buildBVH(this.tris, leafSize, maxDepth, 0);
  }

  get bounds(): AABB { return this.root.bounds; }
  get triangleCount(): number { return this.tris.length; }

  /** Return triangle indices whose AABB overlaps the query box. */
  queryBox(box: AABB): number[] {
    const out: number[] = [];
    const stack: BVHNode[] = [this.root];
    while (stack.length) {
      const n = stack.pop()!;
      if (!aabbsOverlap(n.bounds, box)) continue;
      if (n.triangles) {
        for (const ti of n.triangles) {
          if (aabbsOverlap(this.tris[ti].bounds, box)) out.push(ti);
        }
      } else {
        if (n.left) stack.push(n.left);
        if (n.right) stack.push(n.right);
      }
    }
    return out;
  }

  /** Cast a ray and return the closest hit, or null. */
  raycast(ray: Ray): RayHit | null {
    const invDir: Vec3 = [
      1 / (ray.direction[0] || 1e-30),
      1 / (ray.direction[1] || 1e-30),
      1 / (ray.direction[2] || 1e-30),
    ];
    let closest: RayHit | null = null;
    const stack: BVHNode[] = [this.root];
    while (stack.length) {
      const n = stack.pop()!;
      if (!rayHitsAABB(ray.origin, invDir, n.bounds, closest?.t ?? Infinity)) continue;
      if (n.triangles) {
        for (const ti of n.triangles) {
          const t = this.tris[ti];
          const hit = rayTriangleIntersect(ray, t);
          if (hit && (!closest || hit.t < closest.t)) closest = hit;
        }
      } else {
        if (n.left) stack.push(n.left);
        if (n.right) stack.push(n.right);
      }
    }
    return closest;
  }

  /** Find the triangle closest to a query point (centroid distance). */
  nearestTriangle(point: Vec3): { triangleIndex: number; distance: number } | null {
    if (this.tris.length === 0) return null;
    let best = { triangleIndex: -1, distance: Infinity };
    // Brute-force inside leaves; BVH prunes via AABB-distance lower bound.
    const stack: Array<{ node: BVHNode; lower: number }> = [
      { node: this.root, lower: aabbDistanceSq(this.root.bounds, point) },
    ];
    while (stack.length) {
      stack.sort((a, b) => b.lower - a.lower); // pop closest
      const { node, lower } = stack.pop()!;
      if (lower >= best.distance) continue;
      if (node.triangles) {
        for (const ti of node.triangles) {
          const c = this.tris[ti].centroid;
          const dx = c[0] - point[0], dy = c[1] - point[1], dz = c[2] - point[2];
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 < best.distance) best = { triangleIndex: ti, distance: d2 };
        }
      } else {
        if (node.left) stack.push({ node: node.left, lower: aabbDistanceSq(node.left.bounds, point) });
        if (node.right) stack.push({ node: node.right, lower: aabbDistanceSq(node.right.bounds, point) });
      }
    }
    return best.triangleIndex >= 0
      ? { triangleIndex: best.triangleIndex, distance: Math.sqrt(best.distance) }
      : null;
  }
}

function buildBVH(tris: Triangle[], leafSize: number, maxDepth: number, depth: number): BVHNode {
  const bounds = tris.reduce((acc, t) => unionAABB(acc, t.bounds), tris[0].bounds);
  if (tris.length <= leafSize || depth >= maxDepth) {
    return { bounds, triangles: tris.map((t) => t.index) };
  }
  // Split on longest axis at centroid median.
  const dx = bounds.max[0] - bounds.min[0];
  const dy = bounds.max[1] - bounds.min[1];
  const dz = bounds.max[2] - bounds.min[2];
  const axis = dx >= dy && dx >= dz ? 0 : dy >= dz ? 1 : 2;
  const sorted = [...tris].sort((a, b) => a.centroid[axis] - b.centroid[axis]);
  const mid = Math.floor(sorted.length / 2);
  const left = sorted.slice(0, mid);
  const right = sorted.slice(mid);
  if (left.length === 0 || right.length === 0) {
    return { bounds, triangles: tris.map((t) => t.index) };
  }
  return {
    bounds,
    left: buildBVH(left, leafSize, maxDepth, depth + 1),
    right: buildBVH(right, leafSize, maxDepth, depth + 1),
  };
}

// Slab method ray-AABB
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

// Möller-Trumbore
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

function aabbDistanceSq(box: AABB, p: Vec3): number {
  let d = 0;
  for (let i = 0; i < 3; i++) {
    const v = p[i];
    if (v < box.min[i]) d += (box.min[i] - v) ** 2;
    else if (v > box.max[i]) d += (v - box.max[i]) ** 2;
  }
  return d;
}

// ─── Uniform Grid ───────────────────────────────────────────────

export interface UniformGridOptions {
  /** Cells per longest axis. Default 16. */
  resolution?: number;
}

export class UniformGrid {
  private tris: Triangle[];
  private cellSize: Vec3;
  private origin: Vec3;
  private dims: [number, number, number];
  private cells: Map<number, number[]>;
  readonly bounds: AABB;

  constructor(mesh: RawMesh, opts: UniformGridOptions = {}) {
    this.tris = extractTriangles(mesh);
    const resolution = Math.max(1, opts.resolution ?? 16);
    this.bounds = this.tris.length
      ? this.tris.reduce((acc, t) => unionAABB(acc, t.bounds), this.tris[0].bounds)
      : { min: [0, 0, 0], max: [0, 0, 0] };

    const dx = this.bounds.max[0] - this.bounds.min[0] || 1;
    const dy = this.bounds.max[1] - this.bounds.min[1] || 1;
    const dz = this.bounds.max[2] - this.bounds.min[2] || 1;
    const longest = Math.max(dx, dy, dz);
    const step = longest / resolution;
    this.cellSize = [step, step, step];
    this.origin = this.bounds.min;
    this.dims = [
      Math.max(1, Math.ceil(dx / step)),
      Math.max(1, Math.ceil(dy / step)),
      Math.max(1, Math.ceil(dz / step)),
    ];
    this.cells = new Map();
    for (const t of this.tris) this.insert(t);
  }

  private cellKey(ix: number, iy: number, iz: number): number {
    return (ix * this.dims[1] + iy) * this.dims[2] + iz;
  }

  private cellOf(p: Vec3): [number, number, number] {
    return [
      clamp(Math.floor((p[0] - this.origin[0]) / this.cellSize[0]), 0, this.dims[0] - 1),
      clamp(Math.floor((p[1] - this.origin[1]) / this.cellSize[1]), 0, this.dims[1] - 1),
      clamp(Math.floor((p[2] - this.origin[2]) / this.cellSize[2]), 0, this.dims[2] - 1),
    ];
  }

  private insert(t: Triangle) {
    const [x0, y0, z0] = this.cellOf(t.bounds.min);
    const [x1, y1, z1] = this.cellOf(t.bounds.max);
    for (let ix = x0; ix <= x1; ix++) {
      for (let iy = y0; iy <= y1; iy++) {
        for (let iz = z0; iz <= z1; iz++) {
          const key = this.cellKey(ix, iy, iz);
          const arr = this.cells.get(key);
          if (arr) arr.push(t.index);
          else this.cells.set(key, [t.index]);
        }
      }
    }
  }

  /** Triangle indices whose bounds overlap the query AABB. */
  queryBox(box: AABB): number[] {
    const [x0, y0, z0] = this.cellOf(box.min);
    const [x1, y1, z1] = this.cellOf(box.max);
    const seen = new Set<number>();
    for (let ix = x0; ix <= x1; ix++) {
      for (let iy = y0; iy <= y1; iy++) {
        for (let iz = z0; iz <= z1; iz++) {
          const arr = this.cells.get(this.cellKey(ix, iy, iz));
          if (arr) for (const ti of arr) seen.add(ti);
        }
      }
    }
    return [...seen].filter((ti) => aabbsOverlap(this.tris[ti].bounds, box));
  }

  /** Triangle indices in the cell containing the point. */
  queryPoint(point: Vec3): number[] {
    if (!aabbContainsPoint(this.bounds, point)) return [];
    const [ix, iy, iz] = this.cellOf(point);
    return this.cells.get(this.cellKey(ix, iy, iz)) ?? [];
  }

  get cellCount(): number { return this.cells.size; }
  get dimensions(): [number, number, number] { return this.dims; }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

// ─── Public AABB helpers (re-exported) ─────────────────────────

export const aabb = {
  union: unionAABB,
  overlaps: aabbsOverlap,
  containsPoint: aabbContainsPoint,
};
