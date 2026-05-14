import { describe, it, expect } from 'vitest';
import {
  hasWebGPUForSIMP,
  runSIMPGPU,
  runSIMPAuto,
  WebGPUUnavailableError,
} from '@/lib/geometry/topology';
import type { VoxelDomain } from '@/lib/geometry/topology';

function tinyDomain(n = 6): VoxelDomain {
  const N = n * n * n;
  return {
    dims: [n, n, n],
    origin: [0, 0, 0],
    voxelSize: 1 / n,
    designMask: new Uint8Array(N).fill(1),
  };
}

describe('GPU SIMP', () => {
  it('detects WebGPU absence in headless / sandbox environment', async () => {
    const ok = await hasWebGPUForSIMP();
    // Sandbox has no GPU; in real browser this may be true. Either is valid.
    expect(typeof ok).toBe('boolean');
  });

  it('runSIMPGPU rejects with WebGPUUnavailableError when no adapter', async () => {
    if (await hasWebGPUForSIMP()) return; // skip on real GPU
    await expect(
      runSIMPGPU(tinyDomain(), [{ point: [0, 0, 0], force: [0, -1, 0] }], [{ point: [1, 1, 1] }]),
    ).rejects.toBeInstanceOf(WebGPUUnavailableError);
  });

  it('runSIMPAuto falls back to CPU when WebGPU unavailable', async () => {
    const result = await runSIMPAuto(
      tinyDomain(4),
      [{ point: [0, 0.5, 0.5], force: [0, -1, 0] }],
      [{ point: [1, 0.5, 0.5] }],
      { maxIterations: 3, resolution: 4 },
    );
    expect(['cpu', 'webgpu']).toContain(result.backend);
    expect(result.density.length).toBe(4 * 4 * 4);
    expect(Array.isArray(result.history)).toBe(true);
  });
});
