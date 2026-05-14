/**
 * Typed client for the `sdf-api` edge function (REST + GraphQL).
 *
 * Usage:
 *   const { grid } = await sdfApi.generate({ mesh, options: { resolution: 32 } });
 *   const { results } = await sdfApi.queryInside({ grid, points });
 */
import { supabase } from '@/integrations/supabase/client';

export type Vec3 = [number, number, number];
export interface AABB { min: Vec3; max: Vec3 }
export interface RawMeshInput { positions: number[]; indices?: number[] }
export interface SDFOptions {
  resolution?: number;
  padding?: number;
  signMethod?: 'raycast' | 'normal';
  narrowBand?: number;
}
export interface SerializedSDFGrid {
  /** base64 Float32Array. */
  data: string;
  dims: [number, number, number];
  bounds: AABB;
  voxelSize: number;
  sourceTriangles: number;
  backend: 'cpu';
  elapsedMs: number;
}
export interface NearestSurfaceResult {
  point: Vec3;
  signedDistance: number;
  normal: Vec3;
}

interface QueryInput {
  grid?: SerializedSDFGrid;
  mesh?: RawMeshInput;
  options?: SDFOptions;
  points: Vec3[];
}

const FN = 'sdf-api';

async function call<T>(path: string, body: unknown): Promise<T> {
  const { data, error } = await supabase.functions.invoke(`${FN}${path}`, { body });
  if (error) throw error;
  if ((data as { error?: string }).error) throw new Error((data as { error: string }).error);
  return data as T;
}

export const sdfApi = {
  async generate(input: { mesh: RawMeshInput; options?: SDFOptions }): Promise<{ grid: SerializedSDFGrid }> {
    return call('/generate', input);
  },
  async querySample(input: QueryInput): Promise<{ results: number[] }> {
    return call('/query/sample', input);
  },
  async queryInside(input: QueryInput): Promise<{ results: boolean[] }> {
    return call('/query/inside', input);
  },
  async queryNearest(input: QueryInput): Promise<{ results: NearestSurfaceResult[] }> {
    return call('/query/nearest', input);
  },
  async graphql<T = unknown>(query: string, variables?: Record<string, unknown>): Promise<T> {
    const res = await call<{ data?: T; errors?: Array<{ message: string }> }>('/graphql', { query, variables });
    if (res.errors?.length) throw new Error(res.errors.map((e) => e.message).join('; '));
    return res.data as T;
  },
};

/** Decode a SerializedSDFGrid `.data` field into a Float32Array. */
export function decodeGridData(grid: SerializedSDFGrid): Float32Array {
  const bin = atob(grid.data);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
}
