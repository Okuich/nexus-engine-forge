/**
 * Multi-load-case GPU SIMP optimizer.
 *
 * Optimizes the multi-load CPU path in `simp.ts` by keeping every per-case
 * artefact (force-flow, per-case sensitivity, per-case compliance) on the
 * GPU through a full outer iteration. Per-case readbacks are replaced with
 * GPU reductions + a single aggregated readback so wall-clock cost grows
 * with case count *only* through extra compute dispatches, not extra CPU
 * round-trips.
 *
 * Per outer iter readbacks (constant w.r.t. case count C):
 *   • `perCaseCompliance` — C floats (workgroup-reduction kernel)
 *   • `filteredAggSens`   — N floats (after GPU aggregation + filter)
 *
 * Layout: every per-case array uses **case-major** packing
 * (offset = c·N + idx) so a single `copyBufferToBuffer` moves one case's
 * flow buffer into its slot without a copy shader.
 *
 * Aggregation modes match `runSIMP`:
 *   • `weighted-sum`: agg_sens[i] = Σ_c (w_c · sens_c[i])
 *   • `ks` soft-max: weights = softmax(ρ · w_c · c_c) · w_c, computed CPU-
 *     side from the C-float compliance readback and pushed back to GPU.
 *
 * Falls back to {runSIMP} when WebGPU is unavailable (caller-controlled
 * via `runSIMPAuto`).
 */
import type {
  LoadCase, LoadCaseAggregation, LoadCondition, SupportCondition,
  TopoIterationState, TopoOptimizerOptions,
} from './types';
import { worldToVoxel, type VoxelDomain } from './voxelizer';
import { WebGPUUnavailableError, hasWebGPUForSIMP } from './simpGpu';

const EMIN = 1e-3;
const DIFFUSION_INNER = 30;
const REDUCE_WG = 256;

// ─── WGSL ───────────────────────────────────────────────────────────────────

const WGSL_DIFFUSION = /* wgsl */ `
struct Params {
  dims: vec3<u32>,
  penalty: f32,
  emin: f32,
  damping: f32,
  smoothing: f32,
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
  if (sourceMask[idx] != 0u) { flowOut[idx] = sourceMag[idx]; return; }
  if (supportMask[idx] != 0u) { flowOut[idx] = 0.0; return; }
  let rhoP = pow(density[idx] + P.emin, P.penalty);
  if (rhoP < 1e-4) { flowOut[idx] = flowIn[idx]; return; }
  var sum: f32 = 0.0;
  var weight: f32 = 0.0;
  if (i > 0u)            { let n = idx_of(i - 1u, j, k); let w = pow(density[n] + P.emin, P.penalty); sum += flowIn[n] * w; weight += w; }
  if (i + 1u < P.dims.x) { let n = idx_of(i + 1u, j, k); let w = pow(density[n] + P.emin, P.penalty); sum += flowIn[n] * w; weight += w; }
  if (j > 0u)            { let n = idx_of(i, j - 1u, k); let w = pow(density[n] + P.emin, P.penalty); sum += flowIn[n] * w; weight += w; }
  if (j + 1u < P.dims.y) { let n = idx_of(i, j + 1u, k); let w = pow(density[n] + P.emin, P.penalty); sum += flowIn[n] * w; weight += w; }
  if (k > 0u)            { let n = idx_of(i, j, k - 1u); let w = pow(density[n] + P.emin, P.penalty); sum += flowIn[n] * w; weight += w; }
  if (k + 1u < P.dims.z) { let n = idx_of(i, j, k + 1u); let w = pow(density[n] + P.emin, P.penalty); sum += flowIn[n] * w; weight += w; }
  if (weight > 0.0) {
    flowOut[idx] = P.damping * flowIn[idx] + P.smoothing * (sum / weight);
  } else {
    flowOut[idx] = flowIn[idx];
  }
}
`;

/** Sensitivity + per-cell compliance for one case (slot-aware writes). */
const WGSL_SENS_SLOT = /* wgsl */ `
struct Params {
  n: u32,
  caseIdx: u32,
  penalty: f32,
  emin: f32,
};
@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var<storage, read> density: array<f32>;
@group(0) @binding(2) var<storage, read> flow: array<f32>;       // single case, length n
@group(0) @binding(3) var<storage, read_write> sensAll: array<f32>;  // case-major n*C
@group(0) @binding(4) var<storage, read_write> compAll: array<f32>;  // case-major n*C

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let idx = gid.x;
  if (idx >= P.n) { return; }
  let u = flow[idx]; let u2 = u * u;
  let rho = density[idx] + P.emin;
  let rhoPm1 = pow(rho, P.penalty - 1.0);
  let off = P.caseIdx * P.n + idx;
  compAll[off] = rhoPm1 * rho * u2;
  sensAll[off] = -P.penalty * rhoPm1 * u2;
}
`;

