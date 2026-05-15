/**
 * Tests for the STL/OBJ parsers used by `simplify-api/upload`. We exercise
 * the parser module directly (no HTTP) — the route handler is a thin
 * formData → parser → existing buildLODs/coarsenGraph wrapper.
 */
import { describe, it, expect } from 'vitest';
import {
  parseSTL,
  parseOBJ,
  parseUploadedMesh,
  inferMeshFormat,
} from '../../supabase/functions/simplify-api/parsers';

/** Build a tiny binary STL with one triangle: (0,0,0) (1,0,0) (0,1,0). */
function makeBinarySTL(): Uint8Array {
  const buf = new ArrayBuffer(84 + 50);
  const u8 = new Uint8Array(buf);
  const dv = new DataView(buf);
  // header: 80 zero bytes
  dv.setUint32(80, 1, true); // 1 triangle
  let off = 84;
  // normal (ignored)
  dv.setFloat32(off + 0, 0, true);
  dv.setFloat32(off + 4, 0, true);
  dv.setFloat32(off + 8, 1, true);
  off += 12;
  const verts = [0, 0, 0, 1, 0, 0, 0, 1, 0];
  for (let i = 0; i < 9; i++) { dv.setFloat32(off, verts[i], true); off += 4; }
  dv.setUint16(off, 0, true);
  return u8;
}

const ASCII_STL = `solid cube
facet normal 0 0 1
  outer loop
    vertex 0 0 0
    vertex 1 0 0
    vertex 0 1 0
  endloop
endfacet
facet normal 0 0 1
  outer loop
    vertex 1 0 0
    vertex 1 1 0
    vertex 0 1 0
  endloop
endfacet
endsolid cube
`;

const OBJ_QUAD = `# a quad
v 0 0 0
v 1 0 0
v 1 1 0
v 0 1 0
f 1 2 3 4
`;

describe('simplify-api parsers', () => {
  it('inferMeshFormat picks up extensions and content types', () => {
    expect(inferMeshFormat('part.stl')).toBe('stl');
    expect(inferMeshFormat('PART.STL')).toBe('stl');
    expect(inferMeshFormat('part.obj')).toBe('obj');
    expect(inferMeshFormat('blob', 'model/stl')).toBe('stl');
    expect(inferMeshFormat('blob', 'application/x-wavefront-obj')).toBe('obj');
    expect(inferMeshFormat('blob.txt')).toBeNull();
  });

  it('parses a binary STL', () => {
    const m = parseSTL(makeBinarySTL());
    expect(m.positions).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    expect(m.indices).toBeUndefined();
  });

  it('parses an ASCII STL', () => {
    const bytes = new TextEncoder().encode(ASCII_STL);
    const m = parseSTL(bytes);
    expect(m.positions.length).toBe(18); // 2 tris × 9
    expect(m.positions.slice(0, 3)).toEqual([0, 0, 0]);
  });

  it('parses an OBJ and triangulates a quad as a fan', () => {
    const m = parseOBJ(OBJ_QUAD);
    expect(m.positions.length).toBe(12);
    expect(m.indices).toEqual([0, 1, 2, 0, 2, 3]);
  });

  it('parseUploadedMesh dispatches by format', () => {
    const stl = parseUploadedMesh(makeBinarySTL(), 'stl');
    expect(stl.positions.length).toBe(9);
    const obj = parseUploadedMesh(new TextEncoder().encode(OBJ_QUAD), 'obj');
    expect(obj.indices).toEqual([0, 1, 2, 0, 2, 3]);
  });

  it('rejects malformed ASCII STL (vertex count not a multiple of 3)', () => {
    const bad = new TextEncoder().encode('vertex 1 2 3\nvertex 4 5 6\n');
    expect(() => parseSTL(bad)).toThrow();
  });

  it('rejects an OBJ with no faces', () => {
    expect(() => parseOBJ('v 0 0 0\nv 1 0 0\nv 0 1 0\n')).toThrow();
  });
});
