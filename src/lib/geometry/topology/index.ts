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
export { runSIMPGPU, runSIMPAuto, hasWebGPUForSIMP, WebGPUUnavailableError } from './simpGpu';
export type { SimpGpuRunResult } from './simpGpu';
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
export { applyConstraintPenalties } from './constraintPenalties';
export type { ConstraintPenaltyOptions, PenaltyDiagnostics } from './constraintPenalties';
export { marchingCubes, meshFromDensity } from './marchingCubes';
export type { DensityField, MarchingCubesOptions } from './marchingCubes';
export { exportSTL, exportSTLBinary, exportOBJ, exportMesh } from './meshExport';
export type { ExportFormat, ExportOptions } from './meshExport';
export { proposalToMesh } from './proposalMesh';
export type { ProposalMeshOptions, ProposalMeshResult } from './proposalMesh';
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
