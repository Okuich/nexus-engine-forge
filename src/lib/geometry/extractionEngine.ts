/**
 * Midwater Geometry Engine — Feature Extraction Engine
 *
 * Standalone, framework-agnostic feature extraction from raw mesh data.
 * Produces per-face features, adjacency graph, aggregate stats,
 * and a 12-dimensional feature matrix for downstream ML (GNN).
 *
 * Input: { positions: number[], indices?: number[] }
 * Output: GeometryFeatureSet with nodeFeatures, edges, stats
 */

import type {
  RawMesh,
  Vec3,
  SurfaceClass,
  FaceFeatures,
  GeometryFeatureSet,
  BoundingBox,
  CurvatureStats,
  GeometryStats,
} from './types';
import { MeshValidationError, MeshErrorCode } from './types';
import { validateMesh } from './meshValidator';
import {
  triangleArea,
  triangleNormal,
  triangleCentroid,
  signedTetrahedronVolume,
  classifySurface,
} from './meshMath';
import { buildAdjacencyGraph, connectedComponents } from './adjacencyGraph';

// ─── Internal Helpers ────────────────────────────────────────────

function getVertex(positions: ArrayLike<number>, idx: number): Vec3 {
  return [positions[idx * 3], positions[idx * 3 + 1], positions[idx * 3 + 2]];
}

function computeBoundingBox(positions: ArrayLike<number>): BoundingBox {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];

  for (let i = 0; i < positions.length; i += 3) {
    for (let c = 0; c < 3; c++) {
      if (positions[i + c] < min[c]) min[c] = positions[i + c];
      if (positions[i + c] > max[c]) max[c] = positions[i + c];
    }
  }

  const center: Vec3 = [
    (min[0] + max[0]) / 2,
    (min[1] + max[1]) / 2,
    (min[2] + max[2]) / 2,
  ];

  const diagonal = Math.max(
    max[0] - min[0],
    max[1] - min[1],
    max[2] - min[2],
    1e-9,
  );

  return { min, max, center, diagonal };
}

// ─── Main Extraction Function ────────────────────────────────────

/**
 * Extract geometry features from a raw triangulated mesh.
 *
 * Pipeline:
 *   1. Validate input mesh
 *   2. Compute per-face base features (area, normal, centroid)
 *   3. Build face-adjacency graph (O(F) integer hashing)
 *   4. Estimate curvatures from graph neighborhoods
 *   5. Classify surfaces from curvature signatures
 *   6. Compute aggregate statistics
 *   7. Build 12-d feature matrix for ML
 *
 * @throws MeshValidationError on invalid input
 */
