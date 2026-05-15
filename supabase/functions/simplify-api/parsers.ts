/**
 * Lightweight STL/OBJ parsers for the simplify-api `/upload` endpoint.
 *
 * Supports:
 *   • Binary STL (header[80] + uint32 triCount + 50-byte triangles)
 *   • ASCII  STL ("solid …" / "facet normal …" form)
 *   • Wavefront OBJ (v / f only — quads triangulated as fans, ignores
 *     vt/vn/groups/materials)
 *
 * Both produce a flat `{ positions: number[], indices?: number[] }`
 * shape compatible with the existing `MeshSchema` validator.
 */

export type RawMeshIn = { positions: number[]; indices?: number[] };

// ─── Binary STL detection ───────────────────────────────────────────────────

function looksLikeBinarySTL(buf: Uint8Array): boolean {
  if (buf.byteLength < 84) return false;
  // ASCII STL conventionally starts with "solid", but some binary STLs do too.
  // The reliable check: byteLength === 84 + 50*triCount.
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const tri = dv.getUint32(80, true);
  return buf.byteLength === 84 + 50 * tri;
}

function parseBinarySTL(buf: Uint8Array): RawMeshIn {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const tri = dv.getUint32(80, true);
  const positions = new Array<number>(tri * 9);
  let off = 84;
  let p = 0;
  for (let i = 0; i < tri; i++) {
    off += 12; // skip normal
    for (let v = 0; v < 3; v++) {
      positions[p++] = dv.getFloat32(off, true);
      positions[p++] = dv.getFloat32(off + 4, true);
      positions[p++] = dv.getFloat32(off + 8, true);
      off += 12;
    }
    off += 2; // attribute byte count
  }
  return { positions };
}

function parseAsciiSTL(text: string): RawMeshIn {
  const positions: number[] = [];
  // Accept any whitespace, including newlines and tabs.
  const re = /vertex\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    positions.push(parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3]));
  }
  if (positions.length === 0 || positions.length % 9 !== 0) {
    throw new Error('invalid_ascii_stl');
  }
  return { positions };
}

export function parseSTL(buf: Uint8Array): RawMeshIn {
  if (looksLikeBinarySTL(buf)) return parseBinarySTL(buf);
  // Fall back to ASCII.
  const text = new TextDecoder('utf-8').decode(buf);
  return parseAsciiSTL(text);
}

// ─── OBJ ────────────────────────────────────────────────────────────────────

export function parseOBJ(text: string): RawMeshIn {
  const verts: number[] = [];
  const indices: number[] = [];
  const lines = text.split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (line.length === 0 || line.startsWith('#')) continue;
    if (line.startsWith('v ')) {
      const parts = line.split(/\s+/);
      if (parts.length < 4) continue;
      verts.push(+parts[1], +parts[2], +parts[3]);
    } else if (line.startsWith('f ')) {
      const parts = line.split(/\s+/).slice(1);
      // Each face token may be "i", "i/ti", "i/ti/ni", or "i//ni".
      // OBJ indices are 1-based and can be negative (relative).
      const vCount = (verts.length / 3) | 0;
      const idxs = parts.map((tok) => {
        const i = parseInt(tok.split('/')[0], 10);
        if (!Number.isFinite(i) || i === 0) return -1;
        return i > 0 ? i - 1 : vCount + i;
      }).filter((i) => i >= 0 && i < vCount);
      // Triangulate as a fan.
      for (let k = 1; k + 1 < idxs.length; k++) {
        indices.push(idxs[0], idxs[k], idxs[k + 1]);
      }
    }
    // v t / v n / g / s / o / mtllib / usemtl: ignored.
  }
  if (verts.length === 0 || indices.length === 0) {
    throw new Error('invalid_obj');
  }
  return { positions: verts, indices };
}

// ─── Top-level dispatch ─────────────────────────────────────────────────────

export type MeshFormat = 'stl' | 'obj';

export function inferMeshFormat(filename: string, contentType?: string): MeshFormat | null {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.stl')) return 'stl';
  if (lower.endsWith('.obj')) return 'obj';
  if (contentType) {
    const ct = contentType.toLowerCase();
    if (ct.includes('stl')) return 'stl';
    if (ct.includes('obj') || ct.includes('wavefront')) return 'obj';
  }
  return null;
}

export function parseUploadedMesh(
  bytes: Uint8Array,
  format: MeshFormat,
): RawMeshIn {
  if (format === 'stl') return parseSTL(bytes);
  return parseOBJ(new TextDecoder('utf-8').decode(bytes));
}
