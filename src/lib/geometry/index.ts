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

// ── Three.js integration (existing, backward-compatible) ────────
export {
  extractGeometryFeatures,
  extractSceneFeatures,
} from './featureExtractor';
