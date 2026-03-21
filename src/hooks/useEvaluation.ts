/**
 * useEvaluation — React hook for ML evaluation pipeline.
 *
 * Provides: evaluation runs, model comparison, drift detection,
 * model registry, and promotion workflows.
 */

import { useState, useCallback } from 'react';
import {
  simulateEvaluation,
  compareModels,
  evaluateAllGates,
  buildDriftReport,
  computeAccuracyTimeline,
  registerModel,
  addModelVersion,
  promoteVersion,
  listModels,
  getProductionVersion,
  DEFAULT_EVALUATION_CONFIG,
} from '@/lib/ml/evaluation';
import type {
  EvaluationRun,
  EvaluationConfig,
  ModelComparison,
  DriftReport,
  AccuracySnapshot,
  RegisteredModel,
  PromotionRequest,
  PromotionResult,
  GateResult,
} from '@/lib/ml/evaluation';

interface UseEvaluationReturn {
  // State
  evaluations: EvaluationRun[];
  comparisons: ModelComparison[];
  driftReports: DriftReport[];
  accuracyTimeline: AccuracySnapshot[];
  models: RegisteredModel[];
  loading: boolean;
  error: string | null;

  // Actions
  runEvaluation: (modelType: string, config?: EvaluationConfig) => EvaluationRun;
  runComparison: (championType: string, challengerType: string) => ModelComparison;
  runDriftCheck: (modelId: string, versionId: string) => DriftReport;
  registerNewModel: (name: string, description: string, modelType: string) => RegisteredModel;
  promote: (req: PromotionRequest) => PromotionResult;
  refreshModels: () => void;
  clearError: () => void;
}

export function useEvaluation(): UseEvaluationReturn {
  const [evaluations, setEvaluations] = useState<EvaluationRun[]>([]);
  const [comparisons, setComparisons] = useState<ModelComparison[]>([]);
  const [driftReports, setDriftReports] = useState<DriftReport[]>([]);
  const [accuracyTimeline, setAccuracyTimeline] = useState<AccuracySnapshot[]>([]);
  const [models, setModels] = useState<RegisteredModel[]>(listModels());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runEvaluation = useCallback((modelType: string, config?: EvaluationConfig) => {
    const evaluation = simulateEvaluation(modelType, config ?? DEFAULT_EVALUATION_CONFIG);
    setEvaluations((prev) => [evaluation, ...prev]);

    // Add to accuracy timeline
    const snapshot: AccuracySnapshot = {
      timestamp: evaluation.completedAt ?? new Date().toISOString(),
      modelId: modelType,
      versionId: evaluation.modelVersionId,
      mae: evaluation.metrics.mae,
      accuracy: evaluation.metrics.accuracy,
      f1: evaluation.metrics.f1,
      sampleCount: evaluation.metrics.foldResults?.reduce((s, f) => s + f.sampleCount, 0) ?? 0,
      maeMovingAvg: evaluation.metrics.mae,
      trend: 'stable',
    };

    setAccuracyTimeline((prev) => {
      const updated = [...prev, snapshot];
      return computeAccuracyTimeline(updated);
    });

    return evaluation;
  }, []);

  const runComparison = useCallback((championType: string, challengerType: string) => {
    const champEval = simulateEvaluation(championType);
    const challEval = simulateEvaluation(challengerType);

    const comparison = compareModels(champEval.metrics, challEval.metrics, 'eval-set-v1');
    comparison.championId = championType;
    comparison.challengerId = challengerType;

    setComparisons((prev) => [comparison, ...prev]);
    return comparison;
  }, []);

  const runDriftCheck = useCallback((modelId: string, versionId: string) => {
    // Simulate baseline vs current feature distributions
    const generateDist = (mean: number, std: number, n: number) =>
      Array.from({ length: n }, () => mean + std * (Math.random() * 2 - 1));

    const featureNames = ['area', 'curvature_max', 'curvature_mean', 'normal_z', 'complexity'];
    const baselineFeatures: Record<string, number[]> = {};
    const currentFeatures: Record<string, number[]> = {};

    for (const name of featureNames) {
      const baseMean = Math.random() * 10;
      const drift = Math.random() > 0.7 ? Math.random() * 3 : 0;
      baselineFeatures[name] = generateDist(baseMean, 2, 500);
      currentFeatures[name] = generateDist(baseMean + drift, 2 + drift * 0.5, 500);
    }

    const report = buildDriftReport({
      modelId,
      versionId,
      baselineFeatures,
      currentFeatures,
      baselinePredictions: generateDist(75, 10, 500),
      currentPredictions: generateDist(73 + Math.random() * 5, 12, 500),
      baselineAccuracy: 0.92,
      currentAccuracy: 0.88 + Math.random() * 0.06,
      baselineMAE: 0.045,
      currentMAE: 0.045 + Math.random() * 0.025,
      windowStart: new Date(Date.now() - 7 * 86400000).toISOString(),
      windowEnd: new Date().toISOString(),
    });

    setDriftReports((prev) => [report, ...prev]);
    return report;
  }, []);

  const registerNewModel = useCallback((name: string, description: string, modelType: string) => {
    const model = registerModel({ name, description, modelType });
    setModels(listModels());
    return model;
  }, []);

  const promote = useCallback((req: PromotionRequest) => {
    const result = promoteVersion(req);
    setModels(listModels());
    return result;
  }, []);

  const refreshModels = useCallback(() => {
    setModels(listModels());
  }, []);

  return {
    evaluations,
    comparisons,
    driftReports,
    accuracyTimeline,
    models,
    loading,
    error,
    runEvaluation,
    runComparison,
    runDriftCheck,
    registerNewModel,
    promote,
    refreshModels,
    clearError: () => setError(null),
  };
}
