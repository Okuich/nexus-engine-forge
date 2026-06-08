/**
 * Physics-Constrained Metric Space — Type Definitions
 *
 * Embeds physical feasibility directly into the distance function,
 * so similarity queries never return physically impossible neighbors.
 * Integrates with the Physics OS simulation engine (FEA/CFD) via raw
 * stress/strain/thermal/vibration/flow/fatigue inputs.
 */

// ─── Raw physics inputs ──────────────────────────────────────────

export interface StressState {
  /** Peak von Mises stress in MPa */
  vonMisesMPa: number;
  /** Peak principal stress in MPa (can be negative for compression) */
  principalMPa: number;
  /** Hot-spot location index, used for grouping (optional) */
  hotspotId?: string;
}

export interface StrainState {
  /** Peak equivalent strain (unitless) */
  equivalent: number;
  /** Peak plastic strain (unitless) */
  plastic: number;
}

export interface ThermalState {
  /** Peak operating temperature in Kelvin */
  peakK: number;
  /** Mean operating temperature in Kelvin */
  meanK: number;
  /** Max temperature gradient in K/mm */
  gradientKperMm: number;
}

export interface VibrationState {
  /** First natural frequency in Hz */
  firstNaturalHz: number;
  /** Forcing frequency in Hz (0 if quasi-static) */
  forcingHz: number;
  /** Modal damping ratio 0..1 */
  dampingRatio: number;
}

export interface FlowState {
  /** Reynolds number */
  reynolds: number;
  /** Peak pressure drop in Pa */
  pressureDropPa: number;
  /** Peak velocity in m/s */
  peakVelocity: number;
  /** Has separation/recirculation? */
  separation: boolean;
}

export interface MaterialProperties {
  family: 'aluminum' | 'steel' | 'stainless' | 'titanium' | 'inconel' | 'plastic' | 'composite' | 'other';
  /** Yield strength in MPa */
  yieldMPa: number;
  /** Ultimate tensile strength in MPa */
  utsMPa: number;
  /** Endurance / fatigue limit in MPa (≈0.5*UTS if unknown) */
  enduranceMPa: number;
  /** Max service temperature in Kelvin */
  maxServiceK: number;
  /** Young's modulus in GPa */
  youngsGPa: number;
}

export interface FatigueEstimate {
  /** Stress amplitude in MPa */
  amplitudeMPa: number;
  /** Mean stress in MPa */
  meanMPa: number;
  /** Expected cycles to failure (Nf) */
  cyclesToFailure: number;
  /** Required design life in cycles */
  requiredLifeCycles: number;
}

export interface PhysicsSnapshot {
  id: string;
  /** Optional source linkage to a simulation/run */
  simulationId?: string;
  material: MaterialProperties;
  stress: StressState;
  strain: StrainState;
  thermal: ThermalState;
  vibration: VibrationState;
  flow: FlowState;
  fatigue: FatigueEstimate;
}

// ─── Vector ──────────────────────────────────────────────────────

export const PHYSICS_DIMENSIONS = [
  // Stress (3) — utilization ratios in [0,1], higher = closer to limit
  'stress.yieldRatio',
  'stress.utsRatio',
  'stress.principalAbsRatio',
  // Strain (2)
  'strain.equivalent',
  'strain.plastic',
  // Thermal (3)
  'thermal.peakRatio',
  'thermal.meanRatio',
  'thermal.gradientNorm',
  // Vibration (3)
  'vib.resonanceProximity',
  'vib.dampingDeficitInv',
  'vib.forcingNorm',
  // Flow (4)
  'flow.reynoldsLog',
  'flow.dpNorm',
  'flow.velocityNorm',
  'flow.separationFlag',
  // Fatigue (3)
  'fat.amplitudeRatio',
  'fat.meanRatio',
  'fat.lifeDeficit',
  // Material descriptors (2)
  'mat.yieldNorm',
  'mat.modulusNorm',
] as const;

export type PhysicsDimension = (typeof PHYSICS_DIMENSIONS)[number];
export const PHYSICS_VECTOR_DIM = PHYSICS_DIMENSIONS.length; // 20

export interface PhysicsStateVector {
  id: string;
  snapshotId: string;
  /** Normalized [0,1], length = PHYSICS_VECTOR_DIM */
  vector: Float32Array;
  /** Raw pre-normalization values for inspection */
  raw: Float32Array;
}

// ─── Feasibility outputs ─────────────────────────────────────────

export type ViolationKind =
  | 'yield'
  | 'ultimate'
  | 'thermal'
  | 'fatigue'
  | 'dynamic-instability'
  | 'flow-separation';

export interface Violation {
  kind: ViolationKind;
  /** Severity 0..1 (1 = catastrophic) */
  severity: number;
  /** How far past the limit, as a ratio (e.g. 1.2 = 20% over yield) */
  ratio: number;
  message: string;
}

export interface FeasibilityResult {
  snapshotId: string;
  vector: PhysicsStateVector;
  /** Hard feasibility — false if any catastrophic violation present */
  feasible: boolean;
  /** Continuous feasibility score 0..1 (1 = comfortably safe) */
  feasibilityScore: number;
  /** Aggregate penalty added to distance for this state */
  penalty: number;
  violations: Violation[];
  /** k nearest stable states */
  stableNeighbors: NeighborhoodHit[];
  /** k nearest failure states (cautionary) */
  failureNeighbors: NeighborhoodHit[];
  /** Recommended verdict */
  verdict: 'safe' | 'caution' | 'unsafe';
}

export interface NeighborhoodHit {
  snapshotId: string;
  /** stable or failure distance, lower = closer */
  distance: number;
  /** Whether stored point was stable */
  stable: boolean;
  /** Aggregate penalty of the stored point */
  penalty: number;
}

export interface StoredPhysicsState {
  vector: PhysicsStateVector;
  feasible: boolean;
  penalty: number;
  violations: Violation[];
}

export interface FindOptions {
  k?: number;
}
