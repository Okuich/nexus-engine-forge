/**
 * FORGECAD Geometry Feature Extraction Engine
 *
 * Extracts per-face geometric features from Three.js BufferGeometry:
 *   - surface area
 *   - normal vector
 *   - curvature estimation (discrete differential geometry)
 *   - surface classification (planar / cylindrical / spherical / freeform)
 *
 * Outputs structured feature vectors for downstream ML (GNN).
 */

import * as THREE from "three";
import { buildFaceAdjacency, connectedComponents, type FaceAdjacencyGraph } from "./graphBuilder";

// ─── Types ───────────────────────────────────────────────────────

export type SurfaceClass = "planar" | "cylindrical" | "spherical" | "conical" | "toroidal" | "freeform";

export interface FaceFeatures {
  id: number;
  /** Triangle area in model units² */
  area: number;
  /** Unit face normal */
  normal: [number, number, number];
  /** Face centroid */
  centroid: [number, number, number];
  /** Discrete mean curvature (angle-deficit approximation) */
  curvatureMean: number;
  /** Discrete Gaussian curvature (angle-deficit) */
  curvatureGaussian: number;
  /** Min / max principal curvature estimates */
  curvatureMin: number;
  curvatureMax: number;
  /** Surface classification based on curvature signature */
  surfaceClass: SurfaceClass;
}

export interface EdgeFeatures {
  id: number;
  /** Indices of the two adjacent faces */
  faceA: number;
  faceB: number;
  /** Dihedral angle in radians between the two face normals */
  dihedralAngle: number;
  /** Whether the edge is concave */
  isConcave: boolean;
  /** Edge length */
  length: number;
}

export interface GeometryFeatureSet {
  /** Per-face feature vectors */
  faces: FaceFeatures[];
  /** Per-edge features (face adjacency) */
  edges: EdgeFeatures[];
  /** The face-adjacency graph (for downstream use) */
  graph: FaceAdjacencyGraph;
  /** Aggregate statistics */
  stats: {
    totalFaces: number;
    totalEdges: number;
    totalVertices: number;
    totalArea: number;
    volume: number;
    boundingBox: { min: [number, number, number]; max: [number, number, number] };
    surfaceClassDistribution: Record<SurfaceClass, number>;
    curvatureStats: {
      meanGaussian: number;
      meanMean: number;
      maxAbsCurvature: number;
      variance: number;
    };
    connectedComponents: number;
  };
  /** Fixed-length feature matrix [numFaces x 12] for ML */
  featureMatrix: number[][];
  /** COO edge index [2 x numEdges*2] for PyG-style GNNs */
  edgeIndex: [number[], number[]];
  /** Edge attribute matrix [numEdges*2 x 3] aligned with edgeIndex */
  edgeAttr: number[][];
}

// ─── Helpers ─────────────────────────────────────────────────────

const _v0 = new THREE.Vector3();
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _e1 = new THREE.Vector3();
const _e2 = new THREE.Vector3();
const _cross = new THREE.Vector3();

function triangleArea(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3): number {
  _e1.subVectors(b, a);
  _e2.subVectors(c, a);
  _cross.crossVectors(_e1, _e2);
  return _cross.length() * 0.5;
}

function triangleNormal(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3): THREE.Vector3 {
  _e1.subVectors(b, a);
  _e2.subVectors(c, a);
  return new THREE.Vector3().crossVectors(_e1, _e2).normalize();
}

function triangleCentroid(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3): THREE.Vector3 {
  return new THREE.Vector3(
    (a.x + b.x + c.x) / 3,
    (a.y + b.y + c.y) / 3,
    (a.z + b.z + c.z) / 3,
  );
}

/** Classify surface from curvature signature (κ₁, κ₂). */
function classifySurface(kMin: number, kMax: number): SurfaceClass {
  const absMin = Math.abs(kMin);
  const absMax = Math.abs(kMax);
  const EPS = 1e-4;

  // Both curvatures ~0 → planar
  if (absMin < EPS && absMax < EPS) return "planar";
  // One ~0, one nonzero → cylindrical
  if (absMin < EPS && absMax > EPS) return "cylindrical";
  if (absMax < EPS && absMin > EPS) return "cylindrical";
  // Both equal → spherical
  if (Math.abs(kMin - kMax) / (absMax + 1e-12) < 0.15) return "spherical";
  // Same sign → elliptic (classify as spherical for simplicity)
  if (kMin * kMax > 0) return "conical";
  // Opposite sign → saddle / toroidal
  if (kMin * kMax < -EPS) return "toroidal";

  return "freeform";
}

