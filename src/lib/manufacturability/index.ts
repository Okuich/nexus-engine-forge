/**
 * Manufacturability Metric Space — Public API
 *
 * Represents CAD parts/assemblies as points in a 34-D
 * manufacturability space, scores them across CNC, injection
 * molding, additive, sheet-metal and casting, and retrieves the
 * nearest manufacturable neighbors.
 */

export {
  ManufacturabilityEngine,
  getManufacturabilityEngine,
  evaluateManufacturability,
} from './engine';

export { ManufacturabilityStore } from './store';
export { scoreProcess } from './processScorer';

export {
  geometricDistance,
  geometricSimilarity,
  difficultyDistance,
  difficultyIndex,
} from './distance';

export {
  extractRaw,
  normalize,
  difficultyWeightVector,
  DIFFICULTY_WEIGHTS,
} from './normalizer';

export {
  FABRICATION_PROCESSES,
  MFG_DIMENSIONS,
  MFG_VECTOR_DIM,
} from './types';

export type {
  CadModel,
  FeatureCounts,
  ToleranceProfile,
  SurfaceComplexity,
  WallThicknessProfile,
  MaterialSelection,
  ToolAccessibility,
  AssemblyComplexity,
  TopologicalComplexity,
  ManufacturabilityVector,
  ManufacturabilityEvaluation,
  ProcessScore,
  SimilarPart,
  DifficultyExplanation,
  StoredManufacturablePart,
  FabricationProcess,
  MfgDimension,
  DistanceMetric,
  NearestNeighborOptions,
} from './types';
