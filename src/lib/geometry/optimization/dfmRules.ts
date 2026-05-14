/**
 * Design-for-Manufacturability rules.
 *
 * Each rule consumes a mesh + context and emits zero or more Suggestions.
 * Rules are pure, deterministic, and individually time-bounded.
 */
import type { RawMesh } from '../types';
import { computeThickness } from '../features/thickness';
import { computeSharpness } from '../features/sharpness';
import { computeCurvature } from '../features/curvature';
import {
  PROCESS_MIN_WALL_MM,
  PROCESS_MIN_DRAFT_DEG,
  MATERIAL_DB,
  PROCESS_RATE_USD_PER_CM3,
} from './materials';
import type { OptimizationContext, Suggestion } from './types';

let _id = 0;
const nid = (cat: string) => `${cat}-${++_id}`;

/** Wall-thickness rule: flag faces below process minimum. */
export function ruleWallThickness(mesh: RawMesh, ctx: OptimizationContext): Suggestion[] {
  const minWall = Math.max(
    PROCESS_MIN_WALL_MM[ctx.process],
    ctx.physics?.minWallMm ?? 0,
  );
  const { thickness } = computeThickness(mesh, { samples: 8 });
  const thin: number[] = [];
  for (let i = 0; i < thickness.length; i++) {
    const t = thickness[i];
    if (Number.isFinite(t) && t > 0 && t < minWall) thin.push(i);
  }
  if (!thin.length) return [];
  const props = MATERIAL_DB[ctx.material];
  // Estimate added mass to thicken to minWall over flagged faces.
  const avgThin = thin.reduce((s, i) => s + thickness[i], 0) / thin.length;
  const deltaMm = Math.max(0, minWall - avgThin);
  const addedVolMm3 = thin.length * deltaMm * 1.0; // ~1mm² per face avg
  const addedMassG = (addedVolMm3 * 1e-9) * props.density * 1000;
  const addedCost = (addedVolMm3 / 1000) * PROCESS_RATE_USD_PER_CM3[ctx.process];

  return [{
    id: nid('wall'),
    category: 'wall_thickness',
    severity: 'critical',
    title: `Increase ${thin.length} thin walls to ${minWall.toFixed(2)}mm minimum`,
    rationale:
      `Detected walls as thin as ${avgThin.toFixed(2)}mm — below the ${ctx.process} ` +
      `minimum of ${minWall.toFixed(2)}mm. Thickening prevents print failure / tool deflection.`,
    faceIndices: thin,
    estCostDeltaUsd: addedCost,
    estMassDeltaG: addedMassG,
    estSafetyDelta: 0.4,
    confidence: 0.9,
    patch: { kind: 'thicken', targets: thin, amountMm: deltaMm },
  }];
}

/** Sharp-edge rule: recommend fillets on stress concentrators. */
export function ruleFillets(mesh: RawMesh, ctx: OptimizationContext): Suggestion[] {
  const report = computeSharpness(mesh, { creaseThreshold: Math.PI / 3 });
  const concaveCreases = report.edges.filter(e => e.isCrease && e.signedSharpness < 0);
  if (concaveCreases.length < 3) return [];
  return [{
    id: nid('fillet'),
    category: 'fillet_radius',
    severity: 'warn',
    title: `Add fillets to ${concaveCreases.length} sharp concave edges`,
    rationale:
      'Sharp internal corners are stress raisers and add tool-path complexity. ' +
      'A 0.5–1.0mm fillet typically reduces stress concentration by 30–50%.',
    faceIndices: Array.from(new Set(concaveCreases.flatMap(e => [e.faceA, e.faceB]))),
    estCostDeltaUsd: -0.05 * concaveCreases.length,
    estMassDeltaG: 0,
    estSafetyDelta: 0.6,
    confidence: 0.75,
    patch: { kind: 'fillet', targets: concaveCreases.map((_, i) => i), amountMm: 0.75 },
  }];
}

/** Draft-angle rule: required for molded/cast processes. */
export function ruleDraftAngle(mesh: RawMesh, ctx: OptimizationContext): Suggestion[] {
  const minDraft = PROCESS_MIN_DRAFT_DEG[ctx.process];
  if (minDraft <= 0) return [];
  // Heuristic: count faces nearly parallel to "pull" axis (assumed +Z).
  const { positions, indices } = mesh;
  const flagged: number[] = [];
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i] * 3, b = indices[i + 1] * 3, c = indices[i + 2] * 3;
    const ux = positions[b] - positions[a], uy = positions[b + 1] - positions[a + 1], uz = positions[b + 2] - positions[a + 2];
    const vx = positions[c] - positions[a], vy = positions[c + 1] - positions[a + 1], vz = positions[c + 2] - positions[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    const tiltDeg = Math.acos(Math.min(1, Math.abs(nz / len))) * 180 / Math.PI;
    // Faces nearly vertical (tilt ~90°) need draft.
    if (tiltDeg > 90 - minDraft && tiltDeg < 90 + minDraft) flagged.push(i / 3);
  }
  if (!flagged.length) return [];
  return [{
    id: nid('draft'),
    category: 'draft_angle',
    severity: 'critical',
    title: `Apply ${minDraft}° draft to ${flagged.length} vertical faces`,
    rationale:
      `${ctx.process} requires ${minDraft}° draft for clean ejection. ` +
      'Faces flagged are perpendicular to the assumed pull axis (+Z).',
    faceIndices: flagged,
    estCostDeltaUsd: -2.5,
    estMassDeltaG: 0,
    estSafetyDelta: 0,
    confidence: 0.8,
  }];
}

