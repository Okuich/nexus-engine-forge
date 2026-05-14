/**
 * Spatial Index Debug Instrumentation
 * ───────────────────────────────────
 * Re-walks BVH / Octree node hierarchies in lock-step with their query
 * algorithms and records every node bounds visited. The originals stay
 * untouched (zero overhead in production); these wrappers exist purely
 * to feed the debug visualizer.
 */

import type { Vec3 } from '../types';
import type { AABB, Ray } from '../core/spatialIndex';
import { BVH } from '../core/spatialIndex';
import { Octree } from './octree';

export type VisitRole = 'visited' | 'pruned' | 'leaf-hit';

export interface VisitedNode {
  bounds: AABB;
  depth: number;
  role: VisitRole;
  isLeaf: boolean;
}

export interface TraceResult {
  nodes: VisitedNode[];
  totalVisited: number;
  totalPruned: number;
  totalLeaves: number;
}

interface RuntimeBVHNode {
  bounds: AABB;
  left?: RuntimeBVHNode;
  right?: RuntimeBVHNode;
  triangles?: number[];
}

interface RuntimeOctreeNode {
  bounds: AABB;
  triangles: unknown[];
  children?: RuntimeOctreeNode[];
}

// ─── Geometry helpers (inlined) ────────────────────────────────

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

function aabbDistanceSq(box: AABB, p: Vec3): number {
  let d = 0;
  for (let i = 0; i < 3; i++) {
    const v = p[i];
    if (v < box.min[i]) d += (box.min[i] - v) ** 2;
    else if (v > box.max[i]) d += (v - box.max[i]) ** 2;
  }
  return d;
}

function summarize(nodes: VisitedNode[]): TraceResult {
  return {
    nodes,
    totalVisited: nodes.filter((n) => n.role !== 'pruned').length,
    totalPruned: nodes.filter((n) => n.role === 'pruned').length,
    totalLeaves: nodes.filter((n) => n.isLeaf).length,
  };
}

// ─── BVH tracing ───────────────────────────────────────────────

export function traceBVHRaycast(bvh: BVH, ray: Ray): TraceResult {
  const root = (bvh as unknown as { root: RuntimeBVHNode }).root;
  const invDir: Vec3 = [
    1 / (ray.direction[0] || 1e-30),
    1 / (ray.direction[1] || 1e-30),
    1 / (ray.direction[2] || 1e-30),
  ];
  // First pass: get the actual closest hit so we can report accurate pruning.
  const hit = bvh.raycast(ray);
  const maxT = hit?.t ?? Infinity;

  const out: VisitedNode[] = [];
  const stack: Array<{ n: RuntimeBVHNode; depth: number }> = [{ n: root, depth: 0 }];
  while (stack.length) {
    const { n, depth } = stack.pop()!;
    const isLeaf = !!n.triangles;
    if (!rayHitsAABB(ray.origin, invDir, n.bounds, maxT)) {
      out.push({ bounds: n.bounds, depth, role: 'pruned', isLeaf });
      continue;
    }
    out.push({
      bounds: n.bounds,
      depth,
      role: isLeaf ? 'leaf-hit' : 'visited',
      isLeaf,
    });
    if (n.left) stack.push({ n: n.left, depth: depth + 1 });
    if (n.right) stack.push({ n: n.right, depth: depth + 1 });
  }
  return summarize(out);
}

export function traceBVHNearest(bvh: BVH, point: Vec3): TraceResult {
  const root = (bvh as unknown as { root: RuntimeBVHNode }).root;
  const out: VisitedNode[] = [];
  // Mirror the closest-first traversal in BVH.nearestTriangle.
  let bestDist = Infinity;
  const result = bvh.nearestTriangle(point);
  if (result) bestDist = result.distance ** 2;

  interface Entry { node: RuntimeBVHNode; depth: number; lower: number; }
  const stack: Entry[] = [{ node: root, depth: 0, lower: aabbDistanceSq(root.bounds, point) }];
  while (stack.length) {
    stack.sort((a, b) => b.lower - a.lower);
    const { node, depth, lower } = stack.pop()!;
    const isLeaf = !!node.triangles;
    if (lower >= bestDist) {
      out.push({ bounds: node.bounds, depth, role: 'pruned', isLeaf });
      continue;
    }
    out.push({
      bounds: node.bounds,
      depth,
      role: isLeaf ? 'leaf-hit' : 'visited',
      isLeaf,
    });
    if (node.left) stack.push({
      node: node.left, depth: depth + 1, lower: aabbDistanceSq(node.left.bounds, point),
    });
    if (node.right) stack.push({
      node: node.right, depth: depth + 1, lower: aabbDistanceSq(node.right.bounds, point),
    });
  }
  return summarize(out);
}

// ─── Octree tracing ────────────────────────────────────────────

export function traceOctreeRaycast(oct: Octree, ray: Ray): TraceResult {
  const root = (oct as unknown as { root: RuntimeOctreeNode }).root;
  const invDir: Vec3 = [
    1 / (ray.direction[0] || 1e-30),
    1 / (ray.direction[1] || 1e-30),
    1 / (ray.direction[2] || 1e-30),
  ];
  const hit = oct.raycast(ray);
  const maxT = hit?.t ?? Infinity;

  const out: VisitedNode[] = [];
  const stack: Array<{ n: RuntimeOctreeNode; depth: number }> = [{ n: root, depth: 0 }];
  while (stack.length) {
    const { n, depth } = stack.pop()!;
    const isLeaf = !n.children;
    if (!rayHitsAABB(ray.origin, invDir, n.bounds, maxT)) {
      out.push({ bounds: n.bounds, depth, role: 'pruned', isLeaf });
      continue;
    }
    out.push({
      bounds: n.bounds,
      depth,
      role: n.triangles.length > 0 ? 'leaf-hit' : 'visited',
      isLeaf,
    });
    if (n.children) for (const c of n.children) stack.push({ n: c, depth: depth + 1 });
  }
  return summarize(out);
}

// ─── Full split visualisation (no query) ───────────────────────

export function collectAllSplits(idx: BVH | Octree): VisitedNode[] {
  const out: VisitedNode[] = [];
  if (idx instanceof BVH) {
    const root = (idx as unknown as { root: RuntimeBVHNode }).root;
    const walk = (n: RuntimeBVHNode, depth: number) => {
      out.push({
        bounds: n.bounds, depth,
        role: 'visited',
        isLeaf: !!n.triangles,
      });
      if (n.left) walk(n.left, depth + 1);
      if (n.right) walk(n.right, depth + 1);
    };
    walk(root, 0);
  } else {
    const root = (idx as unknown as { root: RuntimeOctreeNode }).root;
    const walk = (n: RuntimeOctreeNode, depth: number) => {
      out.push({
        bounds: n.bounds, depth,
        role: 'visited',
        isLeaf: !n.children,
      });
      if (n.children) for (const c of n.children) walk(c, depth + 1);
    };
    walk(root, 0);
  }
  return out;
}
