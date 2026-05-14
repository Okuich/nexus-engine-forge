/**
 * SDF cache — keyed by (mesh content hash + generation options hash).
 *
 *   • Deterministic FNV-1a 64-bit hashing over mesh positions/indices and
 *     normalized option fields, so identical inputs always collide.
 *   • In-memory LRU with a configurable max-entry count and total byte budget.
 *     Float32Array `data` payloads dominate memory; we evict on byte budget
 *     before count budget.
 *   • `getOrGenerate(mesh, options, factory)` is the primary entry point.
 *   • Pluggable persistent backend via the `SDFCacheStore` interface — drop
 *     in an IndexedDB or KV adapter without touching call sites.
 *
 * Not a service worker: this is a pure ESM module, safe in browser, worker,
 * Node, or Deno contexts.
 */
import type { RawMesh } from '../types';
import type { SDFGenerationOptions, SDFGrid } from './types';

// ─── Hashing ────────────────────────────────────────────────────────────────

/** FNV-1a 64-bit (split into hi/lo u32) — fast, dependency-free, stable. */
class FNV1a64 {
  private hi = 0xcbf29ce4 >>> 0;
  private lo = 0x84222325 >>> 0;
  private static PRIME_HI = 0x00000100;
  private static PRIME_LO = 0x000001b3;

  updateU32(v: number): void {
    this.updateByte(v & 0xff);
    this.updateByte((v >>> 8) & 0xff);
    this.updateByte((v >>> 16) & 0xff);
    this.updateByte((v >>> 24) & 0xff);
  }

  updateF32(v: number): void {
    SCRATCH_F32[0] = v;
    this.updateU32(SCRATCH_U32[0]);
  }

  updateByte(b: number): void {
    this.lo ^= b;
    // 64-bit multiply (hi:lo) * (PRIME_HI:PRIME_LO), keep low 64 bits.
    const aL = this.lo & 0xffff, aH = this.lo >>> 16;
    const bL = this.hi & 0xffff, bH = this.hi >>> 16;
    const cL = FNV1a64.PRIME_LO & 0xffff, cH = FNV1a64.PRIME_LO >>> 16;
    const dL = FNV1a64.PRIME_HI & 0xffff;
    // lo*PRIME_LO
    const ll = aL * cL;
    const lm = aH * cL + aL * cH;
    const lh = aH * cH + ((lm >>> 16) >>> 0);
    const newLo = (ll + ((lm & 0xffff) << 16)) >>> 0;
    // hi*PRIME_LO + lo*PRIME_HI (low 32 bits only matter for hi)
    const hi1 = (bL * cL + bH * cL * 0x10000 + bL * cH * 0x10000 + aL * dL) >>> 0;
    const newHi = (lh + hi1) >>> 0;
    this.hi = newHi;
    this.lo = newLo;
  }

  digest(): string {
    return this.hi.toString(16).padStart(8, '0') + this.lo.toString(16).padStart(8, '0');
  }
}
const SCRATCH_F32 = new Float32Array(1);
const SCRATCH_U32 = new Uint32Array(SCRATCH_F32.buffer);

function hashMesh(mesh: RawMesh): string {
  const h = new FNV1a64();
  const p = mesh.positions as ArrayLike<number>;
  h.updateU32(p.length);
  for (let i = 0; i < p.length; i++) h.updateF32(p[i]);
  const idx = mesh.indices as ArrayLike<number> | undefined;
  if (idx) {
    h.updateU32(idx.length);
    for (let i = 0; i < idx.length; i++) h.updateU32(idx[i] >>> 0);
  } else {
    h.updateU32(0);
  }
  return h.digest();
}

function hashOptions(options: SDFGenerationOptions = {}): string {
  // Normalize: only fields that affect output participate in the key.
  const normalized = {
    resolution: options.resolution ?? 64,
    padding: options.padding ?? null,
    narrowBand: options.narrowBand ?? null,
    signMethod: options.signMethod ?? 'raycast',
  };
  const json = JSON.stringify(normalized);
  const h = new FNV1a64();
  for (let i = 0; i < json.length; i++) h.updateByte(json.charCodeAt(i) & 0xff);
  return h.digest();
}

