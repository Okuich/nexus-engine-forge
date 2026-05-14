import { describe, it, expect } from 'vitest';
import {
  streamSIMP,
  subscribeSIMP,
  downsampleDensity,
} from '../lib/api/topoIterationApi';
import type { VoxelDomain } from '../lib/geometry/topology/voxelizer';

function domain(nx = 10, ny = 6, nz = 6): VoxelDomain {
  const N = nx * ny * nz;
  const designMask = new Uint8Array(N).fill(1);
  return { designMask, dims: [nx, ny, nz], origin: [0, 0, 0], voxelSize: 1 };
}

const supports = [{ point: [0.5, 3, 3] as [number, number, number] }];
const loads = [{ point: [9.5, 3, 3] as [number, number, number], force: [0, -100, 0] as [number, number, number] }];

describe('topo iteration preview API', () => {
  it('subscribeSIMP delivers ordered iteration snapshots', async () => {
    const seen: number[] = [];
    const compliances: number[] = [];
    const { promise } = subscribeSIMP(domain(), loads, supports, { maxIterations: 5 }, (s) => {
      seen.push(s.iteration);
      compliances.push(s.compliance);
    });
    const r = await promise;
    expect(seen.length).toBeGreaterThan(0);
    for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeGreaterThan(seen[i - 1]);
    expect(compliances.every((c) => Number.isFinite(c))).toBe(true);
    expect(r.iterations).toBeGreaterThan(0);
  });

  it('streamSIMP yields snapshots and returns the final result', async () => {
    const stream = streamSIMP(domain(), loads, supports, { maxIterations: 4 });
    const snaps = [];
    let result;
    while (true) {
      const r = await stream.next();
      if (r.done) { result = r.value; break; }
      snaps.push(r.value);
    }
    expect(snaps.length).toBeGreaterThan(0);
    // Each snapshot has full-res density matching domain dims
    expect(snaps[0].density.length).toBe(10 * 6 * 6);
    expect(result?.iterations).toBeGreaterThan(0);
    expect(result?.history.length).toBe(snaps.length);
  });

  it('throttle skips intermediate iterations', async () => {
    const seen: number[] = [];
    const { promise } = subscribeSIMP(
      domain(),
      loads,
      supports,
      { maxIterations: 6 },
      (s) => seen.push(s.iteration),
      { throttle: 2 },
    );
    await promise;
    for (const i of seen) expect(i % 2).toBe(0);
  });

  it('preview downsamples density to a smaller grid', async () => {
    const seen: ReturnType<typeof Object>[] = [];
    const { promise } = subscribeSIMP(
      domain(20, 20, 20),
      [{ point: [19, 10, 10], force: [0, -100, 0] }],
      [{ point: [0.5, 10, 10] }],
      { maxIterations: 2 },
      (s) => seen.push(s),
      { preview: { maxAxis: 8 } },
    );
    await promise;
    expect(seen.length).toBeGreaterThan(0);
    const s = seen[0] as { densityPreview: number[]; previewDims: [number, number, number] };
    expect(s.densityPreview).toBeDefined();
    expect(s.previewDims).toEqual([8, 8, 8]);
    expect(s.densityPreview.length).toBe(8 * 8 * 8);
  });

  it('downsampleDensity averages 3D blocks', () => {
    // 4×4×4 grid, all ones except an 8-cell dense block at the corner
    const data = new Float32Array(64);
    for (let k = 0; k < 2; k++)
      for (let j = 0; j < 2; j++)
        for (let i = 0; i < 2; i++) data[i + 4 * (j + 4 * k)] = 1;
    const ds = downsampleDensity(data, [4, 4, 4], 2);
    expect(ds.dims).toEqual([2, 2, 2]);
    // Corner at (0,0,0) should be 1 (dense), others 0
    expect(ds.values[0]).toBeCloseTo(1, 6);
    for (let i = 1; i < 8; i++) expect(ds.values[i]).toBeCloseTo(0, 6);
  });

  it('returns full-resolution density unchanged when preview is omitted', async () => {
    const { promise } = subscribeSIMP(
      domain(),
      loads,
      supports,
      { maxIterations: 1 },
      () => {},
    );
    const r = await promise;
    expect(r.density.length).toBe(10 * 6 * 6);
  });
});