/** Per-case workgroup reduction → 1 scalar / case. */
const WGSL_REDUCE_PER_CASE = /* wgsl */ `
struct Params { n: u32, numCases: u32 };
@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var<storage, read> compAll: array<f32>;
@group(0) @binding(2) var<storage, read_write> perCase: array<f32>;

const WG: u32 = 256u;
var<workgroup> partial: array<f32, 256>;

@compute @workgroup_size(256)
fn main(@builtin(workgroup_id) wid: vec3<u32>, @builtin(local_invocation_id) lid: vec3<u32>) {
  let c = wid.x;
  if (c >= P.numCases) { return; }
  let base = c * P.n;
  var sum: f32 = 0.0;
  var i: u32 = lid.x;
  loop {
    if (i >= P.n) { break; }
    sum = sum + compAll[base + i];
    i = i + WG;
  }
  partial[lid.x] = sum;
  workgroupBarrier();
  var stride: u32 = WG / 2u;
  loop {
    if (stride == 0u) { break; }
    if (lid.x < stride) { partial[lid.x] = partial[lid.x] + partial[lid.x + stride]; }
    workgroupBarrier();
    stride = stride / 2u;
  }
  if (lid.x == 0u) { perCase[c] = partial[0]; }
}
`;

/** Linear combination across cases: aggSens[i] = Σ_c weights[c] · sensAll[c·N + i]. */
const WGSL_AGGREGATE = /* wgsl */ `
struct Params { n: u32, numCases: u32 };
@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var<storage, read> sensAll: array<f32>;
@group(0) @binding(2) var<storage, read> weights: array<f32>;
@group(0) @binding(3) var<storage, read_write> aggSens: array<f32>;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let idx = gid.x;
  if (idx >= P.n) { return; }
  var s: f32 = 0.0;
  for (var c: u32 = 0u; c < P.numCases; c = c + 1u) {
    s = s + weights[c] * sensAll[c * P.n + idx];
  }
  aggSens[idx] = s;
}
`;

/**
 * Computes per-case aggregation weights AND the aggregated compliance on the
 * GPU from the C-float `perCase` buffer. Output layout in `weightsAgg`:
 *   [0..C-1] = per-case weights consumed by WGSL_AGGREGATE
 *   [C]      = aggregated compliance (telemetry / history)
 *
 * Modes (matches `computeAggregationWeights`):
 *   mode = 0u → weighted-sum: w_c = caseW_c, agg = Σ caseW_c · c_c
 *   mode = 1u → KS soft-max:  w_c = softmax(ρ·caseW_c·c_c)_c · caseW_c,
 *                              agg = (log Σ exp(ρ·caseW·c) + M) / ρ
 *
 * Single-thread dispatch: C is small (typically ≤ 32) so a serial reduction
 * is faster than a parallel one once you account for barrier overhead, and
 * collapsing into one invocation keeps the WGSL trivially auditable for
 * numerical-stability bugs (max-shift before exp).
 */
const WGSL_KS_WEIGHTS = /* wgsl */ `
struct Params {
  numCases: u32,
  mode: u32,      // 0 = weighted-sum, 1 = ks
  ksRho: f32,
  _pad: u32,
};
@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var<storage, read> perCase: array<f32>;
@group(0) @binding(2) var<storage, read> caseW: array<f32>;
@group(0) @binding(3) var<storage, read_write> weightsAgg: array<f32>;

@compute @workgroup_size(1)
fn main() {
  let C = P.numCases;
  if (P.mode == 0u) {
    var agg: f32 = 0.0;
    for (var c: u32 = 0u; c < C; c = c + 1u) {
      weightsAgg[c] = caseW[c];
      agg = agg + caseW[c] * perCase[c];
    }
    weightsAgg[C] = agg;
    return;
  }
  // KS soft-max with max-shift for numerical stability.
  var M: f32 = -3.4e38;
  for (var c: u32 = 0u; c < C; c = c + 1u) {
    let s = P.ksRho * caseW[c] * perCase[c];
    if (s > M) { M = s; }
  }
  var denom: f32 = 0.0;
  for (var c: u32 = 0u; c < C; c = c + 1u) {
    let s = P.ksRho * caseW[c] * perCase[c];
    let e = exp(s - M);
    weightsAgg[c] = e;          // stash exp(...) — finalized below
    denom = denom + e;
  }
  let invDenom = 1.0 / max(denom, 1e-30);
  for (var c: u32 = 0u; c < C; c = c + 1u) {
    weightsAgg[c] = weightsAgg[c] * invDenom * caseW[c];
  }
  weightsAgg[C] = (log(max(denom, 1e-30)) + M) / P.ksRho;
}
`;

