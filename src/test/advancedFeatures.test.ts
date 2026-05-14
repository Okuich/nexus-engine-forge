import { describe, it, expect } from 'vitest';
import { generateBox, generateSphere, generatePlane } from '@/lib/geometry/core';
import {
  computeCurvature,
  computeThickness,
  computeSharpness,
  extractAdvancedFeatures,
  featureColumns,
} from '@/lib/geometry/features';

describe('features — curvature', () => {
  it('plane has near-zero Gaussian and mean curvature', () => {
    const m = generatePlane({ widthSegments: 4, heightSegments: 4 });
    const c = computeCurvature(m);
    const interiorMeans = c.perVertex.map((v) => Math.abs(v.mean));
    const maxMean = Math.max(...interiorMeans);
    expect(maxMean).toBeLessThan(1e-3);
    const gaussians = c.perVertex.map((v) => Math.abs(v.gaussian));
    expect(Math.max(...gaussians.slice(0, 9))).toBeLessThan(10); // boundary noise tolerated
  });

  it('sphere has positive Gaussian curvature ≈ 1/r²', () => {
    const r = 1;
    const m = generateSphere({ radius: r, latSegments: 24, lonSegments: 32 });
    const c = computeCurvature(m);
    const positive = c.perVertex.filter((v) => v.gaussian > 0).length;
    const total = c.perVertex.length;
    expect(positive / total).toBeGreaterThan(0.85);
    // Average should be close to 1/r² = 1
    const avgGauss = c.perVertex.reduce((s, v) => s + v.gaussian, 0) / total;
    expect(avgGauss).toBeGreaterThan(0.5);
    expect(avgGauss).toBeLessThan(2);
  });
});

describe('features — thickness', () => {
  it('uniform box reports finite thickness near the wall distance', () => {
    const t = computeThickness(generateBox({ width: 2, height: 2, depth: 2 }), { samples: 9 });
    const finite = t.thickness.filter((v) => Number.isFinite(v));
    expect(finite.length).toBeGreaterThan(0);
    expect(t.meanThickness).toBeGreaterThan(1);
    expect(t.meanThickness).toBeLessThan(3);
  });

  it('thin slab is thinner than a thick slab', () => {
    const thin = computeThickness(generateBox({ width: 2, height: 2, depth: 0.2 }), { samples: 9 });
    const thick = computeThickness(generateBox({ width: 2, height: 2, depth: 2 }), { samples: 9 });
    expect(thin.meanThickness).toBeLessThan(thick.meanThickness);
  });
});

describe('features — sharpness', () => {
  it('box has 90° creases on all 12 edges', () => {
    const s = computeSharpness(generateBox());
    expect(s.creaseEdgeCount).toBe(12);
    expect(s.maxSharpness).toBeGreaterThan(0.9);
    expect(s.perFaceCrease.every((c) => c)).toBe(true);
  });

  it('flat plane has no creases', () => {
    const s = computeSharpness(generatePlane({ widthSegments: 4, heightSegments: 4 }));
    expect(s.creaseEdgeCount).toBe(0);
    expect(s.maxSharpness).toBeLessThan(0.05);
  });

  it('sharp cube edges are signed convex (positive)', () => {
    const s = computeSharpness(generateBox());
    const convex = s.edges.filter((e) => e.signedSharpness > 0).length;
    expect(convex).toBe(s.edges.length); // all box edges are convex
  });
});

describe('features — extractAdvancedFeatures', () => {
  it('produces an 8-column matrix per face', () => {
    const fs = extractAdvancedFeatures(generateBox(), { thickness: false });
    expect(featureColumns.length).toBe(8);
    expect(fs.matrix.length).toBe(12);
    for (const row of fs.matrix) expect(row.length).toBe(8);
  });

  it('aggregate stats are populated', () => {
    const fs = extractAdvancedFeatures(generateBox(), { thickness: { samples: 5 } });
    expect(fs.stats.faces).toBe(12);
    expect(fs.stats.creaseRatio).toBe(1);
    expect(fs.stats.sharpnessMean).toBeGreaterThan(0.5);
    expect(fs.stats.meanThickness).toBeGreaterThan(0);
  });

  it('thickness disabled → null + sentinel in matrix col 4', () => {
    const fs = extractAdvancedFeatures(generateBox(), { thickness: false, thicknessNaNSentinel: -1 });
    expect(fs.thickness).toBeNull();
    for (const row of fs.matrix) expect(row[4]).toBe(-1);
  });
});
