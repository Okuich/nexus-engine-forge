import { describe, it, expect } from 'vitest';
import { checkFidelity, checkLODFidelity } from '@/lib/geometry/simplification/fidelity';
import type { RawMesh } from '@/lib/geometry/types';

// A small tetrahedron mesh.
function tetra(): RawMesh {
  return {
    positions: new Float32Array([
      0, 0, 0,
      1, 0, 0,
      0, 1, 0,
      0, 0, 1,
    ]),
    indices: new Uint32Array([
      0, 2, 1,
      0, 1, 3,
      0, 3, 2,
      1, 2, 3,
    ]),
  };
}

// A simple cube (12 triangles) — used as "original".
function cube(): RawMesh {
  const p = new Float32Array([
    0,0,0, 1,0,0, 1,1,0, 0,1,0,
    0,0,1, 1,0,1, 1,1,1, 0,1,1,
  ]);
  const i = new Uint32Array([
    0,2,1, 0,3,2,
    4,5,6, 4,6,7,
    0,1,5, 0,5,4,
    2,3,7, 2,7,6,
    1,2,6, 1,6,5,
    3,0,4, 3,4,7,
  ]);
  return { positions: p, indices: i };
}

// Coarsened cube — collapsed a vertex (intentionally lossy).
function squashedCube(): RawMesh {
  const p = new Float32Array([
    0,0,0, 1,0,0, 1,1,0, 0,1,0,
    0,0,1, 1,0,1, 1,1,1, 0,1,1,
  ]);
  // Move vertex 6 inward to deform.
  p[6*3 + 0] = 0.6; p[6*3 + 1] = 0.6; p[6*3 + 2] = 0.6;
  const i = new Uint32Array([
    0,2,1, 0,3,2,
    4,5,6, 4,6,7,
    0,1,5, 0,5,4,
    2,3,7, 2,7,6,
    1,2,6, 1,6,5,
    3,0,4, 3,4,7,
  ]);
  return { positions: p, indices: i };
}

describe('checkFidelity', () => {
  it('returns near-perfect score for identical meshes', () => {
    const m = cube();
    const r = checkFidelity(m, m);
    expect(r.score).toBeGreaterThan(0.95);
    expect(r.hausdorffNorm).toBeLessThan(1e-6);
    expect(r.meanSurfaceDistanceNorm).toBeLessThan(1e-6);
    expect(r.sharpEdgePreservation).toBe(1);
    expect(r.boundaryPreservation).toBe(1);
    expect(Math.abs(r.surfaceAreaDrift)).toBeLessThan(1e-6);
  });

  it('penalises geometric deviation', () => {
    const ref = cube();
    const def = squashedCube();
    const r = checkFidelity(ref, def);
    expect(r.hausdorffNorm).toBeGreaterThan(0);
    expect(r.score).toBeLessThan(0.99);
    expect(r.subScores.distance).toBeLessThanOrEqual(1);
    expect(r.counts.samples).toBeGreaterThan(0);
  });

  it('detects volume / area drift', () => {
    const ref = cube();
    const big: RawMesh = {
      positions: Float32Array.from(Array.from(ref.positions as Float32Array).map((v) => v * 2)),
      indices: ref.indices,
    };
    const r = checkFidelity(ref, big);
    expect(r.surfaceAreaDrift).toBeGreaterThan(0);
    expect(r.volumeDrift).toBeGreaterThan(0);
  });

  it('reports sharp/boundary counts', () => {
    const r = checkFidelity(tetra(), tetra());
    expect(r.counts.originalSharpEdges).toBeGreaterThan(0);
    expect(r.counts.simplifiedSharpEdges).toBe(r.counts.originalSharpEdges);
  });

  it('checkLODFidelity returns one report per level', () => {
    const base = cube();
    const reports = checkLODFidelity(base, [
      { level: 1, mesh: base },
      { level: 2, mesh: squashedCube() },
    ]);
    expect(reports).toHaveLength(2);
    expect(reports[0].report.score).toBeGreaterThan(reports[1].report.score - 1e-9);
  });

  it('respects custom weights (sharp-only weighting)', () => {
    const ref = cube();
    const def = squashedCube();
    const r = checkFidelity(ref, def, {
      weights: { distance: 0, normal: 0, curvature: 0, sharp: 1, boundary: 0, volume: 0 },
    });
    expect(r.score).toBeCloseTo(r.subScores.sharp, 6);
  });
});
