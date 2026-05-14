import { describe, it, expect } from 'vitest';
import { generateBox } from '@/lib/geometry/core';
import {
  optimizeTopology,
  refineTopology,
  checkTopoGate,
  TopoGateError,
  thresholdDensity,
  openMorphology,
  type PhysicsValidation,
} from '@/lib/geometry/topology';

const validPhysics: PhysicsValidation = {
  modelId: 'fea-v2',
  validated: true,
  accuracy: 0.92,
  trainingSamples: 500,
};

describe('Topology Gating', () => {
  it('blocks Starter tier', () => {
    const d = checkTopoGate({ tier: 'starter', physics: validPhysics, voxelCount: 1000 });
    expect(d.allowed).toBe(false);
    expect(d.upgradeTo).toBe('professional');
  });

  it('blocks unvalidated physics', () => {
    const d = checkTopoGate({
      tier: 'enterprise',
      physics: { modelId: 'x', validated: false },
      voxelCount: 1000,
    });
    expect(d.allowed).toBe(false);
  });

  it('blocks low-accuracy models', () => {
    const d = checkTopoGate({
      tier: 'enterprise',
      physics: { ...validPhysics, accuracy: 0.5 },
      voxelCount: 1000,
    });
    expect(d.allowed).toBe(false);
  });

  it('blocks insufficient training samples', () => {
    const d = checkTopoGate({
      tier: 'enterprise',
      physics: { ...validPhysics, trainingSamples: 10 },
      voxelCount: 1000,
    });
    expect(d.allowed).toBe(false);
  });

  it('allows Professional only with enterprise workflow', () => {
    expect(checkTopoGate({
      tier: 'professional', physics: validPhysics, voxelCount: 1000,
    }).allowed).toBe(false);
    expect(checkTopoGate({
      tier: 'professional', physics: validPhysics, voxelCount: 1000,
      enterpriseWorkflow: true,
    }).allowed).toBe(true);
  });

  it('allows Enterprise within voxel ceiling', () => {
    expect(checkTopoGate({
      tier: 'enterprise', physics: validPhysics, voxelCount: 100_000,
    }).allowed).toBe(true);
  });
});

describe('Manufacturability post-processing', () => {
  it('thresholds density into binary', () => {
    const d = new Float32Array([0.2, 0.6, 0.49, 0.99]);
    const b = thresholdDensity(d);
    expect(Array.from(b)).toEqual([0, 1, 0, 1]);
  });

  it('morphological opening removes thin features', () => {
    // 4×4×1 grid with single isolated voxel — should be removed by opening
    const dims: [number, number, number] = [4, 4, 1];
    const b = new Uint8Array(16);
    b[5] = 1; // isolated
    const opened = openMorphology(b, dims, 1);
    expect(opened.reduce((a, x) => a + x, 0)).toBe(0);
  });
});

describe('Topology Optimization Pipeline', () => {
  it('throws when gating denies', () => {
    const box = generateBox({ width: 20, height: 10, depth: 10 });
    expect(() => optimizeTopology({
      mesh: box,
      loads: [{ point: [10, 5, 5], force: [0, -100, 0] }],
      supports: [{ point: [-10, 5, 5] }, { point: [-10, 5, 5] }],
      manufacturing: { process: 'cnc_milling', minFeatureMm: 1 },
      physics: { modelId: 'm', validated: false },
      cost: { material: 'aluminum_6061' },
      tier: 'enterprise',
    })).toThrow(TopoGateError);
  });

  it('produces a manufacturable proposal end-to-end', () => {
    const box = generateBox({ width: 20, height: 10, depth: 10 });
    const proposal = optimizeTopology({
      mesh: box,
      loads: [{ point: [8, 0, 0], force: [0, -200, 0] }],
      supports: [
        { point: [-8, 0, 0] },
        { point: [-8, 2, 2] },
      ],
      manufacturing: { process: 'cnc_milling', minFeatureMm: 1, symmetry: 'z' },
      physics: validPhysics,
      cost: { material: 'aluminum_6061' },
      tier: 'enterprise',
      options: {
        resolution: 16,
        targetVolumeFraction: 0.45,
        maxIterations: 8,
        timeBudgetMs: 4000,
      },
    });
    expect(proposal.iterations).toBeGreaterThan(0);
    expect(proposal.dims[0]).toBeGreaterThan(0);
    expect(proposal.density.length).toBe(proposal.dims[0] * proposal.dims[1] * proposal.dims[2]);
    expect(proposal.estMassG).toBeGreaterThan(0);
    expect(proposal.estUnitCostUsd).toBeGreaterThan(0);
    expect(proposal.manufacturable).toBe(true);
    expect(proposal.volumeFraction).toBeLessThan(1);
  });

  it('supports iterative refinement via resumeFrom', () => {
    const box = generateBox({ width: 16, height: 8, depth: 8 });
    const req = {
      mesh: box,
      loads: [{ point: [6, 0, 0] as [number, number, number], force: [0, -100, 0] as [number, number, number] }],
      supports: [{ point: [-6, 0, 0] as [number, number, number] }],
      manufacturing: { process: 'cnc_milling' as const, minFeatureMm: 1 },
      physics: validPhysics,
      cost: { material: 'aluminum_6061' as const },
      tier: 'enterprise' as const,
      options: { resolution: 12, maxIterations: 4, timeBudgetMs: 3000 },
    };
    const first = optimizeTopology(req);
    const refined = refineTopology(first, req, { maxIterations: 4 });
    expect(refined.density.length).toBe(first.density.length);
    expect(refined.iterations).toBeGreaterThan(0);
  });
});
