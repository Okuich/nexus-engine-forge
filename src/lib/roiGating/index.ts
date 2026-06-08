/**
 * ROI Gating — Public API
 *
 * Unified facade over the five metric-space capabilities that
 * enforces the strict priority order:
 *
 *   1. Operational State Space
 *   2. Manufacturability Space
 *   3. Physics-Constrained Space
 *   4. Optimization Geometry
 *   5. Autonomous Navigation
 */

export { RoiGatingEngine, getRoiGatingEngine, evaluateRoi, CAPABILITY_ORDER } from './engine';
export type {
  CapabilityDescriptor,
  CapabilityId,
  Difficulty,
  GatePayload,
  GatedRecommendation,
  RoiGateInputs,
  RoiGateOptions,
  RoiGateResult,
  RoiTier,
} from './types';
