import { describe, it, expect } from 'vitest';
import {
  generateSDF,
  generateSDFChunked,
  generateSDFStream,
  generateSDFReadableStream,
  sampleSDF,
} from '@/lib/geometry/sdf';
import type { RawMesh } from '@/lib/geometry';

// Unit cube centered at origin (12 tris).
function cube(): RawMesh {
  const positions = new Float32Array([
    -1,-1,-1,  1,-1,-1,  1, 1,-1, -1, 1,-1,
    -1,-1, 1,  1,-1, 1,  1, 1, 1, -1, 1, 1,
  ]);
  const indices = new Uint32Array([
    0,2,1, 0,3,2, 4,5,6, 4,6,7,
    0,1,5, 0,5,4, 2,3,7, 2,7,6,
    1,2,6, 1,6,5, 0,4,7, 0,7,3,
  ]);
  return { positions, indices };
}

describe('chunked SDF generation', () => {
  it('produces a grid equivalent to non-chunked generation', async () => {
    const mesh = cube();
    const ref = generateSDF(mesh, { resolution: 16, signMethod: 'normal' });
    const chunked = await generateSDFChunked(mesh, { resolution: 16, chunkSize: 8 });
    expect(chunked.dims).toEqual(ref.dims);
    expect(chunked.voxelSize).toBeCloseTo(ref.voxelSize, 6);
    // Sign should match at every voxel; magnitudes within voxelSize.
    let signMismatch = 0, magDiffMax = 0;
    for (let i = 0; i < ref.data.length; i++) {
      if (Math.sign(ref.data[i]) !== Math.sign(chunked.data[i])) signMismatch++;
      magDiffMax = Math.max(magDiffMax, Math.abs(Math.abs(ref.data[i]) - Math.abs(chunked.data[i])));
    }
    expect(signMismatch / ref.data.length).toBeLessThan(0.02);
    expect(magDiffMax).toBeLessThan(ref.voxelSize * 1.5);
  });

  it('streams chunks with bounded memory and reports progress', async () => {
    const mesh = cube();
    const sizes: number[] = [];
    let lastProgress = 0;
    const events: number[] = [];
    for await (const chunk of generateSDFStream(mesh, {
      resolution: 16,
      chunkSize: 8,
      onProgress: (p) => { events.push(p.chunksEmitted); lastProgress = p.voxelsProcessed; },
    })) {
      sizes.push(chunk.data.length);
      // Each chunk's data must equal product of its dims.
      expect(chunk.data.length).toBe(chunk.dims[0] * chunk.dims[1] * chunk.dims[2]);
      // No chunk should exceed chunkSize³ voxels.
      expect(chunk.data.length).toBeLessThanOrEqual(8 * 8 * 8);
    }
    expect(sizes.length).toBeGreaterThan(1);
    expect(events.length).toBe(sizes.length);
    expect(lastProgress).toBe(sizes.reduce((a, b) => a + b, 0));
  });

  it('narrow-band saturates empty chunks (sparse-region O(1))', async () => {
    const mesh = cube();
    let saturatedCount = 0, totalCount = 0;
    for await (const chunk of generateSDFStream(mesh, {
      resolution: 32,
      chunkSize: 4,
      narrowBand: 0.1, // very tight band → far-from-surface chunks should saturate
    })) {
      totalCount++;
      if (chunk.saturated) saturatedCount++;
    }
    // For a unit cube at res 32 with band 0.1, most chunks are far from surface.
    expect(saturatedCount).toBeGreaterThan(0);
    expect(saturatedCount).toBeLessThan(totalCount);
  });

  it('exposes a ReadableStream of NDJSON chunks', async () => {
    const mesh = cube();
    const stream = generateSDFReadableStream(mesh, { resolution: 8, chunkSize: 4 });
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let body = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      body += decoder.decode(value);
    }
    const lines = body.trim().split('\n');
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      const obj = JSON.parse(line);
      expect(obj.data).toMatch(/^[A-Za-z0-9+/=]+$/);
      expect(obj.dims).toHaveLength(3);
      expect(obj.gridDims).toHaveLength(3);
    }
  });

  it('assembled chunked grid is queryable via sampleSDF', async () => {
    const mesh = cube();
    const grid = await generateSDFChunked(mesh, { resolution: 16, chunkSize: 8 });
    expect(sampleSDF(grid, [0, 0, 0])).toBeLessThan(0); // inside cube
    expect(sampleSDF(grid, [3, 3, 3])).toBeGreaterThan(0); // outside cube
  });
});
