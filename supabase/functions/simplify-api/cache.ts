/**
 * Content-addressable in-memory cache for simplify-api.
 *
 * Keys are SHA-256 hashes of the canonical mesh bytes + route + options.
 * Identical inputs return the previous response without re-running the
 * vertex-cluster simplifier or graph coarsener. LRU eviction keeps the
 * working set bounded per edge-function instance.
 *
 * Notes:
 *  - The cache is process-local; cold starts re-warm. Good enough for
 *    burst-y interactive use, which is what these endpoints serve.
 *  - Hashes mix in a route tag so /lods and /inference for the same mesh
 *    don't collide.
 */

import type { RawMesh } from './core.ts';

export type SimplifyRoute = 'lods' | 'graph' | 'inference' | 'upload';

const DEFAULT_MAX_ENTRIES = 64;

interface Entry<V> { value: V; bytes: number; }

export class LRUCache<V> {
  private map = new Map<string, Entry<V>>();
  private currentBytes = 0;
  hits = 0;
  misses = 0;

  constructor(
    public maxEntries: number = DEFAULT_MAX_ENTRIES,
    public maxBytes: number = 64 * 1024 * 1024, // 64 MB cap
  ) {}

  get(key: string): V | undefined {
    const e = this.map.get(key);
    if (!e) { this.misses++; return undefined; }
    // LRU bump
    this.map.delete(key);
    this.map.set(key, e);
    this.hits++;
    return e.value;
  }

  set(key: string, value: V, bytes: number): void {
    if (this.map.has(key)) {
      this.currentBytes -= this.map.get(key)!.bytes;
      this.map.delete(key);
    }
    this.map.set(key, { value, bytes });
    this.currentBytes += bytes;
    while (
      (this.map.size > this.maxEntries || this.currentBytes > this.maxBytes) &&
      this.map.size > 0
    ) {
      const oldestKey = this.map.keys().next().value as string;
      this.currentBytes -= this.map.get(oldestKey)!.bytes;
      this.map.delete(oldestKey);
    }
  }

  clear(): void {
    this.map.clear();
    this.currentBytes = 0;
    this.hits = 0;
    this.misses = 0;
  }

  stats() {
    return {
      entries: this.map.size,
      bytes: this.currentBytes,
      hits: this.hits,
      misses: this.misses,
      hitRate: this.hits + this.misses === 0 ? 0 : this.hits / (this.hits + this.misses),
    };
  }
}

/** Singleton response cache (string body keyed by content hash). */
export const responseCache = new LRUCache<string>();

// ─── Hashing ────────────────────────────────────────────────────────────────

function toHex(buf: ArrayBuffer): string {
  const u8 = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < u8.length; i++) s += u8[i].toString(16).padStart(2, '0');
  return s;
}

/**
 * Stable canonical hash of a mesh's geometry. Positions are quantized to
 * Float32 (matches what `meshToArrays` would produce) so semantically equal
 * meshes that differ only in JSON formatting hit the same cache slot.
 */
export async function hashMesh(mesh: RawMesh): Promise<string> {
  const positions = new Float32Array(mesh.positions);
  const indices = mesh.indices && mesh.indices.length > 0
    ? new Uint32Array(mesh.indices)
    : new Uint32Array(0);

  // Frame: [posByteLen u32 LE][positions bytes][idxLen u32 LE][indices bytes]
  const total = 4 + positions.byteLength + 4 + indices.byteLength;
  const buf = new Uint8Array(total);
  const dv = new DataView(buf.buffer);
  let off = 0;
  dv.setUint32(off, positions.byteLength, true); off += 4;
  buf.set(new Uint8Array(positions.buffer, positions.byteOffset, positions.byteLength), off);
  off += positions.byteLength;
  dv.setUint32(off, indices.byteLength, true); off += 4;
  buf.set(new Uint8Array(indices.buffer, indices.byteOffset, indices.byteLength), off);

  const digest = await crypto.subtle.digest('SHA-256', buf);
  return toHex(digest);
}

/** Hash raw upload bytes (skips re-parsing for the cache key). */
export async function hashBytes(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return toHex(digest);
}

/** Stable string for an options object (sorted keys, undefineds dropped). */
export function canonicalizeOptions(opts: unknown): string {
  if (opts === null || opts === undefined) return 'null';
  if (typeof opts !== 'object') return JSON.stringify(opts);
  const o = opts as Record<string, unknown>;
  const keys = Object.keys(o).filter((k) => o[k] !== undefined).sort();
  const parts = keys.map((k) => `${k}:${canonicalizeOptions(o[k])}`);
  return `{${parts.join(',')}}`;
}

export interface CacheKeyParts {
  route: SimplifyRoute;
  meshHash: string;
  options?: unknown;
}

export function makeCacheKey({ route, meshHash, options }: CacheKeyParts): string {
  return `${route}|${meshHash}|${canonicalizeOptions(options)}`;
}
