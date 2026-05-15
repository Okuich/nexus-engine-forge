/**
 * Integration test that exercises the WebGPU branch of `runSIMPAuto` by
 * installing a minimal `navigator.gpu` adapter mock. The sandbox has no
 * real GPU, so we satisfy `ensureContext` (adapter → device → 3 compute
 * pipelines) with a fake device and exit `runSIMPGPU` early via its
 * "no sources / no supports" guard. That guard returns the canonical
 * `backend: 'webgpu'` result, which `runSIMPAuto` must propagate with
 * `fellBack: false` and no `fallbackReason`.
 *
 * This complements `runSIMPAuto.test.ts` (CPU fallback path) by proving
 * the GPU dispatch path returns the discriminated GPU backend tag when
 * an adapter is available.
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

function installGpuMock() {
  const fakePass = {
    setPipeline: () => {},
    setBindGroup: () => {},
    dispatchWorkgroups: () => {},
    end: () => {},
  };
  const fakeEncoder = {
    copyBufferToBuffer: () => {},
    beginComputePass: () => fakePass,
    finish: () => ({}),
  };
  const fakePipeline = { getBindGroupLayout: () => ({}) };
  const fakeDevice = {
    queue: { writeBuffer: () => {}, submit: () => {} },
    createBuffer: () => ({ destroy: () => {} }),
    createShaderModule: () => ({}),
    createComputePipeline: () => fakePipeline,
    createCommandEncoder: () => fakeEncoder,
    createBindGroup: () => ({}),
    // `lost` must be a Promise; use a never-resolving one for the test lifetime.
    lost: new Promise(() => {}),
  };
  const fakeAdapter = { requestDevice: async () => fakeDevice };
  const fakeGpu = { requestAdapter: async () => fakeAdapter };
  vi.stubGlobal('navigator', { ...globalThis.navigator, gpu: fakeGpu });
}

describe('runSIMPAuto with mocked WebGPU adapter', () => {
  beforeEach(() => {
    // Force a fresh module instance so the cached `gpuCtx` from any prior
    // import (which may have been initialized without a GPU) is discarded.
    vi.resetModules();
    installGpuMock();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("returns backend='webgpu' with fellBack=false when an adapter is present", async () => {
    const { runSIMPAuto, hasWebGPUForSIMP } = await import('@/lib/geometry/topology');

    // Sanity-check: the mock adapter is visible to the capability probe.
    expect(await hasWebGPUForSIMP()).toBe(true);

    // Empty loads/supports trigger runSIMPGPU's early-return path, which
    // still returns the canonical `backend: 'webgpu'` envelope. That keeps
    // the test independent of any actual WGSL execution.
    const result = await runSIMPAuto(tinyDomain(4), [], [], {
      maxIterations: 1,
      targetVolumeFraction: 0.4,
    });

    expect(result.backend).toBe('webgpu');
    expect(result.fellBack).toBe(false);
    expect(result.fallbackReason).toBeUndefined();
    expect(result.density.length).toBe(4 * 4 * 4);
    expect(typeof result.elapsedMs).toBe('number');
    expect(Array.isArray(result.history)).toBe(true);
  });
});
