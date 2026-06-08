/**
 * Per-process scoring rules.
 *
 * Each process defines penalties triggered by specific raw model
 * characteristics. Scores start at 100 and have penalties subtracted;
 * `feasibility` is a 0..1 confidence reflecting hard constraints
 * (e.g. AM cannot handle very heavy parts, IM requires uniform walls).
 */

import type {
  CadModel,
  FabricationProcess,
  ProcessScore,
} from './types';

interface Penalty {
  amount: number;
  feasibilityHit: number;
  reason: string;
}

type ProcessEvaluator = (m: CadModel) => Penalty[];

const cnc: ProcessEvaluator = (m) => {
  const out: Penalty[] = [];
  if (m.features.undercuts > 0)
    out.push({ amount: 8 + m.features.undercuts * 1.5, feasibilityHit: 0.05, reason: `${m.features.undercuts} undercuts require 5-axis or EDM` });
  if (m.tolerances.tightestTolMm > 0 && m.tolerances.tightestTolMm < 0.01)
    out.push({ amount: 18, feasibilityHit: 0.1, reason: 'Sub-10µm tolerances stress CNC capability' });
  if (m.tooling.threeAxisCoverage < 0.6)
    out.push({ amount: (0.6 - m.tooling.threeAxisCoverage) * 60, feasibilityHit: 0.1, reason: 'Low 3-axis tool coverage' });
  if (m.tooling.setupCount > 3)
    out.push({ amount: (m.tooling.setupCount - 3) * 4, feasibilityHit: 0.02, reason: `${m.tooling.setupCount} setups required` });
  if (m.material.machinability < 0.3)
    out.push({ amount: 20, feasibilityHit: 0.05, reason: 'Difficult-to-machine material' });
  if (m.wall.minThicknessMm > 0 && m.wall.minThicknessMm < 0.5)
    out.push({ amount: 10, feasibilityHit: 0.05, reason: 'Walls below 0.5mm prone to chatter' });
  return out;
};

const injection: ProcessEvaluator = (m) => {
  const out: Penalty[] = [];
  if (m.material.family !== 'plastic')
    out.push({ amount: 40, feasibilityHit: 0.5, reason: 'Non-plastic material' });
  if (m.features.undercuts > 0)
    out.push({ amount: 6 + m.features.undercuts * 4, feasibilityHit: 0.1, reason: 'Undercuts require side actions/lifters' });
  if (m.wall.thicknessStdMm > 1.5)
    out.push({ amount: 20, feasibilityHit: 0.1, reason: 'Non-uniform walls cause sink and warpage' });
  if (m.wall.minThicknessMm > 0 && m.wall.minThicknessMm < 0.6)
    out.push({ amount: 12, feasibilityHit: 0.05, reason: 'Walls below 0.6mm hard to fill' });
  if (m.wall.meanThicknessMm > 6)
    out.push({ amount: 10, feasibilityHit: 0.05, reason: 'Thick walls increase cycle time and sink' });
  if (m.tolerances.tightestTolMm > 0 && m.tolerances.tightestTolMm < 0.05)
    out.push({ amount: 15, feasibilityHit: 0.05, reason: 'Tolerances tighter than ±0.05mm impractical' });
  return out;
};

const additive: ProcessEvaluator = (m) => {
  const out: Penalty[] = [];
  if (m.volumeMm3 > 1_000_000)
    out.push({ amount: 15, feasibilityHit: 0.1, reason: 'Large volume exceeds typical build envelopes' });
  if (m.wall.minThicknessMm > 0 && m.wall.minThicknessMm < 0.4)
    out.push({ amount: 10, feasibilityHit: 0.1, reason: 'Walls below 0.4mm risk print failure' });
  if (m.tolerances.bestSurfaceRaUm > 0 && m.tolerances.bestSurfaceRaUm < 1.6)
    out.push({ amount: 18, feasibilityHit: 0.05, reason: 'Sub-Ra1.6 surface requires post-machining' });
  if (m.tolerances.tightestTolMm > 0 && m.tolerances.tightestTolMm < 0.05)
    out.push({ amount: 14, feasibilityHit: 0.05, reason: 'Tight tolerances require secondary ops' });
  if (m.surface.freeformFaceCount > 0)
    out.push({ amount: -Math.min(10, m.surface.freeformFaceCount * 0.2), feasibilityHit: 0, reason: 'Freeform geometry favors AM' });
  return out;
};

const sheetMetal: ProcessEvaluator = (m) => {
  const out: Penalty[] = [];
  if (m.wall.std > 0.2 || m.wall.thicknessStdMm > 0.2)
    out.push({ amount: 30, feasibilityHit: 0.3, reason: 'Wall thickness varies — sheet metal requires uniform gauge' });
  if (m.wall.meanThicknessMm > 10)
    out.push({ amount: 20, feasibilityHit: 0.2, reason: 'Gauge too thick for typical sheet metal' });
  if (m.features.pockets > 0)
    out.push({ amount: m.features.pockets * 2, feasibilityHit: 0.05, reason: 'Pockets are not native to sheet-metal' });
  if (m.features.bosses > 0)
    out.push({ amount: m.features.bosses * 3, feasibilityHit: 0.05, reason: 'Bosses require additional ops' });
  if (m.topology.genus > 0)
    out.push({ amount: m.topology.genus * 4, feasibilityHit: 0.05, reason: 'High topological genus' });
  return out;
};

const casting: ProcessEvaluator = (m) => {
  const out: Penalty[] = [];
  if (m.tolerances.tightestTolMm > 0 && m.tolerances.tightestTolMm < 0.1)
    out.push({ amount: 20, feasibilityHit: 0.1, reason: 'As-cast tolerances rarely tighter than ±0.1mm' });
  if (m.tolerances.bestSurfaceRaUm > 0 && m.tolerances.bestSurfaceRaUm < 3.2)
    out.push({ amount: 12, feasibilityHit: 0.05, reason: 'Smooth surfaces require post-machining' });
  if (m.wall.minThicknessMm > 0 && m.wall.minThicknessMm < 2)
    out.push({ amount: 15, feasibilityHit: 0.1, reason: 'Thin walls hard to fill in casting' });
  if (m.features.threads > 0)
    out.push({ amount: m.features.threads * 2, feasibilityHit: 0.02, reason: 'Threads must be machined post-cast' });
  if (m.material.family === 'plastic')
    out.push({ amount: 30, feasibilityHit: 0.3, reason: 'Plastic not compatible with metal casting' });
  return out;
};

const EVALUATORS: Record<FabricationProcess, ProcessEvaluator> = {
  'cnc': cnc,
  'injection-molding': injection,
  'additive': additive,
  'sheet-metal': sheetMetal,
  'casting': casting,
};

export function scoreProcess(model: CadModel, process: FabricationProcess): ProcessScore {
  const penalties = EVALUATORS[process](model);
  let score = 100;
  let feasibility = 1;
  const reasons: string[] = [];
  // Sort largest penalty first for explanation order.
  penalties
    .slice()
    .sort((a, b) => b.amount - a.amount)
    .forEach((p) => {
      score -= p.amount;
      feasibility -= p.feasibilityHit;
      if (p.amount > 0) reasons.push(p.reason);
    });
  return {
    process,
    score: Math.max(0, Math.min(100, score)),
    feasibility: Math.max(0, Math.min(1, feasibility)),
    reasons: reasons.slice(0, 5),
  };
}
