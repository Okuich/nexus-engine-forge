/**
 * Midwater Real-Time Inference Engine
 *
 * Unified inference service that:
 *   1. Accepts GeometryFeatureSet as input
 *   2. Calls Python ML backend via edge function
 *   3. Falls back to rule-based estimation on failure
 *   4. Generates human-readable explanations
 *   5. Returns cost, manufacturability, risks, and explanations
 *
 * Architecture:
 *   GeometryFeatureSet
 *        │
 *        ├─→ ML Backend (/predict) ──┐
 *        │                           ├─→ Fusion Layer ──→ ExplainedAssessment
 *        └─→ Rule Engine (fallback) ─┘
 *
 * Constraints: <5s response, production error handling
 */

import { supabase } from '@/integrations/supabase/client';
import type { GeometryFeatureSet, GeometryStats, SurfaceClass } from '@/lib/geometry/types';
import { estimateCost, MATERIALS, PROCESSES } from './costEngine';
import type { CostBreakdown } from './costEngine';

// ─── Response Types ──────────────────────────────────────────────

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

export interface RiskRegion {
  faceIndex: number;
  severity: RiskLevel;
  category: string;
  description: string;
}

export interface Explanation {
  /** One-line summary for the assessment */
  summary: string;
  /** Feature-to-outcome attributions */
  attributions: Attribution[];
  /** Actionable recommendations */
  recommendations: Recommendation[];
  /** Rule violations detected */
  violations: Violation[];
}

export interface Attribution {
  feature: string;
  impact: 'positive' | 'negative' | 'neutral';
  contribution: number;
  description: string;
}

export interface Recommendation {
  priority: 'critical' | 'high' | 'medium' | 'low';
  category: string;
  action: string;
  estimatedImpact: string;
}

export interface Violation {
  rule: string;
  severity: RiskLevel;
  detail: string;
  faceIndices: number[];
}

export interface ExplainedAssessment {
  /** Unique assessment ID */
  assessmentId: string;
  /** ISO timestamp */
  timestamp: string;
  /** Overall manufacturability score (0–100) */
  manufacturabilityScore: number;
  /** Estimated manufacturing cost */
  costUsd: number;
  /** Detailed cost breakdown */
  costBreakdown: CostBreakdown;
  /** Overall risk level */
  riskLevel: RiskLevel;
  /** Per-region risk details */
  riskRegions: RiskRegion[];
  /** Human-readable explanations */
  explanation: Explanation;
  /** Confidence in this assessment (0–1) */
  confidence: number;
  /** Which engine produced the result */
  source: 'ml' | 'rules' | 'hybrid';
  /** Total latency in ms */
  latencyMs: number;
  /** Input metadata for reproducibility */
  inputs: {
    material: string;
    process: string;
    faceCount: number;
    edgeCount: number;
    complexityScore: number;
  };
}

export interface InferenceRequest {
  features: GeometryFeatureSet;
  materialId: string;
  processId: string;
  /** Timeout in ms (default 4500) */
  timeoutMs?: number;
  /** Skip ML backend, use rules only */
  rulesOnly?: boolean;
}

// ─── Rule-Based Engine ───────────────────────────────────────────

interface RuleResult {
  score: number;
  risks: RiskRegion[];
  violations: Violation[];
  attributions: Attribution[];
}

