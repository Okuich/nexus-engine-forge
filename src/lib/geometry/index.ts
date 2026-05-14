/**
 * Midwater Geometry Engine — Public API
 *
 * Re-exports the standalone extraction engine, types,
 * and the existing Three.js-based extractor for backward compatibility.
 */

// ── Standalone engine (framework-agnostic) ───────────────────────
export { extractFeatures, toGraphDict } from './extractionEngine';
export { validateMesh } from './meshValidator';
export { buildAdjacencyGraph, connectedComponents } from './adjacencyGraph';

// ── Computational geometry core layer ────────────────────────────
export * from './core';

// ── Spatial acceleration engine (KD-tree, BVH, Octree) ──────────
export { KDTree, Octree, buildSpatialIndex } from './spatial';
export type {
  KDQueryResult,
  KDTreeOptions,
  OctreeOptions,
  SpatialWorkload,
  SpatialIndex,
} from './spatial';

// ── Advanced ML feature extraction ──────────────────────────────
export {
  computeCurvature,
  computeThickness,
  computeSharpness,
  extractAdvancedFeatures,
  featureColumns,
} from './features';
export type {
  VertexCurvature,
  FaceCurvature,
  CurvatureField,
  ThicknessOptions,
  ThicknessResult,
  EdgeSharpness,
  SharpnessOptions,
  SharpnessReport,
  AdvancedFeatureOptions,
  AdvancedFeatureSet,
  FeatureColumn,
} from './features';

// ── Math primitives ──────────────────────────────────────────────
export {
  triangleArea,
  triangleNormal,
  triangleCentroid,
  signedTetrahedronVolume,
  dihedralAngle,
  isConcaveJunction,
  classifySurface,
  edgeHash,
} from './meshMath';

// ── Types ────────────────────────────────────────────────────────
export type {
  RawMesh,
  Vec3,
  SurfaceClass,
  FaceFeatures,
  EdgeFeatures,
  FaceAdjacencyGraph,
  BoundingBox,
  CurvatureStats,
  GeometryStats,
  GeometryFeatureSet,
} from './types';

export { MeshValidationError, MeshErrorCode } from './types';

// ── Geometry optimization engine ────────────────────────────────
export * from './optimization';

// ── Signed Distance Field engine ────────────────────────────────
export {
  generateSDF,
  generateSDFGPU,
  generateSDFGated,
  hasWebGPU,
  sampleSDF,
  isInside,
  nearestSurface,
  gradient,
  checkSDFGate,
  SDFGateError,
} from './sdf';
export type {
  SDFGenerationOptions,
  SDFGrid,
  NearestSurfaceResult,
  SDFTier,
  SDFGatingContext,
  SDFGatingDecision,
} from './sdf';

// ── Topology optimization engine ────────────────────────────────
export {
  optimizeTopology,
  refineTopology,
  runSIMP,
  voxelizeForTopology,
  applyManufacturability,
  checkTopoGate,
  TopoGateError,
} from './topology';
export type {
  TopologyOptimizationRequest,
  LoadCondition,
  SupportCondition,
  ManufacturingConstraints,
  PhysicsValidation,
  CostObjective,
  TopoOptimizerOptions,
  TopoProposal,
  TopoTier,
} from './topology';

// ── Geometry simplification engine ──────────────────────────────
export {
  simplifyMesh,
  buildLODs,
  simplifyGraph,
  prepareForInference,
  checkSimplificationGate,
  SimplificationGateError,
} from './simplification';
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
  LODOptions,
  InferencePrepOptions,
} from './simplification';

// ── Collision & interference analysis engine ────────────────────
export {
  detectCollisions,
  detectCollisionsGated,
  sweepMotion,
  sweepMotionGated,
  checkCollisionGate,
  trianglesIntersect,
  CollisionGateError,
} from './collision';
export type {
  AssemblyPart,
  MovingPart,
  Transform as CollisionTransform,
  MotionKeyframe,
  CollisionDetectionOptions,
  CollisionPair,
  InterferenceReport,
  MotionSweepOptions,
  MotionSweepResult,
  CollisionTier,
  CollisionGatingContext,
  CollisionGatingDecision,
} from './collision';

// ── Three.js integration (existing, backward-compatible) ────────
export {
  extractGeometryFeatures,
  extractSceneFeatures,
} from './featureExtractor';
