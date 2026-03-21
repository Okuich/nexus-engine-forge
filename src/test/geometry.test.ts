/**
 * Tests for the Midwater Geometry Extraction Engine.
 */

import { describe, it, expect } from 'vitest';
import {
  extractFeatures,
  validateMesh,
  toGraphDict,
  triangleArea,
  triangleNormal,
  signedTetrahedronVolume,
  edgeHash,
  classifySurface,
  MeshValidationError,
  MeshErrorCode,
} from '@/lib/geometry';
import type { RawMesh } from '@/lib/geometry';

// ── Test Fixtures ────────────────────────────────────────────────

/** A simple tetrahedron (4 triangular faces, 4 vertices) */
function makeTetrahedron(): RawMesh {
  const s = 1;
  const positions = new Float32Array([
    0, 0, 0,           // v0
    s, 0, 0,           // v1
    s / 2, s * 0.866, 0, // v2
    s / 2, s * 0.289, s * 0.816, // v3
  ]);
  const indices = new Uint32Array([
    0, 1, 2,  // bottom
    0, 1, 3,  // front
    1, 2, 3,  // right
    0, 2, 3,  // left
  ]);
  return { positions, indices };
}

/** A single triangle (simplest valid mesh) */
function makeSingleTriangle(): RawMesh {
  return {
    positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
    indices: [0, 1, 2],
  };
}

/** Two adjacent triangles sharing an edge */
function makeTwoTriangles(): RawMesh {
  return {
    positions: [0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0],
    indices: [0, 1, 2, 1, 3, 2],
  };
}

// ── Math Primitives ──────────────────────────────────────────────

describe('meshMath', () => {
  it('computes triangle area', () => {
    const area = triangleArea([0, 0, 0], [1, 0, 0], [0, 1, 0]);
    expect(area).toBeCloseTo(0.5, 6);
  });

  it('computes triangle normal', () => {
    const n = triangleNormal([0, 0, 0], [1, 0, 0], [0, 1, 0]);
    expect(n[0]).toBeCloseTo(0);
    expect(n[1]).toBeCloseTo(0);
    expect(n[2]).toBeCloseTo(1);
  });

  it('computes signed tetrahedron volume', () => {
    const vol = signedTetrahedronVolume([0, 0, 0], [1, 0, 0], [0, 1, 0]);
    expect(typeof vol).toBe('number');
    expect(Number.isFinite(vol)).toBe(true);
  });

  it('edgeHash is symmetric', () => {
    expect(edgeHash(3, 7)).toBe(edgeHash(7, 3));
    expect(edgeHash(0, 100)).toBe(edgeHash(100, 0));
  });

  it('edgeHash produces unique values', () => {
    const h1 = edgeHash(1, 2);
    const h2 = edgeHash(1, 3);
    const h3 = edgeHash(2, 3);
    expect(h1).not.toBe(h2);
    expect(h1).not.toBe(h3);
    expect(h2).not.toBe(h3);
  });

  it('classifies planar surface', () => {
    expect(classifySurface(0, 0)).toBe('planar');
    expect(classifySurface(1e-5, 1e-5)).toBe('planar');
  });

  it('classifies cylindrical surface', () => {
    expect(classifySurface(0, 0.5)).toBe('cylindrical');
    expect(classifySurface(0.5, 0)).toBe('cylindrical');
  });
});

// ── Validation ───────────────────────────────────────────────────

