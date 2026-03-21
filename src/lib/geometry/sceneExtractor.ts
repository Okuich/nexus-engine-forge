/**
 * React hook + helpers for running geometry feature extraction
 * from Three.js scenes inside the CAD viewer.
 */

import { useCallback } from "react";
import * as THREE from "three";
import {
  extractGeometryFeatures,
  extractSceneFeatures,
  type GeometryFeatureSet,
} from "./featureExtractor";

/**
 * Collect all BufferGeometry instances from a Three.js Object3D tree.
 */
export function collectGeometries(root: THREE.Object3D): THREE.BufferGeometry[] {
  const geometries: THREE.BufferGeometry[] = [];
  root.traverse((child) => {
    if (child instanceof THREE.Mesh && child.geometry instanceof THREE.BufferGeometry) {
      // Apply world matrix so positions are in world space
      const geo = child.geometry.clone();
      geo.applyMatrix4(child.matrixWorld);
      geometries.push(geo);
    }
  });
  return geometries;
}

/**
 * Run feature extraction on all meshes under a scene root.
 * Returns the full feature set or null if no geometry found.
 */
export function extractFeaturesFromScene(scene: THREE.Object3D): GeometryFeatureSet | null {
  const geometries = collectGeometries(scene);
  if (geometries.length === 0) return null;

  const result = extractSceneFeatures(geometries);

  // Clean up cloned geometries
  geometries.forEach((g) => g.dispose());

  return result;
}

/**
 * Serialize GeometryFeatureSet to a JSON blob URL for download.
 */
export function featureSetToDownloadUrl(features: GeometryFeatureSet, filename: string): string {
  const output = {
    filename,
    extracted_at: new Date().toISOString(),
    stats: {
      ...features.stats,
      surfaceClassDistribution: features.stats.surfaceClassDistribution,
    },
    // ── PyG-compatible graph ─────────────────────────
    graph: {
      num_nodes: features.graph.numNodes,
      num_edges: features.graph.numEdges * 2,
      node_feature_dim: 12,
      edge_feature_dim: 3,
      x: features.featureMatrix,
      edge_index: features.edgeIndex,
      edge_attr: features.edgeAttr,
      degree: features.graph.degree,
      connected_components: features.stats.connectedComponents,
    },
    // ── Detailed per-face data ───────────────────────
    faces: features.faces.map((f) => ({
      id: f.id,
      surface_class: f.surfaceClass,
      area: +f.area.toFixed(6),
      normal: f.normal.map((v) => +v.toFixed(6)),
      centroid: f.centroid.map((v) => +v.toFixed(4)),
      curvature: {
        min: +f.curvatureMin.toFixed(6),
        max: +f.curvatureMax.toFixed(6),
        gaussian: +f.curvatureGaussian.toFixed(8),
        mean: +f.curvatureMean.toFixed(6),
      },
    })),
    // ── Adjacency list ───────────────────────────────
    adjacency: features.graph.adjacency.map((a) => ({
      id: a.id,
      face_a: a.faceA,
      face_b: a.faceB,
      shared_vertices: a.sharedVertices,
      dihedral_angle: +a.dihedralAngle.toFixed(6),
      is_concave: a.isConcave,
      edge_length: +a.edgeLength.toFixed(4),
    })),
  };

  const blob = new Blob([JSON.stringify(output, null, 2)], { type: "application/json" });
  return URL.createObjectURL(blob);
}
