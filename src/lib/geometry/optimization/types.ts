/**
 * Geometry Optimization Engine — shared types.
 */

import type { RawMesh } from '../types';

export type ManufacturingProcess =
  | 'cnc_milling'
  | 'cnc_turning'
  | 'sheet_metal'
  | 'injection_molding'
  | 'die_casting'
  | 'fdm_3d_print'
  | 'sls_3d_print'
  | 'dmls_metal_print';

export type Material =
  | 'aluminum_6061'
  | 'steel_1018'
  | 'stainless_304'
  | 'titanium_grade5'
  | 'abs'
  | 'nylon_pa12'
  | 'pla';

export interface MaterialProps {
  /** kg/m^3 */ density: number;
  /** MPa */ yieldStrength: number;
  /** GPa */ youngsModulus: number;
  /** USD/kg */ costPerKg: number;
  /** machinability 0-1 (higher = easier) */ machinability: number;
}

export interface PhysicsConstraints {
  /** Required factor of safety vs. yield. Default 2.0 */
  minSafetyFactor?: number;
  /** Estimated peak load in Newtons applied uniformly. */
  peakLoadN?: number;
  /** Minimum wall thickness in mm allowed by physics. */
  minWallMm?: number;
  /** Operating temperature, Celsius. */
  operatingTempC?: number;
}

export interface CostConstraints {
  /** Target unit cost in USD. */
  targetUnitCostUsd?: number;
  /** Annual production volume — drives amortization. */
  annualVolume?: number;
  /** Hard ceiling — suggestions exceeding this are discarded. */
  maxUnitCostUsd?: number;
}

export interface OptimizationContext {
  process: ManufacturingProcess;
  material: Material;
  physics?: PhysicsConstraints;
  cost?: CostConstraints;
  /** Allow geometry-altering suggestions (vs. annotation only). */
  allowGeometryEdits?: boolean;
}

export type SuggestionCategory =
  | 'wall_thickness'
  | 'fillet_radius'
  | 'hole_simplification'
  | 'draft_angle'
  | 'rib_addition'
  | 'pocket_depth'
  | 'tolerance_loosening'
  | 'feature_consolidation'
  | 'material_swap'
  | 'process_swap'
  | 'symmetry_exploit'
  | 'hollowing'
  | 'lattice_infill';

export type Severity = 'info' | 'warn' | 'critical';

export interface Suggestion {
  id: string;
  category: SuggestionCategory;
  severity: Severity;
  title: string;
  rationale: string;
  /** Affected face / edge / vertex indices (when localized). */
  faceIndices?: number[];
  /** Estimated unit cost delta in USD (negative = savings). */
  estCostDeltaUsd: number;
  /** Estimated mass delta in grams (negative = lighter). */
  estMassDeltaG: number;
  /** Estimated change to factor-of-safety (>0 = stronger). */
  estSafetyDelta: number;
  /** Confidence 0-1. */
  confidence: number;
  /** Optional patch the renderer can preview. */
  patch?: GeometryPatch;
}

export interface GeometryPatch {
  kind: 'thicken' | 'fillet' | 'remove_feature' | 'hollow' | 'replace_material';
  /** Target indices (faces or edges depending on kind). */
  targets: number[];
  /** Magnitude in mm where applicable. */
  amountMm?: number;
  /** Replacement material if kind=replace_material. */
  newMaterial?: Material;
}

export interface OptimizationReport {
  /** Baseline analysis. */
  baseline: {
    massG: number;
    volumeMm3: number;
    surfaceAreaMm2: number;
    estUnitCostUsd: number;
    estSafetyFactor: number;
  };
  /** All suggestions, sorted by impact (cost savings × confidence). */
  suggestions: Suggestion[];
  /** Pareto-optimal subset (cost vs. safety). */
  paretoFront: Suggestion[];
  /** Total potential savings if all non-conflicting suggestions applied. */
  potentialSavingsUsd: number;
  /** Wall-clock ms. */
  elapsedMs: number;
}

export interface OptimizerOptions {
  /** Max suggestions returned. Default 25. */
  maxSuggestions?: number;
  /** Skip suggestions below this cost-impact threshold (USD). */
  minImpactUsd?: number;
  /** Time budget in ms. Defaults to 100ms. */
  timeBudgetMs?: number;
}

/** Internal — re-export for convenience. */
export type { RawMesh };