describe('meshValidator', () => {
  it('validates a correct mesh', () => {
    const result = validateMesh(makeSingleTriangle());
    expect(result.valid).toBe(true);
    expect(result.faceCount).toBe(1);
    expect(result.vertexCount).toBe(3);
  });

  it('rejects empty positions', () => {
    expect(() => validateMesh({ positions: [] })).toThrow(MeshValidationError);
  });

  it('rejects non-divisible-by-3 positions', () => {
    expect(() => validateMesh({ positions: [1, 2] })).toThrow(MeshValidationError);
  });

  it('rejects NaN in positions', () => {
    expect(() => validateMesh({ positions: [0, NaN, 0, 1, 0, 0, 0, 1, 0] }))
      .toThrow(MeshValidationError);
  });

  it('rejects out-of-bounds indices', () => {
    expect(() =>
      validateMesh({ positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], indices: [0, 1, 5] }),
    ).toThrow(MeshValidationError);
  });

  it('warns on degenerate faces', () => {
    // Three identical vertices → zero area
    const mesh: RawMesh = {
      positions: [0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1],
      indices: [0, 1, 2, 3, 4, 5],
    };
    const result = validateMesh(mesh);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('rejects all-degenerate mesh', () => {
    const mesh: RawMesh = {
      positions: [0, 0, 0, 0, 0, 0, 0, 0, 0],
      indices: [0, 1, 2],
    };
    expect(() => validateMesh(mesh)).toThrow(MeshValidationError);
  });
});

// ── Feature Extraction ───────────────────────────────────────────

describe('extractFeatures', () => {
  it('extracts features from a single triangle', () => {
    const result = extractFeatures(makeSingleTriangle());

    expect(result.faces).toHaveLength(1);
    expect(result.faces[0].area).toBeCloseTo(0.5, 5);
    expect(result.faces[0].normal[2]).toBeCloseTo(1);
    expect(result.nodeFeatures).toHaveLength(1);
    expect(result.nodeFeatures[0]).toHaveLength(12);
    expect(result.stats.totalFaces).toBe(1);
    expect(result.stats.volume).toBeGreaterThanOrEqual(0);
  });

  it('extracts features from two adjacent triangles', () => {
    const result = extractFeatures(makeTwoTriangles());

    expect(result.faces).toHaveLength(2);
    expect(result.edges.length).toBeGreaterThan(0);
    expect(result.graph.numNodes).toBe(2);
    expect(result.graph.numEdges).toBeGreaterThan(0);
    expect(result.stats.totalEdges).toBeGreaterThan(0);
  });

  it('extracts features from a tetrahedron', () => {
    const result = extractFeatures(makeTetrahedron());

    expect(result.faces).toHaveLength(4);
    expect(result.stats.totalFaces).toBe(4);
    expect(result.stats.totalVertices).toBe(4);
    expect(result.stats.volume).toBeGreaterThan(0);
    expect(result.stats.totalArea).toBeGreaterThan(0);

    // Each face should have 12-d feature vector
    for (const row of result.nodeFeatures) {
      expect(row).toHaveLength(12);
      for (const val of row) {
        expect(Number.isFinite(val)).toBe(true);
      }
    }

    // Graph should have adjacency edges
    expect(result.graph.numEdges).toBeGreaterThan(0);

    // Edge index should be symmetric (undirected)
    expect(result.edgeIndex[0].length).toBe(result.edgeIndex[1].length);
    expect(result.edgeIndex[0].length).toBe(result.graph.numEdges * 2);
  });

  it('handles non-indexed mesh', () => {
    const mesh: RawMesh = {
      positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
    };
    const result = extractFeatures(mesh);
    expect(result.faces).toHaveLength(1);
  });

  it('computes bounding box correctly', () => {
    const result = extractFeatures(makeSingleTriangle());
    const bb = result.stats.boundingBox;

    expect(bb.min[0]).toBe(0);
    expect(bb.min[1]).toBe(0);
    expect(bb.max[0]).toBe(1);
    expect(bb.max[1]).toBe(1);
    expect(bb.diagonal).toBeCloseTo(1);
  });

  it('computes surface class distribution', () => {
    const result = extractFeatures(makeTetrahedron());
    const dist = result.stats.surfaceClassDistribution;

    const total = Object.values(dist).reduce((s, v) => s + v, 0);
    expect(total).toBe(4);
  });

  it('produces valid complexity score', () => {
    const result = extractFeatures(makeTetrahedron());
    expect(Number.isFinite(result.stats.complexityScore)).toBe(true);
    expect(result.stats.complexityScore).toBeGreaterThanOrEqual(0);
  });

  it('throws on invalid input', () => {
    expect(() => extractFeatures({ positions: [] })).toThrow(MeshValidationError);
  });
});

// ── Serialization ────────────────────────────────────────────────

describe('toGraphDict', () => {
  it('serializes to PyG-compatible format', () => {
    const features = extractFeatures(makeTetrahedron());
    const dict = toGraphDict(features);

    expect(dict.num_nodes).toBe(4);
    expect(dict.node_feature_dim).toBe(12);
    expect(dict.edge_feature_dim).toBe(4);
    expect(dict.x).toHaveLength(4);
    expect(dict.edge_index).toHaveLength(2);
    expect(dict.edge_index[0].length).toBe(dict.edge_index[1].length);
    expect(dict.stats.volume).toBeGreaterThan(0);
  });
});