// ─── Core Extraction ─────────────────────────────────────────────
/**
 * Extract full geometry features from a Three.js BufferGeometry.
 */
export function extractGeometryFeatures(geometry: THREE.BufferGeometry): GeometryFeatureSet {
  // Ensure we have normals and an index
  const geo = geometry.clone();
  if (!geo.index) {
    // Non-indexed geometry — create index
    const count = geo.attributes.position.count;
    const idx = new Uint32Array(count);
    for (let i = 0; i < count; i++) idx[i] = i;
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
  }
  geo.computeVertexNormals();

  const positions = geo.attributes.position.array as Float32Array;
  const index = Array.from(geo.index!.array);
  const numTris = index.length / 3;
  const numVerts = positions.length / 3;

  // ── Per-face base features ─────────────────────────
  const faces: FaceFeatures[] = [];

  for (let f = 0; f < numTris; f++) {
    const i0 = index[f * 3], i1 = index[f * 3 + 1], i2 = index[f * 3 + 2];
    _v0.set(positions[i0 * 3], positions[i0 * 3 + 1], positions[i0 * 3 + 2]);
    _v1.set(positions[i1 * 3], positions[i1 * 3 + 1], positions[i1 * 3 + 2]);
    _v2.set(positions[i2 * 3], positions[i2 * 3 + 1], positions[i2 * 3 + 2]);

    const area = triangleArea(_v0, _v1, _v2);
    const normal = triangleNormal(_v0, _v1, _v2);
    const centroid = triangleCentroid(_v0, _v1, _v2);

    faces.push({
      id: f,
      area,
      normal: [normal.x, normal.y, normal.z],
      centroid: [centroid.x, centroid.y, centroid.z],
      curvatureMean: 0,
      curvatureGaussian: 0,
      curvatureMin: 0,
      curvatureMax: 0,
      surfaceClass: "planar",
    });
  }

  // ── Graph construction (optimized topology traversal) ──
  const faceNormals: Array<[number, number, number]> = faces.map((f) => f.normal);
  const graph = buildFaceAdjacency(index, positions, faceNormals);

  // ── Curvature estimation from graph adjacency ──────
  for (const face of faces) {
    const nbrs = graph.neighbors.get(face.id);
    if (!nbrs || nbrs.length === 0) {
      face.surfaceClass = "planar";
      continue;
    }
    const angles: number[] = [];
    for (const adj of graph.adjacency) {
      if (adj.faceA === face.id || adj.faceB === face.id) {
        angles.push(adj.dihedralAngle);
      }
    }
    if (angles.length === 0) { face.surfaceClass = "planar"; continue; }

    const mean = angles.reduce((s, a) => s + a, 0) / angles.length;
    const max = Math.max(...angles);
    const min = Math.min(...angles);
    face.curvatureMean = mean;
    face.curvatureGaussian = min * max * (mean > 0.1 ? 1 : 0);
    face.curvatureMin = min;
    face.curvatureMax = max;
    face.surfaceClass = classifySurface(min, max);
  }

  // ── Map graph adjacency → EdgeFeatures ─────────────
  const edges: EdgeFeatures[] = graph.adjacency.map((a) => ({
    id: a.id,
    faceA: a.faceA,
    faceB: a.faceB,
    dihedralAngle: a.dihedralAngle,
    isConcave: a.isConcave,
    length: a.edgeLength,
  }));

  // ── Bounding box ───────────────────────────────────
  geo.computeBoundingBox();
  const bb = geo.boundingBox!;
  const bbMin: [number, number, number] = [bb.min.x, bb.min.y, bb.min.z];
  const bbMax: [number, number, number] = [bb.max.x, bb.max.y, bb.max.z];

  const center = [(bb.min.x + bb.max.x) / 2, (bb.min.y + bb.max.y) / 2, (bb.min.z + bb.max.z) / 2];
  const diag = Math.max(bb.max.x - bb.min.x, bb.max.y - bb.min.y, bb.max.z - bb.min.z, 1e-9);

  // ── Volume (signed tetrahedra sum) ─────────────────
  let volume = 0;
  for (let f = 0; f < numTris; f++) {
    const i0 = index[f * 3], i1 = index[f * 3 + 1], i2 = index[f * 3 + 2];
    const ax = positions[i0 * 3], ay = positions[i0 * 3 + 1], az = positions[i0 * 3 + 2];
    const bx = positions[i1 * 3], by = positions[i1 * 3 + 1], bz = positions[i1 * 3 + 2];
    const cx = positions[i2 * 3], cy = positions[i2 * 3 + 1], cz = positions[i2 * 3 + 2];
    volume += (ax * (by * cz - bz * cy) + bx * (cy * az - cz * ay) + cx * (ay * bz - az * by)) / 6;
  }
  volume = Math.abs(volume);

  // ── Surface class distribution ─────────────────────
  const dist: Record<SurfaceClass, number> = {
    planar: 0, cylindrical: 0, spherical: 0, conical: 0, toroidal: 0, freeform: 0,
  };
  for (const f of faces) dist[f.surfaceClass]++;

  // ── Curvature stats ────────────────────────────────
  let sumGaussian = 0, sumMean = 0, maxAbs = 0;
  for (const f of faces) {
    sumGaussian += f.curvatureGaussian;
    sumMean += f.curvatureMean;
    maxAbs = Math.max(maxAbs, Math.abs(f.curvatureMax));
  }
  const n = faces.length || 1;
  const meanGaussian = sumGaussian / n;
  const meanMean = sumMean / n;
  let variance = 0;
  for (const f of faces) variance += (f.curvatureGaussian - meanGaussian) ** 2;
  variance /= n;

  // ── Connected components ───────────────────────────
  const components = connectedComponents(graph);

  // ── Feature matrix [N x 12] ────────────────────────
  const totalArea = faces.reduce((s, f) => s + f.area, 0);
  const meanArea = totalArea / n;
  const featureMatrix: number[][] = faces.map((f) => [
    f.area,
    f.normal[0], f.normal[1], f.normal[2],
    (f.centroid[0] - center[0]) / diag,
    (f.centroid[1] - center[1]) / diag,
    (f.centroid[2] - center[2]) / diag,
    f.curvatureMin,
    f.curvatureMax,
    f.curvatureGaussian,
    f.curvatureMean,
    f.area / meanArea,
  ]);

  geo.dispose();

  return {
    faces,
    edges,
    graph,
    stats: {
      totalFaces: numTris,
      totalEdges: edges.length,
      totalVertices: numVerts,
      totalArea,
      volume,
      boundingBox: { min: bbMin, max: bbMax },
      surfaceClassDistribution: dist,
      curvatureStats: {
        meanGaussian: +meanGaussian.toFixed(6),
        meanMean: +meanMean.toFixed(6),
        maxAbsCurvature: +maxAbs.toFixed(6),
        variance: +variance.toFixed(8),
      },
      connectedComponents: components.length,
    },
    featureMatrix,
    edgeIndex: graph.edgeIndex,
    edgeAttr: graph.edgeAttr,
  };
}

