/**
 * Convert a `TopoProposal` (final SIMP density field) into a manufacturable
 * mesh and optionally serialize it to STL or OBJ.
 */
import type { TopoProposal } from './types';
import type { RawMesh } from '../types';
import { marchingCubes, type MarchingCubesOptions } from './marchingCubes';
import {
  exportMesh,
  exportOBJ,
  exportSTL,
  exportSTLBinary,
  type ExportFormat,
  type ExportOptions,
} from './meshExport';

export interface ProposalMeshOptions extends MarchingCubesOptions {
  /** Optional output format. If set, returns a serialized payload too. */
  format?: ExportFormat;
  /** Serializer options forwarded to STL/OBJ exporters. */
  exportOptions?: ExportOptions;
}

export interface ProposalMeshResult {
  mesh: RawMesh;
  /** Triangle count after marching cubes. */
  triangleCount: number;
  /** Serialized payload when `format` was supplied. */
  exported?: string | Uint8Array;
  format?: ExportFormat;
}

export function proposalToMesh(
  proposal: TopoProposal,
  options: ProposalMeshOptions = {},
): ProposalMeshResult {
  const mesh = marchingCubes(
    {
      data: proposal.density,
      dims: proposal.dims,
      origin: proposal.origin,
      voxelSize: proposal.voxelSize,
    },
    { isoLevel: options.isoLevel ?? 0.5, weld: options.weld ?? true },
  );
  const triangleCount = mesh.indices
    ? Math.floor((mesh.indices as ArrayLike<number>).length / 3)
    : Math.floor(mesh.positions.length / 9);

  const result: ProposalMeshResult = { mesh, triangleCount };
  if (options.format) {
    result.exported = exportMesh(mesh, options.format, options.exportOptions);
    result.format = options.format;
  }
  return result;
}

export { exportMesh, exportSTL, exportSTLBinary, exportOBJ };
export type { ExportFormat, ExportOptions };
