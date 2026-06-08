import { describe, it, expect, vi } from 'vitest';
import { createLimiter } from '@/lib/pipeline/concurrencyLimiter';
import { runFullScan } from '@/lib/pipeline/fullScan';
import type { RawMesh } from '@/lib/geometry';

// Mock Field OS so tests don't touch the network.
vi.mock('@/lib/fieldOs', async () => {
  return {
    fieldOs: {
      eikonal: vi.fn(async ({ w, h }: { w: number; h: number }) => ({
        operator: 'op.eikonal.fsm' as const,
        field: { w, h, data: Array.from({ length: w * h }, (_, i) => i) },
        stats: { min: 0, max: w * h - 1, sources: 1, sweeps: 4 },
      })),
      poisson: vi.fn(async ({ w, h }: { w: number; h: number }) => ({
        operator: 'op.poisson.jacobi' as const,
        field: { w, h, data: Array.from({ length: w * h }, () => 0) },
        stats: { iterations: 120, residual: 1e-6 },
      })),
    },
  };
});

// A trivial tetrahedron (4 triangles, watertight).
const tetra: RawMesh = {
  positions: new Float32Array([
    0, 0, 0,
    1, 0, 0,
    0, 1, 0,
    0, 0, 1,
  ]),
  indices: new Uint32Array([
    0, 1, 2,
    0, 1, 3,
    0, 2, 3,
    1, 2, 3,
  ]),
};

describe('concurrencyLimiter', () => {
  it('respects the concurrency cap', async () => {
    const limit = createLimiter(2);
    let live = 0;
    let maxLive = 0;
    const work = async () => {
      live++;
      maxLive = Math.max(maxLive, live);
      await new Promise((r) => setTimeout(r, 5));
      live--;
    };
    await Promise.all(Array.from({ length: 10 }, () => limit(work)));
    expect(maxLive).toBeLessThanOrEqual(2);
    expect(limit.active()).toBe(0);
    expect(limit.pending()).toBe(0);
  });

  it('preserves task return values and rejects on throw', async () => {
    const limit = createLimiter(1);
    await expect(limit(async () => 42)).resolves.toBe(42);
    await expect(limit(async () => { throw new Error('boom'); })).rejects.toThrow('boom');
  });

  it('idle() resolves only after all in-flight tasks complete', async () => {
    const limit = createLimiter(2);
    const tasks = Array.from({ length: 5 }, () =>
      limit(() => new Promise((r) => setTimeout(r, 10))),
    );
    await limit.idle();
    await Promise.all(tasks); // already settled
    expect(limit.active()).toBe(0);
  });

  it('setConcurrency drains additional slots immediately', async () => {
    const limit = createLimiter(1);
    let started = 0;
    const tasks = Array.from({ length: 4 }, () =>
      limit(async () => {
        started++;
        await new Promise((r) => setTimeout(r, 20));
      }),
    );
    await new Promise((r) => setTimeout(r, 1));
    expect(started).toBe(1);
    limit.setConcurrency(4);
    await new Promise((r) => setTimeout(r, 1));
    expect(started).toBe(4);
    await Promise.all(tasks);
  });
});

describe('runFullScan', () => {
  it('runs all four layers and aggregates per-layer reports', async () => {
    const updates: string[] = [];
    const report = await runFullScan(
      { mesh: tetra, filename: 'tetra.stl' },
      { onLayerUpdate: (r) => updates.push(`${r.layer}:${r.status}`) },
    );

    expect(report.layers.geometryOs.status).toBe('done');
    expect(report.layers.computationalGeometry.status).toBe('done');
    expect(report.layers.physicsOs.status).toBe('done');
    expect(report.layers.fieldOs.status).toBe('done');
    expect(report.ok).toBe(true);
    expect(report.durationMs).toBeGreaterThanOrEqual(0);
    expect(updates).toContain('geometryOs:running');
    expect(updates).toContain('fieldOs:done');
  });

  it('honors the skip list', async () => {
    const report = await runFullScan(
      { mesh: tetra },
      { skip: ['fieldOs', 'physicsOs'] },
    );
    expect(report.layers.fieldOs.status).toBe('skipped');
    expect(report.layers.physicsOs.status).toBe('skipped');
    expect(report.layers.geometryOs.status).toBe('done');
  });

  it('isolates layer failures (Field OS error does not abort the scan)', async () => {
    const { fieldOs } = await import('@/lib/fieldOs');
    (fieldOs.eikonal as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('Field OS down'),
    );
    const report = await runFullScan({ mesh: tetra });
    expect(report.layers.fieldOs.status).toBe('error');
    expect(report.layers.fieldOs.error?.message).toContain('Field OS down');
    expect(report.layers.geometryOs.status).toBe('done');
    expect(report.ok).toBe(false);
  });

  it('shares a limiter across layers', async () => {
    const limit = createLimiter(2);
    const report = await runFullScan({ mesh: tetra }, { limiter: limit });
    expect(report.ok).toBe(true);
    expect(limit.active()).toBe(0);
  });
});
