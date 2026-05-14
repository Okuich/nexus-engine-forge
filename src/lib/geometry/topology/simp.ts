/**
 * SIMP-style topology optimizer.
 *
 * Density-based with:
 *   • Penalized stiffness:  E(ρ) = ρ^p · E₀
 *   • Compliance proxy:     local strain energy ≈ |force-flow|² / E(ρ)
 *   • Force-flow estimation via diffusion from loads to supports on the
 *     density-weighted voxel graph (cheap surrogate for FEA).
 *   • Sensitivity filtering with a radial (cone) kernel to avoid
 *     checkerboard patterns.
 *   • Optimality-Criteria update with bisection for Lagrange multiplier
 *     to satisfy the volume-fraction constraint.
 *
 * This is intentionally simpler than full FEA but produces physically
 * meaningful topology trends, validated against the simulation engine.
 */
import type {
  LoadCondition,
  SupportCondition,
  LoadCase,
  LoadCaseAggregation,
  TopoOptimizerOptions,
  TopoIterationState,
  V3,
} from './types';
import { worldToVoxel, type VoxelDomain } from './voxelizer';
import { applyConstraintPenalties, type PenaltyDiagnostics } from './constraintPenalties';

interface SimpRunResult {
  density: Float32Array;
  compliance: number;
  /** Per-case compliance breakdown for the final iteration. */
  perCaseCompliance: number[];
  loadCaseAggregation: LoadCaseAggregation;
  iterations: number;
  converged: boolean;
  history: number[]; // aggregated compliance per iter
}

interface ProjectedCase {
  loadVoxels: number[];
  loadMags: number[];
  supportSet: Set<number>;
  weight: number;
  name?: string;
}

const EMIN = 1e-3; // stiffness floor for void cells

function neighbors(idx: number, dims: [number, number, number]): number[] {
  const [nx, ny, nz] = dims;
  const k = Math.floor(idx / (nx * ny));
  const j = Math.floor((idx - k * nx * ny) / nx);
  const i = idx - j * nx - k * nx * ny;
  const out: number[] = [];
  if (i > 0)      out.push(idx - 1);
  if (i < nx - 1) out.push(idx + 1);
  if (j > 0)      out.push(idx - nx);
  if (j < ny - 1) out.push(idx + nx);
  if (k > 0)      out.push(idx - nx * ny);
  if (k < nz - 1) out.push(idx + nx * ny);
  return out;
}

/**
 * Estimate force-flow magnitude per voxel via iterative diffusion.
 * Sources = load voxels, sinks = support voxels. Conductivity = ρ^p.
 */
function estimateForceFlow(
  density: Float32Array,
  domain: VoxelDomain,
  loadVoxels: number[],
  loadMag: number[],
  supportVoxels: Set<number>,
  penalty: number,
  iters = 30,
): Float32Array {
  const flow = new Float32Array(density.length);
  for (let i = 0; i < loadVoxels.length; i++) flow[loadVoxels[i]] = loadMag[i];

  const next = new Float32Array(density.length);
  for (let it = 0; it < iters; it++) {
    next.set(flow);
    for (let idx = 0; idx < density.length; idx++) {
      if (supportVoxels.has(idx)) { next[idx] = 0; continue; }
      const rhoP = Math.pow(density[idx] + EMIN, penalty);
      if (rhoP < 1e-4) continue;
      const nb = neighbors(idx, domain.dims);
      let sum = 0;
      let weight = 0;
      for (const n of nb) {
        const wn = Math.pow(density[n] + EMIN, penalty);
        sum += flow[n] * wn;
        weight += wn;
      }
      if (weight > 0) {
        // Flow leaks toward supports; this is a smoothing step
        next[idx] = 0.4 * flow[idx] + 0.6 * (sum / weight);
      }
    }
    // Pin sources
    for (let i = 0; i < loadVoxels.length; i++) next[loadVoxels[i]] = loadMag[i];
    flow.set(next);
  }
  return flow;
}

