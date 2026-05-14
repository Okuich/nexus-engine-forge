/**
 * Typed client for the `simplify-api` edge function (REST + GraphQL).
 *
 * Usage:
 *   const { lods } = await simplifyApi.lods({ mesh, options: { levels: 3 } });
 *   const { graph } = await simplifyApi.graph({ mesh, options: { targetRatio: 0.25 } });
 *   const payload = await simplifyApi.inference({ mesh });
 */
import { supabase } from '@/integrations/supabase/client';

export type Vec3 = [number, number, number];
export interface RawMeshInput { positions: number[]; indices?: number[] }

export interface SerializedMesh {
  /** base64 Float32Array */
  positions: string;
  /** base64 Uint32Array */
  indices: string;
  vertexCount: number;
  triangleCount: number;
}

export interface LODOptions {
  levels?: number;
  ratioPerLevel?: number;
  minTriangles?: number;
  maxLevels?: number;
}
export interface GraphOptions {
  targetNodes?: number;
  targetRatio?: number;
}

export interface SimplifiedLODOut {
  level: number;
  ratio: number;
  mesh: SerializedMesh;
  stats: {
    inputTriangles: number;
    outputTriangles: number;
    inputVertices: number;
    outputVertices: number;
    elapsedMs: number;
  };
}

export interface SimplifiedGraphOut {
  nodeCount: number;
  edgeCount: number;
  edges: Array<[number, number]>;
  clusters: number[][];
  nodeFeatures: Array<{ area: number; avgNormal: Vec3; avgCurvature: number }>;
  edgeCompression: number;
}

export interface LODsResponse { lods: SimplifiedLODOut[]; totalElapsedMs: number }
export interface GraphResponse { graph: SimplifiedGraphOut; elapsedMs: number }
export interface InferenceResponse {
  coarseMesh: SerializedMesh;
  lods: SimplifiedLODOut[];
  graph: SimplifiedGraphOut;
  /** base64 Float32Array of shape [nodeCount × featureDim]. */
  features: string;
  featureDim: number;
  nodeToFaces: number[][];
  elapsedMs: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────

/** Decode a base64-encoded Float32Array. */
export function decodeFloat32(b64: string): Float32Array {
  const bin = atob(b64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
}

/** Decode a base64-encoded Uint32Array. */
export function decodeUint32(b64: string): Uint32Array {
  const bin = atob(b64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return new Uint32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
}

/** Materialize a serialized mesh into typed arrays. */
export function decodeMesh(m: SerializedMesh): { positions: Float32Array; indices: Uint32Array } {
  return { positions: decodeFloat32(m.positions), indices: decodeUint32(m.indices) };
}

// ─── Invokers ─────────────────────────────────────────────────────────────

async function invoke<T>(path: string, body: unknown): Promise<T> {
  const { data, error } = await supabase.functions.invoke(`simplify-api/${path}`, { body });
  if (error) throw error;
  return data as T;
}

export const simplifyApi = {
  /** REST: build LODs from a mesh. */
  lods(input: { mesh: RawMeshInput; options?: LODOptions }): Promise<LODsResponse> {
    return invoke<LODsResponse>('lods', input);
  },
  /** REST: coarsen the face-adjacency graph of a mesh. */
  graph(input: { mesh: RawMeshInput; options?: GraphOptions }): Promise<GraphResponse> {
    return invoke<GraphResponse>('graph', input);
  },
  /** REST: full inference-ready payload (LODs + coarse mesh + graph + features). */
  inference(input: {
    mesh: RawMeshInput;
    lod?: LODOptions;
    graph?: GraphOptions;
  }): Promise<InferenceResponse> {
    return invoke<InferenceResponse>('inference', input);
  },

  /** GraphQL passthrough. */
  graphql<T = unknown>(query: string, variables?: Record<string, unknown>): Promise<{ data?: T; errors?: Array<{ message: string }> }> {
    return invoke('graphql', { query, variables });
  },
};
