/**
 * ML Evaluation Pipeline — Public API
 */

export {
  evaluateGate,
  evaluateAllGates,
  compareModels,
  computePSI,
  computeKS,
  classifyDrift,
  buildDriftReport,
  computeAccuracyTimeline,
  simulateEvaluation,
} from './evaluator';

export {
  registerModel,
  addModelVersion,
  promoteVersion,
  getModel,
  listModels,
  getProductionVersion,
} from './registry';

export type {
  EvaluationRun,
  EvaluationConfig,
  EvaluationMetrics,
  EvaluationStatus,
  MetricName,
  MetricGate,
  GateResult,
  FoldResult,
  ConfusionMatrixEntry,
  ModelComparison,
  SignificanceResult,
  RegisteredModel,
  ModelVersionEntry,
  ModelStage,
  PromotionRequest,
  PromotionResult,
  DriftReport,
  DriftSeverity,
  FeatureDrift,
  PredictionDrift,
  AccuracyDrift,
  AccuracySnapshot,
} from './types';

export { DEFAULT_EVALUATION_CONFIG } from './types';
