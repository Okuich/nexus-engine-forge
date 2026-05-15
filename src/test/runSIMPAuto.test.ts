import { describe, expect, it } from 'vitest';
import { runSIMPAuto, voxelizeForTopology } from '@/lib/geometry/topology';
import type { LoadCondition, SupportCondition } from '@/lib/geometry/topology';
import type { RawMesh } from '@/lib/geometry';

/**
 * Sandbox has no WebGPU adapter, so runSIMPAuto must fall back to CPU
 * and report the right backend tag and fallback reason.
 */

function unitBox(): RawMesh {
  const v: [number, number, number][] = [
    [0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0],
    [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1],
  ];
  const faces: [number, number, number][] = [
    [0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7],
    [0, 1, 5], [0, 5, 4], [3, 7, 6], [3, 6, 2],
    [0, 4, 7], [0, 7, 3], [1, 2, 6], [1, 6, 5],
  ];
  const positions: number[] = v.flat();
  const indices: number[] = faces.flatMap((f) => f);
  return { positions: new Float32Array(positions), indices: new Uint32Array(indices) };
}

describe('runSIMPAuto fallback', () => {
  const domain = voxelizeForTopology(unitBox(), 12);
  const loads: LoadCondition[] = [{ point: [0.9, 0.5, 0.5], force: [0, -1, 0] }];
  const supports: SupportCondition[] = [
    { point: [0.1, 0.1, 0.5], fixed: true },
    { point: [0.1, 0.9, 0.5], fixed: true },
  ];

  it('falls back to CPU when WebGPU is unavailable', async () => {
    const res = await runSIMPAuto(domain, loads, supports, {
      maxIterations: 3,
      targetVolumeFraction: 0.4,
    });
    expect(res.backend).toBe('cpu');
    expect(res.fellBack).toBe(true);
    expect(res.fallbackReason).toBe('webgpu_unavailable');
    expect(res.density.length).toBe(domain.designMask.length);
    expect(res.iterations).toBeGreaterThan(0);
    expect(typeof res.elapsedMs).toBe('number');
    expect(res.elapsedMs).toBeGreaterThanOrEqual(0);
  });

  it('honors forceCpu without claiming a fallback', async () => {
    const res = await runSIMPAuto(domain, loads, supports, {
      maxIterations: 2,
      forceCpu: true,
    });
    expect(res.backend).toBe('cpu');
    expect(res.fellBack).toBe(false);
    expect(res.fallbackReason).toBeUndefined();
  });
});
