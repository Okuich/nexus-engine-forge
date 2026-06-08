/**
 * Feasibility evaluation — converts raw physics ratios into a list
 * of violations, an aggregate penalty, and a hard feasibility flag.
 *
 * Penalties are added to distance calculations so that physically
 * infeasible states are pushed far away from any query, ensuring
 * recommendations remain physically valid.
 */

import type { PhysicsSnapshot, Violation } from './types';

const KIND_WEIGHT: Record<Violation['kind'], number> = {
  'yield': 1.0,
  'ultimate': 1.5,
  'thermal': 1.0,
  'fatigue': 0.9,
  'dynamic-instability': 0.8,
  'flow-separation': 0.4,
};

export interface FeasibilityVerdict {
  feasible: boolean;
  feasibilityScore: number; // 0..1
  penalty: number; // additive distance penalty (non-negative)
  violations: Violation[];
}

export function evaluateViolations(s: PhysicsSnapshot): FeasibilityVerdict {
  const violations: Violation[] = [];

  // Yield / ultimate
  const yRatio = s.stress.vonMisesMPa / Math.max(1e-6, s.material.yieldMPa);
  if (yRatio >= 0.9) {
    violations.push({
      kind: 'yield',
      severity: Math.min(1, (yRatio - 0.9) / 0.5),
      ratio: yRatio,
      message: `Von Mises stress at ${(yRatio * 100).toFixed(0)}% of yield`,
    });
  }
  const uRatio = s.stress.vonMisesMPa / Math.max(1e-6, s.material.utsMPa);
  if (uRatio >= 0.9) {
    violations.push({
      kind: 'ultimate',
      severity: Math.min(1, (uRatio - 0.9) / 0.3),
      ratio: uRatio,
      message: `Von Mises stress at ${(uRatio * 100).toFixed(0)}% of UTS`,
    });
  }

  // Thermal
  const tRatio = s.thermal.peakK / Math.max(1, s.material.maxServiceK);
  if (tRatio >= 0.95) {
    violations.push({
      kind: 'thermal',
      severity: Math.min(1, (tRatio - 0.95) / 0.2),
      ratio: tRatio,
      message: `Peak temperature at ${(tRatio * 100).toFixed(0)}% of max service`,
    });
  }

  // Fatigue
  const fRatio = s.fatigue.amplitudeMPa / Math.max(1e-6, s.material.enduranceMPa);
  const lifeDeficit = Math.max(0, 1 - s.fatigue.cyclesToFailure / Math.max(1, s.fatigue.requiredLifeCycles));
  if (fRatio > 1 || lifeDeficit > 0.5) {
    violations.push({
      kind: 'fatigue',
      severity: Math.min(1, Math.max(fRatio - 1, lifeDeficit)),
      ratio: Math.max(fRatio, 1 + lifeDeficit),
      message: `Fatigue amplitude ${fRatio.toFixed(2)}× endurance, life deficit ${(lifeDeficit * 100).toFixed(0)}%`,
    });
  }

  // Dynamic instability (resonance + low damping)
  const fn = Math.max(1e-6, s.vibration.firstNaturalHz);
  const proximity = 1 - Math.min(1, Math.abs(s.vibration.forcingHz - fn) / fn);
  if (proximity > 0.85 && s.vibration.dampingRatio < 0.05) {
    violations.push({
      kind: 'dynamic-instability',
      severity: Math.min(1, proximity * (1 - s.vibration.dampingRatio * 10)),
      ratio: proximity,
      message: `Forcing within ${((1 - proximity) * 100).toFixed(0)}% of natural freq with damping ${(s.vibration.dampingRatio * 100).toFixed(1)}%`,
    });
  }

  // Flow separation (advisory)
  if (s.flow.separation) {
    violations.push({
      kind: 'flow-separation',
      severity: 0.4,
      ratio: 1,
      message: 'Flow separation/recirculation detected',
    });
  }

  // Aggregate
  let penalty = 0;
  let worstSeverity = 0;
  let hardFail = false;
  for (const v of violations) {
    penalty += KIND_WEIGHT[v.kind] * v.severity;
    if (v.severity > worstSeverity) worstSeverity = v.severity;
    if (v.severity >= 0.8 && v.kind !== 'flow-separation') hardFail = true;
    if (v.kind === 'ultimate' && v.ratio >= 1.0) hardFail = true;
  }
  const feasibilityScore = Math.max(0, 1 - worstSeverity - 0.1 * Math.max(0, violations.length - 1));

  return {
    feasible: !hardFail,
    feasibilityScore: Math.max(0, Math.min(1, feasibilityScore)),
    penalty,
    violations,
  };
}
