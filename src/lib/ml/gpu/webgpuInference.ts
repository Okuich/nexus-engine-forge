/**
 * WebGPU-backed high-volume inference scorer.
 *
 * Provides a per-node scoring kernel that runs over the packed
 * multi-resolution buffer produced by `packMultiResolution`. The same
 * scoring math has a CPU fallback so callers get identical results
 * regardless of whether WebGPU is available.
 *
 * The kernel is intentionally small/general — it computes a
 * manufacturability-style risk score per node from the first 8 packed
 * feature lanes plus 1-hop neighbor mean-curvature aggregation. It is
 * the same shape as the production GAT used by `ml-inference`, just
 * fused into a single pass so we can sustain very high throughput
 * (millions of node evaluations / second on real hardware).
 */

import type { PackedMultiResolution } from './featurePacker';
import { PACKED_NODE_STRIDE } from './featurePacker';

export interface GpuInferenceParams {
  /** Per-feature weights, length 8. Defaults to manufacturability heuristic. */
  weights?: Float32Array;
  /** Bias added to every node. */
  bias?: number;
  /** Neighbor curvature aggregation strength. */
  neighborInfluence?: number;
}

export interface GpuInferenceResult {
  /** Per-node scores in [0, 1]. */
  scores: Float32Array;
  /** Backend that actually executed the work. */
  backend: 'webgpu' | 'cpu';
  elapsedMs: number;
  nodesPerSecond: number;
}

const DEFAULT_WEIGHTS = new Float32Array([
  0.40, // f0: area
  0.05, // f1..f3: avg normal (orientation small effect)
  0.05,
  0.10,
  -0.20, // f4: avg curvature (higher → lower score)
  -0.05, // f5: cluster size
  0.02, // f6: level hint
  0.00, // f7: reserved
]);

function resolveParams(p?: GpuInferenceParams) {
  return {
    weights: p?.weights && p.weights.length >= 8 ? p.weights : DEFAULT_WEIGHTS,
    bias: p?.bias ?? 0.6,
    neighborInfluence: p?.neighborInfluence ?? 0.25,
  };
}

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

/** CPU reference / fallback path. Identical math to the WGSL kernel. */
export function scorePackedCPU(
  packed: PackedMultiResolution,
  params?: GpuInferenceParams,
): GpuInferenceResult {
  const t0 = performance.now();
  const { weights, bias, neighborInfluence } = resolveParams(params);
  const { features, adjOffsets, adjNeighbors, totalNodes } = packed;
  const scores = new Float32Array(totalNodes);

  for (let i = 0; i < totalNodes; i++) {
    const base = i * PACKED_NODE_STRIDE;
    let acc = bias;
    for (let k = 0; k < 8; k++) acc += weights[k] * features[base + k];

    // Aggregate neighbor curvature (lane 4)
    const start = adjOffsets[i];
    const end = adjOffsets[i + 1];
    if (end > start) {
      let sum = 0;
      for (let e = start; e < end; e++) {
        sum += features[adjNeighbors[e] * PACKED_NODE_STRIDE + 4];
      }
      acc -= neighborInfluence * (sum / (end - start));
    }
    scores[i] = sigmoid(acc);
  }

  const elapsedMs = performance.now() - t0;
  return {
    scores,
    backend: 'cpu',
    elapsedMs,
    nodesPerSecond: elapsedMs > 0 ? (totalNodes / elapsedMs) * 1000 : 0,
  };
}

/** Detect WebGPU support without throwing in non-browser/SSR contexts. */
export async function isWebGPUAvailable(): Promise<boolean> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const nav: any = typeof navigator !== 'undefined' ? navigator : null;
    if (!nav?.gpu) return false;
    const adapter = await nav.gpu.requestAdapter();
    return !!adapter;
  } catch {
    return false;
  }
}

const WGSL_SCORE = /* wgsl */ `
struct Params {
  weights : array<vec4<f32>, 2>, // 8 weights
  bias    : f32,
  neighborInfluence : f32,
  stride  : u32,
  totalNodes : u32,
};

@group(0) @binding(0) var<storage, read>       features  : array<f32>;
@group(0) @binding(1) var<storage, read>       adjOffsets: array<u32>;
@group(0) @binding(2) var<storage, read>       adjNeighbors : array<u32>;
@group(0) @binding(3) var<storage, read_write> scores    : array<f32>;
@group(0) @binding(4) var<uniform>             params    : Params;

fn sig(x: f32) -> f32 { return 1.0 / (1.0 + exp(-x)); }

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  let i = gid.x;
  if (i >= params.totalNodes) { return; }
  let base = i * params.stride;

  var acc = params.bias;
  let w0 = params.weights[0];
  let w1 = params.weights[1];
  acc = acc + w0.x * features[base + 0u];
  acc = acc + w0.y * features[base + 1u];
  acc = acc + w0.z * features[base + 2u];
  acc = acc + w0.w * features[base + 3u];
  acc = acc + w1.x * features[base + 4u];
  acc = acc + w1.y * features[base + 5u];
  acc = acc + w1.z * features[base + 6u];
  acc = acc + w1.w * features[base + 7u];

  let s = adjOffsets[i];
  let e = adjOffsets[i + 1u];
  if (e > s) {
    var sum = 0.0;
    for (var k = s; k < e; k = k + 1u) {
      sum = sum + features[adjNeighbors[k] * params.stride + 4u];
    }
    let n = f32(e - s);
    acc = acc - params.neighborInfluence * (sum / n);
  }
  scores[i] = sig(acc);
}
`;

/**
 * Run scoring on the GPU when available, otherwise fall back to CPU.
 * Always returns results — the caller can inspect `backend` to know which path ran.
 */