const WGSL_FILTER = /* wgsl */ `
struct Params { dims: vec3<u32>, rmin: f32, r: u32 };
@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var<storage, read> density: array<f32>;
@group(0) @binding(2) var<storage, read> sensIn: array<f32>;
@group(0) @binding(3) var<storage, read_write> sensOut: array<f32>;
fn idx_of(i: u32, j: u32, k: u32) -> u32 { return i + j * P.dims.x + k * P.dims.x * P.dims.y; }
@compute @workgroup_size(4, 4, 4)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x; let j = gid.y; let k = gid.z;
  if (i >= P.dims.x || j >= P.dims.y || k >= P.dims.z) { return; }
  let idx = idx_of(i, j, k);
  var num: f32 = 0.0; var den: f32 = 0.0;
  let r = i32(P.r);
  for (var dk: i32 = -r; dk <= r; dk = dk + 1) {
    let kk = i32(k) + dk; if (kk < 0 || u32(kk) >= P.dims.z) { continue; }
    for (var dj: i32 = -r; dj <= r; dj = dj + 1) {
      let jj = i32(j) + dj; if (jj < 0 || u32(jj) >= P.dims.y) { continue; }
      for (var di: i32 = -r; di <= r; di = di + 1) {
        let ii = i32(i) + di; if (ii < 0 || u32(ii) >= P.dims.x) { continue; }
        let dist = sqrt(f32(di*di + dj*dj + dk*dk));
        if (dist > P.rmin) { continue; }
        let w = P.rmin - dist;
        let n = idx_of(u32(ii), u32(jj), u32(kk));
        num = num + w * density[n] * sensIn[n];
        den = den + w * density[n];
      }
    }
  }
  if (den > 1e-9) { sensOut[idx] = num / max(density[idx], 1e-3) / den; }
  else { sensOut[idx] = sensIn[idx]; }
}
`;

// ─── Pure aggregation helpers (testable without GPU) ────────────────────────

/**
 * Compute the per-case linear weights sent to the GPU aggregation pass.
 * Returns weights such that `aggSens[i] = Σ_c weights[c] · sens_c[i]` and
 * `aggCompliance = Σ_c weights[c] · perCaseCompliance[c]` for `weighted-sum`,
 * or `(log Σ exp(ρ·w_c·c_c) + M) / ρ` for `ks` (numerically stable form).
 *
 * Exported for tests + reuse by CPU validation.
 */
export function computeAggregationWeights(
  perCaseCompliance: number[],
  caseWeights: number[],
  mode: LoadCaseAggregation,
  ksRho: number,
): { weights: number[]; aggCompliance: number } {
  if (mode === 'ks') {
    const scaled = perCaseCompliance.map((c, i) => ksRho * caseWeights[i] * c);
    const M = scaled.reduce((m, v) => Math.max(m, v), -Infinity);
    if (!Number.isFinite(M)) {
      return { weights: caseWeights.map(() => 0), aggCompliance: 0 };
    }
    let denom = 0;
    const exps = scaled.map(s => { const e = Math.exp(s - M); denom += e; return e; });
    const softmax = exps.map(e => e / denom);
    const weights = softmax.map((s, i) => s * caseWeights[i]);
    const agg = (Math.log(denom) + M) / ksRho;
    return { weights, aggCompliance: agg };
  }
  const weights = caseWeights.slice();
  let agg = 0;
  for (let i = 0; i < perCaseCompliance.length; i++) agg += caseWeights[i] * perCaseCompliance[i];
  return { weights, aggCompliance: agg };
}

// ─── Result type ────────────────────────────────────────────────────────────

