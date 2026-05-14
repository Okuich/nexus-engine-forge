import { describe, it, expect } from 'vitest';
import {
  detectCollisions,
  detectCollisionsGated,
  sweepMotion,
  checkCollisionGate,
  trianglesIntersect,
  CollisionGateError,
} from '@/lib/geometry/collision';
import type { AssemblyPart, MovingPart } from '@/lib/geometry/collision';
import type { RawMesh } from '@/lib/geometry/types';

/** Axis-aligned cube mesh of given size centered at origin. */
function cube(size = 1): RawMesh {
  const s = size / 2;
  const positions = new Float32Array([
    -s, -s, -s,  s, -s, -s,  s,  s, -s, -s,  s, -s,
    -s, -s,  s,  s, -s,  s,  s,  s,  s, -s,  s,  s,
  ]);
  const indices = new Uint32Array([
    0, 1, 2, 0, 2, 3, // back
    4, 6, 5, 4, 7, 6, // front
    0, 4, 5, 0, 5, 1, // bottom
    2, 6, 7, 2, 7, 3, // top
    0, 3, 7, 0, 7, 4, // left
    1, 5, 6, 1, 6, 2, // right
  ]);
  return { positions, indices };
}

describe('trianglesIntersect', () => {
  it('detects intersecting triangles', () => {
    expect(
      trianglesIntersect(
        [0, 0, 0], [2, 0, 0], [0, 2, 0],
        [1, 1, -1], [1, 1, 1], [3, 1, 0],
      ),
    ).toBe(true);
  });
  it('rejects separated triangles', () => {
    expect(
      trianglesIntersect(
        [0, 0, 0], [1, 0, 0], [0, 1, 0],
        [10, 10, 10], [11, 10, 10], [10, 11, 10],
      ),
    ).toBe(false);
  });
});

describe('detectCollisions', () => {
  it('finds intersecting cubes', () => {
    const parts: AssemblyPart[] = [
      { id: 'A', mesh: cube(1) },
      { id: 'B', mesh: cube(1), transform: { translation: [0.5, 0, 0] } },
    ];
    const report = detectCollisions(parts);
    expect(report.pairs.length).toBe(1);
    expect(report.pairs[0].intersectionCount).toBeGreaterThan(0);
    expect(report.pairs[0].overlapVolume).toBeGreaterThan(0);
    expect(report.severityScore).toBeGreaterThan(0);
  });

  it('finds no collisions for separated parts', () => {
    const parts: AssemblyPart[] = [
      { id: 'A', mesh: cube(1) },
      { id: 'B', mesh: cube(1), transform: { translation: [5, 0, 0] } },
    ];
    const report = detectCollisions(parts);
    expect(report.pairs.length).toBe(0);
  });

  it('flags near-misses within tolerance band', () => {
    const parts: AssemblyPart[] = [
      { id: 'A', mesh: cube(1), tolerance: 0.2 },
      { id: 'B', mesh: cube(1), transform: { translation: [1.1, 0, 0] }, tolerance: 0.2 },
    ];
    const report = detectCollisions(parts);
    expect(report.pairs.length).toBe(1);
    expect(report.pairs[0].withinTolerance).toBe(true);
    expect(report.pairs[0].intersectionCount).toBe(0);
  });

  it('excludes pairs in the same group', () => {
    const parts: AssemblyPart[] = [
      { id: 'A', mesh: cube(1), group: 'g1' },
      { id: 'B', mesh: cube(1), transform: { translation: [0.5, 0, 0] }, group: 'g1' },
    ];
    const report = detectCollisions(parts, { excludeSameGroup: true });
    expect(report.pairs.length).toBe(0);
    expect(report.totalPairsSkipped).toBe(1);
  });
});

describe('sweepMotion', () => {
  it('detects time-of-impact across motion path', () => {
    const parts: Array<AssemblyPart | MovingPart> = [
      { id: 'A', mesh: cube(1) },
      {
        id: 'B',
        mesh: cube(1),
        motion: [
          { t: 0, transform: { translation: [3, 0, 0] } },
          { t: 1, transform: { translation: [0, 0, 0] } },
        ],
      },
    ];
    const result = sweepMotion(parts, { samples: 8 });
    expect(result.timeline.length).toBe(8);
    expect(result.firstContactT).not.toBeNull();
    expect(result.contactPairs.length).toBe(1);
  });
});

describe('gating', () => {
  it('blocks starter without assembly workflow', () => {
    expect(
      checkCollisionGate({
        tier: 'starter', partCount: 2, totalTriangles: 100,
      }).allowed,
    ).toBe(false);
  });
  it('allows starter with assembly workflow under limits', () => {
    expect(
      checkCollisionGate({
        tier: 'starter', partCount: 2, totalTriangles: 100,
        assemblyWorkflow: true,
      }).allowed,
    ).toBe(true);
  });
  it('blocks above part limit', () => {
    expect(
      checkCollisionGate({
        tier: 'professional', partCount: 1000, totalTriangles: 1000,
      }).allowed,
    ).toBe(false);
  });
  it('detectCollisionsGated throws when gated', () => {
    const parts: AssemblyPart[] = [
      { id: 'A', mesh: cube(1) },
      { id: 'B', mesh: cube(1) },
    ];
    expect(() =>
      detectCollisionsGated(parts, { tier: 'starter' }),
    ).toThrow(CollisionGateError);
  });
});
