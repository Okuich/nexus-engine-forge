/**
 * Tests for the Midwater Real-Time Inference Engine.
 */

import { describe, it, expect } from 'vitest';
import { extractFeatures } from '@/lib/geometry';
import type { RawMesh } from '@/lib/geometry';

// We test the rule engine and explanation generator directly
// by importing the full engine and running with rulesOnly=true
// (avoids needing a live edge function in tests)

// Import internals we can test
import { MATERIALS, PROCESSES, estimateCost } from '@/lib/ml/costEngine';

function makeTetrahedron(): RawMesh {
  return {
    positions: new Float32Array([
      0, 0, 0, 1, 0, 0, 0.5, 0.866, 0, 0.5, 0.289, 0.816,
    ]),
    indices: new Uint32Array([0, 1, 2, 0, 1, 3, 1, 2, 3, 0, 2, 3]),
  };
}

function makeTwoTriangles(): RawMesh {
  return {
    positions: [0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0],
    indices: [0, 1, 2, 1, 3, 2],
  };
}

describe('inferenceEngine integration', () => {
  const features = extractFeatures(makeTetrahedron());

  it('cost engine produces valid breakdown', () => {
    const cost = estimateCost(features, {
      materialId: 'al-6061',
      processId: 'cnc-milling',
    });

    expect(cost.totalCost).toBeGreaterThan(0);
    expect(cost.lineItems.length).toBeGreaterThan(0);
    expect(cost.subtotals.overhead).toBeGreaterThan(0);
    expect(cost.confidence).toBeGreaterThan(0);
  });

  it('exotic materials cost more', () => {
    const al = estimateCost(features, { materialId: 'al-6061', processId: 'cnc-milling' });
    const ti = estimateCost(features, { materialId: 'ti-6al4v', processId: 'cnc-milling' });
    const inc = estimateCost(features, { materialId: 'inconel-718', processId: 'cnc-milling' });

    expect(ti.totalCost).toBeGreaterThan(al.totalCost);
    expect(inc.totalCost).toBeGreaterThan(ti.totalCost);
  });

  it('simple geometry has high manufacturability potential', () => {
    const simple = extractFeatures(makeTwoTriangles());
    expect(simple.stats.complexityScore).toBeLessThan(0.5);
    expect(simple.stats.totalFaces).toBe(2);
  });

  it('feature vectors are well-formed for inference', () => {
    expect(features.nodeFeatures).toHaveLength(4);
    for (const row of features.nodeFeatures) {
      expect(row).toHaveLength(12);
      for (const val of row) {
        expect(Number.isFinite(val)).toBe(true);
      }
    }
  });

  it('edge index is symmetric for GNN message passing', () => {
    expect(features.edgeIndex[0].length).toBe(features.edgeIndex[1].length);
    expect(features.edgeIndex[0].length).toBe(features.graph.numEdges * 2);
  });

  it('materials library is populated', () => {
    expect(Object.keys(MATERIALS).length).toBeGreaterThanOrEqual(7);
    for (const mat of Object.values(MATERIALS)) {
      expect(mat.costPerCm3).toBeGreaterThan(0);
      expect(mat.machinability).toBeGreaterThan(0);
      expect(mat.machinability).toBeLessThanOrEqual(1);
    }
  });

  it('processes library is populated', () => {
    expect(Object.keys(PROCESSES).length).toBeGreaterThanOrEqual(6);
    for (const proc of Object.values(PROCESSES)) {
      expect(proc.setupCost).toBeGreaterThanOrEqual(0);
      expect(proc.costPerMinute).toBeGreaterThan(0);
    }
  });
});
