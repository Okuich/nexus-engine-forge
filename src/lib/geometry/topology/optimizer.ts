/**
 * Topology Optimization Engine — main entry point.
 *
 * Pipeline:
 *   1. Gate the request against tier / physics validation / training data.
 *   2. Voxelize the input mesh into a design domain.
 *   3. Run SIMP iterations with force-flow surrogate for compliance.
 *   4. Apply manufacturability post-processing (symmetry, min-feature,
 *      overhang, connectivity).
 *   5. Estimate cost / mass / safety against the original baseline.
 *   6. Return a TopoProposal — supports `resumeFrom` for iterative refinement.
 */
import type { RawMesh } from '../types';
import { MATERIAL_DB } from '../optimization/materials';
import type {
  LoadCondition,
  SupportCondition,
  ManufacturingConstraints,
  PhysicsValidation,
  CostObjective,
  TopoOptimizerOptions,
  TopoProposal,
  TopoTier,
} from './types';
import { voxelizeForTopology } from './voxelizer';
import { runSIMP } from './simp';
import { applyManufacturability } from './manufacturability';
import { checkTopoGate, TopoGateError } from './gating';

export interface TopologyOptimizationRequest {
  mesh: RawMesh;
  loads: LoadCondition[];
  supports: SupportCondition[];
  manufacturing: ManufacturingConstraints;
  physics: PhysicsValidation;
  cost: CostObjective;
  tier: TopoTier;
  enterpriseWorkflow?: boolean;
  options?: TopoOptimizerOptions;
}

function estimateProposalMetrics(
  binary: Uint8Array,
  voxelSize: number,
  cost: CostObjective,
  totalLoadN: number,
): { volumeMm3: number; massG: number; costUsd: number; safety: number } {
  const props = MATERIAL_DB[cost.material];
  const cellVol = voxelSize ** 3;
  let solid = 0;
  for (let i = 0; i < binary.length; i++) solid += binary[i];
  const volumeMm3 = solid * cellVol;
  const massKg = (volumeMm3 * 1e-9) * props.density;
  const massG = massKg * 1000;
  const matCost = massKg * props.costPerKg;
  const procCost = (volumeMm3 / 1000) * 0.45 / Math.max(0.1, props.machinability);
  const costUsd = matCost + procCost;
  // crude safety = yield / (load / cross-section); cross-section ≈ solid^(2/3) cells
  const charAreaMm2 = Math.max(1, Math.pow(solid, 2 / 3) * voxelSize * voxelSize);
  const stressMpa = totalLoadN / charAreaMm2;
  const safety = props.yieldStrength / Math.max(0.01, stressMpa);
  return { volumeMm3, massG, costUsd, safety };
}

export function optimizeTopology(req: TopologyOptimizationRequest): TopoProposal {
  const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const resolution = req.options?.resolution ?? 48;

  const decision = checkTopoGate({
    tier: req.tier,
    physics: req.physics,
    enterpriseWorkflow: req.enterpriseWorkflow,
    voxelCount: resolution * resolution * resolution,
  });
  if (!decision.allowed) throw new TopoGateError(decision);

  const domain = voxelizeForTopology(req.mesh, resolution);
  const simp = runSIMP(domain, req.loads, req.supports, req.options);

  const { binary, density: postDensity } = applyManufacturability(simp.density, {
    constraints: req.manufacturing,
    domain,
    supportPoints: req.supports.map(s => s.point),
  });

  const totalLoad = req.loads.reduce((s, l) => s + Math.hypot(...l.force), 0);
  const metrics = estimateProposalMetrics(binary, domain.voxelSize, req.cost, totalLoad);

  let solidCount = 0;
  for (let i = 0; i < binary.length; i++) solidCount += binary[i];
  let designCount = 0;
  for (let i = 0; i < domain.designMask.length; i++) designCount += domain.designMask[i];

  const elapsedMs = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
  return {
    density: postDensity,
    dims: domain.dims,
    origin: domain.origin,
    voxelSize: domain.voxelSize,
    compliance: simp.compliance,
    volumeFraction: solidCount / Math.max(1, designCount),
    estMassG: metrics.massG,
    estUnitCostUsd: metrics.costUsd,
    estSafetyFactor: metrics.safety,
    iterations: simp.iterations,
    converged: simp.converged,
    manufacturable: true,
    elapsedMs,
  };
}

/** Iterative refinement — refine an existing proposal at higher resolution. */
export function refineTopology(
  prev: TopoProposal,
  req: TopologyOptimizationRequest,
  newOptions?: TopoOptimizerOptions,
): TopoProposal {
  const merged: TopologyOptimizationRequest = {
    ...req,
    options: {
      ...req.options,
      ...newOptions,
      resumeFrom: prev.density,
    },
  };
  return optimizeTopology(merged);
}
