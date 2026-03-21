/**
 * Model Registry — Version Management & Promotion Workflow
 *
 * Manages the lifecycle of ML models through stages:
 *   development → staging → production → archived
 *
 * Integrates with:
 *   - Evaluation engine for gate enforcement
 *   - A/B comparison for production promotions
 *   - Drift detection for monitoring
 */

import type {
  RegisteredModel,
  ModelVersionEntry,
  ModelStage,
  PromotionRequest,
  PromotionResult,
  GateResult,
  ModelComparison,
  EvaluationMetrics,
} from './types';
import { DEFAULT_EVALUATION_CONFIG } from './types';
import { evaluateAllGates, compareModels, simulateEvaluation } from './evaluator';

// ─── In-Memory Registry (production: backed by Supabase) ────────

const registry = new Map<string, RegisteredModel>();

/**
 * Register a new model in the registry.
 */
export function registerModel(params: {
  name: string;
  description: string;
  modelType: string;
}): RegisteredModel {
  const model: RegisteredModel = {
    id: crypto.randomUUID(),
    name: params.name,
    description: params.description,
    modelType: params.modelType,
    stages: {
      development: null,
      staging: null,
      production: null,
      archived: null,
    },
    versions: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  registry.set(model.id, model);
  return model;
}

/**
 * Add a model version to the registry.
 */
export function addModelVersion(params: {
  modelId: string;
  versionId: string;
  version: string;
  metrics: EvaluationMetrics | null;
  artifactPath: string | null;
}): ModelVersionEntry {
  const model = registry.get(params.modelId);
  if (!model) throw new Error(`Model ${params.modelId} not found`);

  // Evaluate gates if metrics are available
  let gateResults: GateResult[] = [];
  let gatesPassed = false;
  if (params.metrics) {
    const evaluation = evaluateAllGates(DEFAULT_EVALUATION_CONFIG.gates, params.metrics);
    gateResults = evaluation.results;
    gatesPassed = evaluation.allPassed;
  }

  const entry: ModelVersionEntry = {
    versionId: params.versionId,
    version: params.version,
    stage: 'development',
    metrics: params.metrics,
    gateResults,
    gatesPassed,
    artifactPath: params.artifactPath,
    promotedAt: null,
    promotedBy: null,
    createdAt: new Date().toISOString(),
  };

  model.versions.push(entry);
  model.stages.development = params.versionId;
  model.updatedAt = new Date().toISOString();

  return entry;
}

/**
 * Promote a model version to a higher stage.
 *
 * Promotion to production enforces:
 *   1. All metric gates must pass (if requireGates=true)
 *   2. A/B comparison must favor challenger (if requireComparison=true)
 *
 * Returns detailed result with gate/comparison outcomes.
 */
export function promoteVersion(req: PromotionRequest): PromotionResult {
  const model = registry.get(req.modelId);
  if (!model) throw new Error(`Model ${req.modelId} not found`);

  const version = model.versions.find((v) => v.versionId === req.versionId);
  if (!version) throw new Error(`Version ${req.versionId} not found`);

  // Validate stage transition
  const validTransitions: Record<ModelStage, ModelStage[]> = {
    development: ['staging'],
    staging: ['production', 'development'],
    production: ['archived'],
    archived: ['development'],
  };

  if (!validTransitions[req.fromStage]?.includes(req.toStage)) {
    return {
      success: false,
      versionId: req.versionId,
      fromStage: req.fromStage,
      toStage: req.toStage,
      gateResults: version.gateResults,
      reason: `Invalid stage transition: ${req.fromStage} → ${req.toStage}`,
    };
  }

  // Gate check for production promotions
  if (req.requireGates && req.toStage === 'production') {
    if (!version.metrics) {
      return {
        success: false,
        versionId: req.versionId,
        fromStage: req.fromStage,
        toStage: req.toStage,
        gateResults: [],
        reason: 'Cannot promote to production without evaluation metrics',
      };
    }

    const gateEval = evaluateAllGates(DEFAULT_EVALUATION_CONFIG.gates, version.metrics);
    if (!gateEval.allPassed) {
      const failed = gateEval.results.filter((r) => !r.passed);
      return {
        success: false,
        versionId: req.versionId,
        fromStage: req.fromStage,
        toStage: req.toStage,
        gateResults: gateEval.results,
        reason: `Failed gates: ${failed.map((f) => f.gate.label).join(', ')}`,
      };
    }
  }

  // A/B comparison for production promotions
  let comparison: ModelComparison | undefined;
  if (req.requireComparison && req.toStage === 'production' && model.stages.production) {
    const currentProdVersion = model.versions.find(
      (v) => v.versionId === model.stages.production,
    );

    if (currentProdVersion?.metrics && version.metrics) {
      comparison = compareModels(
        currentProdVersion.metrics,
        version.metrics,
        'production-eval-set',
      );
      comparison.championId = currentProdVersion.versionId;
      comparison.challengerId = version.versionId;

      if (comparison.recommendation === 'reject') {
        return {
          success: false,
          versionId: req.versionId,
          fromStage: req.fromStage,
          toStage: req.toStage,
          gateResults: version.gateResults,
          comparison,
          reason: 'A/B comparison favors current production model',
        };
      }
    }
  }

  // Execute promotion
  version.stage = req.toStage;
  version.promotedAt = new Date().toISOString();
  model.stages[req.toStage] = req.versionId;

  // Archive previous version in this stage (if production)
  if (req.toStage === 'production') {
    for (const v of model.versions) {
      if (v.versionId !== req.versionId && v.stage === 'production') {
        v.stage = 'archived';
        model.stages.archived = v.versionId;
      }
    }
  }

  model.updatedAt = new Date().toISOString();

  return {
    success: true,
    versionId: req.versionId,
    fromStage: req.fromStage,
    toStage: req.toStage,
    gateResults: version.gateResults,
    comparison,
  };
}

/**
 * Get a registered model by ID.
 */
export function getModel(modelId: string): RegisteredModel | undefined {
  return registry.get(modelId);
}

/**
 * List all registered models.
 */
export function listModels(): RegisteredModel[] {
  return Array.from(registry.values());
}

/**
 * Get the production version for a model.
 */
export function getProductionVersion(modelId: string): ModelVersionEntry | null {
  const model = registry.get(modelId);
  if (!model || !model.stages.production) return null;
  return model.versions.find((v) => v.versionId === model.stages.production) ?? null;
}