/** Radial sensitivity filter (Bendsøe-Sigmund) — cone weights of radius rmin. */
function sensitivityFilter(
  sensitivity: Float32Array,
  density: Float32Array,
  dims: [number, number, number],
  rmin: number,
): Float32Array {
  const [nx, ny, nz] = dims;
  const out = new Float32Array(sensitivity.length);
  const r = Math.max(1, Math.ceil(rmin));
  for (let k = 0; k < nz; k++) {
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const idx = i + j * nx + k * nx * ny;
        let num = 0, den = 0;
        for (let dk = -r; dk <= r; dk++) {
          const kk = k + dk; if (kk < 0 || kk >= nz) continue;
          for (let dj = -r; dj <= r; dj++) {
            const jj = j + dj; if (jj < 0 || jj >= ny) continue;
            for (let di = -r; di <= r; di++) {
              const ii = i + di; if (ii < 0 || ii >= nx) continue;
              const dist = Math.hypot(di, dj, dk);
              if (dist > rmin) continue;
              const w = rmin - dist;
              const nIdx = ii + jj * nx + kk * nx * ny;
              num += w * density[nIdx] * sensitivity[nIdx];
              den += w * density[nIdx];
            }
          }
        }
        out[idx] = den > 1e-9 ? num / Math.max(density[idx], 1e-3) / den : sensitivity[idx];
      }
    }
  }
  return out;
}

/** Optimality-Criteria update — bisection on λ to hit volume target. */
function ocUpdate(
  density: Float32Array,
  sensitivity: Float32Array,
  designMask: Uint8Array,
  targetVol: number,
  move = 0.2,
): { density: Float32Array; vol: number } {
  let lo = 1e-9, hi = 1e9;
  const total = designMask.reduce((a, b) => a + b, 0);
  const targetMass = targetVol * total;
  const next = new Float32Array(density.length);

  for (let iter = 0; iter < 50; iter++) {
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

export function runSIMP(
  domain: VoxelDomain,
  loads: LoadCondition[],
  supports: SupportCondition[],
  options: TopoOptimizerOptions = {},
): SimpRunResult {
  const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const targetVol = options.targetVolumeFraction ?? 0.4;
  const maxIter = options.maxIterations ?? 50;
  const penalty = options.penalty ?? 3;
  const filterR = options.filterRadius ?? 1.5;
  const tol = options.convergenceTol ?? 0.01;
  const budget = options.timeBudgetMs ?? 5000;

  const N = domain.designMask.length;
  let density = options.resumeFrom && options.resumeFrom.length === N
    ? new Float32Array(options.resumeFrom)
    : new Float32Array(N);
  if (!options.resumeFrom) {
    for (let i = 0; i < N; i++) density[i] = domain.designMask[i] ? targetVol : 0;
  }

  // Project loads / supports onto voxels
  const loadVoxels: number[] = [];
  const loadMags: number[] = [];
  for (const ld of loads) {
    const { idx } = worldToVoxel(domain, ld.point);
    if (idx >= 0) {
      loadVoxels.push(idx);
      loadMags.push(Math.hypot(...ld.force));
    }
  }
  const supportSet = new Set<number>();
  for (const sp of supports) {
    const { idx } = worldToVoxel(domain, sp.point);
    if (idx >= 0) supportSet.add(idx);
  }
  if (loadVoxels.length === 0 || supportSet.size === 0) {
    return { density, compliance: Infinity, iterations: 0, converged: false, history: [] };
  }

  const history: number[] = [];
  let prev = new Float32Array(density);
  let converged = false;
  let iter = 0;

  for (iter = 0; iter < maxIter; iter++) {
    const elapsed = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
    if (elapsed > budget) break;

    const flow = estimateForceFlow(density, domain, loadVoxels, loadMags, supportSet, penalty);

    // Sensitivity ∂c/∂ρ ≈ −p · ρ^(p−1) · u² where u = flow
    const sens = new Float32Array(N);
    let compliance = 0;
    for (let i = 0; i < N; i++) {
      const u2 = flow[i] * flow[i];
      const rho = density[i] + EMIN;
      compliance += Math.pow(rho, penalty) * u2;
      sens[i] = -penalty * Math.pow(rho, penalty - 1) * u2;
    }
    history.push(compliance);

    // Optional manufacturing/physics penalty terms.
    let penaltyDiagnostics: PenaltyDiagnostics | undefined;
    let augmentedSens = sens;
    if (options.constraints) {
      const res = applyConstraintPenalties(sens, density, domain.designMask, domain.dims, {
        ...options.constraints,
        flow,
        voxelSizeMm: options.constraints.voxelSizeMm ?? domain.voxelSize,
      });
      augmentedSens = new Float32Array(res.sensitivity);
      penaltyDiagnostics = res.diagnostics;
    }

    const filtered = sensitivityFilter(augmentedSens, density, domain.dims, filterR);
    const updated = ocUpdate(density, filtered, domain.designMask, targetVol);
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
      penaltyDiagnostics,
    } satisfies TopoIterationState);

    if (change < tol && iter > 5) { converged = true; break; }
  }

  const lastCompliance = history.length ? history[history.length - 1] : Infinity;
  return { density, compliance: lastCompliance, iterations: iter + 1, converged, history };
}
