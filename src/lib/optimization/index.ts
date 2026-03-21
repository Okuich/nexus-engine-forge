/**
 * Geometry Optimization Engine — Public API
 */

export { runOptimization } from './engine';
export { ALL_GENERATORS, getEnabledGenerators } from './generators';
export type {
  OptimizationConfig,
  OptimizationResult,
  OptimizationCandidate,
  Modification,
  ModificationType,
  FeatureDelta,
  SavingsSummary,
  CandidateGenerator,
} from './types';
export { DEFAULT_OPTIMIZATION_CONFIG } from './types';
