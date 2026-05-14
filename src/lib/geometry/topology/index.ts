/**
 * Topology Optimization Engine — public API.
 *
 *   • optimizeTopology     — single-shot SIMP pipeline + manufacturability
 *   • refineTopology       — iterative refinement from a prior proposal
 *   • runSIMP              — low-level SIMP solver
 *   • voxelizeForTopology  — mesh → design domain via SDF
 *   • applyManufacturability — post-processing (symmetry, overhang, min-feature)
 *   • checkTopoGate / TopoGateError — entitlement controls
 */
export { optimizeTopology, refineTopology } from './optimizer';
export type { TopologyOptimizationRequest } from './optimizer';
export { runSIMP } from './simp';
export { voxelizeForTopology, worldToVoxel } from './voxelizer';
export type { VoxelDomain } from './voxelizer';
export {
  thresholdDensity,
  enforceSymmetry,
  openMorphology,
  enforceOverhang,
  keepConnectedToSupports,
  applyManufacturability,
} from './manufacturability';
export { checkTopoGate, TopoGateError, TOPO_GATING_LIMITS } from './gating';
export type {
  LoadCondition,
  SupportCondition,
  ManufacturingConstraints,
  PhysicsValidation,
  CostObjective,
  TopoOptimizerOptions,
  TopoIterationState,
  TopoProposal,
  TopoTier,
  TopoGatingContext,
  TopoGatingDecision,
  V3,
} from './types';
