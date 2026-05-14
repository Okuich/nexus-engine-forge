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

// ── Geometry traversal pipeline (auto-routes to KD/BVH/Octree) ─
export { GeometryTraversal, createTraversal } from './traversal';
export type { TraversalOptions, NearestTriangleResult } from './traversal';

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

// ── Symbolic / algebraic geometry engine (interface only) ───────
export {
  SymbolicEngine,
  symbolicRegistry,
  makeCapabilities,
  stubBackend,
  SymbolicNotImplementedError,
  SymbolicBackendError,
} from './symbolic';
export type {
  SymbolicBackend,
  SymbolicCapabilities,
  SymbolicScalar,
  SymbolicExpr,
  SymbolicSymbol,
  SymbolBinding,
  SymbolicPrimitive,
  SymbolicPrimitiveKind,
  SymbolicConstraint,
  ConstraintKind,
  BooleanOp,
  DifferentialOp,
  GeometricPredicate,
  SymbolicResult,
  SolveOutcome,
  DispatchOptions,
  CapabilityFlag,
} from './symbolic';

// ── Manifold analysis extension layer (interface only) ─────────
export {
  ManifoldEngine,
  manifoldRegistry,
  makeManifoldCapabilities,
  stubManifoldBackend,
  ManifoldNotImplementedError,
  ManifoldBackendError,
} from './manifold';
export type {
  ManifoldBackend,
  ManifoldCapabilities,
  ManifoldKind,
  ManifoldRepresentation,
  ManifoldDescriptor,
  ManifoldPoint,
  TangentVector,
  Covector,
  MetricTensor,
  CurvatureSample,
  Geodesic,
  TopologicalInvariants,
  PersistencePair,
  PersistenceDiagram,
  ManifoldMap,
  MapKind,
  DECOperator,
  ManifoldResult,
  ManifoldDispatch,
  ManifoldCapabilityFlag,
} from './manifold';

// ── Topology reasoning extension layer (interface only) ────────
export {
  TopologyReasoningEngine,
  topologyRegistry,
  makeTopologyCapabilities,
  stubTopologyBackend,
  TopologyNotImplementedError,
  TopologyBackendError,
} from './topologyReasoning';
export type {
  TopologyBackend,
  TopologyCapabilities,
  GraphKind,
  GraphFlavor,
  GraphDescriptor,
  NodeRef,
  EdgeRef,
  CentralityKind,
  CommunityAlgorithm,
  GraphIsomorphismKind,
  PathKind,
  FlowKind,
  GraphInvariants,
  CommunityPartition,
  CentralityScores,
  PathResult,
  FlowResult,
  IsomorphismResult,
  MotifQuery,
  MotifMatch,
  GraphTransform,
  TopologyResult,
  TopologyDispatch,
  TopologyCapabilityFlag,
} from './topologyReasoning';

// ── Three.js integration (existing, backward-compatible) ────────
export {
  extractGeometryFeatures,
  extractSceneFeatures,
} from './featureExtractor';
