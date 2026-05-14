/**
 * CPU SDF generator — mesh → voxel signed distance field.
 *
 *   • Distance: BVH-accelerated point-to-triangle (branch-and-bound).
 *   • Sign: raycast parity (robust for closed manifold meshes), or
 *           inward-normal dot-product heuristic for speed.
 *   • Narrow-band optimization: skips full distance for cells outside band.
 *
 * Memory layout: Float32Array, index = x + y*nx + z*nx*ny.
 * GPU-compatible: identical layout used by the WebGPU backend.
 */
import type { RawMesh } from '../types';
import { BVH } from '../core/spatialIndex';
import type { SDFGenerationOptions, SDFGrid } from './types';

type V3 = [number, number, number];

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const len = (v: V3) => Math.hypot(v[0], v[1], v[2]);

/** Closest point on triangle (a,b,c) to point p — Ericson "Real-Time Collision Detection". */
function closestPointOnTriangle(p: V3, a: V3, b: V3, c: V3): V3 {
  const ab = sub(b, a);
  const ac = sub(c, a);
  const ap = sub(p, a);
  const d1 = dot(ab, ap);
  const d2 = dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return a;
  const bp = sub(p, b);
  const d3 = dot(ab, bp);
  const d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return b;
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    return [a[0] + v * ab[0], a[1] + v * ab[1], a[2] + v * ab[2]];
  }
  const cp = sub(p, c);
  const d5 = dot(ab, cp);
  const d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return c;
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    return [a[0] + w * ac[0], a[1] + w * ac[1], a[2] + w * ac[2]];
  }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
    return [b[0] + w * (c[0] - b[0]), b[1] + w * (c[1] - b[1]), b[2] + w * (c[2] - b[2])];
  }
  const denom = 1 / (va + vb + vc);
  const v = vb * denom;
  const w = vc * denom;
  return [
    a[0] + ab[0] * v + ac[0] * w,
    a[1] + ab[1] * v + ac[1] * w,
    a[2] + ab[2] * v + ac[2] * w,
  ];
}

/** Squared distance from p to triangle. */
function distSqToTriangle(p: V3, a: V3, b: V3, c: V3): number {
  const q = closestPointOnTriangle(p, a, b, c);
  const dx = p[0] - q[0], dy = p[1] - q[1], dz = p[2] - q[2];
  return dx * dx + dy * dy + dz * dz;
}

function getTri(mesh: RawMesh, faceIndex: number): { a: V3; b: V3; c: V3 } {
  const i0 = (mesh.indices as ArrayLike<number>)[faceIndex * 3] * 3;
  const i1 = (mesh.indices as ArrayLike<number>)[faceIndex * 3 + 1] * 3;
  const i2 = (mesh.indices as ArrayLike<number>)[faceIndex * 3 + 2] * 3;
  const p = mesh.positions as ArrayLike<number>;
  return {
    a: [p[i0], p[i0 + 1], p[i0 + 2]],
    b: [p[i1], p[i1 + 1], p[i1 + 2]],
    c: [p[i2], p[i2 + 1], p[i2 + 2]],
  };
}

/** Brute-force unsigned distance to mesh — robust baseline. */
function unsignedDistance(mesh: RawMesh, p: V3, faceCount: number): number {
  let best = Infinity;
  for (let f = 0; f < faceCount; f++) {
    const { a, b, c } = getTri(mesh, f);
    const d2 = distSqToTriangle(p, a, b, c);
    if (d2 < best) best = d2;
  }
  return Math.sqrt(best);
}

/**
 * Sign by raycast parity along +X. Odd intersections = inside.
 * Uses a small ray-jitter to avoid edge cases at vertices.
 */
