/**
 * Computational Geometry Core Layer.
 *
 *   • Mesh generation (procedural primitives + retessellation)
 *   • Topology analysis (Euler, manifold, genus, watertight)
 *   • Spatial acceleration (BVH, uniform grid)
 *   • STEP processing (parser + pluggable tessellator)
 *
 * All exports are framework-agnostic and consumed by the higher-level
 * geometry feature extraction, optimization, and ML pipelines.
 */

export {
  generateBox,
  generateSphere,
  generateCylinder,
  generateCone,
  generatePlane,
  subdivide,
  normalizeIndexed,
} from './meshGenerator';
export type {
  BoxOptions,
  SphereOptions,
  CylinderOptions,
  ConeOptions,
  PlaneOptions,
} from './meshGenerator';

export { analyzeTopology } from './topology';
export type { TopologyReport } from './topology';

export { BVH, UniformGrid, aabb } from './spatialIndex';
export type {
  AABB,
  Ray,
  RayHit,
  BVHOptions,
  UniformGridOptions,
} from './spatialIndex';

export {
  parseStep,
  processStep,
} from './stepProcessor';
export type {
  StepHeader,
  StepEntity,
  StepDocument,
  StepProcessResult,
  StepTessellator,
  StepTessellationOptions,
  ProcessStepOptions,
} from './stepProcessor';