/**
 * Extract features from multiple geometries (e.g. multi-mesh scene)
 * and merge into a single graph.
 */
export function extractSceneFeatures(geometries: THREE.BufferGeometry[]): GeometryFeatureSet {
  if (geometries.length === 0) {
    const emptyGraph: FaceAdjacencyGraph = {
      numNodes: 0, numEdges: 0, adjacency: [],
      edgeIndex: [[], []], edgeAttr: [],
      neighbors: new Map(), degree: [],
    };
    return {
      faces: [], edges: [], graph: emptyGraph,
      stats: {
        totalFaces: 0, totalEdges: 0, totalVertices: 0,
        totalArea: 0, volume: 0,
        boundingBox: { min: [0, 0, 0], max: [0, 0, 0] },
        surfaceClassDistribution: { planar: 0, cylindrical: 0, spherical: 0, conical: 0, toroidal: 0, freeform: 0 },
        curvatureStats: { meanGaussian: 0, meanMean: 0, maxAbsCurvature: 0, variance: 0 },
        connectedComponents: 0,
      },
      featureMatrix: [],
      edgeIndex: [[], []],
      edgeAttr: [],
    };
  }

  if (geometries.length === 1) return extractGeometryFeatures(geometries[0]);

  // Merge all geometries
  const merged = new THREE.BufferGeometry();
  const allPositions: number[] = [];
  const allIndices: number[] = [];
  let vertexOffset = 0;

  for (const geo of geometries) {
    const g = geo.index ? geo : geo.clone().toNonIndexed();
    const pos = g.attributes.position.array;
    for (let i = 0; i < pos.length; i++) allPositions.push(pos[i]);

    if (g.index) {
      for (let i = 0; i < g.index.count; i++) {
        allIndices.push(g.index.array[i] + vertexOffset);
      }
    } else {
      for (let i = 0; i < pos.length / 3; i++) {
        allIndices.push(i + vertexOffset);
      }
    }
    vertexOffset += pos.length / 3;
  }

  merged.setAttribute("position", new THREE.Float32BufferAttribute(allPositions, 3));
  merged.setIndex(allIndices);

  const result = extractGeometryFeatures(merged);
  merged.dispose();
  return result;
}