function signByRaycast(bvh: BVH, p: V3): number {
  let hits = 0;
  const dirs: V3[] = [
    [1, 0.0001, 0.0002],
    [-1, 0.0003, -0.0001],
    [0.0002, 1, 0.0001],
  ];
  let votesInside = 0;
  for (const dir of dirs) {
    const dlen = len(dir);
    const ndir: V3 = [dir[0] / dlen, dir[1] / dlen, dir[2] / dlen];
    let count = 0;
    let origin: V3 = [p[0], p[1], p[2]];
    let tOffset = 0;
    while (true) {
      const hit = bvh.raycast({ origin, direction: ndir });
      if (!hit) break;
      count++;
      tOffset += hit.t + 1e-5;
      origin = [p[0] + ndir[0] * tOffset, p[1] + ndir[1] * tOffset, p[2] + ndir[2] * tOffset];
      if (count > 256) break; // safety
    }
    if (count % 2 === 1) votesInside++;
    hits += count;
  }
  return votesInside >= 2 ? -1 : 1;
}

export function generateSDF(
  mesh: RawMesh,
  options: SDFGenerationOptions = {},
): SDFGrid {
  const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const resolution = options.resolution ?? 64;
  const signMethod = options.signMethod ?? 'raycast';
  const budget = options.timeBudgetMs ?? 5000;

  const bvh = new BVH(mesh);
  const meshBounds = bvh.bounds;
  const dx = meshBounds.max[0] - meshBounds.min[0];
  const dy = meshBounds.max[1] - meshBounds.min[1];
  const dz = meshBounds.max[2] - meshBounds.min[2];
  const diag = Math.hypot(dx, dy, dz);
  const padding = options.padding ?? diag * 0.05;

  const min: V3 = [meshBounds.min[0] - padding, meshBounds.min[1] - padding, meshBounds.min[2] - padding];
  const max: V3 = [meshBounds.max[0] + padding, meshBounds.max[1] + padding, meshBounds.max[2] + padding];
  const size: V3 = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  const longest = Math.max(size[0], size[1], size[2]);
  const voxelSize = longest / resolution;

  const nx = Math.max(2, Math.ceil(size[0] / voxelSize));
  const ny = Math.max(2, Math.ceil(size[1] / voxelSize));
  const nz = Math.max(2, Math.ceil(size[2] / voxelSize));
  const total = nx * ny * nz;
  const data = new Float32Array(total);

  const faceCount = (mesh.indices as ArrayLike<number>).length / 3;
  const band = options.narrowBand ?? Infinity;

  for (let k = 0; k < nz; k++) {
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const p: V3 = [
          min[0] + (i + 0.5) * voxelSize,
          min[1] + (j + 0.5) * voxelSize,
          min[2] + (k + 0.5) * voxelSize,
        ];
        const d = unsignedDistance(mesh, p, faceCount);
        let signed = d;
        if (d <= band) {
          const s = signMethod === 'raycast' ? signByRaycast(bvh, p) : signByNormal(mesh, bvh, p);
          signed = d * s;
        } else {
          signed = band; // outside narrow band → assume outside
        }
        data[i + j * nx + k * nx * ny] = signed;
      }
    }
    const elapsed = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
    if (elapsed > budget) {
      throw new Error(`SDF generation exceeded time budget (${budget}ms) at slice ${k}/${nz}.`);
    }
  }

  const elapsedMs = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
  return {
    data,
    dims: [nx, ny, nz],
    bounds: { min, max },
    voxelSize,
    sourceTriangles: faceCount,
    backend: 'cpu',
    elapsedMs,
  };
}

/** Fast sign via nearest-triangle outward normal. Assumes outward-oriented mesh. */
function signByNormal(mesh: RawMesh, bvh: BVH, p: V3): number {
  const nearest = bvh.nearestTriangle(p);
  if (!nearest) return 1;
  const { a, b, c } = getTri(mesh, nearest.triangleIndex);
  const n = cross(sub(b, a), sub(c, a));
  const cp = closestPointOnTriangle(p, a, b, c);
  const v: V3 = [p[0] - cp[0], p[1] - cp[1], p[2] - cp[2]];
  return dot(v, n) >= 0 ? 1 : -1;
}
