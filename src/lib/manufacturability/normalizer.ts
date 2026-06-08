/**
 * Manufacturability feature extraction + normalization.
 *
 * Min/max bounds reflect realistic ranges for industrial CNC, IM,
 * AM, sheet-metal and casting parts. Vectors are clipped to [0,1]
 * after normalization for stable distance computation.
 */

import {
  MFG_DIMENSIONS,
  MFG_VECTOR_DIM,
  type CadModel,
  type MfgDimension,
} from './types';

const RANGES: Record<MfgDimension, [number, number]> = {
  'feat.holes': [0, 200],
  'feat.pockets': [0, 100],
  'feat.bosses': [0, 100],
  'feat.ribs': [0, 80],
  'feat.fillets': [0, 300],
  'feat.chamfers': [0, 200],
  'feat.threads': [0, 80],
  'feat.undercuts': [0, 40],
  'tol.tightnessInv': [0, 4], // -log10(mm), 0.001mm => 3
  'tol.precisionFeatureCount': [0, 50],
  'tol.surfaceInv': [0, 3], // -log10(Ra um)
  'tol.gdtCount': [0, 80],
  'surf.areaLog': [0, 8], // log10(mm^2)
  'surf.freeform': [0, 200],
  'surf.planar': [0, 400],
  'surf.curvature': [0, 5],
  'wall.minInv': [0, 4], // 1/mm capped
  'wall.mean': [0, 50],
  'wall.std': [0, 20],
  'mat.machinabilityInv': [0, 1],
  'mat.hardness': [0, 1],
  'mat.costLog': [0, 4], // log10(usd/kg)
  'tool.coverageInv': [0, 1],
  'tool.lengthLog': [0, 3], // log10(mm)
  'tool.setups': [0, 10],
  'asm.parts': [0, 200],
  'asm.fasteners': [0, 200],
  'asm.interfaces': [0, 400],
  'asm.stackups': [0, 100],
  'topo.eulerAbs': [0, 200],
  'topo.genus': [0, 50],
  'topo.components': [0, 50],
  'topo.featureClasses': [0, 30],
  'vol.log': [0, 10], // log10(mm^3)
};

function safeLog10(x: number, floor = 1): number {
  return Math.log10(Math.max(x, floor));
}

function invMm(x: number): number {
  if (x <= 0) return 4;
  return Math.min(4, 1 / x);
}

export function extractRaw(model: CadModel): Float32Array {
  const m = model;
  const values: Record<MfgDimension, number> = {
    'feat.holes': m.features.holes,
    'feat.pockets': m.features.pockets,
    'feat.bosses': m.features.bosses,
    'feat.ribs': m.features.ribs,
    'feat.fillets': m.features.fillets,
    'feat.chamfers': m.features.chamfers,
    'feat.threads': m.features.threads,
    'feat.undercuts': m.features.undercuts,
    'tol.tightnessInv': m.tolerances.tightestTolMm > 0 ? -Math.log10(m.tolerances.tightestTolMm) : 4,
    'tol.precisionFeatureCount': m.tolerances.precisionFeatureCount,
    'tol.surfaceInv': m.tolerances.bestSurfaceRaUm > 0 ? -Math.log10(m.tolerances.bestSurfaceRaUm) : 3,
    'tol.gdtCount': m.tolerances.gdtCount,
    'surf.areaLog': safeLog10(m.surface.surfaceAreaMm2),
    'surf.freeform': m.surface.freeformFaceCount,
    'surf.planar': m.surface.planarFaceCount,
    'surf.curvature': m.surface.meanCurvature,
    'wall.minInv': invMm(m.wall.minThicknessMm),
    'wall.mean': m.wall.meanThicknessMm,
    'wall.std': m.wall.thicknessStdMm,
    'mat.machinabilityInv': 1 - Math.max(0, Math.min(1, m.material.machinability)),
    'mat.hardness': Math.max(0, Math.min(1, m.material.hardness)),
    'mat.costLog': safeLog10(m.material.costPerKgUsd),
    'tool.coverageInv': 1 - Math.max(0, Math.min(1, m.tooling.threeAxisCoverage)),
    'tool.lengthLog': safeLog10(m.tooling.requiredToolLengthMm),
    'tool.setups': m.tooling.setupCount,
    'asm.parts': m.assembly.partCount,
    'asm.fasteners': m.assembly.fastenerCount,
    'asm.interfaces': m.assembly.interfaceCount,
    'asm.stackups': m.assembly.stackupCount,
    'topo.eulerAbs': Math.abs(m.topology.euler),
    'topo.genus': m.topology.genus,
    'topo.components': m.topology.componentCount,
    'topo.featureClasses': m.topology.featureClassCount,
    'vol.log': safeLog10(m.volumeMm3),
  };
  const out = new Float32Array(MFG_VECTOR_DIM);
  MFG_DIMENSIONS.forEach((d, i) => {
    const v = values[d];
    out[i] = Number.isFinite(v) ? v : 0;
  });
  return out;
}

export function normalize(raw: Float32Array): Float32Array {
  const out = new Float32Array(MFG_VECTOR_DIM);
  MFG_DIMENSIONS.forEach((d, i) => {
    const [lo, hi] = RANGES[d];
    const range = hi - lo;
    if (range <= 0) {
      out[i] = 0;
    } else {
      const v = (raw[i] - lo) / range;
      out[i] = v < 0 ? 0 : v > 1 ? 1 : v;
    }
  });
  return out;
}

/**
 * Per-dimension "difficulty weight" — how strongly the dimension
 * contributes to overall manufacturing difficulty. Used by the
 * difficulty distance metric and the difficulty index.
 */
export const DIFFICULTY_WEIGHTS: Record<MfgDimension, number> = {
  'feat.holes': 0.4,
  'feat.pockets': 0.6,
  'feat.bosses': 0.3,
  'feat.ribs': 0.3,
  'feat.fillets': 0.2,
  'feat.chamfers': 0.1,
  'feat.threads': 0.5,
  'feat.undercuts': 1.0,
  'tol.tightnessInv': 1.0,
  'tol.precisionFeatureCount': 0.8,
  'tol.surfaceInv': 0.7,
  'tol.gdtCount': 0.4,
  'surf.areaLog': 0.2,
  'surf.freeform': 0.8,
  'surf.planar': 0.1,
  'surf.curvature': 0.6,
  'wall.minInv': 1.0,
  'wall.mean': 0.2,
  'wall.std': 0.5,
  'mat.machinabilityInv': 0.9,
  'mat.hardness': 0.8,
  'mat.costLog': 0.3,
  'tool.coverageInv': 0.9,
  'tool.lengthLog': 0.4,
  'tool.setups': 0.6,
  'asm.parts': 0.5,
  'asm.fasteners': 0.3,
  'asm.interfaces': 0.5,
  'asm.stackups': 0.6,
  'topo.eulerAbs': 0.3,
  'topo.genus': 0.7,
  'topo.components': 0.4,
  'topo.featureClasses': 0.4,
  'vol.log': 0.2,
};

export function difficultyWeightVector(): Float32Array {
  const w = new Float32Array(MFG_VECTOR_DIM);
  MFG_DIMENSIONS.forEach((d, i) => {
    w[i] = DIFFICULTY_WEIGHTS[d];
  });
  return w;
}