/** Hollowing rule: solid heavy parts can often be hollowed/lattice-filled. */
export function ruleHollowing(
  mesh: RawMesh,
  ctx: OptimizationContext,
  volumeMm3: number,
): Suggestion[] {
  if (ctx.process !== 'fdm_3d_print' &&
      ctx.process !== 'sls_3d_print' &&
      ctx.process !== 'dmls_metal_print') return [];
  if (volumeMm3 < 5000) return [];
  const props = MATERIAL_DB[ctx.material];
  const savedVolMm3 = volumeMm3 * 0.55;
  const savedMassG = (savedVolMm3 * 1e-9) * props.density * 1000;
  const savedCost =
    -savedMassG / 1000 * props.costPerKg
    - (savedVolMm3 / 1000) * PROCESS_RATE_USD_PER_CM3[ctx.process];

  return [{
    id: nid('hollow'),
    category: 'hollowing',
    severity: 'info',
    title: 'Hollow interior with lattice infill (~55% mass reduction)',
    rationale:
      'Part is solid and printed — replacing the core with a gyroid lattice ' +
      'preserves >80% stiffness while cutting material and print time.',
    estCostDeltaUsd: savedCost,
    estMassDeltaG: -savedMassG,
    estSafetyDelta: -0.3,
    confidence: 0.7,
    patch: { kind: 'hollow', targets: [] },
  }];
}

/** Material-swap rule: suggest cheaper material if safety budget allows. */
export function ruleMaterialSwap(
  mesh: RawMesh,
  ctx: OptimizationContext,
  baselineSafety: number,
): Suggestion[] {
  const minFoS = ctx.physics?.minSafetyFactor ?? 2.0;
  // Only swap titanium → steel or steel → aluminum when over-spec'd.
  const swaps: Array<[typeof ctx.material, typeof ctx.material]> = [
    ['titanium_grade5', 'stainless_304'],
    ['stainless_304',   'steel_1018'],
    ['steel_1018',      'aluminum_6061'],
  ];
  const swap = swaps.find(([from]) => from === ctx.material);
  if (!swap) return [];
  const [, to] = swap;
  const fromProps = MATERIAL_DB[ctx.material];
  const toProps = MATERIAL_DB[to];
  const newSafety = baselineSafety * (toProps.yieldStrength / fromProps.yieldStrength);
  if (newSafety < minFoS * 1.1) return []; // not enough margin

  const costRatio = toProps.costPerKg / fromProps.costPerKg;
  return [{
    id: nid('mat'),
    category: 'material_swap',
    severity: 'info',
    title: `Swap ${ctx.material} → ${to}`,
    rationale:
      `Estimated FoS would drop from ${baselineSafety.toFixed(2)} to ${newSafety.toFixed(2)} ` +
      `(still above the ${minFoS} target). Material cost ratio: ${costRatio.toFixed(2)}×.`,
    estCostDeltaUsd: -(1 - costRatio) * 5, // illustrative
    estMassDeltaG: 0,
    estSafetyDelta: newSafety - baselineSafety,
    confidence: 0.65,
    patch: { kind: 'replace_material', targets: [], newMaterial: to },
  }];
}

/** Feature-consolidation: highly curved regions hint at multiple small features. */
export function ruleFeatureConsolidation(mesh: RawMesh, ctx: OptimizationContext): Suggestion[] {
  if (ctx.process !== 'cnc_milling' && ctx.process !== 'cnc_turning') return [];
  const cur = computeCurvature(mesh);
  let highCount = 0;
  for (let i = 0; i < cur.perVertex.length; i++) {
    if (Math.abs(cur.perVertex[i].mean) > 1.5) highCount++;
  }
  if (highCount < cur.perVertex.length * 0.15) return [];
  return [{
    id: nid('consol'),
    category: 'feature_consolidation',
    severity: 'warn',
    title: 'Consolidate small high-curvature features',
    rationale:
      `${highCount} vertices show high mean curvature, suggesting many small pockets/bosses. ` +
      'Combining them reduces tool-changes and setup count.',
    estCostDeltaUsd: -3.5,
    estMassDeltaG: 0,
    estSafetyDelta: 0,
    confidence: 0.55,
  }];
}

export const ALL_RULES = [
  ruleWallThickness,
  ruleFillets,
  ruleDraftAngle,
  ruleFeatureConsolidation,
];
