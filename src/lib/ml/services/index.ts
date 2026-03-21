/**
 * ML Accuracy Orchestration Layer — Public API
 *
 * Exports the three core services:
 *   - ModelManager: multi-version model registry & selection
 *   - EnsembleEngine: parallel multi-model inference with aggregation
 *   - EvaluationService: metrics tracking, feedback loop, retraining signals
 */

export { ModelManager, modelManager } from './mlManager';
export type {
  ManagedModel,
  ModelMetricsSnapshot,
  ModelSelectionResult,
  SelectionStrategy,
} from './mlManager';

export { runEnsemble } from './ensembleEngine';
export type {
  EnsemblePrediction,
  EnsembleConfig,
  ModelPrediction,
  AggregationMethod,
} from './ensembleEngine';

export { EvaluationService, evaluationService } from './evaluation';
export type {
  EvaluationEntry,
  FeedbackInput,
  ModelStats,
  RetrainingSignal,
} from './evaluation';
