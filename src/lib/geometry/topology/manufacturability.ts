/**
 * Manufacturability post-processing for topology-optimized density fields.
 *
 *   • Threshold to binary at ρ ≥ 0.5
 *   • Symmetry enforcement (mirror about a plane)
 *   • Min-feature-size filter via morphological opening (erode → dilate)
 *   • Overhang filter for AM processes (drop unsupported voxels)
 *   • Connected-component pruning — keep only the largest component
 *     attached to a support voxel.
 */
import type { ManufacturingConstraints, V3 } from './types';
import type { VoxelDomain } from './voxelizer';
import { worldToVoxel } from './voxelizer';
import { PROCESS_MIN_WALL_MM } from '../optimization/materials';

function idxOf(i: number, j: number, k: number, dims: [number, number, number]): number {
  return i + j * dims[0] + k * dims[0] * dims[1];
}

function forEachVoxel(
  dims: [number, number, number],
  fn: (i: number, j: number, k: number, idx: number) => void,
): void {
  const [nx, ny, nz] = dims;
  for (let k = 0; k < nz; k++)
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++)
        fn(i, j, k, i + j * nx + k * nx * ny);
}

export function thresholdDensity(density: Float32Array, threshold = 0.5): Uint8Array {
  const out = new Uint8Array(density.length);
  for (let i = 0; i < density.length; i++) out[i] = density[i] >= threshold ? 1 : 0;
  return out;
}

export function enforceSymmetry(
  binary: Uint8Array,
  dims: [number, number, number],
  axis: 'x' | 'y' | 'z',
): Uint8Array {
  const out = new Uint8Array(binary);
  const [nx, ny, nz] = dims;
  forEachVoxel(dims, (i, j, k, idx) => {
    let mi = i, mj = j, mk = k;
    if (axis === 'x') mi = nx - 1 - i;
    else if (axis === 'y') mj = ny - 1 - j;
    else mk = nz - 1 - k;
    const mIdx = idxOf(mi, mj, mk, dims);
    out[idx] = (binary[idx] || binary[mIdx]) ? 1 : 0;
  });
  return out;
}

function erode(binary: Uint8Array, dims: [number, number, number]): Uint8Array {
  const [nx, ny, nz] = dims;
  const out = new Uint8Array(binary.length);
  forEachVoxel(dims, (i, j, k, idx) => {
    if (!binary[idx]) return;
    let keep = true;
    for (const [di, dj, dk] of [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]]) {
      const ii = i + di, jj = j + dj, kk = k + dk;
      if (ii < 0 || jj < 0 || kk < 0 || ii >= nx || jj >= ny || kk >= nz) { keep = false; break; }
      if (!binary[idxOf(ii, jj, kk, dims)]) { keep = false; break; }
    }
    out[idx] = keep ? 1 : 0;
  });
  return out;
}

function dilate(binary: Uint8Array, dims: [number, number, number]): Uint8Array {
  const [nx, ny, nz] = dims;
  const out = new Uint8Array(binary);
  forEachVoxel(dims, (i, j, k, idx) => {
    if (binary[idx]) return;
    for (const [di, dj, dk] of [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]]) {
      const ii = i + di, jj = j + dj, kk = k + dk;
      if (ii < 0 || jj < 0 || kk < 0 || ii >= nx || jj >= ny || kk >= nz) continue;
      if (binary[idxOf(ii, jj, kk, dims)]) { out[idx] = 1; return; }
    }
  });
  return out;
}

/** Morphological opening — k iterations of erode then dilate. */
export function openMorphology(
  binary: Uint8Array,
  dims: [number, number, number],
  iterations: number,
): Uint8Array {
  let v = binary;
  for (let i = 0; i < iterations; i++) v = erode(v, dims);
  for (let i = 0; i < iterations; i++) v = dilate(v, dims);
  return v;
}

