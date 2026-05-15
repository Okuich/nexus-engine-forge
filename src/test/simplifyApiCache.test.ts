/**
 * Tests for the content-hash cache used by simplify-api.
 *
 * Exercises the pure JS module directly (no HTTP) — the route handlers
 * are thin wrappers that look up `responseCache` by `makeCacheKey`.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  LRUCache,
  hashMesh,
  hashBytes,
  canonicalizeOptions,
  makeCacheKey,
  responseCache,
} from '../../supabase/functions/simplify-api/cache';

describe('simplify-api content-hash cache', () => {
  beforeEach(() => responseCache.clear());

  it('hashMesh returns the same digest for semantically identical meshes', async () => {
    const a = { positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], indices: [0, 1, 2] };
    const b = { positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], indices: [0, 1, 2] };
    expect(await hashMesh(a)).toBe(await hashMesh(b));
  });

  it('hashMesh differs when geometry changes', async () => {
    const a = { positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], indices: [0, 1, 2] };
    const b = { positions: [0, 0, 0, 2, 0, 0, 0, 1, 0], indices: [0, 1, 2] };
    expect(await hashMesh(a)).not.toBe(await hashMesh(b));
  });

  it('hashMesh differs when indices change but positions match', async () => {
    const positions = [0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0];
    const a = { positions, indices: [0, 1, 2] };
    const b = { positions, indices: [0, 1, 3] };
    expect(await hashMesh(a)).not.toBe(await hashMesh(b));
  });

  it('canonicalizeOptions sorts keys and drops undefined', () => {
    expect(canonicalizeOptions({ b: 1, a: 2 })).toBe(canonicalizeOptions({ a: 2, b: 1 }));
    expect(canonicalizeOptions({ a: 1, b: undefined })).toBe(canonicalizeOptions({ a: 1 }));
  });

  it('makeCacheKey isolates routes', async () => {
    const meshHash = await hashMesh({ positions: [0, 0, 0, 1, 0, 0, 0, 1, 0] });
    const k1 = makeCacheKey({ route: 'lods', meshHash, options: { levels: 2 } });
    const k2 = makeCacheKey({ route: 'graph', meshHash, options: { levels: 2 } });
    expect(k1).not.toBe(k2);
  });

  it('LRUCache evicts oldest when over maxEntries', () => {
    const c = new LRUCache<string>(3, 1024);
    c.set('a', '1', 1); c.set('b', '2', 1); c.set('c', '3', 1);
    c.set('d', '4', 1);
    expect(c.get('a')).toBeUndefined();
    expect(c.get('b')).toBe('2');
    expect(c.get('d')).toBe('4');
  });

  it('LRUCache bumps recency on get', () => {
    const c = new LRUCache<string>(2, 1024);
    c.set('a', '1', 1); c.set('b', '2', 1);
    c.get('a'); // bump a
    c.set('c', '3', 1); // should evict b, not a
    expect(c.get('a')).toBe('1');
    expect(c.get('b')).toBeUndefined();
  });

  it('LRUCache evicts on byte budget', () => {
    const c = new LRUCache<string>(100, 10);
    c.set('a', 'x', 6); c.set('b', 'y', 6); // 12 > 10 → drops a
    expect(c.get('a')).toBeUndefined();
    expect(c.get('b')).toBe('y');
  });

  it('hashBytes is stable and content-sensitive', async () => {
    const a = new Uint8Array([1, 2, 3, 4]);
    const b = new Uint8Array([1, 2, 3, 4]);
    const c = new Uint8Array([1, 2, 3, 5]);
    expect(await hashBytes(a)).toBe(await hashBytes(b));
    expect(await hashBytes(a)).not.toBe(await hashBytes(c));
  });

  it('round-trips a cached payload via responseCache', async () => {
    const mesh = { positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], indices: [0, 1, 2] };
    const meshHash = await hashMesh(mesh);
    const key = makeCacheKey({ route: 'lods', meshHash, options: { levels: 2 } });

    expect(responseCache.get(key)).toBeUndefined();
    const payload = JSON.stringify({ lods: [{ level: 0 }] });
    responseCache.set(key, payload, payload.length);
    expect(responseCache.get(key)).toBe(payload);

    const stats = responseCache.stats();
    expect(stats.entries).toBeGreaterThanOrEqual(1);
    expect(stats.hits).toBeGreaterThanOrEqual(1);
  });
});
