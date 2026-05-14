/**
 * Geometry Simplification Engine — public API
 *
 * Capabilities:
 *   - QEM mesh simplification with sharp-edge / boundary preservation
 *   - Multi-resolution LOD generation
 *   - Heavy-Edge-Matching graph coarsening
 *   - Inference-pipeline payload packaging
 *   - Tier-based gating for large-scale + high-volume workloads
 */

export { simplifyMesh } from './quadricSimplifier';
export { buildLODs } from './lod';
export type { LODOptions } from './lod';
export { simplifyGraph } from './graphSimplifier';
export { prepareForInference } from './inferencePipeline';
export type { InferencePrepOptions } from './inferencePipeline';
export { checkSimplificationGate } from './gating';
export { checkFidelity, checkLODFidelity } from './fidelity';
export type { FidelityOptions, FidelityReport } from './fidelity';
export {
  SimplificationGateError,
} from './types';
export type {
  SimplifyOptions,
  SimplifiedMesh,
  SimplifiedLOD,
  SimplificationStats,
  MultiResolutionResult,
  SimplifiedGraph,
  GraphSimplifyOptions,
  InferenceReadyPayload,
  SimplificationTier,
  SimplificationGatingContext,
  SimplificationGatingDecision,
} from './types';
