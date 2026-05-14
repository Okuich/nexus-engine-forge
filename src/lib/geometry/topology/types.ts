/**
 * Topology Optimization Engine — types.
 *
 * Implements a SIMP (Solid Isotropic Material with Penalization) style
 * density-based topology optimizer on a voxel grid.
 */
import type { RawMesh } from '../types';
import type { SDFGrid } from '../sdf/types';
import type { Material, ManufacturingProcess } from '../optimization/types';

export type V3 = [number, number, number];

export interface LoadCondition {
  /** World-space application point. */
  point: V3;
  /** Force vector in Newtons. */
  force: V3;
  /** Optional radius of influence (mm). */
  radius?: number;
}

export interface SupportCondition {
  /** World-space anchor point or face center. */
  point: V3;
  /** Restrained DOFs — for now we treat all supports as fixed. */
  fixed?: boolean;
  /** Radius of influence (mm). */
  radius?: number;
}

export interface ManufacturingConstraints {
  process: ManufacturingProcess;
  /** Minimum feature size, mm. Defaults derived from process. */
  minFeatureMm?: number;
  /** Symmetry plane to enforce (none / x / y / z). */
  symmetry?: 'none' | 'x' | 'y' | 'z';
  /** Pull/build axis for draft / overhang constraints. */
  pullAxis?: 'x' | 'y' | 'z';
  /** Maximum overhang angle from build plate (degrees). Used for AM processes. */
  maxOverhangDeg?: number;
}

export interface PhysicsValidation {
  /** Identifier of the validated physics model. */
  modelId: string;
  /** Was the model cross-validated against ground-truth? */
  validated: boolean;
  /** R² or similar accuracy metric in [0,1]. */
  accuracy?: number;
  /** Number of training samples used. */
  trainingSamples?: number;
}

export interface CostObjective {
  material: Material;
  /** Weight (0..1) for cost vs. weight in the multi-objective scalarization. */
  costWeight?: number;
  /** Target unit cost (USD). Optimizer will stop if hit. */
  targetUnitCostUsd?: number;
}

export interface TopoOptimizerOptions {
  /** Voxel resolution along longest axis. Default 48. */
  resolution?: number;
  /** Target volume fraction in [0,1]. Default 0.4. */
  targetVolumeFraction?: number;
  /** Max SIMP iterations. Default 50. */
  maxIterations?: number;
  /** SIMP penalization exponent. Default 3. */
  penalty?: number;
  /** Density filter radius (in voxels). Default 1.5. */
  filterRadius?: number;
  /** Convergence threshold on density change. Default 0.01. */
  convergenceTol?: number;
  /** Time budget (ms). Default 5000. */
  timeBudgetMs?: number;
  /** Resume from a previous proposal's density field. */
  resumeFrom?: Float32Array;
  /** Per-iteration callback for live previews. */
  onIteration?: (state: TopoIterationState) => void;
}

export interface TopoIterationState {
  iteration: number;
  density: Float32Array;
  compliance: number;
  volumeFraction: number;
  change: number;
  elapsedMs: number;
}

export interface TopoProposal {
  /** Density field in [0,1], same layout as the input voxel grid. */
  density: Float32Array;
  /** Voxel grid metadata. */
  dims: [number, number, number];
  origin: V3;
  voxelSize: number;
  /** Final compliance (lower = stiffer). */
  compliance: number;
  /** Achieved volume fraction. */
  volumeFraction: number;
  /** Estimated mass in grams. */
  estMassG: number;
  /** Estimated unit cost in USD. */
  estUnitCostUsd: number;
  /** Estimated factor of safety vs. yield. */
  estSafetyFactor: number;
  /** Iterations consumed. */
  iterations: number;
  /** Whether the iteration converged. */
  converged: boolean;
  /** Was the result post-processed for manufacturability? */
  manufacturable: boolean;
  /** Wall-clock ms. */
  elapsedMs: number;
}

export type TopoTier = 'starter' | 'professional' | 'enterprise';

export interface TopoGatingContext {
  tier: TopoTier;
  physics: PhysicsValidation;
  /** True if the request is part of an enterprise optimization workflow. */
  enterpriseWorkflow?: boolean;
  /** Voxel count of the requested grid. */
  voxelCount: number;
}

export interface TopoGatingDecision {
  allowed: boolean;
  reason?: string;
  upgradeTo?: TopoTier;
}

export type { RawMesh, SDFGrid, Material, ManufacturingProcess };
