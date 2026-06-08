import { describe, it, expect, beforeEach } from 'vitest';
import {
  ManufacturabilityEngine,
  evaluateManufacturability,
  getManufacturabilityEngine,
  geometricSimilarity,
  difficultyDistance,
  difficultyWeightVector,
  MFG_VECTOR_DIM,
  FABRICATION_PROCESSES,
  type CadModel,
  type FabricationProcess,
} from '@/lib/manufacturability';

function makeModel(overrides: Partial<CadModel> = {}): CadModel {
  const base: CadModel = {
    id: 'p1',
    name: 'Bracket',
    volumeMm3: 25_000,
    features: { holes: 6, pockets: 2, bosses: 1, ribs: 0, fillets: 8, chamfers: 4, threads: 2, undercuts: 0 },
    tolerances: { tightestTolMm: 0.05, precisionFeatureCount: 2, bestSurfaceRaUm: 1.6, gdtCount: 3 },
    surface: { surfaceAreaMm2: 12_000, freeformFaceCount: 0, planarFaceCount: 20, meanCurvature: 0.1 },
    wall: { minThicknessMm: 2, meanThicknessMm: 4, thicknessStdMm: 0.5 },
    material: { family: 'aluminum', machinability: 0.85, hardness: 0.2, costPerKgUsd: 8 },
    tooling: { threeAxisCoverage: 0.9, requiredToolLengthMm: 40, setupCount: 2 },
    assembly: { partCount: 1, fastenerCount: 0, interfaceCount: 0, stackupCount: 0 },
    topology: { euler: 2, genus: 0, componentCount: 1, featureClassCount: 4 },
  };
  return { ...base, ...overrides };
}

describe('ManufacturabilityEngine', () => {
  let engine: ManufacturabilityEngine;
  beforeEach(() => {
    engine = new ManufacturabilityEngine();
  });

  it('generates a normalized 34-D vector', () => {
    const v = engine.generateVector(makeModel());
    expect(v.vector).toBeInstanceOf(Float32Array);
    expect(v.vector.length).toBe(MFG_VECTOR_DIM);
    for (let i = 0; i < v.vector.length; i++) {
      expect(v.vector[i]).toBeGreaterThanOrEqual(0);
      expect(v.vector[i]).toBeLessThanOrEqual(1);
    }
  });

  it('scores all five fabrication processes', () => {
    const res = engine.evaluateManufacturability(makeModel());
    const processes = res.processScores.map((p) => p.process).sort();
    expect(processes).toEqual([...FABRICATION_PROCESSES].sort());
    for (const p of res.processScores) {
      expect(p.score).toBeGreaterThanOrEqual(0);
      expect(p.score).toBeLessThanOrEqual(100);
      expect(p.feasibility).toBeGreaterThanOrEqual(0);
      expect(p.feasibility).toBeLessThanOrEqual(1);
    }
  });

  it('picks CNC for a simple aluminum bracket', () => {
    const res = engine.evaluateManufacturability(makeModel());
    expect(res.recommendedProcess).toBe<FabricationProcess>('cnc');
    expect(res.score).toBeGreaterThan(40);
    expect(res.feasibility).toBeGreaterThan(0.5);
  });

  it('flags injection molding for thin uniform plastic part', () => {
    const part = makeModel({
      id: 'plastic-1',
      name: 'PlasticHousing',
      material: { family: 'plastic', machinability: 0.95, hardness: 0.05, costPerKgUsd: 3 },
      wall: { minThicknessMm: 1.5, meanThicknessMm: 1.7, thicknessStdMm: 0.05 },
      features: { holes: 4, pockets: 0, bosses: 6, ribs: 4, fillets: 12, chamfers: 0, threads: 0, undercuts: 0 },
      tolerances: { tightestTolMm: 0.1, precisionFeatureCount: 0, bestSurfaceRaUm: 3.2, gdtCount: 0 },
      surface: { surfaceAreaMm2: 35_000, freeformFaceCount: 4, planarFaceCount: 10, meanCurvature: 0.3 },
    });
    const res = engine.evaluateManufacturability(part);
    const im = res.processScores.find((p) => p.process === 'injection-molding')!;
    const sm = res.processScores.find((p) => p.process === 'sheet-metal')!;
    const cst = res.processScores.find((p) => p.process === 'casting')!;
    expect(im.score).toBeGreaterThan(sm.score);
    expect(im.score).toBeGreaterThan(cst.score);
  });

  it('penalizes parts with undercuts and tight tolerances', () => {
    const easy = engine.evaluateManufacturability(makeModel());
    const hard = engine.evaluateManufacturability(
      makeModel({
        id: 'hard',
        features: { ...makeModel().features, undercuts: 5 },
        tolerances: { tightestTolMm: 0.005, precisionFeatureCount: 12, bestSurfaceRaUm: 0.4, gdtCount: 20 },
        material: { family: 'titanium', machinability: 0.15, hardness: 0.9, costPerKgUsd: 60 },
        tooling: { threeAxisCoverage: 0.4, requiredToolLengthMm: 200, setupCount: 6 },
      }),
    );
    expect(hard.score).toBeLessThan(easy.score);
    expect(hard.difficulty.length).toBeGreaterThan(0);
    expect(hard.difficulty[0].impact).toBeGreaterThan(0);
  });

  it('returns similar manufacturable parts from the store', () => {
    for (let i = 0; i < 30; i++) {
      engine.registerPart(
        makeModel({
          id: `seed-${i}`,
          name: `Bracket-${i}`,
          features: { ...makeModel().features, holes: 4 + (i % 8) },
        }),
        'cnc',
        80 - (i % 10),
      );
    }
    const res = engine.evaluateManufacturability(makeModel({ id: 'query', name: 'Query' }));
    expect(res.similarParts.length).toBe(5);
    expect(res.similarParts[0].geometricSimilarity).toBeGreaterThan(
      res.similarParts[4].geometricSimilarity - 0.01,
    );
    expect(res.similarParts.every((s) => s.modelId.startsWith('seed-'))).toBe(true);
  });

  it('returns top alternative fabrication methods', () => {
    const res = engine.evaluateManufacturability(makeModel());
    expect(res.alternatives.length).toBeGreaterThan(0);
    expect(res.alternatives.every((a) => a.process !== res.recommendedProcess)).toBe(true);
  });

  it('geometric similarity is symmetric and self-similar = 1', () => {
    const v = engine.generateVector(makeModel());
    expect(geometricSimilarity(v.vector, v.vector)).toBeCloseTo(1, 5);
    const v2 = engine.generateVector(makeModel({ id: 'other' }));
    expect(geometricSimilarity(v.vector, v2.vector)).toBe(
      geometricSimilarity(v2.vector, v.vector),
    );
  });

  it('difficulty distance is weighted and non-negative', () => {
    const w = difficultyWeightVector();
    const a = engine.generateVector(makeModel());
    const b = engine.generateVector(
      makeModel({ id: 'b', features: { ...makeModel().features, undercuts: 8 } }),
    );
    const d = difficultyDistance(a.vector, b.vector, w);
    expect(d).toBeGreaterThan(0);
  });

  it('exposes a singleton evaluateManufacturability helper', () => {
    getManufacturabilityEngine().reset();
    const res = evaluateManufacturability(makeModel());
    expect(res.score).toBeGreaterThan(0);
    expect(res.processScores).toHaveLength(5);
  });
});
