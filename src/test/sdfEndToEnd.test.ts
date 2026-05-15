import { describe, expect, it } from 'vitest';
import {
  generateSDF,
  isInside,
  nearestSurface,
  sampleSDF,
  gradient,
} from '@/lib/geometry';
import type { RawMesh } from '@/lib/geometry';

/**
 * End-to-end tests for the SDF pipeline.
 *
 * Uses a unit cube centered at the origin (extent [-1, 1]³) so analytic
 * ground truth is available for sample / inside / nearest queries.
 */

// ─── Cube mesh fixture ─────────────────────────────────────────────

function unitCube(): RawMesh {
  // 8 corners of [-1, 1]³
  const v: [number, number, number][] = [
    [-1, -1, -1], [ 1, -1, -1], [ 1,  1, -1], [-1,  1, -1],
    [-1, -1,  1], [ 1, -1,  1], [ 1,  1,  1], [-1,  1,  1],
  ];
  // outward-facing triangles per face (CCW from outside)
  const faces: [number, number, number][] = [
    // -Z
    [0, 2, 1], [0, 3, 2],
    // +Z
    [4, 5, 6], [4, 6, 7],
    // -Y
    [0, 1, 5], [0, 5, 4],
    // +Y
    [3, 7, 6], [3, 6, 2],
    // -X
    [0, 4, 7], [0, 7, 3],
    // +X
    [1, 2, 6], [1, 6, 5],
  ];
  const positions: number[] = [];
  for (const [a, b, c] of faces) {
    positions.push(...v[a], ...v[b], ...v[c]);
  }
  return { positions: new Float32Array(positions) };
}

// Analytic SDF for axis-aligned box [-1, 1]³.
function cubeSDF(p: [number, number, number]): number {
  const dx = Math.abs(p[0]) - 1;
  const dy = Math.abs(p[1]) - 1;
  const dz = Math.abs(p[2]) - 1;
  const outside = Math.hypot(Math.max(dx, 0), Math.max(dy, 0), Math.max(dz, 0));
  const inside = Math.min(0, Math.max(dx, dy, dz));
  return outside + inside;
}

// ─── Tests ─────────────────────────────────────────────────────────

describe('SDF end-to-end (unit cube)', () => {
  const mesh = unitCube();
  const field = generateSDF(mesh, { resolution: 48, padding: 0.5, signMethod: 'raycast' });

  it('produces a valid grid', () => {
    expect(field.backend).toBe('cpu');
    expect(field.sourceTriangles).toBe(12);
    const [nx, ny, nz] = field.dims;
    expect(field.data.length).toBe(nx * ny * nz);
    expect(field.voxelSize).toBeGreaterThan(0);
    // Bounds should comfortably enclose the [-1, 1] cube + padding.
    expect(field.bounds.min[0]).toBeLessThanOrEqual(-1);
    expect(field.bounds.max[0]).toBeGreaterThanOrEqual(1);
  });

  it('sampleSDF matches analytic SDF within voxel resolution', () => {
    // Tolerance: 1.5 voxels — accounts for trilinear interp + discretization.
    const tol = field.voxelSize * 1.5;
    const probes: [number, number, number][] = [
      [0, 0, 0],         // deep interior
      [0.5, 0, 0],       // interior off-center
      [1.5, 0, 0],       // exterior face-normal direction
      [2, 2, 2],         // exterior corner direction
      [-0.9, 0.3, 0.1],  // close to interior surface
    ];
    for (const p of probes) {
      const got = sampleSDF(field, p);
      const want = cubeSDF(p);
      expect(Math.abs(got - want)).toBeLessThan(tol);
    }
  });

  it('isInside agrees with analytic predicate well away from the surface', () => {
    // Skip points within ~1 voxel of surface where discretization can flip sign.
    const margin = field.voxelSize * 1.5;
    const insidePoints: [number, number, number][] = [
      [0, 0, 0], [0.5, -0.4, 0.2], [-0.7, 0.7, -0.7],
    ];
    const outsidePoints: [number, number, number][] = [
      [2, 0, 0], [0, 3, 0], [-2, -2, -2], [1.5, 1.5, 0],
    ];
    for (const p of insidePoints) {
      expect(Math.abs(cubeSDF(p))).toBeGreaterThan(margin);
      expect(isInside(field, p)).toBe(true);
    }
    for (const p of outsidePoints) {
      expect(Math.abs(cubeSDF(p))).toBeGreaterThan(margin);
      expect(isInside(field, p)).toBe(false);
    }
  });

  it('gradient points outward and is roughly unit length', () => {
    // At (1.5, 0, 0) the outward normal is +X.
    const g = gradient(field, [1.5, 0, 0]);
    const norm = Math.hypot(g[0], g[1], g[2]);
    expect(norm).toBeGreaterThan(0.5); // direction estimate is meaningful
    expect(g[0] / norm).toBeGreaterThan(0.7); // dominantly +X
    expect(Math.abs(g[1] / norm)).toBeLessThan(0.5);
    expect(Math.abs(g[2] / norm)).toBeLessThan(0.5);
  });

  it('nearestSurface lands on the cube boundary', () => {
    const tol = field.voxelSize * 2;
    const queries: [number, number, number][] = [
      [1.4, 0, 0],     // expected nearest ≈ (1, 0, 0)
      [0, -1.6, 0.1],  // expected nearest ≈ (0, -1, 0.1)
      [0.5, 0.5, 0.5], // interior — projects to a face
    ];
    for (const q of queries) {
      const r = nearestSurface(field, q);
      // Returned point must be on the cube surface: |coord| ≈ 1 on dominant axis.
      const maxAbs = Math.max(Math.abs(r.point[0]), Math.abs(r.point[1]), Math.abs(r.point[2]));
      expect(Math.abs(maxAbs - 1)).toBeLessThan(tol);
      // Reported signed distance matches the analytic SDF at the query point.
      expect(Math.abs(r.signedDistance - cubeSDF(q))).toBeLessThan(tol);
      // Normal is finite and unit-ish.
      const n = Math.hypot(r.normal[0], r.normal[1], r.normal[2]);
      expect(Number.isFinite(n)).toBe(true);
      expect(n).toBeGreaterThan(0.5);
    }
  });
});