function runRuleEngine(features: GeometryFeatureSet, materialId: string): RuleResult {
  const stats = features.stats;
  const faces = features.faces;
  const risks: RiskRegion[] = [];
  const violations: Violation[] = [];
  const attributions: Attribution[] = [];

  let score = 92; // Start optimistic

  // ── Complexity penalty ────────────────────────────
  const complexityPenalty = stats.complexityScore * 25;
  score -= complexityPenalty;
  if (stats.complexityScore > 0.3) {
    attributions.push({
      feature: 'Geometric complexity',
      impact: 'negative',
      contribution: -complexityPenalty,
      description: `Complexity score ${stats.complexityScore.toFixed(3)} exceeds threshold (0.3)`,
    });
  }

  // ── Surface class analysis ────────────────────────
  const dist = stats.surfaceClassDistribution;
  const totalFaces = stats.totalFaces || 1;
  const freeformRatio = (dist.freeform ?? 0) / totalFaces;
  const toroidalRatio = (dist.toroidal ?? 0) / totalFaces;

  if (freeformRatio > 0.2) {
    const penalty = freeformRatio * 15;
    score -= penalty;
    attributions.push({
      feature: 'Freeform surfaces',
      impact: 'negative',
      contribution: -penalty,
      description: `${(freeformRatio * 100).toFixed(0)}% freeform surfaces require 5-axis machining`,
    });
  }

  if (toroidalRatio > 0.1) {
    score -= toroidalRatio * 8;
  }

  const planarRatio = (dist.planar ?? 0) / totalFaces;
  if (planarRatio > 0.6) {
    const bonus = planarRatio * 5;
    score += bonus;
    attributions.push({
      feature: 'Planar dominance',
      impact: 'positive',
      contribution: bonus,
      description: `${(planarRatio * 100).toFixed(0)}% planar faces — well-suited for 3-axis milling`,
    });
  }

  // ── Curvature analysis (per-face risk detection) ──
  const highCurvThreshold = 0.25;
  const thinWallFaces: number[] = [];
  const highCurvFaces: number[] = [];

  for (const face of faces) {
    if (face.curvatureMax > highCurvThreshold) {
      highCurvFaces.push(face.id);
      if (highCurvFaces.length <= 5) {
        risks.push({
          faceIndex: face.id,
          severity: face.curvatureMax > 0.5 ? 'high' : 'medium',
          category: 'curvature',
          description: `Face ${face.id}: max curvature ${face.curvatureMax.toFixed(3)} — tight radius may require EDM or slow feed`,
        });
      }
    }

    // Thin wall proxy: high mean curvature + small area
    if (face.curvatureMean > 0.3 && face.area < stats.totalArea / totalFaces * 0.5) {
      thinWallFaces.push(face.id);
    }
  }

  if (highCurvFaces.length > 0) {
    const penalty = Math.min(15, highCurvFaces.length * 2);
    score -= penalty;
    violations.push({
      rule: 'MIN_RADIUS',
      severity: highCurvFaces.length > 3 ? 'high' : 'medium',
      detail: `${highCurvFaces.length} face(s) with curvature > ${highCurvThreshold} — may violate minimum radius constraints`,
      faceIndices: highCurvFaces.slice(0, 10),
    });
  }

  if (thinWallFaces.length > 0) {
    const penalty = Math.min(12, thinWallFaces.length * 3);
    score -= penalty;
    violations.push({
      rule: 'MIN_WALL_THICKNESS',
      severity: thinWallFaces.length > 2 ? 'high' : 'medium',
      detail: `${thinWallFaces.length} potential thin-wall region(s) detected`,
      faceIndices: thinWallFaces.slice(0, 10),
    });
    risks.push(...thinWallFaces.slice(0, 3).map(i => ({
      faceIndex: i,
      severity: 'high' as RiskLevel,
      category: 'thin_wall',
      description: `Face ${i}: potential thin wall — increase thickness to ≥1.5mm`,
    })));
  }

  // ── Connected components ──────────────────────────
  if (stats.connectedComponents > 1) {
    const penalty = stats.connectedComponents * 3;
    score -= penalty;
    violations.push({
      rule: 'SINGLE_BODY',
      severity: 'medium',
      detail: `Mesh has ${stats.connectedComponents} disconnected components — may require multiple setups`,
      faceIndices: [],
    });
  }

  // ── Material difficulty ───────────────────────────
  const material = MATERIALS[materialId];
  if (material && material.toolWearFactor > 0.6) {
    const penalty = material.toolWearFactor * 8;
    score -= penalty;
    attributions.push({
      feature: 'Material difficulty',
      impact: 'negative',
      contribution: -penalty,
      description: `${material.name} has tool wear factor ${material.toolWearFactor} — increases machining risk`,
    });
  }

  // ── Volume/area ratio (solid vs thin) ─────────────
  if (stats.volume > 0 && stats.totalArea > 0) {
    const vaRatio = stats.volume / stats.totalArea;
    if (vaRatio < 0.05) {
      score -= 5;
      attributions.push({
        feature: 'Volume/area ratio',
        impact: 'negative',
        contribution: -5,
        description: `Low V/A ratio (${vaRatio.toFixed(4)}) suggests thin-walled geometry`,
      });
    }
  }

  score = Math.max(10, Math.min(98, score));

  return { score, risks, violations, attributions };
}

// ─── ML Backend Call ─────────────────────────────────────────────

interface MLPrediction {
  manufacturabilityScore: number;
  estimatedCostUsd: number;
  riskLevel: RiskLevel;
  riskRegions: Array<{ faceIndex: number; severity: string; description: string }>;
  recommendations: string[];
  latencyMs: number;
  modelVersion: string;
}