export async function scorePacked(
  packed: PackedMultiResolution,
  params?: GpuInferenceParams,
): Promise<GpuInferenceResult> {
  if (packed.totalNodes === 0) {
    return { scores: new Float32Array(0), backend: 'cpu', elapsedMs: 0, nodesPerSecond: 0 };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const nav: any = typeof navigator !== 'undefined' ? navigator : null;
  if (!nav?.gpu) return scorePackedCPU(packed, params);

  try {
    const adapter = await nav.gpu.requestAdapter();
    if (!adapter) return scorePackedCPU(packed, params);
    const device = await adapter.requestDevice();

    const t0 = performance.now();
    const { weights, bias, neighborInfluence } = resolveParams(params);
    const { features, adjOffsets, adjNeighbors, totalNodes } = packed;

    const mkBuf = (data: ArrayBufferView, usage: number) => {
      const buf = device.createBuffer({
        size: Math.max(16, data.byteLength),
        usage,
        mappedAtCreation: true,
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const Ctor: any = data.constructor;
      new Ctor(buf.getMappedRange()).set(data as never);
      buf.unmap();
      return buf;
    };

    // GPUBufferUsage flags by value (avoids depending on @webgpu/types in tests)
    const STORAGE = 0x0080;
    const COPY_SRC = 0x0004;
    const COPY_DST = 0x0008;
    const UNIFORM = 0x0040;
    const MAP_READ = 0x0001;

    const fBuf = mkBuf(features, STORAGE | COPY_DST);
    const oBuf = mkBuf(adjOffsets, STORAGE | COPY_DST);
    const nBuf = mkBuf(adjNeighbors, STORAGE | COPY_DST);
    const sBuf = device.createBuffer({
      size: totalNodes * 4,
      usage: STORAGE | COPY_SRC,
    });

    const params32 = new Float32Array(12);
    for (let i = 0; i < 8; i++) params32[i] = weights[i] ?? 0;
    params32[8] = bias;
    params32[9] = neighborInfluence;
    new Uint32Array(params32.buffer)[10] = PACKED_NODE_STRIDE;
    new Uint32Array(params32.buffer)[11] = totalNodes;
    const pBuf = mkBuf(params32, UNIFORM | COPY_DST);

    const module = device.createShaderModule({ code: WGSL_SCORE });
    const pipeline = device.createComputePipeline({
      layout: 'auto',
      compute: { module, entryPoint: 'main' },
    });
    const bindGroup = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: fBuf } },
        { binding: 1, resource: { buffer: oBuf } },
        { binding: 2, resource: { buffer: nBuf } },
        { binding: 3, resource: { buffer: sBuf } },
        { binding: 4, resource: { buffer: pBuf } },
      ],
    });

    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(Math.ceil(totalNodes / 64));
    pass.end();

    const readBuf = device.createBuffer({
      size: totalNodes * 4,
      usage: COPY_DST | MAP_READ,
    });
    encoder.copyBufferToBuffer(sBuf, 0, readBuf, 0, totalNodes * 4);
    device.queue.submit([encoder.finish()]);

    await readBuf.mapAsync(MAP_READ);
    const scores = new Float32Array(readBuf.getMappedRange().slice(0));
    readBuf.unmap();

    [fBuf, oBuf, nBuf, sBuf, pBuf, readBuf].forEach((b) => b.destroy?.());
    device.destroy?.();

    const elapsedMs = performance.now() - t0;
    return {
      scores,
      backend: 'webgpu',
      elapsedMs,
      nodesPerSecond: elapsedMs > 0 ? (totalNodes / elapsedMs) * 1000 : 0,
    };
  } catch {
    return scorePackedCPU(packed, params);
  }
}

/**
 * High-volume batch scorer. Runs many packed payloads through the same
 * pipeline (CPU or GPU), returning aggregate throughput numbers.
 * Concurrency is bounded so we never exceed the GPU queue depth on
 * hosts where one device is shared across the page.
 */
export async function scoreBatch(
  payloads: PackedMultiResolution[],
  params?: GpuInferenceParams,
  opts?: { concurrency?: number; signal?: AbortSignal },
): Promise<{
  results: GpuInferenceResult[];
  totalNodes: number;
  totalElapsedMs: number;
  nodesPerSecond: number;
  backend: 'webgpu' | 'cpu' | 'mixed';
}> {
  const concurrency = Math.max(1, opts?.concurrency ?? 4);
  const t0 = performance.now();
  const results: GpuInferenceResult[] = new Array(payloads.length);
  let totalNodes = 0;
  let next = 0;

  const useGPU = await isWebGPUAvailable();
  const runner = useGPU ? scorePacked : (p: PackedMultiResolution) => Promise.resolve(scorePackedCPU(p, params));

  await Promise.all(
    Array.from({ length: Math.min(concurrency, payloads.length) }, async () => {
      while (true) {
        if (opts?.signal?.aborted) throw new Error('aborted');
        const idx = next++;
        if (idx >= payloads.length) return;
        const r = await runner(payloads[idx], params);
        results[idx] = r;
        totalNodes += r.scores.length;
      }
    }),
  );

  const totalElapsedMs = performance.now() - t0;
  const backends = new Set(results.map((r) => r.backend));
  const backend: 'webgpu' | 'cpu' | 'mixed' =
    backends.size === 1 ? (results[0]?.backend ?? 'cpu') : 'mixed';

  return {
    results,
    totalNodes,
    totalElapsedMs,
    nodesPerSecond: totalElapsedMs > 0 ? (totalNodes / totalElapsedMs) * 1000 : 0,
    backend,
  };
}
