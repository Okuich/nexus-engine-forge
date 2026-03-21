/**
 * Midwater Geometry Engine — Core Type Definitions
 *
 * Framework-agnostic types for mesh representation,
 * feature extraction, and graph construction.
 * Decoupled from Three.js for backend/edge-function use.
 */

// ─── Raw Mesh Input ──────────────────────────────────────────────

/** A 3-component vector [x, y, z] */
export type Vec3 = [number, number, number];

/**
 * Raw triangulated mesh input.
 * Accepts either indexed or non-indexed geometry.
 */
export interface RawMesh {
  /** Flat array of vertex positions [x0,y0,z0, x1,y1,z1, ...] */
  positions: Float32Array | Float64Array | number[];
  /** Optional triangle index array. If omitted, positions are treated as sequential triangles. */
  indices?: Uint32Array | Uint16Array | number[];
}

// ─── Surface Classification ──────────────────────────────────────

export type SurfaceClass =
  | 'planar'
  | 'cylindrical'
  | 'spherical'
  | 'conical'
  | 'toroidal'
  | 'freeform';

// ─── Per-Face Features ───────────────────────────────────────────

export interface FaceFeatures {
  /** Face index */
  id: number;
  /** Triangle area (model units²) */
  area: number;
  /** Unit face normal */
  normal: Vec3;
  /** Face centroid */
  centroid: Vec3;
  /** Discrete mean curvature (angle-deficit from neighbors) */
  curvatureMean: number;
  /** Discrete Gaussian curvature */
  curvatureGaussian: number;
  /** Minimum principal curvature estimate */
  curvatureMin: number;
  /** Maximum principal curvature estimate */
  curvatureMax: number;
  /** Classified surface type */
  surfaceClass: SurfaceClass;
}

// ─── Per-Edge (Adjacency) Features ───────────────────────────────

export interface EdgeFeatures {
  /** Edge index */
  id: number;
  /** First adjacent face */
  faceA: number;
  /** Second adjacent face */
  faceB: number;
  /** Shared vertex indices from original mesh */
  sharedVertices: [number, number];
  /** Dihedral angle between face normals (radians) */
  dihedralAngle: number;
  /** Whether the junction is concave */
  isConcave: boolean;
  /** Length of the shared geometric edge */
  length: number;
}

// ─── Face-Adjacency Graph ────────────────────────────────────────

export interface FaceAdjacencyGraph {
  /** Number of face-nodes */
  numNodes: number;
  /** Number of undirected adjacency edges */
  numEdges: number;
  /** Full adjacency entries */
  adjacency: EdgeFeatures[];
  /** COO edge_index [2 × 2·numEdges] (both directions for GNN) */
  edgeIndex: [number[], number[]];
  /** Edge attribute matrix [2·numEdges × 4] aligned with edgeIndex */
  edgeAttr: number[][];
  /** Per-node neighbor list */
  neighbors: Map<number, number[]>;
  /** Degree of each node */
  degree: number[];
}

// ─── Aggregate Statistics ────────────────────────────────────────

export interface BoundingBox {
  min: Vec3;
  max: Vec3;
  /** Longest axis dimension */
  diagonal: number;
  /** Centroid of the bounding box */
  center: Vec3;
}

export interface CurvatureStats {
  meanGaussian: number;
  meanMean: number;
  maxAbsCurvature: number;
  variance: number;
}

export interface GeometryStats {
  totalFaces: number;
  totalEdges: number;
  totalVertices: number;
  totalArea: number;
  /** Enclosed volume (signed tetrahedra method) */
  volume: number;
  boundingBox: BoundingBox;
  surfaceClassDistribution: Record<SurfaceClass, number>;
  curvatureStats: CurvatureStats;
  connectedComponents: number;
  /** Geometric complexity score κ = (σ_curvature / σ_max) × (f_freeform / f_total) */
  complexityScore: number;
}

// ─── Complete Feature Set ────────────────────────────────────────

export interface GeometryFeatureSet {
  /** Per-face feature records */
  faces: FaceFeatures[];
  /** Per-edge adjacency records */
  edges: EdgeFeatures[];
  /** The face-adjacency graph */
  graph: FaceAdjacencyGraph;
  /** Aggregate statistics */
  stats: GeometryStats;
  /** Feature matrix [numFaces × 12] for ML consumption */
  nodeFeatures: number[][];
  /** COO edge index [2 × numEdges×2] */
  edgeIndex: [number[], number[]];
  /** Edge attribute matrix aligned with edgeIndex */
  edgeAttr: number[][];
}

// ─── Validation ──────────────────────────────────────────────────

export class MeshValidationError extends Error {
  constructor(
    message: string,
    public readonly code: MeshErrorCode,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'MeshValidationError';
  }
}

export enum MeshErrorCode {
  EMPTY_POSITIONS = 'EMPTY_POSITIONS',
  INVALID_VERTEX_COUNT = 'INVALID_VERTEX_COUNT',
  INVALID_INDEX = 'INVALID_INDEX',
  DEGENERATE_FACE = 'DEGENERATE_FACE',
  NON_FINITE_VALUE = 'NON_FINITE_VALUE',
  INDEX_OUT_OF_BOUNDS = 'INDEX_OUT_OF_BOUNDS',
}