async function callMLBackend(
  features: GeometryFeatureSet,
  material: string,
  process: string,
  timeoutMs: number,
): Promise<MLPrediction | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const { data, error } = await supabase.functions.invoke('ml-backend', {
      body: {
        action: 'predict',
        submission: {
          geometryId: crypto.randomUUID(),
          nodeFeatures: features.nodeFeatures,
          edgeIndex: features.edgeIndex,
          edgeAttr: features.edgeAttr,
          material,
          process,
        },
      },
    });

    clearTimeout(timer);
    if (error) throw new Error(error.message);
    if (data?.error) throw new Error(data.error);

    return data as MLPrediction;
  } catch (err) {
    clearTimeout(timer);
    console.warn('[Inference] ML backend unavailable, falling back to rules:', (err as Error).message);
    return null;
  }
}

// ─── Explanation Generator ───────────────────────────────────────

function generateExplanation(
  score: number,
  riskLevel: RiskLevel,
  costBreakdown: CostBreakdown,
  ruleResult: RuleResult,
  mlAvailable: boolean,
  stats: GeometryStats,
): Explanation {
  // ── Summary ───────────────────────────────────────
  const riskWord = riskLevel === 'low' ? 'low risk' :
    riskLevel === 'medium' ? 'moderate risk' :
    riskLevel === 'high' ? 'high risk' : 'critical risk';

  const summary = score >= 85
    ? `Part scores ${score.toFixed(1)}/100 — well-suited for manufacturing with ${riskWord}. Estimated cost $${costBreakdown.totalCost.toFixed(0)}.`
    : score >= 70
    ? `Part scores ${score.toFixed(1)}/100 — manufacturable with some concerns (${riskWord}). Review ${ruleResult.violations.length} flagged issue(s).`
    : score >= 50
    ? `Part scores ${score.toFixed(1)}/100 — significant manufacturing challenges detected (${riskWord}). ${ruleResult.violations.length} violation(s) require attention.`
    : `Part scores ${score.toFixed(1)}/100 — critical manufacturing issues detected. Redesign strongly recommended before quoting.`;

  // ── Recommendations ───────────────────────────────
  const recommendations: Recommendation[] = [];

  for (const v of ruleResult.violations) {
    if (v.rule === 'MIN_WALL_THICKNESS') {
      recommendations.push({
        priority: 'high',
        category: 'Geometry',
        action: `Increase wall thickness in ${v.faceIndices.length} region(s) to ≥1.5mm`,
        estimatedImpact: 'Could improve score by 5–12 points',
      });
    }
    if (v.rule === 'MIN_RADIUS') {
      recommendations.push({
        priority: 'medium',
        category: 'Geometry',
        action: `Increase fillet radii on ${v.faceIndices.length} tight-radius face(s)`,
        estimatedImpact: 'Reduces tool breakage risk and machining time',
      });
    }
    if (v.rule === 'SINGLE_BODY') {
      recommendations.push({
        priority: 'medium',
        category: 'Assembly',
        action: 'Consolidate disconnected bodies or plan multiple setups',
        estimatedImpact: `Saves ${stats.connectedComponents - 1} additional setup(s)`,
      });
    }
  }

  // Cost-based recommendations
  const costRatio = costBreakdown.subtotals;
  if (costRatio.complexity > costBreakdown.totalCost * 0.2) {
    recommendations.push({
      priority: 'medium',
      category: 'Cost',
      action: 'Simplify freeform surfaces to reduce complexity surcharge',
      estimatedImpact: `Could save ~$${costRatio.complexity.toFixed(0)} (${((costRatio.complexity / costBreakdown.totalCost) * 100).toFixed(0)}% of total)`,
    });
  }

  if (costRatio.material > costBreakdown.totalCost * 0.4) {
    recommendations.push({
      priority: 'low',
      category: 'Cost',
      action: 'Consider alternative material or near-net-shape process to reduce material waste',
      estimatedImpact: 'Material is largest cost driver',
    });
  }

  if (recommendations.length === 0) {
    recommendations.push({
      priority: 'low',
      category: 'General',
      action: 'Part is well-optimized — no critical changes recommended',
      estimatedImpact: 'Ready for production quoting',
    });
  }

  // Sort by priority
  const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
  recommendations.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

  return {
    summary,
    attributions: ruleResult.attributions,
    recommendations,
    violations: ruleResult.violations,
  };
}

// ─── Fusion Layer ────────────────────────────────────────────────

