/**
 * Verifies the GPU-failure branch of `runSIMPAuto`: when an adapter is
 * present but the GPU run throws, the auto-dispatcher must catch the
 * error, run the CPU solver, and report `backend: 'cpu'`, `fellBack: true`,
 * and a `gpu_run_failed:` fallback reason.
 *
 * We trigger the throw deep in `ensureContext` by giving the mocked
 * adapter a `requestDevice` that rejects — this exercises the same
 * try/catch path that handles real device-lost / OOM / shader-compile
 * failures in production.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { VoxelDomain } from '@/lib/geometry/topology';

function tinyDomain(n = 4): VoxelDomain {
  const N = n * n * n;
  return {
    dims: [n, n, n],
    origin: [0, 0, 0],
    voxelSize: 1 / n,
    designMask: new Uint8Array(N).fill(1),
  };
}

function installFailingGpuMock() {
  const fakeAdapter = {
    requestDevice: async () => {
      throw new Error('simulated device init failure');
    },
  };
  const fakeGpu = { requestAdapter: async () => fakeAdapter };
  vi.stubGlobal('navigator', { ...globalThis.navigator, gpu: fakeGpu });
}

describe('runSIMPAuto GPU failure → CPU fallback', () => {
  beforeEach(() => {
    vi.resetModules();
    installFailingGpuMock();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('falls back to CPU and tags fallbackReason with gpu_run_failed when the GPU run throws', async () => {
    const { runSIMPAuto } = await import('@/lib/geometry/topology');

    const result = await runSIMPAuto(
      tinyDomain(4),
      [{ point: [0, 0.5, 0.5], force: [0, -1, 0] }],
      [{ point: [1, 0.5, 0.5], fixed: true }],
      { maxIterations: 2, targetVolumeFraction: 0.4 },
    );

    expect(result.backend).toBe('cpu');
    expect(result.fellBack).toBe(true);
    expect(result.fallbackReason).toBeDefined();
    expect(result.fallbackReason).toMatch(/^gpu_run_failed:/);
    expect(result.fallbackReason).toContain('simulated device init failure');
    expect(result.density.length).toBe(4 * 4 * 4);
    expect(result.iterations).toBeGreaterThan(0);
  });
});
