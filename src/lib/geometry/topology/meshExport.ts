/**
 * STL / OBJ exporters for `RawMesh`.
 *
 * Both ASCII STL and binary STL are supported. OBJ output is plain text with
 * vertex (`v`) and face (`f`) records. All output is returned as a string
 * (ASCII formats) or `Uint8Array` (binary STL) — callers handle file I/O.
 */
import type { RawMesh } from './types';
import { ensureWatertight, analyzeWatertightness, type SealOptions, type WatertightReport } from './meshWatertight';

export interface ExportOptions {
  /** Solid / object name. Default 'mesh'. */
  name?: string;
  /** Append unit-normals (OBJ only). Default false. */
  includeNormals?: boolean;
  /**
   * If true, run hole-sealing before serialization. The sealed mesh is used
   * for output. Pass an object to forward `SealOptions`. Default false.
   */
  ensureWatertight?: boolean | SealOptions;
  /**
   * Optional sink that receives the watertightness report (post-seal if
   * `ensureWatertight` is set, otherwise pre-export analysis).
   */
  onWatertightReport?: (report: WatertightReport) => void;
}

function preprocess(mesh: RawMesh, options: ExportOptions): RawMesh {
  if (!options.ensureWatertight && !options.onWatertightReport) return mesh;
  const sealOpts: SealOptions = typeof options.ensureWatertight === 'object'
    ? options.ensureWatertight
    : {};
  if (options.ensureWatertight) {
    const result = ensureWatertight(mesh, sealOpts);
    options.onWatertightReport?.(result.after);
    return result.mesh;
  }
  // Report only.
  options.onWatertightReport?.(analyzeWatertightness(mesh, sealOpts.weldEpsilon ?? 1e-6));
  return mesh;
}

interface IteratedTriangle {
  ax: number; ay: number; az: number;
  bx: number; by: number; bz: number;
  cx: number; cy: number; cz: number;
}

function* iterateTriangles(mesh: RawMesh): Generator<IteratedTriangle> {
  const p = mesh.positions;
  if (mesh.indices && (mesh.indices as ArrayLike<number>).length > 0) {
    const idx = mesh.indices as ArrayLike<number>;
    for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
      yield {
        ax: p[a], ay: p[a + 1], az: p[a + 2],
        bx: p[b], by: p[b + 1], bz: p[b + 2],
        cx: p[c], cy: p[c + 1], cz: p[c + 2],
      };
    }
  } else {
    for (let t = 0; t < p.length; t += 9) {
      yield {
        ax: p[t], ay: p[t + 1], az: p[t + 2],
        bx: p[t + 3], by: p[t + 4], bz: p[t + 5],
        cx: p[t + 6], cy: p[t + 7], cz: p[t + 8],
      };
    }
  }
}

function triangleNormal(t: IteratedTriangle): [number, number, number] {
  const ux = t.bx - t.ax, uy = t.by - t.ay, uz = t.bz - t.az;
  const vx = t.cx - t.ax, vy = t.cy - t.ay, vz = t.cz - t.az;
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  const len = Math.hypot(nx, ny, nz);
  if (len < 1e-20) return [0, 0, 0];
  return [nx / len, ny / len, nz / len];
}

function countTriangles(mesh: RawMesh): number {
  if (mesh.indices && (mesh.indices as ArrayLike<number>).length > 0) {
    return Math.floor((mesh.indices as ArrayLike<number>).length / 3);
  }
  return Math.floor(mesh.positions.length / 9);
}

// ─────────────────────────────────────────────────────────────────────────
// STL — ASCII
// ─────────────────────────────────────────────────────────────────────────

