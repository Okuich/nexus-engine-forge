import { describe, it, expect } from 'vitest';
import { marchingCubes } from '../lib/geometry/topology/marchingCubes';
import {
  exportSTL,
  exportSTLBinary,
  exportOBJ,
} from '../lib/geometry/topology/meshExport';
import { proposalToMesh } from '../lib/geometry/topology/proposalMesh';
import type { TopoProposal } from '../lib/geometry/topology/types';

/** Build a centered "blob" density field: 1.0 inside a sphere of radius r. */
function sphereField(n: number, r: number): Float32Array {
  const data = new Float32Array(n * n * n);
  const c = (n - 1) / 2;
  for (let k = 0; k < n; k++) {
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const dx = i - c, dy = j - c, dz = k - c;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        data[i + n * (j + n * k)] = d < r ? 1 : 0;
      }
    }
  }
  return data;
}

describe('marching cubes + mesh export', () => {
  it('extracts a closed mesh from a sphere density field', () => {
    const n = 16;
    const data = sphereField(n, 5);
    const mesh = marchingCubes({
      data,
      dims: [n, n, n],
      origin: [0, 0, 0],
      voxelSize: 1,
    });
    expect(mesh.positions.length).toBeGreaterThan(0);
    expect(mesh.indices && mesh.indices.length).toBeGreaterThan(0);
    // No degenerate triangles referenced beyond vertex array
    const vCount = mesh.positions.length / 3;
    for (const idx of mesh.indices as Uint32Array) {
      expect(idx).toBeLessThan(vCount);
    }
  });

  it('returns empty mesh below iso threshold', () => {
    const data = new Float32Array(8 * 8 * 8); // all zeros
    const mesh = marchingCubes({ data, dims: [8, 8, 8], origin: [0, 0, 0], voxelSize: 1 });
    expect(mesh.positions.length).toBe(0);
  });

  it('exports ASCII STL with facet normals', () => {
    const n = 12;
    const data = sphereField(n, 4);
    const mesh = marchingCubes({ data, dims: [n, n, n], origin: [0, 0, 0], voxelSize: 1 });
    const stl = exportSTL(mesh, { name: 'unit' });
    expect(stl.startsWith('solid unit')).toBe(true);
    expect(stl.endsWith('endsolid unit')).toBe(true);
    expect(stl).toContain('facet normal');
    expect(stl).toContain('outer loop');
  });

  it('exports binary STL with correct header + tri count', () => {
    const n = 12;
    const data = sphereField(n, 4);
    const mesh = marchingCubes({ data, dims: [n, n, n], origin: [0, 0, 0], voxelSize: 1 });
    const bin = exportSTLBinary(mesh);
    expect(bin.byteLength).toBeGreaterThan(84);
    const view = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
    const triCount = view.getUint32(80, true);
    expect(bin.byteLength).toBe(84 + 50 * triCount);
    const triCountFromIdx = (mesh.indices as Uint32Array).length / 3;
    expect(triCount).toBe(triCountFromIdx);
  });

  it('exports OBJ with v/f records', () => {
    const n = 12;
    const data = sphereField(n, 4);
    const mesh = marchingCubes({ data, dims: [n, n, n], origin: [0, 0, 0], voxelSize: 1 });
    const obj = exportOBJ(mesh, { name: 'unit', includeNormals: true });
    expect(obj).toMatch(/^o unit/m);
    expect(obj).toMatch(/^v /m);
    expect(obj).toMatch(/^vn /m);
    expect(obj).toMatch(/^f \d+\/\/\d+ \d+\/\/\d+ \d+\/\/\d+/m);
  });

  it('proposalToMesh produces serialized output when format is set', () => {
    const n = 14;
    const data = sphereField(n, 4);
    const proposal: TopoProposal = {
      density: data,
      dims: [n, n, n],
      origin: [0, 0, 0],
      voxelSize: 1,
      compliance: 0,
      volumeFraction: 0.3,
      estMassG: 0,
      estUnitCostUsd: 0,
      estSafetyFactor: 1,
      iterations: 0,
      converged: true,
      manufacturable: true,
      elapsedMs: 0,
    };
    const stlResult = proposalToMesh(proposal, { format: 'stl' });
    expect(typeof stlResult.exported).toBe('string');
    expect(stlResult.triangleCount).toBeGreaterThan(0);

    const binResult = proposalToMesh(proposal, { format: 'stl-binary' });
    expect(binResult.exported).toBeInstanceOf(Uint8Array);

    const objResult = proposalToMesh(proposal, { format: 'obj' });
    expect(typeof objResult.exported).toBe('string');
    expect((objResult.exported as string)).toContain('v ');
  });
});
