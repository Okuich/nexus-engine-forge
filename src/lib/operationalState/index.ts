/**
 * Operational State Metric Space — Public API
 *
 * Represents every operational snapshot of a Midwater facility as a
 * point in a 32-D normalized metric space, enabling sub-100ms
 * retrieval of similar historical situations along with their
 * outcomes, interventions, and performance metrics.
 */

export {
  OperationalStateEngine,
  getOperationalStateEngine,
  findSimilarStates,
} from './engine';
export type { IngestOptions } from './engine';

export { OperationalVectorStore } from './vectorStore';
export type { VectorStoreOptions } from './vectorStore';

export {
  euclideanDistance,
  cosineDistance,
  mahalanobisDistance,
  toSimilarity,
} from './distance';

export {
  defaultStats,
  extractRawFeatures,
  normalize,
  updateStats,
} from './normalizer';
export type { NormalizerStats } from './normalizer';

export {
  STATE_DIMENSIONS,
  VECTOR_DIM,
} from './types';
export type {
  MachineState,
  ProductionQueue,
  MaterialInventory,
  ToolUtilization,
  ThroughputMetrics,
  DowntimeMetrics,
  EnergyConsumption,
  OrderBacklog,
  QualityMetrics,
  DemandSignals,
  OperationalSnapshot,
  OperationalStateVector,
  StateOutcome,
  StateIntervention,
  StatePerformanceMetrics,
  StoredOperationalState,
  DistanceMetric,
  NearestNeighborResult,
  FindSimilarOptions,
  StateDimension,
} from './types';
