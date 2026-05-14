/**
 * GPU-accelerated SIMP topology optimizer.
 *
 *   • Force-flow diffusion → WGSL compute shader, ping-pong storage buffers,
 *     N inner Jacobi iterations per outer SIMP step.
 *   • Sensitivity computation (∂c/∂ρ ≈ −p · ρ^(p−1) · u²) → WGSL.
 *   • Sensitivity filter (3D cone kernel) → WGSL with a uniform `rmin`.
 *   • OC update (λ-bisection) runs CPU-side after a single readback per
 *     outer iter — bisection is O(50·N) per step but already trivial vs.
 *     diffusion's O(30·6·N) memory-bound work.
 *
 * Activation conditions:
 *   – `navigator.gpu` present AND `requestAdapter()` returns an adapter
 *   – Otherwise `runSIMPGPU` rejects with `WebGPUUnavailableError` and the
 *     caller is expected to fall back to {runSIMP} from `./simp`.
 *
 * Sandbox note: the dev preview has no GPU. Verification happens through
 * unit tests that mock `navigator.gpu` and the existing CPU-vs-GPU parity
 * test in `src/test/simpGpu.test.ts` (parity is checked only when WebGPU
 * is available).
 */
import type { LoadCondition, SupportCondition, TopoOptimizerOptions, TopoIterationState } from './types';
import { worldToVoxel, type VoxelDomain } from './voxelizer';

export class WebGPUUnavailableError extends Error {
  constructor(reason: string) { super(`WebGPU unavailable: ${reason}`); this.name = 'WebGPUUnavailableError'; }
}

export interface SimpGpuRunResult {
  density: Float32Array;
  compliance: number;
  iterations: number;
  converged: boolean;
  history: number[];
  /** Backend that actually executed the loop. */
  backend: 'webgpu';
  elapsedMs: number;
}

export async function hasWebGPUForSIMP(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !(navigator as Navigator & { gpu?: GPU }).gpu) return false;
  try {
    const adapter = await (navigator as Navigator & { gpu?: GPU }).gpu!.requestAdapter();
    return !!adapter;
  } catch { return false; }
}

// ─── WGSL shaders ───────────────────────────────────────────────────────────

const WGSL_DIFFUSION = /* wgsl */ `
struct Params {
  dims: vec3<u32>,
  penalty: f32,
  // No vec3 padding issue: dims is at offset 0 (size 12, align 16) → padded.
  // penalty starts at offset 16.
  emin: f32,
  damping: f32,    // 0.4 in CPU code
  smoothing: f32,  // 0.6 in CPU code
};

@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var<storage, read> density: array<f32>;
@group(0) @binding(2) var<storage, read> flowIn: array<f32>;
@group(0) @binding(3) var<storage, read_write> flowOut: array<f32>;
@group(0) @binding(4) var<storage, read> supportMask: array<u32>;
@group(0) @binding(5) var<storage, read> sourceMask: array<u32>;
@group(0) @binding(6) var<storage, read> sourceMag: array<f32>;

fn idx_of(i: u32, j: u32, k: u32) -> u32 {
  return i + j * P.dims.x + k * P.dims.x * P.dims.y;
}

@compute @workgroup_size(4, 4, 4)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x; let j = gid.y; let k = gid.z;
  if (i >= P.dims.x || j >= P.dims.y || k >= P.dims.z) { return; }
  let idx = idx_of(i, j, k);

  // Pinned sources
  if (sourceMask[idx] != 0u) { flowOut[idx] = sourceMag[idx]; return; }
  // Sinks (supports)
  if (supportMask[idx] != 0u) { flowOut[idx] = 0.0; return; }

  let rho = density[idx] + P.emin;
  let rhoP = pow(rho, P.penalty);
  if (rhoP < 1e-4) { flowOut[idx] = flowIn[idx]; return; }

  var sum: f32 = 0.0;
  var weight: f32 = 0.0;
  // 6-neighbour stencil, density-weighted conductance.
  if (i > 0u)              { let n = idx_of(i - 1u, j, k); let w = pow(density[n] + P.emin, P.penalty); sum += flowIn[n] * w; weight += w; }
  if (i + 1u < P.dims.x)   { let n = idx_of(i + 1u, j, k); let w = pow(density[n] + P.emin, P.penalty); sum += flowIn[n] * w; weight += w; }
  if (j > 0u)              { let n = idx_of(i, j - 1u, k); let w = pow(density[n] + P.emin, P.penalty); sum += flowIn[n] * w; weight += w; }
  if (j + 1u < P.dims.y)   { let n = idx_of(i, j + 1u, k); let w = pow(density[n] + P.emin, P.penalty); sum += flowIn[n] * w; weight += w; }
  if (k > 0u)              { let n = idx_of(i, j, k - 1u); let w = pow(density[n] + P.emin, P.penalty); sum += flowIn[n] * w; weight += w; }
  if (k + 1u < P.dims.z)   { let n = idx_of(i, j, k + 1u); let w = pow(density[n] + P.emin, P.penalty); sum += flowIn[n] * w; weight += w; }

  if (weight > 0.0) {
    flowOut[idx] = P.damping * flowIn[idx] + P.smoothing * (sum / weight);
  } else {
    flowOut[idx] = flowIn[idx];
  }
}
`;