export function exportSTL(mesh: RawMesh, options: ExportOptions = {}): string {
  mesh = preprocess(mesh, options);
  const name = options.name ?? 'mesh';
  const lines: string[] = [`solid ${name}`];
  for (const tri of iterateTriangles(mesh)) {
    const [nx, ny, nz] = triangleNormal(tri);
    lines.push(`  facet normal ${nx} ${ny} ${nz}`);
    lines.push('    outer loop');
    lines.push(`      vertex ${tri.ax} ${tri.ay} ${tri.az}`);
    lines.push(`      vertex ${tri.bx} ${tri.by} ${tri.bz}`);
    lines.push(`      vertex ${tri.cx} ${tri.cy} ${tri.cz}`);
    lines.push('    endloop');
    lines.push('  endfacet');
  }
  lines.push(`endsolid ${name}`);
  return lines.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────
// STL — Binary (84 + 50 * triCount bytes)
// ─────────────────────────────────────────────────────────────────────────

export function exportSTLBinary(mesh: RawMesh, options: ExportOptions = {}): Uint8Array {
  mesh = preprocess(mesh, options);
  const triCount = countTriangles(mesh);
  const buffer = new ArrayBuffer(84 + 50 * triCount);
  const view = new DataView(buffer);
  const headerBytes = new Uint8Array(buffer, 0, 80);
  const header = `Lovable Geometry STL — ${options.name ?? 'mesh'}`;
  for (let i = 0; i < Math.min(80, header.length); i++) {
    headerBytes[i] = header.charCodeAt(i) & 0xff;
  }
  view.setUint32(80, triCount, true);
  let off = 84;
  for (const tri of iterateTriangles(mesh)) {
    const [nx, ny, nz] = triangleNormal(tri);
    view.setFloat32(off, nx, true); off += 4;
    view.setFloat32(off, ny, true); off += 4;
    view.setFloat32(off, nz, true); off += 4;
    view.setFloat32(off, tri.ax, true); off += 4;
    view.setFloat32(off, tri.ay, true); off += 4;
    view.setFloat32(off, tri.az, true); off += 4;
    view.setFloat32(off, tri.bx, true); off += 4;
    view.setFloat32(off, tri.by, true); off += 4;
    view.setFloat32(off, tri.bz, true); off += 4;
    view.setFloat32(off, tri.cx, true); off += 4;
    view.setFloat32(off, tri.cy, true); off += 4;
    view.setFloat32(off, tri.cz, true); off += 4;
    view.setUint16(off, 0, true); off += 2;
  }
  return new Uint8Array(buffer);
}

// ─────────────────────────────────────────────────────────────────────────
// OBJ
// ─────────────────────────────────────────────────────────────────────────

export function exportOBJ(mesh: RawMesh, options: ExportOptions = {}): string {
  mesh = preprocess(mesh, options);
  const name = options.name ?? 'mesh';
  const includeNormals = options.includeNormals ?? false;
  const lines: string[] = [`# Lovable Geometry OBJ`, `o ${name}`];

  const p = mesh.positions;
  const vertCount = Math.floor(p.length / 3);
  for (let i = 0; i < vertCount; i++) {
    lines.push(`v ${p[i * 3]} ${p[i * 3 + 1]} ${p[i * 3 + 2]}`);
  }

  const idx = mesh.indices && (mesh.indices as ArrayLike<number>).length > 0
    ? mesh.indices as ArrayLike<number>
    : null;

  if (includeNormals) {
    // Per-triangle face normals (referenced once per face)
    const tris = idx ? idx.length / 3 : vertCount / 3;
    for (let t = 0; t < tris; t++) {
      const a = (idx ? idx[t * 3] : t * 3) * 3;
      const b = (idx ? idx[t * 3 + 1] : t * 3 + 1) * 3;
      const c = (idx ? idx[t * 3 + 2] : t * 3 + 2) * 3;
      const tri: IteratedTriangle = {
        ax: p[a], ay: p[a + 1], az: p[a + 2],
        bx: p[b], by: p[b + 1], bz: p[b + 2],
        cx: p[c], cy: p[c + 1], cz: p[c + 2],
      };
      const [nx, ny, nz] = triangleNormal(tri);
      lines.push(`vn ${nx} ${ny} ${nz}`);
    }
  }

  if (idx) {
    for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t] + 1, b = idx[t + 1] + 1, c = idx[t + 2] + 1;
      if (includeNormals) {
        const n = (t / 3) + 1;
        lines.push(`f ${a}//${n} ${b}//${n} ${c}//${n}`);
      } else {
        lines.push(`f ${a} ${b} ${c}`);
      }
    }
  } else {
    for (let t = 0; t < vertCount; t += 3) {
      const a = t + 1, b = t + 2, c = t + 3;
      if (includeNormals) {
        const n = (t / 3) + 1;
        lines.push(`f ${a}//${n} ${b}//${n} ${c}//${n}`);
      } else {
        lines.push(`f ${a} ${b} ${c}`);
      }
    }
  }

  return lines.join('\n');
}

export type ExportFormat = 'stl' | 'stl-binary' | 'obj';

/**
 * Polymorphic exporter — returns string for ASCII, Uint8Array for binary STL.
 */
export function exportMesh(
  mesh: RawMesh,
  format: ExportFormat,
  options?: ExportOptions,
): string | Uint8Array {
  switch (format) {
    case 'stl': return exportSTL(mesh, options);
    case 'stl-binary': return exportSTLBinary(mesh, options);
    case 'obj': return exportOBJ(mesh, options);
  }
}
