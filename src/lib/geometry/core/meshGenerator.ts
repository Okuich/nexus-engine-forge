/**
 * Mesh Generator — Procedural primitive tessellation.
 *
 * Produces RawMesh objects (positions + indices) for canonical
 * primitives. Output is suitable for downstream feature extraction,
 * topology analysis, and spatial indexing.
 *
 * All generators are pure, deterministic, and framework-agnostic.
 */

import type { RawMesh, Vec3 } from '../types';

// ─── Common helpers ─────────────────────────────────────────────

interface MeshBuilder {
  positions: number[];
  indices: number[];
  addVertex(x: number, y: number, z: number): number;
  addTriangle(a: number, b: number, c: number): void;
  addQuad(a: number, b: number, c: number, d: number): void;
  build(): RawMesh;
}

function createBuilder(): MeshBuilder {
  const positions: number[] = [];
  const indices: number[] = [];
  return {
    positions,
    indices,
    addVertex(x, y, z) {
      const id = positions.length / 3;
      positions.push(x, y, z);
      return id;
    },
    addTriangle(a, b, c) {
      indices.push(a, b, c);
    },
    addQuad(a, b, c, d) {
      indices.push(a, b, c, a, c, d);
    },
    build() {
      return {
        positions: new Float32Array(positions),
        indices: new Uint32Array(indices),
      };
    },
  };
}

// ─── Primitives ─────────────────────────────────────────────────

export interface BoxOptions {
  width?: number;
  height?: number;
  depth?: number;
  center?: Vec3;
}

/** Axis-aligned box (12 triangles, 8 vertices). */
export function generateBox(opts: BoxOptions = {}): RawMesh {
  const w = (opts.width ?? 1) / 2;
  const h = (opts.height ?? 1) / 2;
  const d = (opts.depth ?? 1) / 2;
  const [cx, cy, cz] = opts.center ?? [0, 0, 0];

  const b = createBuilder();
  const v = [
    b.addVertex(cx - w, cy - h, cz - d), // 0
    b.addVertex(cx + w, cy - h, cz - d), // 1
    b.addVertex(cx + w, cy + h, cz - d), // 2
    b.addVertex(cx - w, cy + h, cz - d), // 3
    b.addVertex(cx - w, cy - h, cz + d), // 4
    b.addVertex(cx + w, cy - h, cz + d), // 5
    b.addVertex(cx + w, cy + h, cz + d), // 6
    b.addVertex(cx - w, cy + h, cz + d), // 7
  ];
  // -Z, +Z, -Y, +Y, -X, +X
  b.addQuad(v[0], v[3], v[2], v[1]);
  b.addQuad(v[4], v[5], v[6], v[7]);
  b.addQuad(v[0], v[1], v[5], v[4]);
  b.addQuad(v[3], v[7], v[6], v[2]);
  b.addQuad(v[0], v[4], v[7], v[3]);
  b.addQuad(v[1], v[2], v[6], v[5]);
  return b.build();
}

export interface SphereOptions {
  radius?: number;
  /** Latitude segments (≥2). Default 16. */
  latSegments?: number;
  /** Longitude segments (≥3). Default 24. */
  lonSegments?: number;
  center?: Vec3;
}

/** UV sphere with poles. */
export function generateSphere(opts: SphereOptions = {}): RawMesh {
  const r = opts.radius ?? 0.5;
  const lat = Math.max(2, opts.latSegments ?? 16);
  const lon = Math.max(3, opts.lonSegments ?? 24);
  const [cx, cy, cz] = opts.center ?? [0, 0, 0];

  const b = createBuilder();
  // grid of vertices including duplicated seam? we keep single seam (acceptable for analysis)
  for (let i = 0; i <= lat; i++) {
    const theta = (i / lat) * Math.PI; // 0..π
    const sinT = Math.sin(theta);
    const cosT = Math.cos(theta);
    for (let j = 0; j <= lon; j++) {
      const phi = (j / lon) * Math.PI * 2;
      const x = cx + r * sinT * Math.cos(phi);
      const y = cy + r * cosT;
      const z = cz + r * sinT * Math.sin(phi);
      b.addVertex(x, y, z);
    }
  }

  const stride = lon + 1;
  for (let i = 0; i < lat; i++) {
    for (let j = 0; j < lon; j++) {
      const a = i * stride + j;
      const c = a + stride;
      const d = c + 1;
      const e = a + 1;
      // Skip degenerate quads at poles (still emit, downstream filters)
      if (i !== 0) b.addTriangle(a, c, e);
      if (i !== lat - 1) b.addTriangle(e, c, d);
    }
  }
  return b.build();
}

export interface CylinderOptions {
  radius?: number;
  height?: number;
  segments?: number;
  capped?: boolean;
  center?: Vec3;
}