export function extractFeatures(mesh: RawMesh): GeometryFeatureSet {
  // ── Step 1: Validate ──────────────────────────────
  const validation = validateMesh(mesh);
  const { vertexCount, faceCount } = validation;

  const positions = mesh.positions;

  // Build indices if not provided
  let indices: ArrayLike<number>;
  if (mesh.indices) {
    indices = mesh.indices;
  } else {
    const seq = new Uint32Array(vertexCount);
    for (let i = 0; i < vertexCount; i++) seq[i] = i;
    indices = seq;
  }

  // ── Step 2: Per-face base features ────────────────
  const faces: FaceFeatures[] = new Array(faceCount);
  const normals: Vec3[] = new Array(faceCount);

  for (let f = 0; f < faceCount; f++) {
    const v0 = getVertex(positions, indices[f * 3]);
    const v1 = getVertex(positions, indices[f * 3 + 1]);
    const v2 = getVertex(positions, indices[f * 3 + 2]);

    const area = triangleArea(v0, v1, v2);
    const normal = triangleNormal(v0, v1, v2);
    const centroid = triangleCentroid(v0, v1, v2);

    normals[f] = normal;

    faces[f] = {
      id: f,
      area,
      normal,
      centroid,
      curvatureMean: 0,
      curvatureGaussian: 0,
      curvatureMin: 0,
      curvatureMax: 0,
      surfaceClass: 'planar',
    };
  }

  // ── Step 3: Build adjacency graph ─────────────────
  const graph = buildAdjacencyGraph(indices, positions, normals);

  // ── Step 4: Curvature estimation ──────────────────
  // Use dihedral angles from adjacency as curvature proxies
  for (let f = 0; f < faceCount; f++) {
    const nbrs = graph.neighbors.get(f);
    if (!nbrs || nbrs.length === 0) continue;

    // Collect dihedral angles for this face's adjacencies
    const angles: number[] = [];
    for (const adj of graph.adjacency) {
      if (adj.faceA === f || adj.faceB === f) {
        angles.push(adj.dihedralAngle);
      }
    }

    if (angles.length === 0) continue;

    const meanAngle = angles.reduce((s, a) => s + a, 0) / angles.length;
    const maxAngle = Math.max(...angles);
    const minAngle = Math.min(...angles);

    // Convert dihedral angles to curvature estimates
    // κ ≈ 2 × sin(θ/2) / edge_length (simplified discrete curvature)
    faces[f].curvatureMean = meanAngle;
    faces[f].curvatureGaussian = minAngle * maxAngle * (meanAngle > 0.1 ? 1 : 0);
    faces[f].curvatureMin = minAngle;
    faces[f].curvatureMax = maxAngle;

    // ── Step 5: Surface classification ──────────────
    faces[f].surfaceClass = classifySurface(minAngle, maxAngle);
  }

  // ── Step 6: Map graph adjacency to EdgeFeatures ───
  const edges = graph.adjacency;

  // ── Step 7: Bounding box ──────────────────────────
  const bb = computeBoundingBox(positions);

  // ── Step 8: Volume (signed tetrahedra) ────────────
  let volume = 0;
  for (let f = 0; f < faceCount; f++) {
    const v0 = getVertex(positions, indices[f * 3]);
    const v1 = getVertex(positions, indices[f * 3 + 1]);
    const v2 = getVertex(positions, indices[f * 3 + 2]);
    volume += signedTetrahedronVolume(v0, v1, v2);
  }
  volume = Math.abs(volume);

  // ── Step 9: Surface class distribution ────────────
  const dist: Record<SurfaceClass, number> = {
    planar: 0, cylindrical: 0, spherical: 0,
    conical: 0, toroidal: 0, freeform: 0,
  };
  for (const f of faces) dist[f.surfaceClass]++;

  // ── Step 10: Curvature statistics ─────────────────
  let sumGaussian = 0;
  let sumMean = 0;
  let maxAbs = 0;

  for (const f of faces) {
    sumGaussian += f.curvatureGaussian;
    sumMean += f.curvatureMean;
    maxAbs = Math.max(maxAbs, Math.abs(f.curvatureMax));
  }

  const n = faceCount || 1;
  const meanGaussian = sumGaussian / n;
  const meanMeanCurv = sumMean / n;

  let variance = 0;
  for (const f of faces) {
    variance += (f.curvatureGaussian - meanGaussian) ** 2;
  }
  variance /= n;

  const curvatureStats: CurvatureStats = {
    meanGaussian: +meanGaussian.toFixed(6),
    meanMean: +meanMeanCurv.toFixed(6),
    maxAbsCurvature: +maxAbs.toFixed(6),
    variance: +variance.toFixed(8),
  };

  // ── Step 11: Complexity score ─────────────────────
  // κ = (σ_curvature / σ_max) × (f_freeform / f_total)
  const sigmaMax = maxAbs > 0 ? maxAbs : 1;
  const sigmaVar = Math.sqrt(variance);
  const freeformFraction = dist.freeform / n;
  const complexityScore = +(
    (sigmaVar / sigmaMax) * freeformFraction
  ).toFixed(6);

  // ── Step 12: Connected components ─────────────────
  const components = connectedComponents(graph);

  // ── Step 13: Aggregate stats ──────────────────────
  const totalArea = faces.reduce((s, f) => s + f.area, 0);

  const stats: GeometryStats = {
    totalFaces: faceCount,
    totalEdges: edges.length,
    totalVertices: vertexCount,
    totalArea,
    volume,
    boundingBox: bb,
    surfaceClassDistribution: dist,
    curvatureStats,
    connectedComponents: components.length,
    complexityScore,
  };

  // ── Step 14: Feature matrix [N × 12] ──────────────
  // Columns: area, nx, ny, nz, cx, cy, cz, κ_min, κ_max, K, H, relative_area
  const meanArea = totalArea / n;

  const nodeFeatures: number[][] = faces.map((f) => [
    f.area,
    f.normal[0],
    f.normal[1],
    f.normal[2],
    (f.centroid[0] - bb.center[0]) / bb.diagonal,
    (f.centroid[1] - bb.center[1]) / bb.diagonal,
    (f.centroid[2] - bb.center[2]) / bb.diagonal,
    f.curvatureMin,
    f.curvatureMax,
    f.curvatureGaussian,
    f.curvatureMean,
    meanArea > 0 ? f.area / meanArea : 0,
  ]);

  return {
    faces,
    edges,
    graph,
    stats,
    nodeFeatures,
    edgeIndex: graph.edgeIndex,
    edgeAttr: graph.edgeAttr,
  };
}

/**
 * Serialize a GeometryFeatureSet to a PyTorch Geometric–compatible dict.
 * Suitable for JSON export and consumption by Python ML pipelines.
 */
export function toGraphDict(features: GeometryFeatureSet) {
  return {
    num_nodes: features.stats.totalFaces,
    num_edges: features.graph.numEdges * 2,
    node_feature_dim: 12,
    edge_feature_dim: 4,
    x: features.nodeFeatures,
    edge_index: features.edgeIndex,
    edge_attr: features.edgeAttr,
    degree: features.graph.degree,
    stats: {
      total_area: features.stats.totalArea,
      volume: features.stats.volume,
      bounding_box: features.stats.boundingBox,
      surface_class_distribution: features.stats.surfaceClassDistribution,
      curvature_stats: features.stats.curvatureStats,
      complexity_score: features.stats.complexityScore,
      connected_components: features.stats.connectedComponents,
    },
  };
}
