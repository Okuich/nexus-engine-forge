/**
 * ML Evaluation Pipeline — Type Definitions
 *
 * Covers: model evaluation, A/B comparison, drift detection,
 * model registry with promotion workflow, and accuracy tracking.
 */

// ─── Evaluation Run ──────────────────────────────────────────────

export type EvaluationStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface EvaluationRun {
  id: string;
  modelVersionId: string;
  datasetId: string;
  status: EvaluationStatus;
  metrics: EvaluationMetrics;
  config: EvaluationConfig;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  error?: string;
}

export interface EvaluationConfig {
  /** Stratified splits for robust evaluation */
  crossValidationFolds: number;
  /** Holdout test set percentage */
  testSplitPct: number;
  /** Metrics to track */
  metricsToTrack: MetricName[];
  /** Threshold gates — fail if metric breaches */
  gates: MetricGate[];
  /** Max evaluation time in ms */
  timeoutMs: number;
}

export const DEFAULT_EVALUATION_CONFIG: EvaluationConfig = {
  crossValidationFolds: 5,
  testSplitPct: 0.2,
  metricsToTrack: ['mae', 'mape', 'accuracy', 'f1', 'latency_p95'],
  gates: [
    { metric: 'mae', operator: 'lt', threshold: 0.10, label: 'MAE < 10%' },
    { metric: 'accuracy', operator: 'gt', threshold: 0.85, label: 'Accuracy > 85%' },
    { metric: 'latency_p95', operator: 'lt', threshold: 100, label: 'P95 < 100ms' },
  ],
  timeoutMs: 300_000,
};

// ─── Metrics ─────────────────────────────────────────────────────

export type MetricName =
  | 'mae' | 'mse' | 'rmse' | 'mape'
  | 'accuracy' | 'precision' | 'recall' | 'f1'
  | 'latency_mean' | 'latency_p50' | 'latency_p95' | 'latency_p99'
  | 'throughput_rps';

export interface EvaluationMetrics {
  mae: number;
  mse: number;
  rmse: number;
  mape: number;
  accuracy: number;
  precision: number;
  recall: number;
  f1: number;
  latencyMean: number;
  latencyP50: number;
  latencyP95: number;
  latencyP99: number;
  throughputRps: number;
  /** Per-fold results for cross-validation */
  foldResults?: FoldResult[];
  /** Confusion matrix entries */
  confusionMatrix?: ConfusionMatrixEntry[];
}

export interface FoldResult {
  fold: number;
  mae: number;
  accuracy: number;
  f1: number;
  sampleCount: number;
}

export interface ConfusionMatrixEntry {
  predicted: string;
  actual: string;
  count: number;
}

// ─── Metric Gates (Quality Checks) ──────────────────────────────

export interface MetricGate {
  metric: MetricName;
  operator: 'lt' | 'gt' | 'lte' | 'gte' | 'eq';
  threshold: number;
  label: string;
}

export interface GateResult {
  gate: MetricGate;
  actualValue: number;
  passed: boolean;
}

// ─── A/B Model Comparison ────────────────────────────────────────

export interface ModelComparison {
  id: string;
  championId: string;
  challengerId: string;
  datasetId: string;
  championMetrics: EvaluationMetrics;
  challengerMetrics: EvaluationMetrics;
  /** Per-metric delta (challenger - champion) */
  deltas: Record<string, number>;
  /** Statistical significance per metric */
  significance: Record<string, SignificanceResult>;
  winner: 'champion' | 'challenger' | 'tie';
  recommendation: 'promote' | 'reject' | 'needs_review';
  createdAt: string;
}

export interface SignificanceResult {
  pValue: number;
  significant: boolean;
  effectSize: number;
  confidenceInterval: [number, number];
}

// ─── Model Registry ─────────────────────────────────────────────

export type ModelStage = 'development' | 'staging' | 'production' | 'archived';

export interface RegisteredModel {
  id: string;
  name: string;
  description: string;
  modelType: string;
  /** Current active version per stage */
  stages: Record<ModelStage, string | null>;
  versions: ModelVersionEntry[];
  createdAt: string;
  updatedAt: string;
}

export interface ModelVersionEntry {
  versionId: string;
  version: string;
  stage: ModelStage;
  metrics: EvaluationMetrics | null;
  gateResults: GateResult[];
  /** All gates passed? */
  gatesPassed: boolean;
  artifactPath: string | null;
  promotedAt: string | null;
  promotedBy: string | null;
  createdAt: string;
}

export interface PromotionRequest {
  modelId: string;
  versionId: string;
  fromStage: ModelStage;
  toStage: ModelStage;
  /** Require all gates to pass for production promotion */
  requireGates: boolean;
  /** Run A/B comparison against current production model */
  requireComparison: boolean;
}

export interface PromotionResult {
  success: boolean;
  versionId: string;
  fromStage: ModelStage;
  toStage: ModelStage;
  gateResults: GateResult[];
  comparison?: ModelComparison;
  reason?: string;
}

// ─── Drift Detection ────────────────────────────────────────────

export type DriftSeverity = 'none' | 'low' | 'medium' | 'high' | 'critical';

export interface DriftReport {
  id: string;
  modelId: string;
  versionId: string;
  /** Time window analyzed */
  windowStart: string;
  windowEnd: string;
  /** Input feature drift (PSI or KS test) */
  featureDrift: FeatureDrift[];
  /** Output prediction drift */
  predictionDrift: PredictionDrift;
  /** Accuracy degradation vs baseline */
  accuracyDrift: AccuracyDrift;
  overallSeverity: DriftSeverity;
  recommendations: string[];
  createdAt: string;
}

export interface FeatureDrift {
  featureName: string;
  /** Population Stability Index */
  psi: number;
  /** Kolmogorov-Smirnov statistic */
  ksStatistic: number;
  ksPValue: number;
  severity: DriftSeverity;
  baselineMean: number;
  currentMean: number;
  baselineStd: number;
  currentStd: number;
}

export interface PredictionDrift {
  psi: number;
  meanShift: number;
  varianceRatio: number;
  severity: DriftSeverity;
}

export interface AccuracyDrift {
  baselineAccuracy: number;
  currentAccuracy: number;
  degradationPct: number;
  baselineMAE: number;
  currentMAE: number;
  maeIncreasePct: number;
  severity: DriftSeverity;
}

// ─── Accuracy Timeline ──────────────────────────────────────────

export interface AccuracySnapshot {
  timestamp: string;
  modelId: string;
  versionId: string;
  mae: number;
  accuracy: number;
  f1: number;
  sampleCount: number;
  /** Moving average MAE over last N snapshots */
  maeMovingAvg: number;
  /** Trend direction */
  trend: 'improving' | 'stable' | 'degrading';
}
