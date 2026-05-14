import { describe, it, expect } from 'vitest';
import {
  extractSDFFeatures,
  extractAdvancedFeatures,
  featureColumnsFor,
  SDF_FEATURE_COLUMNS,
} from '@/lib/geometry/features';
import type { RawMesh } from '@/lib/geometry/types';

// Closed unit cube (12 triangles).
function cube(): RawMesh {
  const positions = new Float32Array([
    0, 0, 0,  1, 0, 0,  1, 1, 0,  0, 1, 0,
    0, 0, 1,  1, 0, 1,  1, 1, 1,  0, 1, 1,
  ]);
  const indices = new Uint32Array([
    0, 2, 1,  0, 3, 2, // bottom (-z)
    4, 5, 6,  4, 6, 7, // top (+z)
    0, 1, 5,  0, 5, 4, // -y
    2, 3, 7,  2, 7, 6, // +y
    1, 2, 6,  1, 6, 5, // +x
    0, 4, 7,  0, 7, 3, // -x
  ]);
  return { positions, indices };
}

describe('SDF feature integration', () => {
  it('produces 4 SDF columns per face', () => {
    const r = extractSDFFeatures(cube(), { generation: { resolution: 24 } });
    expect(r.matrix.length).toBe(12);
    expect(r.matrix[0].length).toBe(SDF_FEATURE_COLUMNS.length);
    expect(r.grid.dims[0]).toBeGreaterThan(0);
  });

  it('reports outward gradient consistency for a closed cube', () => {
    const r = extractSDFFeatures(cube(), { generation: { resolution: 24 } });
    expect(r.stats.outwardConsistency).toBeGreaterThan(0.7);
    expect(r.stats.enclosedVolume).toBeGreaterThan(0);
  });

  it('appends SDF columns to the advanced ML feature matrix', () => {
    const a = extractAdvancedFeatures(cube(), {
      thickness: false,
      sdf: { generation: { resolution: 20 } },
    });
    const cols = featureColumnsFor({ sdf: true });
    expect(cols.length).toBe(12);
    expect(a.matrix[0].length).toBe(12);
    expect(a.sdf).not.toBeNull();
    expect(a.stats.sdf).toBeDefined();
  });

  it('skips SDF when option is omitted', () => {
    const a = extractAdvancedFeatures(cube(), { thickness: false });
    expect(a.matrix[0].length).toBe(8);
    expect(a.sdf).toBeNull();
    expect(featureColumnsFor()).toHaveLength(8);
  });

  it('reuses a precomputed grid', () => {
    const first = extractSDFFeatures(cube(), { generation: { resolution: 16 } });
    const second = extractSDFFeatures(cube(), { grid: first.grid });
    expect(second.grid).toBe(first.grid);
  });
});
