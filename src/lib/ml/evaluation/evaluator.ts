/**
 * ML Evaluation Engine
 *
 * Runs model evaluation with:
 *   - Cross-validation fold analysis
 *   - Metric gate enforcement
 *   - A/B model comparison with statistical significance
 *   - Drift detection (PSI, KS, accuracy degradation)
 *
 * Design: Orchestrates calls to external Python ML services
 * via edge functions. Falls back to simulated evaluation for
 * development when backend is unavailable.
 */

import type {
  EvaluationConfig,
  EvaluationMetrics,
  EvaluationRun,
  MetricGate,
  GateResult,
  ModelComparison,
  SignificanceResult,
  DriftReport,
  DriftSeverity,
  FeatureDrift,
  PredictionDrift,
  AccuracyDrift,
  AccuracySnapshot,
  FoldResult,
} from './types';
import { DEFAULT_EVALUATION_CONFIG } from './types';

// ─── Gate Evaluation ─────────────────────────────────────────────

/**
 * Evaluate a single metric gate against actual value.
 */
export function evaluateGate(gate: MetricGate, metrics: EvaluationMetrics): GateResult {
  const metricMap: Record<string, number> = {
    mae: metrics.mae,
    mse: metrics.mse,
    rmse: metrics.rmse,
    mape: metrics.mape,
    accuracy: metrics.accuracy,
    precision: metrics.precision,
    recall: metrics.recall,
    f1: metrics.f1,
    latency_mean: metrics.latencyMean,
    latency_p50: metrics.latencyP50,
    latency_p95: metrics.latencyP95,
    latency_p99: metrics.latencyP99,
    throughput_rps: metrics.throughputRps,
  };

  const actualValue = metricMap[gate.metric] ?? 0;
  let passed = false;

  switch (gate.operator) {
    case 'lt': passed = actualValue < gate.threshold; break;
    case 'gt': passed = actualValue > gate.threshold; break;
    case 'lte': passed = actualValue <= gate.threshold; break;
    case 'gte': passed = actualValue >= gate.threshold; break;
    case 'eq': passed = Math.abs(actualValue - gate.threshold) < 1e-6; break;
  }

  return { gate, actualValue, passed };
}

/**
 * Run all gates and return results.
 */
export function evaluateAllGates(
  gates: MetricGate[],
  metrics: EvaluationMetrics,
): { results: GateResult[]; allPassed: boolean } {
  const results = gates.map((g) => evaluateGate(g, metrics));
  return {
    results,
    allPassed: results.every((r) => r.passed),
  };
}

// ─── A/B Model Comparison ────────────────────────────────────────

/**
 * Compare two models' evaluation metrics with statistical analysis.
 *
 * Uses fold-level results for paired t-test approximation when
 * cross-validation data is available; falls back to point estimates.
 */
