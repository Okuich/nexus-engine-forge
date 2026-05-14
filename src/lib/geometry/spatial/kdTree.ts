/**
 * KD-Tree — 3D point spatial index.
 *
 * Median-split balanced k-d tree (k=3) optimized for:
 *   • k-nearest-neighbor queries (best-bin-first with bounded heap)
 *   • radius / range queries
 *   • axis-aligned box queries
 *
 * Build: O(n log n). Query: O(log n) expected for low-dim point sets.
 * Designed to keep typical queries under 1ms for n < 1e5 points.
 */

import type { Vec3 } from '../types';

interface KDNode {
  /** Index into the original points array. */
  index: number;
  axis: 0 | 1 | 2;
  point: Vec3;
  left?: KDNode;
  right?: KDNode;
}

export interface KDQueryResult {
  index: number;
  point: Vec3;
  /** Euclidean distance from the query point. */
  distance: number;
}

export interface KDTreeOptions {
  /** Max points per leaf split decision. Default 1. */
  leafSize?: number;
}

export class KDTree {
  private root: KDNode | null;
  private points: Vec3[];

  constructor(points: ArrayLike<Vec3> | Float32Array, _opts: KDTreeOptions = {}) {
    this.points = normalizePoints(points);
    const indices = this.points.map((_, i) => i);
    this.root = build(indices, this.points, 0);
  }

  get size(): number { return this.points.length; }

  /** Nearest-neighbor query. Returns the closest point or null if empty. */
  nearest(target: Vec3): KDQueryResult | null {
    if (!this.root) return null;
    const best = { index: -1, distSq: Infinity };
    nearestRecursive(this.root, target, this.points, best);
    if (best.index < 0) return null;
    return {
      index: best.index,
      point: this.points[best.index],
      distance: Math.sqrt(best.distSq),
    };
  }

  /** k-nearest-neighbor query. Returns up to k points sorted nearest-first. */
  knn(target: Vec3, k: number): KDQueryResult[] {
    if (!this.root || k <= 0) return [];
    const heap = new MaxHeap(k);
    knnRecursive(this.root, target, this.points, heap, k);
    return heap.drainSorted().map((e) => ({
      index: e.index,
      point: this.points[e.index],
      distance: Math.sqrt(e.distSq),
    }));
  }

  /** Range search: every point within `radius` of `target`. */
  withinRadius(target: Vec3, radius: number): KDQueryResult[] {
    if (!this.root) return [];
    const r2 = radius * radius;
    const out: KDQueryResult[] = [];
    radiusRecursive(this.root, target, this.points, r2, out);
    return out.sort((a, b) => a.distance - b.distance);
  }

  /** Axis-aligned box query: every point inside `[min, max]`. */
  withinBox(min: Vec3, max: Vec3): KDQueryResult[] {
    if (!this.root) return [];
    const out: KDQueryResult[] = [];
    boxRecursive(this.root, min, max, this.points, out);
    return out;
  }
}

// ─── Build ──────────────────────────────────────────────────────

function build(indices: number[], pts: Vec3[], depth: number): KDNode | null {
  if (indices.length === 0) return null;
  const axis = (depth % 3) as 0 | 1 | 2;
  // nth-element via sort of the working slice (O(n log n) build is acceptable).
  indices.sort((a, b) => pts[a][axis] - pts[b][axis]);
  const mid = indices.length >> 1;
  const idx = indices[mid];
  return {
    index: idx,
    axis,
    point: pts[idx],
    left: build(indices.slice(0, mid), pts, depth + 1),
    right: build(indices.slice(mid + 1), pts, depth + 1),
  };
}

// ─── Query helpers ──────────────────────────────────────────────

function distSq(a: Vec3, b: Vec3): number {
  const dx = a[0] - b[0], dy = a[1] - b[1], dz = a[2] - b[2];
  return dx * dx + dy * dy + dz * dz;
}

function nearestRecursive(
  node: KDNode | undefined,
  target: Vec3,
  pts: Vec3[],
  best: { index: number; distSq: number },
) {
  if (!node) return;
  const d2 = distSq(node.point, target);
  if (d2 < best.distSq) { best.distSq = d2; best.index = node.index; }
  const diff = target[node.axis] - node.point[node.axis];
  const near = diff < 0 ? node.left : node.right;
  const far = diff < 0 ? node.right : node.left;
  nearestRecursive(near, target, pts, best);
  if (diff * diff < best.distSq) nearestRecursive(far, target, pts, best);
}