/** Z-axis cylinder, optionally capped. */
export function generateCylinder(opts: CylinderOptions = {}): RawMesh {
  const r = opts.radius ?? 0.5;
  const h = opts.height ?? 1;
  const seg = Math.max(3, opts.segments ?? 24);
  const capped = opts.capped ?? true;
  const [cx, cy, cz] = opts.center ?? [0, 0, 0];

  const b = createBuilder();
  const halfH = h / 2;

  // bottom & top rings
  const bottomRing: number[] = [];
  const topRing: number[] = [];
  for (let i = 0; i < seg; i++) {
    const phi = (i / seg) * Math.PI * 2;
    const x = cx + r * Math.cos(phi);
    const y = cy + r * Math.sin(phi);
    bottomRing.push(b.addVertex(x, y, cz - halfH));
    topRing.push(b.addVertex(x, y, cz + halfH));
  }

  // side
  for (let i = 0; i < seg; i++) {
    const j = (i + 1) % seg;
    b.addQuad(bottomRing[i], bottomRing[j], topRing[j], topRing[i]);
  }

  if (capped) {
    const bc = b.addVertex(cx, cy, cz - halfH);
    const tc = b.addVertex(cx, cy, cz + halfH);
    for (let i = 0; i < seg; i++) {
      const j = (i + 1) % seg;
      b.addTriangle(bc, bottomRing[j], bottomRing[i]); // bottom (down)
      b.addTriangle(tc, topRing[i], topRing[j]); // top (up)
    }
  }
  return b.build();
}

export interface ConeOptions {
  radius?: number;
  height?: number;
  segments?: number;
  capped?: boolean;
  center?: Vec3;
}

export function generateCone(opts: ConeOptions = {}): RawMesh {
  const r = opts.radius ?? 0.5;
  const h = opts.height ?? 1;
  const seg = Math.max(3, opts.segments ?? 24);
  const capped = opts.capped ?? true;
  const [cx, cy, cz] = opts.center ?? [0, 0, 0];

  const b = createBuilder();
  const halfH = h / 2;
  const apex = b.addVertex(cx, cy, cz + halfH);

  const ring: number[] = [];
  for (let i = 0; i < seg; i++) {
    const phi = (i / seg) * Math.PI * 2;
    ring.push(b.addVertex(cx + r * Math.cos(phi), cy + r * Math.sin(phi), cz - halfH));
  }
  for (let i = 0; i < seg; i++) {
    const j = (i + 1) % seg;
    b.addTriangle(apex, ring[i], ring[j]);
  }
  if (capped) {
    const bc = b.addVertex(cx, cy, cz - halfH);
    for (let i = 0; i < seg; i++) {
      const j = (i + 1) % seg;
      b.addTriangle(bc, ring[j], ring[i]);
    }
  }
  return b.build();
}

export interface PlaneOptions {
  width?: number;
  height?: number;
  /** Subdivisions along each axis (≥1). */
  widthSegments?: number;
  heightSegments?: number;
  center?: Vec3;
}

/** XY-plane subdivided grid. */
export function generatePlane(opts: PlaneOptions = {}): RawMesh {
  const w = opts.width ?? 1;
  const h = opts.height ?? 1;
  const ws = Math.max(1, opts.widthSegments ?? 1);
  const hs = Math.max(1, opts.heightSegments ?? 1);
  const [cx, cy, cz] = opts.center ?? [0, 0, 0];

  const b = createBuilder();
  for (let j = 0; j <= hs; j++) {
    for (let i = 0; i <= ws; i++) {
      const x = cx - w / 2 + (i / ws) * w;
      const y = cy - h / 2 + (j / hs) * h;
      b.addVertex(x, y, cz);
    }
  }
  const stride = ws + 1;
  for (let j = 0; j < hs; j++) {
    for (let i = 0; i < ws; i++) {
      const a = j * stride + i;
      b.addQuad(a, a + 1, a + stride + 1, a + stride);
    }
  }
  return b.build();
}

// ─── Re-tessellation utilities ─────────────────────────────────

/**
 * Subdivide each triangle into 4 by midpoint splitting (1→4 Loop-style topology, no smoothing).
 * Increases face count quadratically per pass.
 */
export function subdivide(mesh: RawMesh, passes = 1): RawMesh {
  let current = normalizeIndexed(mesh);
  for (let p = 0; p < passes; p++) {
    current = subdivideOnce(current);
  }
  return current;
}

function subdivideOnce(mesh: RawMesh): RawMesh {
  const positions = Array.from(mesh.positions as ArrayLike<number>);
  const indices = Array.from(mesh.indices as ArrayLike<number>);
  const newIndices: number[] = [];
  const midCache = new Map<string, number>();

  const midpoint = (a: number, b: number): number => {
    const key = a < b ? `${a}_${b}` : `${b}_${a}`;
    const cached = midCache.get(key);
    if (cached !== undefined) return cached;
    const ax = positions[a * 3], ay = positions[a * 3 + 1], az = positions[a * 3 + 2];
    const bx = positions[b * 3], by = positions[b * 3 + 1], bz = positions[b * 3 + 2];
    const id = positions.length / 3;
    positions.push((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2);
    midCache.set(key, id);
    return id;
  };

  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i], b = indices[i + 1], c = indices[i + 2];
    const ab = midpoint(a, b);
    const bc = midpoint(b, c);
    const ca = midpoint(c, a);
    newIndices.push(a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca);
  }
  return {
    positions: new Float32Array(positions),
    indices: new Uint32Array(newIndices),
  };
}

/** Ensure mesh has explicit indices (synthesize sequential if missing). */
export function normalizeIndexed(mesh: RawMesh): RawMesh {
  if (mesh.indices && (mesh.indices as ArrayLike<number>).length > 0) return mesh;
  const triCount = (mesh.positions as ArrayLike<number>).length / 9;
  const idx = new Uint32Array(triCount * 3);
  for (let i = 0; i < idx.length; i++) idx[i] = i;
  return { positions: mesh.positions, indices: idx };
}
