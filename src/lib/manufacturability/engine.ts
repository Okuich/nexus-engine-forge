/**
 * Manufacturability Engine — public facade.
 *
 *   evaluateManufacturability(cadModel) → score, feasibility,
 *   recommended process, alternatives, similar parts, and
 *   difficulty explanations.
 */

import { difficultyIndex } from './distance';
import {
  DIFFICULTY_WEIGHTS,
  difficultyWeightVector,
  extractRaw,
  normalize,
} from './normalizer';
import { scoreProcess } from './processScorer';
import { ManufacturabilityStore } from './store';
import {
  FABRICATION_PROCESSES,
  MFG_DIMENSIONS,
  type CadModel,
  type DifficultyExplanation,
  type FabricationProcess,
  type ManufacturabilityEvaluation,
  type ManufacturabilityVector,
  type ProcessScore,
  type StoredManufacturablePart,
} from './types';

function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return (crypto as Crypto).randomUUID();
  }
  return `mfg-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

const DIM_MESSAGES: Partial<Record<(typeof MFG_DIMENSIONS)[number], string>> = {
  'feat.undercuts': 'Undercuts force multi-axis tooling or secondary operations',
  'tol.tightnessInv': 'Tight dimensional tolerances drive cost and reject rate',
  'tol.precisionFeatureCount': 'Many features carry precision callouts',
  'tol.surfaceInv': 'Fine surface finish requires post-processing',
  'wall.minInv': 'Thin walls risk deflection, chatter, or fill failures',
  'wall.std': 'Non-uniform walls cause warpage and sink',
  'mat.machinabilityInv': 'Material is hard to machine',
  'mat.hardness': 'Material hardness stresses tooling',
  'tool.coverageInv': 'Low 3-axis tool coverage — multi-axis or special fixturing needed',
  'tool.setups': 'High number of setups inflates lead time',
  'topo.genus': 'High topological genus — complex internal connectivity',
  'feat.threads': 'Threaded features require tapping or thread-milling ops',
  'asm.stackups': 'Tolerance stack-ups complicate assembly',
  'feat.pockets': 'Deep pockets stress tool reach and chip evacuation',
  'surf.freeform': 'Freeform surfaces require 5-axis finishing or AM',
};

function buildVector(model: CadModel): ManufacturabilityVector {
  const raw = extractRaw(model);
  const vec = normalize(raw);
  return { id: newId(), modelId: model.id, vector: vec, raw };
}

function explain(vector: ManufacturabilityVector, topN = 5): DifficultyExplanation[] {
  const out: DifficultyExplanation[] = [];
  MFG_DIMENSIONS.forEach((d, i) => {
    const weight = DIFFICULTY_WEIGHTS[d];
    const impact = vector.vector[i] * weight;
    if (impact <= 0.05) return;
    out.push({
      dimension: d,
      impact,
      message: DIM_MESSAGES[d] ?? `${d} contributes to difficulty`,
    });
  });
  out.sort((a, b) => b.impact - a.impact);
  return out.slice(0, topN);
}

export class ManufacturabilityEngine {
  private readonly store: ManufacturabilityStore;
  private readonly weights = difficultyWeightVector();

  constructor(store?: ManufacturabilityStore) {
    this.store = store ?? new ManufacturabilityStore();
  }

  size(): number {
    return this.store.size();
  }

  reset(): void {
    this.store.clear();
  }

  /** Build a ManufacturabilityVector without persisting it. */
  generateVector(model: CadModel): ManufacturabilityVector {
    return buildVector(model);
  }

  /** Persist a part for use as a similar-part neighbor later. */
  registerPart(
    model: CadModel,
    process: FabricationProcess,
    actualScore: number,
  ): StoredManufacturablePart {
    const vector = buildVector(model);
    const item: StoredManufacturablePart = {
      vector,
      modelName: model.name,
      process,
      actualScore,
    };
    this.store.add(item);
    return item;
  }

  /**
   * Primary API. Evaluates a CAD model end-to-end:
   *   - generates vector
   *   - scores every supported process
   *   - retrieves similar manufacturable parts
   *   - returns top alternatives and difficulty explanations
   */
  evaluateManufacturability(model: CadModel): ManufacturabilityEvaluation {
    const vector = buildVector(model);

    const processScores: ProcessScore[] = FABRICATION_PROCESSES
      .map((p) => scoreProcess(model, p))
      .sort((a, b) => b.score - a.score);

    const recommended = processScores[0];
    // Combine top-process score with overall difficulty index for the
    // headline manufacturability number.
    const diff = difficultyIndex(vector.vector, this.weights);
    const score = Math.max(
      0,
      Math.min(100, recommended.score * (1 - 0.35 * diff)),
    );

    const similarParts = this.store.nearest(vector, { k: 5, metric: 'geometric' });

    const alternatives = processScores
      .filter((p) => p.process !== recommended.process)
      .slice(0, 3);

    return {
      modelId: model.id,
      vector,
      score: Math.round(score * 10) / 10,
      feasibility: recommended.feasibility,
      recommendedProcess: recommended.process,
      processScores,
      similarParts,
      alternatives,
      difficulty: explain(vector),
    };
  }
}

// ─── Shared singleton + top-level API ────────────────────────────

let shared: ManufacturabilityEngine | null = null;

export function getManufacturabilityEngine(): ManufacturabilityEngine {
  if (!shared) shared = new ManufacturabilityEngine();
  return shared;
}

export function evaluateManufacturability(model: CadModel): ManufacturabilityEvaluation {
  return getManufacturabilityEngine().evaluateManufacturability(model);
}
