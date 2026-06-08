/**
 * Feature extraction + normalization for the Physics-Constrained
 * metric space. All dimensions are mapped into [0, 1] where higher
 * values consistently mean "closer to a physical limit".
 */

import {
  PHYSICS_DIMENSIONS,
  PHYSICS_VECTOR_DIM,
  type PhysicsDimension,
  type PhysicsSnapshot,
} from './types';

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return x < 0 ? 0 : x > 1 ? 1 : x;
}
function safeLog10(x: number, floor = 1): number {
  return Math.log10(Math.max(x, floor));
}

export function extractRaw(s: PhysicsSnapshot): Float32Array {
  const yieldMPa = Math.max(1e-6, s.material.yieldMPa);
  const utsMPa = Math.max(1e-6, s.material.utsMPa);
  const enduranceMPa = Math.max(1e-6, s.material.enduranceMPa);
  const maxK = Math.max(1, s.material.maxServiceK);
  const fn = Math.max(1e-6, s.vibration.firstNaturalHz);
  const reqLife = Math.max(1, s.fatigue.requiredLifeCycles);

  const values: Record<PhysicsDimension, number> = {
    'stress.yieldRatio': s.stress.vonMisesMPa / yieldMPa,
    'stress.utsRatio': s.stress.vonMisesMPa / utsMPa,
    'stress.principalAbsRatio': Math.abs(s.stress.principalMPa) / utsMPa,
    'strain.equivalent': s.strain.equivalent,
    'strain.plastic': s.strain.plastic,
    'thermal.peakRatio': s.thermal.peakK / maxK,
    'thermal.meanRatio': s.thermal.meanK / maxK,
    'thermal.gradientNorm': s.thermal.gradientKperMm / 50, // 50 K/mm cap
    'vib.resonanceProximity': 1 - Math.min(1, Math.abs(s.vibration.forcingHz - fn) / fn),
    'vib.dampingDeficitInv': 1 - clamp01(s.vibration.dampingRatio * 20), // <5% damping = deficit
    'vib.forcingNorm': Math.min(1, s.vibration.forcingHz / 2000),
    'flow.reynoldsLog': safeLog10(Math.max(1, s.flow.reynolds)) / 7, // log10 normalized by 1e7
    'flow.dpNorm': Math.min(1, s.flow.pressureDropPa / 1e6), // 1 MPa cap
    'flow.velocityNorm': Math.min(1, s.flow.peakVelocity / 100), // 100 m/s cap
    'flow.separationFlag': s.flow.separation ? 1 : 0,
    'fat.amplitudeRatio': s.fatigue.amplitudeMPa / enduranceMPa,
    'fat.meanRatio': s.fatigue.meanMPa / utsMPa,
    'fat.lifeDeficit': Math.max(0, 1 - s.fatigue.cyclesToFailure / reqLife),
    'mat.yieldNorm': Math.min(1, yieldMPa / 2000),
    'mat.modulusNorm': Math.min(1, s.material.youngsGPa / 400),
  };

  const out = new Float32Array(PHYSICS_VECTOR_DIM);
  PHYSICS_DIMENSIONS.forEach((d, i) => {
    out[i] = Number.isFinite(values[d]) ? values[d] : 0;
  });
  return out;
}

/** Clip raw values into [0, 1] for distance calculations. */
export function normalize(raw: Float32Array): Float32Array {
  const out = new Float32Array(PHYSICS_VECTOR_DIM);
  for (let i = 0; i < PHYSICS_VECTOR_DIM; i++) out[i] = clamp01(raw[i]);
  return out;
}