export function compareModels(
  championMetrics: EvaluationMetrics,
  challengerMetrics: EvaluationMetrics,
  datasetId: string,
): ModelComparison {
  const deltas: Record<string, number> = {};
  const significance: Record<string, SignificanceResult> = {};

  // Compute deltas for key metrics
  const metricPairs: Array<{ key: string; champion: number; challenger: number; lowerIsBetter: boolean }> = [
    { key: 'mae', champion: championMetrics.mae, challenger: challengerMetrics.mae, lowerIsBetter: true },
    { key: 'accuracy', champion: championMetrics.accuracy, challenger: challengerMetrics.accuracy, lowerIsBetter: false },
    { key: 'f1', champion: championMetrics.f1, challenger: challengerMetrics.f1, lowerIsBetter: false },
    { key: 'latency_p95', champion: championMetrics.latencyP95, challenger: challengerMetrics.latencyP95, lowerIsBetter: true },
    { key: 'mape', champion: championMetrics.mape, challenger: challengerMetrics.mape, lowerIsBetter: true },
  ];

  let challengerWins = 0;
  let championWins = 0;

  for (const { key, champion, challenger, lowerIsBetter } of metricPairs) {
    const delta = challenger - champion;
    deltas[key] = +delta.toFixed(6);

    // Compute significance via bootstrapped confidence intervals
    const sig = computeSignificance(
      championMetrics.foldResults ?? [],
      challengerMetrics.foldResults ?? [],
      key,
    );
    significance[key] = sig;

    // Count wins
    const improved = lowerIsBetter ? delta < 0 : delta > 0;
    if (sig.significant && improved) challengerWins++;
    else if (sig.significant && !improved) championWins++;
  }

  const winner: ModelComparison['winner'] =
    challengerWins > championWins ? 'challenger' :
    championWins > challengerWins ? 'champion' : 'tie';

  const recommendation: ModelComparison['recommendation'] =
    winner === 'challenger' && challengerWins >= 2 ? 'promote' :
    winner === 'champion' ? 'reject' : 'needs_review';

  return {
    id: crypto.randomUUID(),
    championId: '', // Set by caller
    challengerId: '',
    datasetId,
    championMetrics,
    challengerMetrics,
    deltas,
    significance,
    winner,
    recommendation,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Approximate statistical significance from fold-level results.
 * Uses Welch's t-test approximation for unequal variances.
 */
function computeSignificance(
  championFolds: FoldResult[],
  challengerFolds: FoldResult[],
  metric: string,
): SignificanceResult {
  // Extract fold values for the specified metric
  const getValues = (folds: FoldResult[]): number[] =>
    folds.map((f) => {
      switch (metric) {
        case 'mae': return f.mae;
        case 'accuracy': return f.accuracy;
        case 'f1': return f.f1;
        default: return f.mae;
      }
    });

  const a = getValues(championFolds);
  const b = getValues(challengerFolds);

  if (a.length < 2 || b.length < 2) {
    // Not enough data for statistical test
    return {
      pValue: 1.0,
      significant: false,
      effectSize: 0,
      confidenceInterval: [0, 0],
    };
  }

  const meanA = mean(a);
  const meanB = mean(b);
  const varA = variance(a);
  const varB = variance(b);
  const nA = a.length;
  const nB = b.length;

  // Welch's t-statistic
  const se = Math.sqrt(varA / nA + varB / nB);
  if (se === 0) {
    return {
      pValue: 1.0,
      significant: false,
      effectSize: 0,
      confidenceInterval: [meanB - meanA, meanB - meanA],
    };
  }

  const t = (meanB - meanA) / se;

  // Approximate p-value using normal distribution (valid for df > 30)
  // For small samples, this is conservative
  const pValue = 2 * (1 - normalCDF(Math.abs(t)));

  // Cohen's d effect size
  const pooledStd = Math.sqrt((varA + varB) / 2);
  const effectSize = pooledStd > 0 ? (meanB - meanA) / pooledStd : 0;

  // 95% confidence interval for the difference
  const margin = 1.96 * se;
  const diff = meanB - meanA;

  return {
    pValue: +pValue.toFixed(6),
    significant: pValue < 0.05,
    effectSize: +effectSize.toFixed(4),
    confidenceInterval: [+(diff - margin).toFixed(6), +(diff + margin).toFixed(6)],
  };
}

// ─── Drift Detection ─────────────────────────────────────────────

/**
 * Compute Population Stability Index between two distributions.
 * PSI < 0.1 = no shift, 0.1-0.25 = moderate, > 0.25 = significant
 */
export function computePSI(
  baseline: number[],
  current: number[],
  bins = 10,
): number {
  if (baseline.length === 0 || current.length === 0) return 0;

  const min = Math.min(...baseline, ...current);
  const max = Math.max(...baseline, ...current);
  const binWidth = (max - min) / bins || 1;

  let psi = 0;
  for (let i = 0; i < bins; i++) {
    const lo = min + i * binWidth;
    const hi = lo + binWidth;

    const bCount = baseline.filter((v) => v >= lo && (i === bins - 1 ? v <= hi : v < hi)).length;
    const cCount = current.filter((v) => v >= lo && (i === bins - 1 ? v <= hi : v < hi)).length;

    const bPct = Math.max(bCount / baseline.length, 0.0001);
    const cPct = Math.max(cCount / current.length, 0.0001);

    psi += (cPct - bPct) * Math.log(cPct / bPct);
  }

  return +Math.max(0, psi).toFixed(6);
}

/**
 * Kolmogorov-Smirnov test statistic between two samples.
 */
export function computeKS(baseline: number[], current: number[]): { statistic: number; pValue: number } {
  if (baseline.length === 0 || current.length === 0) return { statistic: 0, pValue: 1 };

  const sortedA = [...baseline].sort((a, b) => a - b);
  const sortedB = [...current].sort((a, b) => a - b);

  const all = [...new Set([...sortedA, ...sortedB])].sort((a, b) => a - b);
  let maxD = 0;

  for (const x of all) {
    const cdfA = sortedA.filter((v) => v <= x).length / sortedA.length;
    const cdfB = sortedB.filter((v) => v <= x).length / sortedB.length;
    maxD = Math.max(maxD, Math.abs(cdfA - cdfB));
  }

  // Approximate p-value using asymptotic distribution
  const n = Math.sqrt((sortedA.length * sortedB.length) / (sortedA.length + sortedB.length));
  const lambda = (n + 0.12 + 0.11 / n) * maxD;
  const pValue = 2 * Math.exp(-2 * lambda * lambda);

  return {
    statistic: +maxD.toFixed(6),
    pValue: +Math.min(1, Math.max(0, pValue)).toFixed(6),
  };
}

/**
 * Classify drift severity from PSI value.
 */
export function classifyDrift(psi: number): DriftSeverity {
  if (psi < 0.05) return 'none';
  if (psi < 0.1) return 'low';
  if (psi < 0.25) return 'medium';
  if (psi < 0.5) return 'high';
  return 'critical';
}

/**
 * Build a comprehensive drift report from baseline vs current data.
 */
export function buildDriftReport(params: {
  modelId: string;
  versionId: string;
  baselineFeatures: Record<string, number[]>;
  currentFeatures: Record<string, number[]>;
  baselinePredictions: number[];
  currentPredictions: number[];
  baselineAccuracy: number;
  currentAccuracy: number;
  baselineMAE: number;
  currentMAE: number;
  windowStart: string;
  windowEnd: string;
}): DriftReport {
  // Feature drift
  const featureDrift: FeatureDrift[] = Object.keys(params.baselineFeatures).map((name) => {
    const baseline = params.baselineFeatures[name] ?? [];
    const current = params.currentFeatures[name] ?? [];
    const psi = computePSI(baseline, current);
    const ks = computeKS(baseline, current);

    return {
      featureName: name,
      psi,
      ksStatistic: ks.statistic,
      ksPValue: ks.pValue,
      severity: classifyDrift(psi),
      baselineMean: mean(baseline),
      currentMean: mean(current),
      baselineStd: Math.sqrt(variance(baseline)),
      currentStd: Math.sqrt(variance(current)),
    };
  });

  // Prediction drift
  const predPSI = computePSI(params.baselinePredictions, params.currentPredictions);
  const predictionDrift: PredictionDrift = {
    psi: predPSI,
    meanShift: mean(params.currentPredictions) - mean(params.baselinePredictions),
    varianceRatio: variance(params.currentPredictions) / Math.max(variance(params.baselinePredictions), 1e-10),
    severity: classifyDrift(predPSI),
  };

  // Accuracy drift
  const degradationPct = params.baselineAccuracy > 0
    ? ((params.baselineAccuracy - params.currentAccuracy) / params.baselineAccuracy) * 100
    : 0;
  const maeIncreasePct = params.baselineMAE > 0
    ? ((params.currentMAE - params.baselineMAE) / params.baselineMAE) * 100
    : 0;

  const accuracyDrift: AccuracyDrift = {
    baselineAccuracy: params.baselineAccuracy,
    currentAccuracy: params.currentAccuracy,
    degradationPct: +degradationPct.toFixed(2),
    baselineMAE: params.baselineMAE,
    currentMAE: params.currentMAE,
    maeIncreasePct: +maeIncreasePct.toFixed(2),
    severity: degradationPct > 10 ? 'critical' :
              degradationPct > 5 ? 'high' :
              degradationPct > 2 ? 'medium' :
              degradationPct > 0.5 ? 'low' : 'none',
  };

  // Overall severity = worst of any drift signal
  const severities: DriftSeverity[] = [
    ...featureDrift.map((f) => f.severity),
    predictionDrift.severity,
    accuracyDrift.severity,
  ];
  const severityOrder: Record<DriftSeverity, number> = { none: 0, low: 1, medium: 2, high: 3, critical: 4 };
  const overallSeverity = severities.reduce((worst, s) =>
    severityOrder[s] > severityOrder[worst] ? s : worst, 'none' as DriftSeverity);

  // Generate recommendations
  const recommendations: string[] = [];
  const driftedFeatures = featureDrift.filter((f) => severityOrder[f.severity] >= 2);
  if (driftedFeatures.length > 0) {
    recommendations.push(
      `${driftedFeatures.length} feature(s) show significant drift: ${driftedFeatures.map((f) => f.featureName).join(', ')}. Consider retraining on recent data.`,
    );
  }
  if (severityOrder[predictionDrift.severity] >= 2) {
    recommendations.push('Prediction distribution has shifted significantly. Validate model outputs against ground truth.');
  }
  if (severityOrder[accuracyDrift.severity] >= 3) {
    recommendations.push('Critical accuracy degradation detected. Immediate retraining recommended.');
  }
  if (recommendations.length === 0) {
    recommendations.push('No significant drift detected. Model performance is stable.');
  }

  return {
    id: crypto.randomUUID(),
    modelId: params.modelId,
    versionId: params.versionId,
    windowStart: params.windowStart,
    windowEnd: params.windowEnd,
    featureDrift,
    predictionDrift,
    accuracyDrift,
    overallSeverity,
    recommendations,
    createdAt: new Date().toISOString(),
  };
}

// ─── Accuracy Timeline ──────────────────────────────────────────

/**
 * Compute accuracy trend from a series of snapshots.
 * Uses exponential moving average for smoothing.
 */
export function computeAccuracyTimeline(
  snapshots: AccuracySnapshot[],
  windowSize = 5,
): AccuracySnapshot[] {
  if (snapshots.length === 0) return [];

  const sorted = [...snapshots].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );

  const alpha = 2 / (windowSize + 1);
  let ema = sorted[0].mae;

  return sorted.map((s, i) => {
    ema = i === 0 ? s.mae : alpha * s.mae + (1 - alpha) * ema;

    // Trend: compare EMA direction over last 3 points
    let trend: AccuracySnapshot['trend'] = 'stable';
    if (i >= 2) {
      const prev = sorted[i - 2].mae;
      const delta = s.mae - prev;
      trend = delta < -0.005 ? 'improving' : delta > 0.005 ? 'degrading' : 'stable';
    }

    return { ...s, maeMovingAvg: +ema.toFixed(6), trend };
  });
}

// ─── Simulated Evaluation (for dev/demo) ─────────────────────────

/**
 * Generate realistic-looking evaluation metrics for development.
 * In production, these come from the Python ML backend.
 */
export function simulateEvaluation(
  modelType: string,
  config: EvaluationConfig = DEFAULT_EVALUATION_CONFIG,
): EvaluationRun {
  const baseMAE = modelType === 'gat' ? 0.04 : modelType === 'gcn' ? 0.06 : 0.08;
  const baseAcc = modelType === 'gat' ? 0.93 : modelType === 'gcn' ? 0.89 : 0.85;
  const noise = () => (Math.random() - 0.5) * 0.02;

  const mae = +(baseMAE + noise()).toFixed(4);
  const accuracy = +Math.min(0.99, baseAcc + noise()).toFixed(4);
  const f1 = +(accuracy * (0.95 + Math.random() * 0.05)).toFixed(4);
  const latency = +(8 + Math.random() * 30).toFixed(1);

  const foldResults: FoldResult[] = Array.from({ length: config.crossValidationFolds }, (_, i) => ({
    fold: i + 1,
    mae: +(mae + (Math.random() - 0.5) * 0.01).toFixed(4),
    accuracy: +(accuracy + (Math.random() - 0.5) * 0.02).toFixed(4),
    f1: +(f1 + (Math.random() - 0.5) * 0.015).toFixed(4),
    sampleCount: 100 + Math.floor(Math.random() * 50),
  }));

  const metrics: EvaluationMetrics = {
    mae,
    mse: +(mae * mae * (1 + Math.random() * 0.3)).toFixed(6),
    rmse: +Math.sqrt(mae * mae * 1.15).toFixed(5),
    mape: +(mae * 100 * (1 + Math.random() * 0.2)).toFixed(2),
    accuracy,
    precision: +(accuracy * (0.96 + Math.random() * 0.04)).toFixed(4),
    recall: +(accuracy * (0.92 + Math.random() * 0.08)).toFixed(4),
    f1,
    latencyMean: latency,
    latencyP50: +(latency * 0.82).toFixed(1),
    latencyP95: +(latency * 1.9).toFixed(1),
    latencyP99: +(latency * 2.8).toFixed(1),
    throughputRps: +(1000 / latency).toFixed(1),
    foldResults,
  };

  return {
    id: crypto.randomUUID(),
    modelVersionId: '',
    datasetId: 'eval-set-v1',
    status: 'completed',
    metrics,
    config,
    startedAt: new Date(Date.now() - 60000).toISOString(),
    completedAt: new Date().toISOString(),
    createdAt: new Date(Date.now() - 120000).toISOString(),
  };
}

// ─── Math Utilities ──────────────────────────────────────────────

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function variance(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  return values.reduce((s, v) => s + (v - m) ** 2, 0) / (values.length - 1);
}

/**
 * Standard normal CDF approximation (Abramowitz & Stegun).
 */
function normalCDF(x: number): number {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x) / Math.SQRT2;

  const t = 1.0 / (1.0 + p * x);
  const y = 1.0 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);

  return 0.5 * (1.0 + sign * y);
}
