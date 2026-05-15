/**
 * GPU-compatible multi-resolution feature packaging + high-volume inference.
 *
 * - `packMultiResolution` / `packInferencePayload` produce GPU-friendly buffers
 *   (16-float padded rows, CSR adjacency, per-LOD offsets).
 * - `scorePacked` runs a WebGPU compute kernel with automatic CPU fallback.
 * - `scoreBatch` sustains high throughput across many payloads with bounded
 *   concurrency.
 */

export {
  packMultiResolution,
  packInferencePayload,
  PACKED_NODE_STRIDE,
} from './featurePacker';
export type {
  PackedMultiResolution,
  PackedLODLevel,
  MultiResLevelInput,
} from './featurePacker';

export {
  scorePacked,
  scorePackedCPU,
  scoreBatch,
  isWebGPUAvailable,
} from './webgpuInference';
export type {
  GpuInferenceParams,
  GpuInferenceResult,
} from './webgpuInference';
