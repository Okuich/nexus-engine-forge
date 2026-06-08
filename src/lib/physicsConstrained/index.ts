/**
 * Physics-Constrained Metric Space — Public API
 *
 * Embeds physical feasibility (stress, strain, thermal, vibration,
 * flow, fatigue) directly into distance calculations so similarity
 * queries never recommend physically impossible states.
 *
 * Integrates with the Physics OS simulation engine (FEA + CFD).
 */

export {
  PhysicsConstrainedEngine,
  getPhysicsConstrainedEngine,
  evaluatePhysicalFeasibility,
} from './engine';

export { PhysicsNeighborhoodStore } from './neighborhoodStore';
export { evaluateViolations } from './feasibility';
export {
  vectorDistance,
  feasibilityDistance,
  stableDistance,
  failureDistance,
} from './distance';
export { extractRaw, normalize } from './normalizer';
export { PHYSICS_DIMENSIONS, PHYSICS_VECTOR_DIM } from './types';

export type {
  PhysicsSnapshot,
  PhysicsStateVector,
  StressState,
  StrainState,
  ThermalState,
  VibrationState,
  FlowState,
  MaterialProperties,
  FatigueEstimate,
  Violation,
  ViolationKind,
  FeasibilityResult,
  NeighborhoodHit,
  StoredPhysicsState,
  PhysicsDimension,
  FindOptions,
} from './types';