const WGSL_SENSITIVITY = /* wgsl */ `
struct Params {
  dims: vec3<u32>,
  penalty: f32,
  emin: f32,
};
@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var<storage, read> density: array<f32>;
@group(0) @binding(2) var<storage, read> flow: array<f32>;
@group(0) @binding(3) var<storage, read_write> sens: array<f32>;
@group(0) @binding(4) var<storage, read_write> compliance: array<f32>; // partial sums per cell

@compute @workgroup_size(4, 4, 4)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= P.dims.x || gid.y >= P.dims.y || gid.z >= P.dims.z) { return; }
  let idx = gid.x + gid.y * P.dims.x + gid.z * P.dims.x * P.dims.y;
  let u = flow[idx]; let u2 = u * u;
  let rho = density[idx] + P.emin;
  let rhoP = pow(rho, P.penalty);
  compliance[idx] = rhoP * u2;
  sens[idx] = -P.penalty * pow(rho, P.penalty - 1.0) * u2;
}
`;

const WGSL_FILTER = /* wgsl */ `
struct Params {
  dims: vec3<u32>,
  rmin: f32,
  // u32 radius = ceil(rmin), broadcast by host.
  r: u32,
};
@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var<storage, read> density: array<f32>;
@group(0) @binding(2) var<storage, read> sensIn: array<f32>;
@group(0) @binding(3) var<storage, read_write> sensOut: array<f32>;

fn idx_of(i: u32, j: u32, k: u32) -> u32 {
  return i + j * P.dims.x + k * P.dims.x * P.dims.y;
}

@compute @workgroup_size(4, 4, 4)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x; let j = gid.y; let k = gid.z;
  if (i >= P.dims.x || j >= P.dims.y || k >= P.dims.z) { return; }
  let idx = idx_of(i, j, k);

  var num: f32 = 0.0;
  var den: f32 = 0.0;
  let r = i32(P.r);
  for (var dk: i32 = -r; dk <= r; dk = dk + 1) {
    let kk = i32(k) + dk;
    if (kk < 0 || u32(kk) >= P.dims.z) { continue; }
    for (var dj: i32 = -r; dj <= r; dj = dj + 1) {
      let jj = i32(j) + dj;
      if (jj < 0 || u32(jj) >= P.dims.y) { continue; }
      for (var di: i32 = -r; di <= r; di = di + 1) {
        let ii = i32(i) + di;
        if (ii < 0 || u32(ii) >= P.dims.x) { continue; }
        let dist = sqrt(f32(di*di + dj*dj + dk*dk));
        if (dist > P.rmin) { continue; }
        let w = P.rmin - dist;
        let n = idx_of(u32(ii), u32(jj), u32(kk));
        num = num + w * density[n] * sensIn[n];
        den = den + w * density[n];
      }
    }
  }
  if (den > 1e-9) {
    sensOut[idx] = num / max(density[idx], 1e-3) / den;
  } else {
    sensOut[idx] = sensIn[idx];
  }
}
`;

// ─── GPU device + pipelines (lazy, cached) ─────────────────────────────────

interface GpuContext {
  device: GPUDevice;
  diffPipeline: GPUComputePipeline;
  sensPipeline: GPUComputePipeline;
  filterPipeline: GPUComputePipeline;
}

let gpuCtx: GpuContext | null = null;

