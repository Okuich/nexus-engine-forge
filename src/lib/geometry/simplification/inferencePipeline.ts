/**
 * Inference-pipeline integration.
 *
 * Packages simplification outputs into an ML-ready payload:
 *   - coarsest mesh for fast model passes
 *   - full LOD stack for hierarchical models
 *   - coarsened face graph + flat feature matrix
 *
 * Designed to feed directly into the geometry feature pipeline used
 * by Midwater's pricing / DFM / classification models.
 */

import type { FaceAdjacencyGraph, RawMesh } from '../types';
import { buildLODs, type LODOptions } from './lod';
import { simplifyGraph } from './graphSimplifier';
import { checkSimplificationGate } from './gating';
import {
  SimplificationGateError,
  type GraphSimplifyOptions,
  type InferenceReadyPayload,
  type SimplificationGatingContext,
} from './types';

export interface InferencePrepOptions {
  lod?: LODOptions;
  graph?: GraphSimplifyOptions;
  gating: SimplificationGatingContext;
}

export function prepareForInference(
  mesh: RawMesh,
  graph: FaceAdjacencyGraph,
  options: InferencePrepOptions,
): InferenceReadyPayload {
  const decision = checkSimplificationGate(options.gating);
  if (!decision.allowed) throw new SimplificationGateError(decision);

  const lodResult = buildLODs(mesh, {
    ...options.lod,
    maxLevels: decision.maxLODs,
  });

  const coarseGraph = simplifyGraph(graph, options.graph);

  // Build flat feature matrix: [area, nx, ny, nz, curvature, |members|, levelHint]
  const featureDim = 7;
  const features = new Float32Array(coarseGraph.nodeCount * featureDim);
  for (let i = 0; i < coarseGraph.nodeCount; i++) {
    const nf = coarseGraph.nodeFeatures[i];
    const off = i * featureDim;
    features[off] = nf.area;
    features[off + 1] = nf.avgNormal[0];
    features[off + 2] = nf.avgNormal[1];
    features[off + 3] = nf.avgNormal[2];
    features[off + 4] = nf.avgCurvature;
    features[off + 5] = coarseGraph.clusters[i].length;
    features[off + 6] = lodResult.lods.length - 1;
  }

  const coarseLOD = lodResult.lods[lodResult.lods.length - 1];

  return {
    coarseMesh: coarseLOD.mesh,
    lods: lodResult.lods,
    graph: coarseGraph,
    features,
    featureDim,
    nodeToFaces: coarseGraph.clusters,
  };
}