export function sdfCacheKey(mesh: RawMesh, options?: SDFGenerationOptions): string {
  return `${hashMesh(mesh)}:${hashOptions(options)}`;
}

// ─── Store interface ────────────────────────────────────────────────────────

export interface SDFCacheStore {
  get(key: string): SDFGrid | undefined | Promise<SDFGrid | undefined>;
  set(key: string, value: SDFGrid): void | Promise<void>;
  delete(key: string): void | Promise<void>;
  clear(): void | Promise<void>;
  /** Number of entries (best-effort for async stores). */
  size(): number | Promise<number>;
}

export interface LRUCacheOptions {
  /** Max number of cached SDFs. Default 32. */
  maxEntries?: number;
  /** Max total bytes of `data` payloads. Default 256 MiB. */
  maxBytes?: number;
}

interface Entry { key: string; grid: SDFGrid; bytes: number }

/** In-memory LRU store backed by a Map (insertion-order = recency). */
export class InMemorySDFCache implements SDFCacheStore {
  private entries = new Map<string, Entry>();
  private bytes = 0;
  readonly maxEntries: number;
  readonly maxBytes: number;

  constructor(opts: LRUCacheOptions = {}) {
    this.maxEntries = opts.maxEntries ?? 32;
    this.maxBytes = opts.maxBytes ?? 256 * 1024 * 1024;
  }

  get(key: string): SDFGrid | undefined {
    const e = this.entries.get(key);
    if (!e) return undefined;
    // Touch — move to end.
    this.entries.delete(key);
    this.entries.set(key, e);
    return e.grid;
  }

  set(key: string, grid: SDFGrid): void {
    const existing = this.entries.get(key);
    if (existing) { this.bytes -= existing.bytes; this.entries.delete(key); }
    const bytes = grid.data.byteLength;
    this.entries.set(key, { key, grid, bytes });
    this.bytes += bytes;
    this.evict();
  }

  delete(key: string): void {
    const e = this.entries.get(key);
    if (!e) return;
    this.bytes -= e.bytes;
    this.entries.delete(key);
  }

  clear(): void { this.entries.clear(); this.bytes = 0; }
  size(): number { return this.entries.size; }
  byteSize(): number { return this.bytes; }

  private evict(): void {
    while (this.bytes > this.maxBytes || this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.delete(oldest);
    }
  }
}

// ─── Default singleton + getOrGenerate ──────────────────────────────────────

let defaultStore: SDFCacheStore = new InMemorySDFCache();

export function setSDFCacheStore(store: SDFCacheStore): void { defaultStore = store; }
export function getSDFCacheStore(): SDFCacheStore { return defaultStore; }

export interface SDFCacheStats { hits: number; misses: number }
const stats: SDFCacheStats = { hits: 0, misses: 0 };
export function getSDFCacheStats(): Readonly<SDFCacheStats> { return stats; }
export function resetSDFCacheStats(): void { stats.hits = 0; stats.misses = 0; }

/**
 * Resolve an SDF for (mesh, options) — return cached if present, else invoke
 * `factory` and cache the result. Use this to wrap any generator (CPU, GPU,
 * gated, chunked).
 */
export async function getOrGenerateSDF(
  mesh: RawMesh,
  options: SDFGenerationOptions | undefined,
  factory: () => SDFGrid | Promise<SDFGrid>,
  store: SDFCacheStore = defaultStore,
): Promise<SDFGrid> {
  const key = sdfCacheKey(mesh, options);
  const cached = await store.get(key);
  if (cached) { stats.hits++; return cached; }
  stats.misses++;
  const grid = await factory();
  await store.set(key, grid);
  return grid;
}