async function ensureContext(): Promise<GpuContext> {
  if (gpuCtx) return gpuCtx;
  if (typeof navigator === 'undefined' || !(navigator as Navigator & { gpu?: GPU }).gpu) {
    throw new WebGPUUnavailableError('navigator.gpu not present');
  }
  const adapter = await (navigator as Navigator & { gpu?: GPU }).gpu!.requestAdapter();
  if (!adapter) throw new WebGPUUnavailableError('no GPU adapter');
  const device = await adapter.requestDevice();
  device.lost.then((info) => {
    if (info.reason !== 'destroyed') gpuCtx = null;
  });
  const make = (code: string) =>
    device.createComputePipeline({ layout: 'auto', compute: { module: device.createShaderModule({ code }), entryPoint: 'main' } });
  gpuCtx = {
    device,
    diffPipeline: make(WGSL_DIFFUSION),
    sensPipeline: make(WGSL_SENSITIVITY),
    filterPipeline: make(WGSL_FILTER),
  };
  return gpuCtx;
}

// ─── Buffer helpers ────────────────────────────────────────────────────────

function createBuf(device: GPUDevice, bytes: number, usage: GPUBufferUsageFlags): GPUBuffer {
  return device.createBuffer({ size: Math.max(16, bytes), usage });
}

function writeF32(device: GPUDevice, buf: GPUBuffer, src: Float32Array): void {
  device.queue.writeBuffer(buf, 0, src.buffer, src.byteOffset, src.byteLength);
}
function writeU32(device: GPUDevice, buf: GPUBuffer, src: Uint32Array): void {
  device.queue.writeBuffer(buf, 0, src.buffer, src.byteOffset, src.byteLength);
}