/** Drop voxels with no supporting voxel beneath them along the build axis. */
export function enforceOverhang(
  binary: Uint8Array,
  dims: [number, number, number],
  buildAxis: 'x' | 'y' | 'z',
  maxOverhangDeg: number,
): Uint8Array {
  const [nx, ny, nz] = dims;
  const out = new Uint8Array(binary);
  // Reach: how many voxels sideways are allowed per voxel of build height.
  const reach = Math.max(0, Math.floor(Math.tan((maxOverhangDeg * Math.PI) / 180)));
  const stride = buildAxis === 'x' ? [1, 0, 0] : buildAxis === 'y' ? [0, 1, 0] : [0, 0, 1];
  const [nu, nv] = buildAxis === 'z' ? [nx, ny] : buildAxis === 'y' ? [nx, nz] : [ny, nz];

  // Iterate from build plate upward
  const heights = buildAxis === 'x' ? nx : buildAxis === 'y' ? ny : nz;
  for (let h = 1; h < heights; h++) {
    for (let v = 0; v < nv; v++) {
      for (let u = 0; u < nu; u++) {
        // Map (u,v,h) back to (i,j,k)
        let i = 0, j = 0, k = 0;
        if (buildAxis === 'z') { i = u; j = v; k = h; }
        else if (buildAxis === 'y') { i = u; j = h; k = v; }
        else { i = h; j = u; k = v; }
        const idx = idxOf(i, j, k, dims);
        if (!out[idx]) continue;
        // Look for support within `reach` voxels in the layer below
        let supported = false;
        for (let du = -reach - 1; du <= reach + 1 && !supported; du++) {
          for (let dv = -reach - 1; dv <= reach + 1 && !supported; dv++) {
            const uu = u + du, vv = v + dv;
            if (uu < 0 || vv < 0 || uu >= nu || vv >= nv) continue;
            let bi = 0, bj = 0, bk = 0;
            if (buildAxis === 'z') { bi = uu; bj = vv; bk = h - 1; }
            else if (buildAxis === 'y') { bi = uu; bj = h - 1; bk = vv; }
            else { bi = h - 1; bj = uu; bk = vv; }
            if (out[idxOf(bi, bj, bk, dims)]) supported = true;
          }
        }
        if (!supported) out[idx] = 0;
      }
    }
  }
  return out;
}

/** Keep the largest connected component that touches a support voxel. */
export function keepConnectedToSupports(
  binary: Uint8Array,
  dims: [number, number, number],
  supportIndices: number[],
): Uint8Array {
  const [nx, ny, nz] = dims;
  const visited = new Uint8Array(binary.length);
  const out = new Uint8Array(binary.length);
  const queue: number[] = [];
  for (const s of supportIndices) {
    if (binary[s] && !visited[s]) queue.push(s);
  }
  while (queue.length) {
    const idx = queue.pop()!;
    if (visited[idx] || !binary[idx]) continue;
    visited[idx] = 1;
    out[idx] = 1;
    const k = Math.floor(idx / (nx * ny));
    const j = Math.floor((idx - k * nx * ny) / nx);
    const i = idx - j * nx - k * nx * ny;
    if (i > 0)      queue.push(idx - 1);
    if (i < nx - 1) queue.push(idx + 1);
    if (j > 0)      queue.push(idx - nx);
    if (j < ny - 1) queue.push(idx + nx);
    if (k > 0)      queue.push(idx - nx * ny);
    if (k < nz - 1) queue.push(idx + nx * ny);
  }
  return out;
}

export interface PostProcessOptions {
  constraints: ManufacturingConstraints;
  domain: VoxelDomain;
  supportPoints: V3[];
}

export function applyManufacturability(
  density: Float32Array,
  opts: PostProcessOptions,
): { binary: Uint8Array; density: Float32Array } {
  const { constraints, domain, supportPoints } = opts;
  const minFeature = constraints.minFeatureMm
    ?? PROCESS_MIN_WALL_MM[constraints.process]
    ?? 1.0;
  const featureVoxels = Math.max(1, Math.round(minFeature / domain.voxelSize));

  let bin = thresholdDensity(density);
  if (constraints.symmetry && constraints.symmetry !== 'none') {
    bin = enforceSymmetry(bin, domain.dims, constraints.symmetry);
  }
  bin = openMorphology(bin, domain.dims, featureVoxels);
  if (constraints.maxOverhangDeg && constraints.pullAxis) {
    bin = enforceOverhang(bin, domain.dims, constraints.pullAxis, constraints.maxOverhangDeg);
  }
  // Prune disconnected islands — pin supports & loads as anchors
  const supportIndices: number[] = [];
  for (const p of supportPoints) {
    const { idx } = worldToVoxel(domain, p);
    if (idx >= 0) {
      supportIndices.push(idx);
      bin[idx] = 1; // support voxel must be solid for connectivity seed
    }
  }
  if (supportIndices.length) {
    bin = keepConnectedToSupports(bin, domain.dims, supportIndices);
  }

  // Project back to density (binary is the manufacturable geometry)
  const out = new Float32Array(density.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin[i];
  return { binary: bin, density: out };
}