export interface SimpGpuMultiLoadResult {
  density: Float32Array;
  compliance: number;
  perCaseCompliance: number[];
  loadCaseAggregation: LoadCaseAggregation;
  iterations: number;
  converged: boolean;
  history: number[];
  backend: 'webgpu-multiload';
  elapsedMs: number;
  /** Number of GPU→CPU readbacks performed across all outer iterations. */
  readbacks: number;
}

// ─── Pipeline cache ─────────────────────────────────────────────────────────

interface MultiCtx {
  device: GPUDevice;
  diff: GPUComputePipeline;
  sensSlot: GPUComputePipeline;
  reduce: GPUComputePipeline;
  aggregate: GPUComputePipeline;
  filter: GPUComputePipeline;
}

let cached: MultiCtx | null = null;

async function ensureCtx(): Promise<MultiCtx> {
  if (cached) return cached;
  if (typeof navigator === 'undefined' || !(navigator as Navigator & { gpu?: GPU }).gpu) {
    throw new WebGPUUnavailableError('navigator.gpu not present');
  }
  const adapter = await (navigator as Navigator & { gpu?: GPU }).gpu!.requestAdapter();
  if (!adapter) throw new WebGPUUnavailableError('no GPU adapter');
  const device = await adapter.requestDevice();
  device.lost.then((info) => { if (info.reason !== 'destroyed') cached = null; });
  const make = (code: string) =>
    device.createComputePipeline({ layout: 'auto', compute: { module: device.createShaderModule({ code }), entryPoint: 'main' } });
  cached = {
    device,
    diff: make(WGSL_DIFFUSION),
    sensSlot: make(WGSL_SENS_SLOT),
    reduce: make(WGSL_REDUCE_PER_CASE),
    aggregate: make(WGSL_AGGREGATE),
    filter: make(WGSL_FILTER),
  };
  return cached;
}

// ─── Buffer helpers ─────────────────────────────────────────────────────────

const STORAGE = (): GPUBufferUsageFlags =>
  GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST;

