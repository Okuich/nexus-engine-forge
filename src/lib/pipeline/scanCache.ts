/**
 * Scan Cache
 *
 * Memoizes parsed meshes and FullScanReport results keyed by a stable
 * fingerprint of (mesh bytes + scan options). Repeated scans of the
 * same STL/STEP/IGES with the same parameters skip every layer and
 * return the cached report immediately.
 *
 * Also exposes a parsed-mesh cache so the upload flow can reuse a
 * RawMesh derived from a File without re-parsing it.
 */

import type { RawMesh } from '@/lib/geometry';
import type { FullScanLayer, FullScanReport, LayerReport } from './fullScan';

// ── Fast non-crypto hash (FNV-1a 32-bit) ───────────────────────
function fnv1a(seed: number, n: number): number {
  // Standard FNV-1a step on a 32-bit unsigned int.
  let h = seed ^ (n | 0);
  h = Math.imul(h, 0x01000193);
  return h >>> 0;
}

/**
 * Stable, cheap fingerprint of a RawMesh. We sample positions
 * (not the whole buffer) so a 5M-vertex mesh hashes in <1ms.
 */
export function hashMesh(mesh: RawMesh): string {
  const pos = mesh.positions as ArrayLike<number>;
  const len = pos.length;
  const stride = Math.max(1, Math.floor(len / 1024));
  let h = 0x811c9dc5;
  h = fnv1a(h, len);
  for (let i = 0; i < len; i += stride) {
    // Quantize to 1e-4 to ignore floating-point noise.
    const v = Math.round(pos[i] * 10000);
    h = fnv1a(h, v);
  }
  const idx = mesh.indices as ArrayLike<number> | undefined;
  if (idx) {
    const il = idx.length;
    const is = Math.max(1, Math.floor(il / 512));
    h = fnv1a(h, il);
    for (let i = 0; i < il; i += is) h = fnv1a(h, idx[i] | 0);
  }
  return h.toString(16).padStart(8, '0');
}

/** Hash of scan parameters that affect output (skip set + grid). */
export function hashScanOptions(opts: {
  skip?: readonly FullScanLayer[];
  fieldOsGrid?: number;
}): string {
  const skip = [...(opts.skip ?? [])].sort().join(',');
  const grid = opts.fieldOsGrid ?? 48;
  let h = 0x811c9dc5;
  for (let i = 0; i < skip.length; i++) h = fnv1a(h, skip.charCodeAt(i));
  h = fnv1a(h, grid);
  return h.toString(16);
}

/** Full cache key combining mesh + options. */
export function scanKey(meshHash: string, optsHash: string): string {
  return `${meshHash}:${optsHash}`;
}

// ── LRU map ────────────────────────────────────────────────────
class LRU<V> {
  private map = new Map<string, V>();
  constructor(private capacity: number) {}
  get(k: string): V | undefined {
    const v = this.map.get(k);
    if (v === undefined) return undefined;
    this.map.delete(k);
    this.map.set(k, v);
    return v;
  }
  set(k: string, v: V) {
    if (this.map.has(k)) this.map.delete(k);
    this.map.set(k, v);
    if (this.map.size > this.capacity) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
  }
  has(k: string) { return this.map.has(k); }
  delete(k: string) { this.map.delete(k); }
  clear() { this.map.clear(); }
  get size() { return this.map.size; }
  keys() { return [...this.map.keys()]; }
}

// ── Singletons ─────────────────────────────────────────────────
const REPORT_CACHE = new LRU<FullScanReport>(16);
const MESH_CACHE = new LRU<RawMesh>(8);

export interface CachedReport {
  report: FullScanReport;
  cachedAt: number;
  meshHash: string;
  optsHash: string;
}

const META = new Map<string, { cachedAt: number; meshHash: string; optsHash: string }>();

export function getCachedReport(meshHash: string, optsHash: string): CachedReport | null {
  const key = scanKey(meshHash, optsHash);
  const report = REPORT_CACHE.get(key);
  if (!report) return null;
  const meta = META.get(key);
  return {
    report,
    cachedAt: meta?.cachedAt ?? 0,
    meshHash,
    optsHash,
  };
}

export function putCachedReport(
  meshHash: string,
  optsHash: string,
  report: FullScanReport,
): void {
  const key = scanKey(meshHash, optsHash);
  REPORT_CACHE.set(key, report);
  META.set(key, { cachedAt: Date.now(), meshHash, optsHash });
}

/** Mark every cached layer report as "cached" (no timing change). */
export function markReportAsCached(report: FullScanReport): FullScanReport {
  const layers = { ...report.layers } as Record<FullScanLayer, LayerReport>;
  for (const k of Object.keys(layers) as FullScanLayer[]) {
    layers[k] = { ...layers[k], cached: true } as LayerReport;
  }
  return { ...report, layers, cached: true };
}

// ── Parsed-mesh cache (keyed by file identity) ─────────────────
export function fileKey(file: { name: string; size: number; lastModified?: number }): string {
  return `${file.name}::${file.size}::${file.lastModified ?? 0}`;
}

export function getCachedMesh(key: string): RawMesh | undefined {
  return MESH_CACHE.get(key);
}

export function putCachedMesh(key: string, mesh: RawMesh): void {
  MESH_CACHE.set(key, mesh);
}

// ── Diagnostics / control ──────────────────────────────────────
export function scanCacheStats() {
  return {
    reports: REPORT_CACHE.size,
    meshes: MESH_CACHE.size,
    keys: REPORT_CACHE.keys(),
  };
}

export function clearScanCache() {
  REPORT_CACHE.clear();
  MESH_CACHE.clear();
  META.clear();
}