function fuseScores(
  ruleScore: number,
  mlScore: number | null,
  ruleViolationCount: number,
): { score: number; confidence: number; source: ExplainedAssessment['source'] } {
  if (mlScore === null) {
    // Rules only — lower confidence
    const confidence = Math.max(0.35, 0.7 - ruleViolationCount * 0.05);
    return { score: ruleScore, confidence, source: 'rules' };
  }

  // Adaptive fusion: weight ML higher when rules and ML agree
  const agreement = 1 - Math.abs(ruleScore - mlScore) / 100;
  const mlWeight = 0.4 + agreement * 0.3; // 0.4–0.7
  const ruleWeight = 1 - mlWeight;

  const fusedScore = ruleScore * ruleWeight + mlScore * mlWeight;
  const confidence = Math.max(0.5, Math.min(0.95, agreement * 0.85 + 0.1));

  return {
    score: +fusedScore.toFixed(1),
    confidence: +confidence.toFixed(3),
    source: 'hybrid',
  };
}

function scoreToRiskLevel(score: number): RiskLevel {
  if (score >= 85) return 'low';
  if (score >= 70) return 'medium';
  if (score >= 50) return 'high';
  return 'critical';
}

// ─── Public API ──────────────────────────────────────────────────

/**
 * Run real-time manufacturing inference on extracted geometry features.
 *
 * Pipeline:
 *   1. Run rule engine (always, ~1ms)
 *   2. Call ML backend in parallel (with timeout)
 *   3. Fuse scores via adaptive confidence weighting
 *   4. Compute cost breakdown via costEngine
 *   5. Generate human-readable explanations
 *
 * @returns ExplainedAssessment within <5 seconds
 */
export async function runInferenceEngine(req: InferenceRequest): Promise<ExplainedAssessment> {
  const start = performance.now();
  const timeoutMs = req.timeoutMs ?? 4500;

  const material = MATERIALS[req.materialId];
  if (!material) throw new Error(`Unknown material: ${req.materialId}`);
  const process = PROCESSES[req.processId];
  if (!process) throw new Error(`Unknown process: ${req.processId}`);

  // ── Step 1 & 2: Rule engine + ML backend in parallel ──
  const ruleResult = runRuleEngine(req.features, req.materialId);

  let mlPrediction: MLPrediction | null = null;
  if (!req.rulesOnly) {
    mlPrediction = await callMLBackend(
      req.features,
      material.name,
      process.name,
      Math.min(timeoutMs - 500, 4000), // Reserve 500ms for post-processing
    );
  }

  // ── Step 3: Fuse scores ───────────────────────────
  const { score, confidence, source } = fuseScores(
    ruleResult.score,
    mlPrediction?.manufacturabilityScore ?? null,
    ruleResult.violations.length,
  );

  const riskLevel = scoreToRiskLevel(score);

  // ── Step 4: Cost breakdown ────────────────────────
  const costBreakdown = estimateCost(req.features, {
    materialId: req.materialId,
    processId: req.processId,
  });

  // ── Step 5: Merge risk regions ────────────────────
  const riskRegions = [...ruleResult.risks];
  if (mlPrediction?.riskRegions) {
    for (const r of mlPrediction.riskRegions) {
      // Avoid duplicating face indices already in rules
      const exists = riskRegions.some(rr => rr.faceIndex === r.faceIndex && rr.category === 'curvature');
      if (!exists) {
        riskRegions.push({
          faceIndex: r.faceIndex,
          severity: r.severity as RiskLevel,
          category: 'ml_detected',
          description: r.description,
        });
      }
    }
  }

  // ── Step 6: Generate explanations ─────────────────
  const explanation = generateExplanation(
    score,
    riskLevel,
    costBreakdown,
    ruleResult,
    mlPrediction !== null,
    req.features.stats,
  );

  // Add ML-sourced recommendations if available
  if (mlPrediction?.recommendations) {
    for (const rec of mlPrediction.recommendations) {
      if (!explanation.recommendations.some(r => r.action === rec)) {
        explanation.recommendations.push({
          priority: 'medium',
          category: 'ML Insight',
          action: rec,
          estimatedImpact: 'Identified by ML model',
        });
      }
    }
  }

  const latencyMs = +(performance.now() - start).toFixed(1);

  return {
    assessmentId: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    manufacturabilityScore: score,
    costUsd: costBreakdown.totalCost,
    costBreakdown,
    riskLevel,
    riskRegions,
    explanation,
    confidence,
    source,
    latencyMs,
    inputs: {
      material: material.name,
      process: process.name,
      faceCount: req.features.stats.totalFaces,
      edgeCount: req.features.stats.totalEdges,
      complexityScore: req.features.stats.complexityScore,
    },
  };
}
