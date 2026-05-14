import { describe, it, expect } from 'vitest';
import { generateBox, generateSphere } from '@/lib/geometry/core';
import {
  generateSDF,
  sampleSDF,
  isInside,
  nearestSurface,
  checkSDFGate,
  SDFGateError,
  generateSDFGated,
} from '@/lib/geometry/sdf';

describe('SDF Engine', () => {
  it('generates a signed distance field for a box', () => {
    const box = generateBox({ width: 10, height: 10, depth: 10 });
    const sdf = generateSDF(box, { resolution: 24, signMethod: 'normal' });
    expect(sdf.dims[0]).toBeGreaterThan(0);
    expect(sdf.data.length).toBe(sdf.dims[0] * sdf.dims[1] * sdf.dims[2]);
    expect(sdf.backend).toBe('cpu');
  });

  it('reports inside/outside correctly', () => {
    const sphere = generateSphere({ radius: 5, segments: 16 });
    const sdf = generateSDF(sphere, { resolution: 32, signMethod: 'raycast' });
    expect(isInside(sdf, [0, 0, 0])).toBe(true);     // center
    expect(isInside(sdf, [20, 0, 0])).toBe(false);   // far outside
  });

  it('returns sensible nearest-surface projection', () => {
    const sphere = generateSphere({ radius: 5, segments: 16 });
    const sdf = generateSDF(sphere, { resolution: 32, signMethod: 'normal' });
    const result = nearestSurface(sdf, [10, 0, 0]);
    const dist = Math.hypot(result.point[0], result.point[1], result.point[2]);
    expect(dist).toBeGreaterThan(3);
    expect(dist).toBeLessThan(7);
    expect(result.signedDistance).toBeGreaterThan(0);
  });

  it('samples interpolated distances', () => {
    const box = generateBox({ width: 4, height: 4, depth: 4 });
    const sdf = generateSDF(box, { resolution: 16, signMethod: 'normal' });
    const dInside = sampleSDF(sdf, [0, 0, 0]);
    const dOutside = sampleSDF(sdf, [10, 0, 0]);
    expect(dInside).toBeLessThan(0);
    expect(dOutside).toBeGreaterThan(0);
  });
});

describe('SDF Gating', () => {
  it('blocks Starter tier by default', () => {
    const decision = checkSDFGate({ tier: 'starter', triangleCount: 100, voxelCount: 1000 });
    expect(decision.allowed).toBe(false);
    expect(decision.upgradeTo).toBe('professional');
  });

  it('allows Professional for assembly workflows', () => {
    const decision = checkSDFGate({
      tier: 'professional',
      isAssembly: true,
      triangleCount: 1000,
      voxelCount: 64 * 64 * 64,
    });
    expect(decision.allowed).toBe(true);
  });

  it('blocks Professional for small ad-hoc parts', () => {
    const decision = checkSDFGate({
      tier: 'professional',
      isAssembly: false,
      triangleCount: 1000,
      voxelCount: 64 * 64 * 64,
    });
    expect(decision.allowed).toBe(false);
    expect(decision.upgradeTo).toBe('enterprise');
  });

  it('allows Enterprise unrestricted within voxel ceiling', () => {
    const decision = checkSDFGate({
      tier: 'enterprise',
      triangleCount: 100,
      voxelCount: 256 * 256 * 256,
    });
    expect(decision.allowed).toBe(true);
  });

  it('throws SDFGateError when gate denies generation', async () => {
    const box = generateBox({ width: 10, height: 10, depth: 10 });
    await expect(
      generateSDFGated(box, { gating: { tier: 'starter' }, resolution: 32 }),
    ).rejects.toBeInstanceOf(SDFGateError);
  });

  it('runs end-to-end gated generation for enterprise', async () => {
    const box = generateBox({ width: 10, height: 10, depth: 10 });
    const sdf = await generateSDFGated(box, {
      gating: { tier: 'enterprise' },
      resolution: 16,
      signMethod: 'normal',
    });
    expect(sdf.backend).toBe('cpu'); // no GPU in sandbox
    expect(sdf.data.length).toBeGreaterThan(0);
  });
});
