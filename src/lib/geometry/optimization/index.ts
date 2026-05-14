/**
 * Geometry Optimization Engine — public API.
 *
 *   • Suggests geometry modifications (thicken / fillet / draft / hollow)
 *   • Suggests manufacturability improvements (process-specific DFM)
 *   • Integrates physics constraints (safety factor, min wall, peak load)
 *   • Integrates cost constraints (material, process rate, tooling, target cost)
 *   • Real-time: time-budgeted (~100ms) iterative rule pipeline
 */
export { optimizeGeometry } from './optimizer';
export { computeBaseline, computeVolume, computeSurfaceArea, estimateUnitCost, estimateSafetyFactor } from './baseline';
export type { BaselineMetrics } from './baseline';
export {
  MATERIAL_DB,
  PROCESS_RATE_USD_PER_CM3,
  PROCESS_TOOLING_USD,
  PROCESS_MIN_WALL_MM,
  PROCESS_MIN_DRAFT_DEG,
} from './materials';
export {
  ruleWallThickness,
  ruleFillets,
  ruleDraftAngle,
  ruleHollowing,
  ruleMaterialSwap,
  ruleFeatureConsolidation,
} from './dfmRules';
export type {
  ManufacturingProcess,
  Material,
  MaterialProps,
  PhysicsConstraints,
  CostConstraints,
  OptimizationContext,
  Suggestion,
  SuggestionCategory,
  Severity,
  GeometryPatch,
  OptimizationReport,
  OptimizerOptions,
} from './types';
