import { describe, it, expect } from 'vitest';
import {
  analyzeWatertightness,
  sealSmallHoles,
  ensureWatertight,
} from '@/lib/geometry/topology/meshWatertight';
import { exportSTL } from '@/lib/geometry/topology/meshExport';
import type { RawMesh } from '@/lib/geometry/types';

// Unit tetrahedron: 4 vertices, 4 faces — closed.
const tetraPositions = new Float32Array([
  0, 0, 0,
  1, 0, 0,
  0, 1, 0,
  0, 0, 1,
]);
const tetraIndicesClosed = new Uint32Array([
  0, 2, 1,
  0, 1, 3,
  0, 3, 2,
  1, 2, 3,
]);
// Same tetra but missing the cap face (1,2,3) — exposes a 3-edge boundary loop.
const tetraIndicesOpen = new Uint32Array([
  0, 2, 1,
  0, 1, 3,
  0, 3, 2,
]);

describe('mesh watertightness', () => {
  it('reports closed tetra as watertight', () => {
    const r = analyzeWatertightness({ positions: tetraPositions, indices: tetraIndicesClosed });
    expect(r.isWatertight).toBe(true);
    expect(r.boundaryEdgeCount).toBe(0);
    expect(r.boundaryLoops.length).toBe(0);
    expect(r.nonManifoldEdgeCount).toBe(0);
    expect(r.triangleCount).toBe(4);
  });

  it('detects an open hole with a 3-edge loop', () => {
    const r = analyzeWatertightness({ positions: tetraPositions, indices: tetraIndicesOpen });
    expect(r.isWatertight).toBe(false);
    expect(r.boundaryEdgeCount).toBe(3);
    expect(r.boundaryLoops.length).toBe(1);
    expect(r.boundaryLoops[0].length).toBe(3);
  });

  it('seals a small hole and the result is watertight', () => {
    const open: RawMesh = { positions: tetraPositions, indices: tetraIndicesOpen };
    const result = sealSmallHoles(open, { maxLoopEdges: 8 });
    expect(result.before.isWatertight).toBe(false);
    expect(result.sealedLoops).toBe(1);
    expect(result.skippedLoops).toBe(0);
    expect(result.addedTriangles).toBe(1);
    expect(result.after.isWatertight).toBe(true);
  });

  it('skips loops above the maxLoopEdges threshold', () => {
    const open: RawMesh = { positions: tetraPositions, indices: tetraIndicesOpen };
    const result = sealSmallHoles(open, { maxLoopEdges: 2 });
    expect(result.sealedLoops).toBe(0);
    expect(result.skippedLoops).toBe(1);
    expect(result.after.isWatertight).toBe(false);
  });

  it('ensureWatertight is a no-op for already-closed meshes', () => {
    const closed: RawMesh = { positions: tetraPositions, indices: tetraIndicesClosed };
    const result = ensureWatertight(closed);
    expect(result.addedTriangles).toBe(0);
    expect(result.mesh).toBe(closed);
  });

  it('exportSTL with ensureWatertight seals before serialization', () => {
    const open: RawMesh = { positions: tetraPositions, indices: tetraIndicesOpen };
    let report: { isWatertight: boolean; triangleCount: number } | null = null;
    const stl = exportSTL(open, {
      ensureWatertight: true,
      onWatertightReport: r => { report = r; },
    });
    expect(report).not.toBeNull();
    expect(report!.isWatertight).toBe(true);
    expect(report!.triangleCount).toBe(4);
    // Sealed STL should contain 4 facets, not 3.
    const facetCount = (stl.match(/facet normal/g) ?? []).length;
    expect(facetCount).toBe(4);
  });
});
