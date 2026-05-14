/**
 * Signed Distance Field (SDF) Engine — types.
 */
import type { RawMesh } from '../types';
import type { AABB } from '../core/spatialIndex';

export interface SDFGenerationOptions {
  /** Voxel resolution along the longest axis. Default 64. */
  resolution?: number;
  /** Padding around the mesh AABB, in mesh units. Default 0 (auto = 5% diagonal). */
  padding?: number;
  /** Narrow-band: only compute |d| ≤ band; outside cells stored as ±band. */
  narrowBand?: number;
  /** Sign method. 'raycast' = robust parity, 'normal' = fast oriented heuristic. */
  signMethod?: 'raycast' | 'normal';
  /** Time budget (ms) — generation will throw if exceeded by safety margin. */
  timeBudgetMs?: number;
}

export interface SDFGrid {
  /** Voxel data: distances in row-major (x, y, z) layout. */
  data: Float32Array;
  /** Grid dimensions [nx, ny, nz]. */
  dims: [number, number, number];
  /** Bounding box of the field (origin = bounds.min). */
  bounds: AABB;
  /** Voxel size in mesh units (uniform). */
  voxelSize: number;
  /** Source-mesh triangle count (for diagnostics). */
  sourceTriangles: number;
  /** Generation backend. */
  backend: 'cpu' | 'gpu';
  /** Wall-clock generation time (ms). */
  elapsedMs: number;
}

export interface NearestSurfaceResult {
  /** Closest point on surface. */
  point: [number, number, number];
  /** Signed distance (negative = inside). */
  signedDistance: number;
  /** Outward normal estimated from the SDF gradient. */
  normal: [number, number, number];
}

export type SDFTier = 'starter' | 'professional' | 'enterprise';

export interface SDFGatingDecision {
  allowed: boolean;
  reason?: string;
  /** Suggested tier for upgrade prompt. */
  upgradeTo?: SDFTier;
}

export interface SDFGatingContext {
  tier: SDFTier;
  /** True if this generation is part of an assembly workflow. */
  isAssembly?: boolean;
  /** Mesh triangle count. */
  triangleCount: number;
  /** Requested voxel count (nx*ny*nz). */
  voxelCount: number;
  /** Override entitlement (e.g. trial). */
  betaOverride?: boolean;
}

export type { RawMesh, AABB };