function knnRecursive(
  node: KDNode | undefined,
  target: Vec3,
  pts: Vec3[],
  heap: MaxHeap,
  k: number,
) {
  if (!node) return;
  const d2 = distSq(node.point, target);
  heap.push(node.index, d2);
  const diff = target[node.axis] - node.point[node.axis];
  const near = diff < 0 ? node.left : node.right;
  const far = diff < 0 ? node.right : node.left;
  knnRecursive(near, target, pts, heap, k);
  if (heap.size < k || diff * diff < heap.top()) {
    knnRecursive(far, target, pts, heap, k);
  }
}

function radiusRecursive(
  node: KDNode | undefined,
  target: Vec3,
  pts: Vec3[],
  r2: number,
  out: KDQueryResult[],
) {
  if (!node) return;
  const d2 = distSq(node.point, target);
  if (d2 <= r2) {
    out.push({ index: node.index, point: node.point, distance: Math.sqrt(d2) });
  }
  const diff = target[node.axis] - node.point[node.axis];
  const near = diff < 0 ? node.left : node.right;
  const far = diff < 0 ? node.right : node.left;
  radiusRecursive(near, target, pts, r2, out);
  if (diff * diff <= r2) radiusRecursive(far, target, pts, r2, out);
}

function boxRecursive(
  node: KDNode | undefined,
  min: Vec3,
  max: Vec3,
  pts: Vec3[],
  out: KDQueryResult[],
) {
  if (!node) return;
  const p = node.point;
  if (
    p[0] >= min[0] && p[0] <= max[0] &&
    p[1] >= min[1] && p[1] <= max[1] &&
    p[2] >= min[2] && p[2] <= max[2]
  ) {
    out.push({ index: node.index, point: p, distance: 0 });
  }
  const v = p[node.axis];
  if (min[node.axis] <= v) boxRecursive(node.left, min, max, pts, out);
  if (max[node.axis] >= v) boxRecursive(node.right, min, max, pts, out);
}

// ─── Bounded max-heap for kNN ───────────────────────────────────

interface HeapEntry { index: number; distSq: number; }

class MaxHeap {
  private data: HeapEntry[] = [];
  constructor(private capacity: number) {}
  get size(): number { return this.data.length; }
  top(): number { return this.data[0]?.distSq ?? Infinity; }

  push(index: number, distSq: number) {
    if (this.data.length < this.capacity) {
      this.data.push({ index, distSq });
      this.bubbleUp(this.data.length - 1);
    } else if (distSq < this.data[0].distSq) {
      this.data[0] = { index, distSq };
      this.sinkDown(0);
    }
  }

  drainSorted(): HeapEntry[] {
    return [...this.data].sort((a, b) => a.distSq - b.distSq);
  }

  private bubbleUp(i: number) {
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.data[i].distSq > this.data[p].distSq) {
        [this.data[i], this.data[p]] = [this.data[p], this.data[i]];
        i = p;
      } else break;
    }
  }

  private sinkDown(i: number) {
    const n = this.data.length;
    while (true) {
      const l = 2 * i + 1;
      const r = 2 * i + 2;
      let largest = i;
      if (l < n && this.data[l].distSq > this.data[largest].distSq) largest = l;
      if (r < n && this.data[r].distSq > this.data[largest].distSq) largest = r;
      if (largest === i) break;
      [this.data[i], this.data[largest]] = [this.data[largest], this.data[i]];
      i = largest;
    }
  }
}

// ─── Input normalization ────────────────────────────────────────

function normalizePoints(input: ArrayLike<Vec3> | Float32Array): Vec3[] {
  if (input instanceof Float32Array) {
    const out: Vec3[] = [];
    for (let i = 0; i + 2 < input.length; i += 3) {
      out.push([input[i], input[i + 1], input[i + 2]]);
    }
    return out;
  }
  const out: Vec3[] = [];
  for (let i = 0; i < input.length; i++) {
    const p = input[i];
    out.push([p[0], p[1], p[2]]);
  }
  return out;
}
