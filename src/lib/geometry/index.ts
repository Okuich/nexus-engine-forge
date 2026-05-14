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

// ── Three.js integration (existing, backward-compatible) ────────
export {
  extractGeometryFeatures,
  extractSceneFeatures,
} from './featureExtractor';
