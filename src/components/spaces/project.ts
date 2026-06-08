/**
 * project — turn high-dim vectors into 2D for scatter rendering.
 *
 * Uses a deterministic random projection (Achlioptas sparse matrix)
 * seeded per space, then min/max normalizes the resulting components
 * into [0,1] for SVG plotting.
 */

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildProjection(seed: number, dim: number): [Float32Array, Float32Array] {
  const rng = mulberry32(seed);
  const a = new Float32Array(dim);
  const b = new Float32Array(dim);
  for (let i = 0; i < dim; i++) {
    a[i] = (rng() - 0.5) * 2;
    b[i] = (rng() - 0.5) * 2;
  }
  return [a, b];
}

const cache = new Map<string, [Float32Array, Float32Array]>();
function projection(seedKey: string, dim: number): [Float32Array, Float32Array] {
  const key = `${seedKey}:${dim}`;
  let p = cache.get(key);
  if (!p) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < seedKey.length; i++) {
      h ^= seedKey.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    p = buildProjection(h, dim);
    cache.set(key, p);
  }
  return p;
}

function dot(v: Float32Array | ArrayLike<number>, w: Float32Array): number {
  let s = 0;
  for (let i = 0; i < w.length; i++) s += (v[i] ?? 0) * w[i];
  return s;
}

export interface Projected2D {
  id: string;
  x: number; // [0,1]
  y: number; // [0,1]
}

export function project2D(
  seedKey: string,
  vectors: { id: string; vec: Float32Array | ArrayLike<number> }[],
): Projected2D[] {
  if (vectors.length === 0) return [];
  const dim = (vectors[0].vec as Float32Array).length;
  const [a, b] = projection(seedKey, dim);
  const raw = vectors.map((v) => ({ id: v.id, x: dot(v.vec, a), y: dot(v.vec, b) }));
  const xs = raw.map((r) => r.x);
  const ys = raw.map((r) => r.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const rx = Math.max(1e-6, maxX - minX);
  const ry = Math.max(1e-6, maxY - minY);
  return raw.map((r) => ({ id: r.id, x: (r.x - minX) / rx, y: (r.y - minY) / ry }));
}

/** Project a single new vector through the cached basis used by project2D. */
export function projectPoint(
  seedKey: string,
  vec: Float32Array | ArrayLike<number>,
  domain: { minX: number; maxX: number; minY: number; maxY: number },
): { x: number; y: number } {
  const dim = (vec as Float32Array).length;
  const [a, b] = projection(seedKey, dim);
  const rawX = dot(vec, a);
  const rawY = dot(vec, b);
  const rx = Math.max(1e-6, domain.maxX - domain.minX);
  const ry = Math.max(1e-6, domain.maxY - domain.minY);
  return { x: (rawX - domain.minX) / rx, y: (rawY - domain.minY) / ry };
}