async function readF32(device: GPUDevice, src: GPUBuffer, lengthFloats: number): Promise<Float32Array> {
  const bytes = lengthFloats * 4;
  const stage = device.createBuffer({ size: bytes, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
  const enc = device.createCommandEncoder();
  enc.copyBufferToBuffer(src, 0, stage, 0, bytes);
  device.queue.submit([enc.finish()]);
  await stage.mapAsync(GPUMapMode.READ);
  const copy = new ArrayBuffer(bytes);
  new Uint8Array(copy).set(new Uint8Array(stage.getMappedRange()));
  stage.unmap();
  stage.destroy();
  return new Float32Array(copy);
}

// ─── OC update (CPU — lightweight bisection) ───────────────────────────────

const EMIN = 1e-3;

function ocUpdate(
  density: Float32Array,
  sensitivity: Float32Array,
  designMask: Uint8Array,
  targetVol: number,
  move = 0.2,
): { density: Float32Array; vol: number } {
  let lo = 1e-9, hi = 1e9;
  let total = 0;
  for (let i = 0; i < designMask.length; i++) total += designMask[i];
  const targetMass = targetVol * total;
  const next = new Float32Array(density.length);
  for (let it = 0; it < 50; it++) {
    const lam = 0.5 * (lo + hi);
    let mass = 0;
    for (let i = 0; i < density.length; i++) {
      if (!designMask[i]) { next[i] = 0; continue; }
      const ratio = Math.sqrt(Math.max(0, -sensitivity[i] / lam));
      let v = density[i] * ratio;
      v = Math.min(density[i] + move, Math.max(density[i] - move, v));
      v = Math.min(1, Math.max(0, v));
      next[i] = v;
      mass += v;
    }
    if (mass > targetMass) lo = lam; else hi = lam;
    if ((hi - lo) / (hi + lo) < 1e-4) break;
  }
  let vol = 0;
  for (let i = 0; i < next.length; i++) vol += next[i];
  return { density: next, vol: vol / Math.max(1, total) };
}

// ─── Main entry ────────────────────────────────────────────────────────────

export async function runSIMPGPU(
  domain: VoxelDomain,
  loads: LoadCondition[],
  supports: SupportCondition[],
  options: TopoOptimizerOptions = {},
): Promise<SimpGpuRunResult> {
  const ctx = await ensureContext();
  const { device } = ctx;

  const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const targetVol = options.targetVolumeFraction ?? 0.4;
  const maxIter = options.maxIterations ?? 50;
  const penalty = options.penalty ?? 3;
  const filterR = options.filterRadius ?? 1.5;
  const tol = options.convergenceTol ?? 0.01;
  const budget = options.timeBudgetMs ?? 5000;
  const diffusionInner = 30;

  const [nx, ny, nz] = domain.dims;
  const N = nx * ny * nz;
  const groups: [number, number, number] = [Math.ceil(nx / 4), Math.ceil(ny / 4), Math.ceil(nz / 4)];

  // ── Initial density ──
  let density = options.resumeFrom && options.resumeFrom.length === N
    ? new Float32Array(options.resumeFrom)
    : new Float32Array(N);
  if (!options.resumeFrom) {
    for (let i = 0; i < N; i++) density[i] = domain.designMask[i] ? targetVol : 0;
  }

  // ── Project loads / supports ──
  const sourceMask = new Uint32Array(N);
  const sourceMag = new Float32Array(N);
  for (const ld of loads) {
    const { idx } = worldToVoxel(domain, ld.point);
    if (idx >= 0) { sourceMask[idx] = 1; sourceMag[idx] = Math.hypot(...ld.force); }
  }
  const supportMask = new Uint32Array(N);
  for (const sp of supports) {
    const { idx } = worldToVoxel(domain, sp.point);
    if (idx >= 0) supportMask[idx] = 1;
  }
  let sourceCount = 0; for (let i = 0; i < N; i++) sourceCount += sourceMask[i];
  let supportCount = 0; for (let i = 0; i < N; i++) supportCount += supportMask[i];
  if (sourceCount === 0 || supportCount === 0) {
    return { density, compliance: Infinity, iterations: 0, converged: false, history: [], backend: 'webgpu', elapsedMs: 0 };
  }

  // ── Allocate persistent GPU buffers ──
  const STORAGE = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST;
  const bytes = N * 4;
  const densityBuf = createBuf(device, bytes, STORAGE);
  const flowA = createBuf(device, bytes, STORAGE);
  const flowB = createBuf(device, bytes, STORAGE);
  const sensBuf = createBuf(device, bytes, STORAGE);
  const sensFiltBuf = createBuf(device, bytes, STORAGE);
  const complianceBuf = createBuf(device, bytes, STORAGE);
  const supportBuf = createBuf(device, N * 4, STORAGE);
  const sourceMaskBuf = createBuf(device, N * 4, STORAGE);
  const sourceMagBuf = createBuf(device, N * 4, STORAGE);

  writeU32(device, supportBuf, supportMask);
  writeU32(device, sourceMaskBuf, sourceMask);
  writeF32(device, sourceMagBuf, sourceMag);

  // Diffusion params: dims(vec3 u32 padded) + 4 floats = 16 + 16 bytes = 32
  const diffParams = new ArrayBuffer(32);
  const diffParamsBuf = createBuf(device, 32, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
  {
    const u = new Uint32Array(diffParams); const f = new Float32Array(diffParams);
    u[0] = nx; u[1] = ny; u[2] = nz; // u[3] padding
    f[4] = penalty; f[5] = EMIN; f[6] = 0.4; f[7] = 0.6;
  }
  device.queue.writeBuffer(diffParamsBuf, 0, diffParams);

  // Sensitivity params: dims + penalty + emin = 16 + 8 = 24, round to 32
  const sensParams = new ArrayBuffer(32);
  const sensParamsBuf = createBuf(device, 32, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
  {
    const u = new Uint32Array(sensParams); const f = new Float32Array(sensParams);
    u[0] = nx; u[1] = ny; u[2] = nz;
    f[4] = penalty; f[5] = EMIN;
  }
  device.queue.writeBuffer(sensParamsBuf, 0, sensParams);

  // Filter params: dims + rmin + r(u32) = 16 + 8 = 24, round to 32
  const filterParams = new ArrayBuffer(32);
  const filterParamsBuf = createBuf(device, 32, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
  {
    const u = new Uint32Array(filterParams); const f = new Float32Array(filterParams);
    u[0] = nx; u[1] = ny; u[2] = nz;
    f[4] = filterR;
    u[5] = Math.max(1, Math.ceil(filterR));
  }
  device.queue.writeBuffer(filterParamsBuf, 0, filterParams);

  const history: number[] = [];
  let prev = new Float32Array(density);
  let converged = false;
  let iter = 0;
  let lastCompliance = Infinity;

  for (iter = 0; iter < maxIter; iter++) {
    const elapsed = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
    if (elapsed > budget) break;

    writeF32(device, densityBuf, density);

    // Seed flow A with sources, B with zeros.
    const seed = new Float32Array(N);
    for (let i = 0; i < N; i++) if (sourceMask[i]) seed[i] = sourceMag[i];
    writeF32(device, flowA, seed);
    writeF32(device, flowB, new Float32Array(N));

    // ── Diffusion: ping-pong inner iterations ──
    let readBuf = flowA, writeBuf = flowB;
    for (let inner = 0; inner < diffusionInner; inner++) {
      const bg = device.createBindGroup({
        layout: ctx.diffPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: diffParamsBuf } },
          { binding: 1, resource: { buffer: densityBuf } },
          { binding: 2, resource: { buffer: readBuf } },
          { binding: 3, resource: { buffer: writeBuf } },
          { binding: 4, resource: { buffer: supportBuf } },
          { binding: 5, resource: { buffer: sourceMaskBuf } },
          { binding: 6, resource: { buffer: sourceMagBuf } },
        ],
      });
      const enc = device.createCommandEncoder();
      const pass = enc.beginComputePass();
      pass.setPipeline(ctx.diffPipeline);
      pass.setBindGroup(0, bg);
      pass.dispatchWorkgroups(groups[0], groups[1], groups[2]);
      pass.end();
      device.queue.submit([enc.finish()]);
      [readBuf, writeBuf] = [writeBuf, readBuf];
    }
    const flowFinal = readBuf;

    // ── Sensitivity + per-cell compliance ──
    {
      const bg = device.createBindGroup({
        layout: ctx.sensPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: sensParamsBuf } },
          { binding: 1, resource: { buffer: densityBuf } },
          { binding: 2, resource: { buffer: flowFinal } },
          { binding: 3, resource: { buffer: sensBuf } },
          { binding: 4, resource: { buffer: complianceBuf } },
        ],
      });
      const enc = device.createCommandEncoder();
      const pass = enc.beginComputePass();
      pass.setPipeline(ctx.sensPipeline);
      pass.setBindGroup(0, bg);
      pass.dispatchWorkgroups(groups[0], groups[1], groups[2]);
      pass.end();
      device.queue.submit([enc.finish()]);
    }

    // ── Sensitivity filter ──
    {
      const bg = device.createBindGroup({
        layout: ctx.filterPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: filterParamsBuf } },
          { binding: 1, resource: { buffer: densityBuf } },
          { binding: 2, resource: { buffer: sensBuf } },
          { binding: 3, resource: { buffer: sensFiltBuf } },
        ],
      });
      const enc = device.createCommandEncoder();
      const pass = enc.beginComputePass();
      pass.setPipeline(ctx.filterPipeline);
      pass.setBindGroup(0, bg);
      pass.dispatchWorkgroups(groups[0], groups[1], groups[2]);
      pass.end();
      device.queue.submit([enc.finish()]);
    }

    // ── Read back compliance + filtered sensitivity (single submit each) ──
    const [compArr, sensArr] = await Promise.all([
      readF32(device, complianceBuf, N),
      readF32(device, sensFiltBuf, N),
    ]);
    let compliance = 0;
    for (let i = 0; i < N; i++) compliance += compArr[i];
    history.push(compliance);
    lastCompliance = compliance;

    // ── OC update on CPU ──
    const updated = ocUpdate(density, sensArr, domain.designMask, targetVol);
    density = new Float32Array(updated.density);

    let change = 0;
    for (let i = 0; i < N; i++) change = Math.max(change, Math.abs(density[i] - prev[i]));
    prev.set(density);

    options.onIteration?.({
      iteration: iter,
      density: new Float32Array(density),
      compliance,
      volumeFraction: updated.vol,
      change,
      elapsedMs: elapsed,
    } satisfies TopoIterationState);

    if (change < tol && iter > 5) { converged = true; break; }
  }

  // ── Cleanup transient buffers (keep pipelines/device cached) ──
  for (const b of [densityBuf, flowA, flowB, sensBuf, sensFiltBuf, complianceBuf, supportBuf, sourceMaskBuf, sourceMagBuf, diffParamsBuf, sensParamsBuf, filterParamsBuf]) {
    b.destroy();
  }

  return {
    density,
    compliance: lastCompliance,
    iterations: iter + 1,
    converged,
    history,
    backend: 'webgpu',
    elapsedMs: (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0,
  };
}

/**
 * Convenience: run on GPU when available, else fall back to CPU runSIMP.
 * Returns a discriminated `backend` field.
 */
export async function runSIMPAuto(
  domain: VoxelDomain,
  loads: LoadCondition[],
  supports: SupportCondition[],
  options: TopoOptimizerOptions = {},
): Promise<SimpGpuRunResult | (Awaited<ReturnType<typeof import('./simp')['runSIMP']>> & { backend: 'cpu' })> {
  if (await hasWebGPUForSIMP()) {
    try { return await runSIMPGPU(domain, loads, supports, options); }
    catch { /* fall through to CPU */ }
  }
  const { runSIMP } = await import('./simp');
  const res = runSIMP(domain, loads, supports, options);
  return { ...res, backend: 'cpu' as const };
}
