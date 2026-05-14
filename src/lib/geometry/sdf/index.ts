/**
 * Signed Distance Field (SDF) Engine — public API.
 *
 *   • generateSDF       — CPU mesh → SDF (BVH-accelerated, narrow-band capable)
 *   • generateSDFGPU    — WebGPU compute backend (browser-only)
 *   • generateSDFGated  — convenience wrapper enforcing tier / workload gating
 *   • sampleSDF / isInside / nearestSurface / gradient — query operations
 *   • checkSDFGate / SDFGateError — entitlement controls
 *
 * Activation conditions enforced in `gating.ts`:
 *   – Enterprise tier: unrestricted (up to 512³)
 *   – Professional tier: assembly workflows OR ≥ 50k triangles, up to ~158³
 *   – Starter tier: blocked except beta override
 */
import type { RawMesh } from '../types';
import type { SDFGenerationOptions, SDFGrid, SDFGatingContext } from './types';
import { generateSDF } from './sdfGenerator';
import { generateSDFGPU, hasWebGPU } from './gpuSdf';
import { checkSDFGate, SDFGateError } from './gating';

export { generateSDF } from './sdfGenerator';
export { generateSDFGPU, hasWebGPU } from './gpuSdf';
export {
  sampleSDF,
  isInside,
  nearestSurface,
  gradient,
} from './sdfQuery';
export { checkSDFGate, SDFGateError } from './gating';
export {
  generateSDFStream,
  generateSDFChunked,
  generateSDFReadableStream,
} from './sdfChunked';
export type {
  ChunkedSDFOptions,
  SDFChunk,
  ChunkProgress,
} from './sdfChunked';
export type {
  SDFGenerationOptions,
  SDFGrid,
  NearestSurfaceResult,
  SDFTier,
  SDFGatingContext,
  SDFGatingDecision,
} from './types';

export interface GatedGenerationOptions extends SDFGenerationOptions {
  gating: Omit<SDFGatingContext, 'triangleCount' | 'voxelCount'>;
  /** Use WebGPU when available. Falls back to CPU automatically. */
  preferGPU?: boolean;
}

/**
 * Gated SDF generation — enforces entitlement, then routes to GPU or CPU.
 * Throws SDFGateError if the caller's tier doesn't permit the requested job.
 */
export async function generateSDFGated(
  mesh: RawMesh,
  options: GatedGenerationOptions,
): Promise<SDFGrid> {
  const triangleCount = (mesh.indices as ArrayLike<number>).length / 3;
  const resolution = options.resolution ?? 64;
  // Voxel count is bounded by resolution³; over-estimate for gating.
  const voxelCount = resolution * resolution * resolution;

  const decision = checkSDFGate({
    ...options.gating,
    triangleCount,
    voxelCount,
  });
  if (!decision.allowed) throw new SDFGateError(decision);

  if (options.preferGPU && hasWebGPU()) {
    try {
      return await generateSDFGPU(mesh, options);
    } catch {
      // GPU path failed → CPU fallback
    }
  }
  return generateSDF(mesh, options);
}
