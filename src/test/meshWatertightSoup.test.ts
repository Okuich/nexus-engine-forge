/**
 * Verifies that `analyzeWatertightness`, `sealSmallHoles`, and `ensureWatertight`
 * work on a `RawMesh` that has only `positions` and no `indices` (triangle-soup
 * input from STL imports, exported buffers, etc.). The implementation must
 * weld coincident vertices (via `weldEpsilon`) before edge analysis.
 */
import { describe, expect, it } from 'vitest';
import {
  analyzeWatertightness,
  ensureWatertight,
  sealSmallHoles,
} from '@/lib/geometry/topology';
import type { RawMesh } from '@/lib/geometry';

/** Triangle-soup unit cube (12 triangles, no shared indices). */
function soupCube(): RawMesh {
  const v = [
    [0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0],
    [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1],
  ];
  const tris: [number, number, number][] = [
    [0, 2, 1], [0, 3, 2],   // -Z
    [4, 5, 6], [4, 6, 7],   // +Z
    [0, 1, 5], [0, 5, 4],   // -Y
    [3, 7, 6], [3, 6, 2],   // +Y
    [0, 4, 7], [0, 7, 3],   // -X
    [1, 2, 6], [1, 6, 5],   // +X
  ];
  const positions: number[] = [];
  for (const [a, b, c] of tris) positions.push(...v[a], ...v[b], ...v[c]);
  return { positions: new Float32Array(positions) }; // no indices on purpose
}

/** Same cube but with the +Z face removed → 1 boundary loop of 4 edges. */
function openSoupCube(): RawMesh {
  const v = [
    [0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0],
    [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1],
  ];
  const tris: [number, number, number][] = [
    [0, 2, 1], [0, 3, 2],   // -Z
    // +Z removed
    [0, 1, 5], [0, 5, 4],   // -Y
    [3, 7, 6], [3, 6, 2],   // +Y
    [0, 4, 7], [0, 7, 3],   // -X
    [1, 2, 6], [1, 6, 5],   // +X
  ];
  const positions: number[] = [];
  for (const [a, b, c] of tris) positions.push(...v[a], ...v[b], ...v[c]);
  return { positions: new Float32Array(positions) };
}

describe('watertight analysis on unindexed (triangle-soup) meshes', () => {
  it('analyzeWatertightness welds positions and detects a closed cube as watertight', () => {
    const mesh = soupCube();
    expect(mesh.indices).toBeUndefined();

    const report = analyzeWatertightness(mesh);

    expect(report.triangleCount).toBe(12);
    expect(report.boundaryEdgeCount).toBe(0);
    expect(report.boundaryLoops).toHaveLength(0);
    expect(report.nonManifoldEdgeCount).toBe(0);
    expect(report.isWatertight).toBe(true);
  });

  it('analyzeWatertightness detects the open face as a 4-edge boundary loop', () => {
    const mesh = openSoupCube();
    const report = analyzeWatertightness(mesh);

    expect(report.triangleCount).toBe(10);
    expect(report.isWatertight).toBe(false);
    expect(report.boundaryEdgeCount).toBe(4);
    expect(report.boundaryLoops).toHaveLength(1);
    expect(report.boundaryLoops[0]).toHaveLength(4);
    expect(report.nonManifoldEdgeCount).toBe(0);
  });

  it('sealSmallHoles closes the open cube and produces an indexed, watertight mesh', () => {
    const result = sealSmallHoles(openSoupCube());

    expect(result.before.isWatertight).toBe(false);
    expect(result.before.boundaryLoops).toHaveLength(1);
    expect(result.sealedLoops).toBe(1);
    expect(result.skippedLoops).toBe(0);
    expect(result.addedTriangles).toBe(2); // fan over a 4-vert loop = 2 tris

    expect(result.after.isWatertight).toBe(true);
    expect(result.after.boundaryEdgeCount).toBe(0);

    // Output mesh is now indexed (sealing always emits an indexed result).
    expect(result.mesh.indices).toBeDefined();
    expect(result.mesh.indices!.length).toBe((10 + 2) * 3);
  });

  it('ensureWatertight is a no-op when the soup mesh is already closed', () => {
    const mesh = soupCube();
    const result = ensureWatertight(mesh);

    expect(result.before.isWatertight).toBe(true);
    expect(result.after.isWatertight).toBe(true);
    expect(result.sealedLoops).toBe(0);
    expect(result.addedTriangles).toBe(0);
    // No-op path returns the original mesh by reference.
    expect(result.mesh).toBe(mesh);
  });

  it('ensureWatertight seals the open soup mesh end-to-end', () => {
    const result = ensureWatertight(openSoupCube());

    expect(result.before.isWatertight).toBe(false);
    expect(result.after.isWatertight).toBe(true);
    expect(result.sealedLoops).toBe(1);
    expect(result.addedTriangles).toBeGreaterThan(0);
  });

  it('respects weldEpsilon when soup positions have small numerical jitter', () => {
    // Perturb every coordinate by ±1e-5 — well under a 1e-3 weld tolerance.
    const mesh = soupCube();
    const jittered = new Float32Array(mesh.positions);
    for (let i = 0; i < jittered.length; i++) {
      jittered[i] += (i % 2 === 0 ? 1 : -1) * 1e-5;
    }
    const noisy: RawMesh = { positions: jittered };

    // With a tight epsilon, jittered duplicates fail to weld → mesh looks open.
    expect(analyzeWatertightness(noisy, 1e-9).isWatertight).toBe(false);
    // With a loose epsilon that swallows the jitter, watertightness is recovered.
    expect(analyzeWatertightness(noisy, 1e-3).isWatertight).toBe(true);
  });
});
