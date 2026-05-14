import { describe, it, expect, beforeEach } from 'vitest';
import {
  generateSDF,
  sdfCacheKey,
  getOrGenerateSDF,
  InMemorySDFCache,
  getSDFCacheStats,
  resetSDFCacheStats,
} from '@/lib/geometry/sdf';
import type { RawMesh } from '@/lib/geometry';

function cube(scale = 1): RawMesh {
  const s = scale;
  return {
    positions: new Float32Array([
      -s,-s,-s,  s,-s,-s,  s, s,-s, -s, s,-s,
      -s,-s, s,  s,-s, s,  s, s, s, -s, s, s,
    ]),
    indices: new Uint32Array([
      0,2,1, 0,3,2, 4,5,6, 4,6,7,
      0,1,5, 0,5,4, 2,3,7, 2,7,6,
      1,2,6, 1,6,5, 0,4,7, 0,7,3,
    ]),
  };
}

describe('SDF cache', () => {
  beforeEach(() => resetSDFCacheStats());

  it('produces stable keys for identical mesh + options', () => {
    const k1 = sdfCacheKey(cube(), { resolution: 16, signMethod: 'normal' });
    const k2 = sdfCacheKey(cube(), { resolution: 16, signMethod: 'normal' });
    expect(k1).toBe(k2);
  });

  it('produces different keys when mesh content changes', () => {
    const k1 = sdfCacheKey(cube(1), { resolution: 16 });
    const k2 = sdfCacheKey(cube(2), { resolution: 16 });
    expect(k1).not.toBe(k2);
  });

  it('produces different keys when options change', () => {
    const k1 = sdfCacheKey(cube(), { resolution: 16 });
    const k2 = sdfCacheKey(cube(), { resolution: 32 });
    expect(k1).not.toBe(k2);
  });

  it('reuses cached SDF on repeat requests (factory called once)', async () => {
    const store = new InMemorySDFCache();
    const mesh = cube();
    const opts = { resolution: 12, signMethod: 'normal' as const };
    let calls = 0;
    const factory = () => { calls++; return generateSDF(mesh, opts); };

    const a = await getOrGenerateSDF(mesh, opts, factory, store);
    const b = await getOrGenerateSDF(mesh, opts, factory, store);
    expect(calls).toBe(1);
    expect(b).toBe(a); // identical reference
    expect(getSDFCacheStats()).toEqual({ hits: 1, misses: 1 });
  });

  it('does NOT reuse when options differ', async () => {
    const store = new InMemorySDFCache();
    const mesh = cube();
    let calls = 0;
    const factory = (res: number) => () => { calls++; return generateSDF(mesh, { resolution: res, signMethod: 'normal' }); };

    await getOrGenerateSDF(mesh, { resolution: 8, signMethod: 'normal' }, factory(8), store);
    await getOrGenerateSDF(mesh, { resolution: 12, signMethod: 'normal' }, factory(12), store);
    expect(calls).toBe(2);
    expect(await store.size()).toBe(2);
  });

  it('LRU evicts when byte budget exceeded', async () => {
    const store = new InMemorySDFCache({ maxEntries: 100, maxBytes: 4096 });
    const mesh = cube();
    // res=8 cube ≈ 8³=512 voxels = 2048 bytes. Two of these fit, third must evict.
    for (const r of [6, 8, 10]) {
      await getOrGenerateSDF(mesh, { resolution: r, signMethod: 'normal' },
        () => generateSDF(mesh, { resolution: r, signMethod: 'normal' }), store);
    }
    expect(store.byteSize()).toBeLessThanOrEqual(4096);
    expect(await store.size()).toBeLessThan(3);
  });

  it('LRU evicts when entry count exceeded', async () => {
    const store = new InMemorySDFCache({ maxEntries: 2, maxBytes: 1e9 });
    const mesh = cube();
    for (const r of [6, 8, 10]) {
      await getOrGenerateSDF(mesh, { resolution: r, signMethod: 'normal' },
        () => generateSDF(mesh, { resolution: r, signMethod: 'normal' }), store);
    }
    expect(await store.size()).toBe(2);
  });
});
