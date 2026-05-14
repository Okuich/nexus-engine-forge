import { describe, it, expect } from 'vitest';
import { runSIMP, applyConstraintPenalties } from '@/lib/geometry/topology';
import type { VoxelDomain } from '@/lib/geometry/topology';

function slabDomain(n = 8): VoxelDomain {
  const N = n * n * n;
  return {
    dims: [n, n, n],
    origin: [0, 0, 0],
    voxelSize: 1 / n,
    designMask: new Uint8Array(N).fill(1),
  };
}

describe('SIMP constraint penalties', () => {
  it('overhang penalty pushes density away from unsupported cells', () => {
    const dims: [number, number, number] = [4, 4, 4];
    const N = 4 * 4 * 4;
    const density = new Float32Array(N).fill(0.5);
    const sens = new Float32Array(N).fill(-1);
    const mask = new Uint8Array(N).fill(1);
    const { sensitivity, diagnostics } = applyConstraintPenalties(sens, density, mask, dims, {
      manufacturing: { process: 'fdm_3d_print', pullAxis: 'z', maxOverhangDeg: 0 },
      weights: { overhang: 1.0 },
    });
    // Cells above the build plate (k>0) should have *increased* sensitivity (less negative).
    let bumpedAbove = 0;
    for (let k = 1; k < 4; k++) {
      for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
        const idx = i + j * 4 + k * 16;
        if (sensitivity[idx] > sens[idx]) bumpedAbove++;
      }
    }
    expect(bumpedAbove).toBeGreaterThan(0);
    expect(diagnostics.overhangViolations).toBeGreaterThan(0);
  });

  it('min-feature penalty flags isolated thin cells', () => {
    const dims: [number, number, number] = [5, 5, 5];
    const N = 125;
    const density = new Float32Array(N); // mostly empty
    const center = 2 + 2 * 5 + 2 * 25;
    density[center] = 1.0; // single isolated dense voxel
    const sens = new Float32Array(N).fill(-1);
    const mask = new Uint8Array(N).fill(1);
    const { sensitivity, diagnostics } = applyConstraintPenalties(sens, density, mask, dims, {
      manufacturing: { process: 'cnc_milling', minFeatureMm: 2 },
      weights: { minFeature: 1.0 },
      voxelSizeMm: 1,
    });
    expect(sensitivity[center]).toBeGreaterThan(sens[center]); // penalty bumped it
    expect(diagnostics.minFeatureViolations).toBeGreaterThanOrEqual(1);
  });

  it('stress penalty drives density UP in over-stressed cells', () => {
    const dims: [number, number, number] = [3, 3, 3];
    const N = 27;
    const density = new Float32Array(N).fill(0.5);
    const sens = new Float32Array(N).fill(0);
    const flow = new Float32Array(N);
    flow[13] = 100; // massive stress at center
    const { sensitivity, diagnostics } = applyConstraintPenalties(sens, density, new Uint8Array(N).fill(1), dims, {
      weights: { stress: 1.0 },
      flow,
      maxStress: 1,
    });
    expect(sensitivity[13]).toBeLessThan(0); // negative → OC will densify
    expect(diagnostics.stressViolations).toBe(1);
  });

  it('runSIMP threads constraints into the iteration callback diagnostics', () => {
    const domain = slabDomain(6);
    const states: number[] = [];
    runSIMP(
      domain,
      [{ point: [0.05, 0.5, 0.5], force: [0, -1, 0] }],
      [{ point: [0.95, 0.5, 0.5] }],
      {
        maxIterations: 4,
        constraints: {
          manufacturing: { process: 'fdm_3d_print', pullAxis: 'z', maxOverhangDeg: 0 },
          weights: { overhang: 0.1 },
        },
        onIteration: (s) => { states.push(s.penaltyDiagnostics?.overhangViolations ?? -1); },
      },
    );
    expect(states.length).toBeGreaterThan(0);
    expect(states.every((v) => v >= 0)).toBe(true);
  });
});