function buf(d: GPUDevice, bytes: number, usage: GPUBufferUsageFlags): GPUBuffer {
  return d.createBuffer({ size: Math.max(16, bytes), usage });
}
function wF32(d: GPUDevice, b: GPUBuffer, src: Float32Array, offset = 0): void {
  d.queue.writeBuffer(b, offset, src.buffer, src.byteOffset, src.byteLength);
}
function wU32(d: GPUDevice, b: GPUBuffer, src: Uint32Array): void {
  d.queue.writeBuffer(b, 0, src.buffer, src.byteOffset, src.byteLength);
}
async function readF32(d: GPUDevice, src: GPUBuffer, lengthFloats: number): Promise<Float32Array> {
  const bytes = lengthFloats * 4;
  const stage = d.createBuffer({ size: Math.max(16, bytes), usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
  const enc = d.createCommandEncoder();
  enc.copyBufferToBuffer(src, 0, stage, 0, bytes);
  d.queue.submit([enc.finish()]);
  await stage.mapAsync(GPUMapMode.READ);
  const copy = new ArrayBuffer(bytes);
  new Uint8Array(copy).set(new Uint8Array(stage.getMappedRange()));
  stage.unmap();
  stage.destroy();
  return new Float32Array(copy);
}

// ─── OC update (CPU; cheap) ─────────────────────────────────────────────────

function ocUpdate(
  density: Float32Array, sens: Float32Array, designMask: Uint8Array, targetVol: number, move = 0.2,
): { density: Float32Array; vol: number } {
  let lo = 1e-9, hi = 1e9;
  let total = 0; for (let i = 0; i < designMask.length; i++) total += designMask[i];
  const targetMass = targetVol * total;
  const next = new Float32Array(density.length);
  for (let it = 0; it < 50; it++) {
    const lam = 0.5 * (lo + hi);
    let mass = 0;
    for (let i = 0; i < density.length; i++) {
      if (!designMask[i]) { next[i] = 0; continue; }
      const ratio = Math.sqrt(Math.max(0, -sens[i] / lam));
      let v = density[i] * ratio;
      v = Math.min(density[i] + move, Math.max(density[i] - move, v));
      v = Math.min(1, Math.max(0, v));
      next[i] = v;
      mass += v;
    }
    if (mass > targetMass) lo = lam; else hi = lam;
    if ((hi - lo) / (hi + lo) < 1e-4) break;
  }
  let vol = 0; for (let i = 0; i < next.length; i++) vol += next[i];
  return { density: next, vol: vol / Math.max(1, total) };
}

// ─── Per-case projection ────────────────────────────────────────────────────

interface ProjectedCase {
  sourceMask: Uint32Array;
  sourceMag: Float32Array;
  supportMask: Uint32Array;
  weight: number;
  name?: string;
}

function projectCases(
  domain: VoxelDomain,
  loadCases: LoadCase[],
  fallbackSupports: SupportCondition[],
): ProjectedCase[] {
  const N = domain.designMask.length;
  const out: ProjectedCase[] = [];
  for (const lc of loadCases) {
    const sourceMask = new Uint32Array(N);
    const sourceMag = new Float32Array(N);
    let sourceCount = 0;
    for (const ld of lc.loads) {
      const { idx } = worldToVoxel(domain, ld.point);
      if (idx >= 0) {
        sourceMask[idx] = 1;
        sourceMag[idx] = Math.hypot(...ld.force);
        sourceCount++;
      }
    }
    const supportMask = new Uint32Array(N);
    let supportCount = 0;
    const sps = lc.supports ?? fallbackSupports;
    for (const sp of sps) {
      const { idx } = worldToVoxel(domain, sp.point);
      if (idx >= 0) { supportMask[idx] = 1; supportCount++; }
    }
    if (sourceCount === 0 || supportCount === 0) continue;
    out.push({ sourceMask, sourceMag, supportMask, weight: lc.weight ?? 1, name: lc.name });
  }
  return out;
}

// ─── Main entry ─────────────────────────────────────────────────────────────

export async function runSIMPGPUMultiLoad(
  domain: VoxelDomain,
  loadCases: LoadCase[],
  fallbackSupports: SupportCondition[],
  options: TopoOptimizerOptions = {},
): Promise<SimpGpuMultiLoadResult> {
  const cases = projectCases(domain, loadCases, fallbackSupports);
  if (cases.length === 0) {
    return {
      density: new Float32Array(domain.designMask.length),
      compliance: Infinity,
      perCaseCompliance: [],
      loadCaseAggregation: options.loadCaseAggregation ?? 'weighted-sum',
      iterations: 0, converged: false, history: [],
      backend: 'webgpu-multiload', elapsedMs: 0, readbacks: 0,
    };
  }

  const ctx = await ensureCtx();
  const { device } = ctx;

  const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const targetVol = options.targetVolumeFraction ?? 0.4;
  const maxIter = options.maxIterations ?? 50;
  const penalty = options.penalty ?? 3;
  const filterR = options.filterRadius ?? 1.5;
  const tol = options.convergenceTol ?? 0.01;
  const budget = options.timeBudgetMs ?? 5000;
  const aggregation: LoadCaseAggregation = options.loadCaseAggregation ?? 'weighted-sum';
  const ksRho = options.ksRho ?? 8;

  const [nx, ny, nz] = domain.dims;
  const N = nx * ny * nz;
  const C = cases.length;
  const groups3D: [number, number, number] = [Math.ceil(nx / 4), Math.ceil(ny / 4), Math.ceil(nz / 4)];
  const groups1D = Math.ceil(N / 64);

  // ── Density init ──
  let density = options.resumeFrom && options.resumeFrom.length === N
    ? new Float32Array(options.resumeFrom)
    : new Float32Array(N);
  if (!options.resumeFrom) {
    for (let i = 0; i < N; i++) density[i] = domain.designMask[i] ? targetVol : 0;
  }

  // ── Persistent buffers ──
  const bytes = N * 4;
  const STO = STORAGE();
  const densityBuf = buf(device, bytes, STO);
  const flowA = buf(device, bytes, STO);
  const flowB = buf(device, bytes, STO);
  const sensAll = buf(device, bytes * C, STO);
  const compAll = buf(device, bytes * C, STO);
  const aggSens = buf(device, bytes, STO);
  const filtSens = buf(device, bytes, STO);
  const perCase = buf(device, C * 4, STO);
  const weightsBuf = buf(device, C * 4, STO);
  // Per-case source/support are uploaded into single shared buffers each case.
  const sourceMaskBuf = buf(device, bytes, STO);
  const sourceMagBuf = buf(device, bytes, STO);
  const supportBuf = buf(device, bytes, STO);

  // ── Uniform buffers ──
  // diffusion params: dims(vec3 u32 padded=16) + 4 floats(16) = 32
  const diffParamsBuf = buf(device, 32, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
  {
    const ab = new ArrayBuffer(32);
    const u = new Uint32Array(ab); const f = new Float32Array(ab);
    u[0] = nx; u[1] = ny; u[2] = nz;
    f[4] = penalty; f[5] = EMIN; f[6] = 0.4; f[7] = 0.6;
    device.queue.writeBuffer(diffParamsBuf, 0, ab);
  }
  // sens-slot params: n(u32) caseIdx(u32) penalty(f32) emin(f32) = 16
  const sensParamsBuf = buf(device, 16, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
  // reduce params: n, numCases = 8 → padded 16
  const reduceParamsBuf = buf(device, 16, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
  {
    const ab = new ArrayBuffer(16); new Uint32Array(ab).set([N, C]);
    device.queue.writeBuffer(reduceParamsBuf, 0, ab);
  }
  // aggregate params: n, numCases
  const aggParamsBuf = buf(device, 16, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
  {
    const ab = new ArrayBuffer(16); new Uint32Array(ab).set([N, C]);
    device.queue.writeBuffer(aggParamsBuf, 0, ab);
  }
  // filter params: dims + rmin + r = 32
  const filterParamsBuf = buf(device, 32, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
  {
    const ab = new ArrayBuffer(32);
    const u = new Uint32Array(ab); const f = new Float32Array(ab);
    u[0] = nx; u[1] = ny; u[2] = nz;
    f[4] = filterR; u[5] = Math.max(1, Math.ceil(filterR));
    device.queue.writeBuffer(filterParamsBuf, 0, ab);
  }

  const history: number[] = [];
  const prev = new Float32Array(density);
  let converged = false;
  let iter = 0;
  let lastAgg = Infinity;
  let lastPerCase: number[] = new Array(C).fill(0);
  let readbacks = 0;

  for (iter = 0; iter < maxIter; iter++) {
    const elapsed = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
    if (elapsed > budget) break;

    wF32(device, densityBuf, density);

    // ── Per-case diffusion + sens (no readbacks) ──
    for (let c = 0; c < C; c++) {
      const cs = cases[c];
      wU32(device, sourceMaskBuf, cs.sourceMask);
      wF32(device, sourceMagBuf, cs.sourceMag);
      wU32(device, supportBuf, cs.supportMask);

      const seed = new Float32Array(N);
      for (let i = 0; i < N; i++) if (cs.sourceMask[i]) seed[i] = cs.sourceMag[i];
      wF32(device, flowA, seed);
      wF32(device, flowB, new Float32Array(N));

      let readBuf = flowA, writeBuf = flowB;
      for (let inner = 0; inner < DIFFUSION_INNER; inner++) {
        const bg = device.createBindGroup({
          layout: ctx.diff.getBindGroupLayout(0),
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
        pass.setPipeline(ctx.diff);
        pass.setBindGroup(0, bg);
        pass.dispatchWorkgroups(groups3D[0], groups3D[1], groups3D[2]);
        pass.end();
        device.queue.submit([enc.finish()]);
        [readBuf, writeBuf] = [writeBuf, readBuf];
      }
      const flowFinal = readBuf;

      // Sens for this case → write into c-th slot of sensAll/compAll.
      {
        const ab = new ArrayBuffer(16);
        const u = new Uint32Array(ab); const f = new Float32Array(ab);
        u[0] = N; u[1] = c; f[2] = penalty; f[3] = EMIN;
        device.queue.writeBuffer(sensParamsBuf, 0, ab);
      }
      const sbg = device.createBindGroup({
        layout: ctx.sensSlot.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: sensParamsBuf } },
          { binding: 1, resource: { buffer: densityBuf } },
          { binding: 2, resource: { buffer: flowFinal } },
          { binding: 3, resource: { buffer: sensAll } },
          { binding: 4, resource: { buffer: compAll } },
        ],
      });
      const enc = device.createCommandEncoder();
      const pass = enc.beginComputePass();
      pass.setPipeline(ctx.sensSlot);
      pass.setBindGroup(0, sbg);
      pass.dispatchWorkgroups(groups1D);
      pass.end();
      device.queue.submit([enc.finish()]);
    }

    // ── Per-case GPU reduction → C floats ──
    {
      const bg = device.createBindGroup({
        layout: ctx.reduce.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: reduceParamsBuf } },
          { binding: 1, resource: { buffer: compAll } },
          { binding: 2, resource: { buffer: perCase } },
        ],
      });
      const enc = device.createCommandEncoder();
      const pass = enc.beginComputePass();
      pass.setPipeline(ctx.reduce);
      pass.setBindGroup(0, bg);
      pass.dispatchWorkgroups(C, 1, 1);
      pass.end();
      device.queue.submit([enc.finish()]);
    }

    // Readback #1: tiny C-float per-case compliance.
    const perCaseArr = await readF32(device, perCase, C);
    readbacks++;
    lastPerCase = Array.from(perCaseArr);

    // CPU computes weights for the GPU aggregation pass.
    const caseWeights = cases.map(c => c.weight);
    const { weights, aggCompliance } = computeAggregationWeights(
      lastPerCase, caseWeights, aggregation, ksRho,
    );
    lastAgg = aggCompliance;
    history.push(aggCompliance);
    wF32(device, weightsBuf, new Float32Array(weights));

    // ── GPU aggregation: aggSens[i] = Σ_c weights[c] · sens[c·N + i] ──
    {
      const bg = device.createBindGroup({
        layout: ctx.aggregate.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: aggParamsBuf } },
          { binding: 1, resource: { buffer: sensAll } },
          { binding: 2, resource: { buffer: weightsBuf } },
          { binding: 3, resource: { buffer: aggSens } },
        ],
      });
      const enc = device.createCommandEncoder();
      const pass = enc.beginComputePass();
      pass.setPipeline(ctx.aggregate);
      pass.setBindGroup(0, bg);
      pass.dispatchWorkgroups(groups1D);
      pass.end();
      device.queue.submit([enc.finish()]);
    }

    // ── Sensitivity filter on aggregated field ──
    {
      const bg = device.createBindGroup({
        layout: ctx.filter.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: filterParamsBuf } },
          { binding: 1, resource: { buffer: densityBuf } },
          { binding: 2, resource: { buffer: aggSens } },
          { binding: 3, resource: { buffer: filtSens } },
        ],
      });
      const enc = device.createCommandEncoder();
      const pass = enc.beginComputePass();
      pass.setPipeline(ctx.filter);
      pass.setBindGroup(0, bg);
      pass.dispatchWorkgroups(groups3D[0], groups3D[1], groups3D[2]);
      pass.end();
      device.queue.submit([enc.finish()]);
    }

    // Readback #2: filtered aggregated sensitivity (N floats) — independent of C.
    const sensArr = await readF32(device, filtSens, N);
    readbacks++;

    // ── OC update on CPU ──
    const updated = ocUpdate(density, sensArr, domain.designMask, targetVol);
    density = new Float32Array(updated.density);

    let change = 0;
    for (let i = 0; i < N; i++) change = Math.max(change, Math.abs(density[i] - prev[i]));
    prev.set(density);

    options.onIteration?.({
      iteration: iter,
      density: new Float32Array(density),
      compliance: aggCompliance,
      perCaseCompliance: lastPerCase.slice(),
      volumeFraction: updated.vol,
      change,
      elapsedMs: elapsed,
    } satisfies TopoIterationState);

    if (change < tol && iter > 5) { converged = true; break; }
  }

  for (const b of [
    densityBuf, flowA, flowB, sensAll, compAll, aggSens, filtSens, perCase, weightsBuf,
    sourceMaskBuf, sourceMagBuf, supportBuf,
    diffParamsBuf, sensParamsBuf, reduceParamsBuf, aggParamsBuf, filterParamsBuf,
  ]) b.destroy();

  return {
    density,
    compliance: lastAgg,
    perCaseCompliance: lastPerCase,
    loadCaseAggregation: aggregation,
    iterations: iter + 1,
    converged,
    history,
    backend: 'webgpu-multiload',
    elapsedMs: (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0,
    readbacks,
  };
}

// ─── Convenience helper for runSIMPAuto ─────────────────────────────────────

export function shouldUseMultiLoadGpu(options: TopoOptimizerOptions): boolean {
  return !!(options.loadCases && options.loadCases.length > 0);
}

export { hasWebGPUForSIMP };

/**
 * Re-export for external callers that want to depend on this module
 * without also pulling in `simpGpu.ts`.
 */
export { WebGPUUnavailableError } from './simpGpu';
