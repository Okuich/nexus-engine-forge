/**
 * Voxelize a mesh into a uniform-grid design domain using the SDF engine.
 * Voxels with SDF ≤ 0 are inside the part and form the initial mass.
 */
import type { RawMesh } from '../types';
import { generateSDF } from '../sdf/sdfGenerator';
import type { V3 } from './types';

export interface VoxelDomain {
  /** 1 = inside design domain, 0 = outside (void). */
  designMask: Uint8Array;
  dims: [number, number, number];
  origin: V3;
  voxelSize: number;
}

export function voxelizeForTopology(mesh: RawMesh, resolution = 48): VoxelDomain {
  const sdf = generateSDF(mesh, { resolution, signMethod: 'normal', padding: 0 });
  const designMask = new Uint8Array(sdf.data.length);
  for (let i = 0; i < sdf.data.length; i++) {
    designMask[i] = sdf.data[i] <= 0 ? 1 : 0;
  }
  return {
    designMask,
    dims: sdf.dims,
    origin: sdf.bounds.min as V3,
    voxelSize: sdf.voxelSize,
  };
}

/** Map a world point to a voxel index, or -1 if out of bounds. */
export function worldToVoxel(
  domain: VoxelDomain,
  p: V3,
): { i: number; j: number; k: number; idx: number } {
  const i = Math.floor((p[0] - domain.origin[0]) / domain.voxelSize);
  const j = Math.floor((p[1] - domain.origin[1]) / domain.voxelSize);
  const k = Math.floor((p[2] - domain.origin[2]) / domain.voxelSize);
  const [nx, ny, nz] = domain.dims;
  if (i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz) {
    return { i, j, k, idx: -1 };
  }
  return { i, j, k, idx: i + j * nx + k * nx * ny };
}
