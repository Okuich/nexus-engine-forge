/**
 * Constraint penalty terms for the SIMP optimizer.
 *
 * Each constraint contributes a per-voxel additive term to the raw
 * sensitivity ∂c/∂ρ before the radial filter and OC update.
 *
 *   sens_i ← sens_i + Σ_k  w_k · ∂g_k / ∂ρ_i
 *
 * Sign convention: more negative sensitivity → OC update PUSHES density
 * UP at that voxel. So:
 *   – overhang violation → POSITIVE penalty (push material away)
 *   – min-feature violation → POSITIVE penalty on isolated thin cells
 *   – stress overload → NEGATIVE penalty (add material to relieve stress)
 *
 * All terms are computed in-place on a fresh Float32Array; the original
 * sensitivity is not mutated. Designed to run after the GPU readback
 * (cheap O(N) work — negligible vs. diffusion).
 */
import type { ManufacturingConstraints } from './types';

export interface ConstraintPenaltyOptions {
  /** Manufacturing constraints (overhang, min-feature, symmetry). */
  manufacturing?: ManufacturingConstraints;
  /** Penalty weights — multiply each ∂g/∂ρ. All default to 0 (no penalty). */
  weights?: {
    /** Overhang violation penalty. Typical 0.05 – 0.5. */
    overhang?: number;
    /** Min-feature isolation penalty. Typical 0.01 – 0.2. */
    minFeature?: number;
    /** Stress-cap penalty (requires `flow` and `maxStress`). 0.05 – 0.5. */
    stress?: number;
  };
  /** Optional flow/strain field from the diffusion solver, for stress capping. */
  flow?: Float32Array;
  /** Maximum allowable |flow|² before the stress penalty kicks in. */
  maxStress?: number;
  /** Voxel size in mm — used to convert min-feature mm → cells. */
  voxelSizeMm?: number;
}

export interface PenaltyDiagnostics {
  overhangViolations: number;
  minFeatureViolations: number;
  stressViolations: number;
}

function buildAxisIndex(axis: 'x' | 'y' | 'z'): number {
  return axis === 'x' ? 0 : axis === 'y' ? 1 : 2;
}

function axisStride(axis: 'x' | 'y' | 'z', dims: [number, number, number]): number {
  if (axis === 'x') return 1;
  if (axis === 'y') return dims[0];
  return dims[0] * dims[1];
}

/**
 * Apply all configured penalties to a copy of `sensitivity` and return it.
 * Fast O(N · k) where k is bounded by the chosen kernel sizes (≤ 27 typical).
 */
export function applyConstraintPenalties(
  sensitivity: Float32Array,
  density: Float32Array,
  designMask: Uint8Array,
  dims: [number, number, number],
  options: ConstraintPenaltyOptions = {},
): { sensitivity: Float32Array; diagnostics: PenaltyDiagnostics } {
  const out = new Float32Array(sensitivity);
  const diag: PenaltyDiagnostics = {
    overhangViolations: 0,
    minFeatureViolations: 0,
    stressViolations: 0,
  };
  const w = options.weights ?? {};
  const mc = options.manufacturing;

  // ── Overhang penalty ────────────────────────────────────────────────────
  if (w.overhang && mc?.pullAxis && mc.maxOverhangDeg !== undefined) {
    const axis = mc.pullAxis;
    const stride = axisStride(axis, dims);
    const axisLen = dims[buildAxisIndex(axis)];
    const reach = Math.max(0, Math.floor(Math.tan((mc.maxOverhangDeg * Math.PI) / 180)));
    const [nx, ny, nz] = dims;
    for (let k = 0; k < nz; k++) {
      for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++) {
          const idx = i + j * nx + k * nx * ny;
          if (!designMask[idx]) continue;
          // Coordinate along build axis.
          const h = axis === 'x' ? i : axis === 'y' ? j : k;
          if (h === 0) continue; // build plate — always supported
          // Inspect candidate supporters one cell down the build axis,
          // within `reach` cells perpendicular to the axis.
          let supportMass = 0;
          for (let du = -reach; du <= reach; du++) {
            for (let dv = -reach; dv <= reach; dv++) {
              let ii = i, jj = j, kk = k;
              if (axis === 'x') { ii -= 1; jj += du; kk += dv; }
              else if (axis === 'y') { jj -= 1; ii += du; kk += dv; }
              else { kk -= 1; ii += du; jj += dv; }
              if (ii < 0 || jj < 0 || kk < 0 || ii >= nx || jj >= ny || kk >= nz) continue;
              supportMass += density[ii + jj * nx + kk * nx * ny];
            }
          }
          // Penalty grows when this cell is dense but its supporters are sparse.
          const denom = (2 * reach + 1) * (2 * reach + 1);
          const supportFrac = supportMass / denom;
          const violation = density[idx] * Math.max(0, 1 - supportFrac * 2);
          if (violation > 1e-3) diag.overhangViolations++;
          // ∂(violation)/∂ρ_idx ≈ max(0, 1 - 2*supportFrac); positive → push down.
          out[idx] += w.overhang * Math.max(0, 1 - supportFrac * 2);
          // Indirectly reward supporters (negative push to densify them).
          if (violation > 0) {
            const reward = -w.overhang * 0.25 * density[idx] / denom;
            for (let du = -reach; du <= reach; du++) {
              for (let dv = -reach; dv <= reach; dv++) {
                let ii = i, jj = j, kk = k;
                if (axis === 'x') { ii -= 1; jj += du; kk += dv; }
                else if (axis === 'y') { jj -= 1; ii += du; kk += dv; }
                else { kk -= 1; ii += du; jj += dv; }
                if (ii < 0 || jj < 0 || kk < 0 || ii >= nx || jj >= ny || kk >= nz) continue;
                out[ii + jj * nx + kk * nx * ny] += reward;
              }
            }
          }
        }
      }
    }
    // silence unused stride warning while preserving the intent.
    void stride; void axisLen;
  }

  // ── Min-feature isolation penalty ───────────────────────────────────────
  if (w.minFeature && mc?.minFeatureMm && options.voxelSizeMm) {
    const r = Math.max(1, Math.round(mc.minFeatureMm / options.voxelSizeMm));
    const [nx, ny, nz] = dims;
    for (let k = 0; k < nz; k++) {
      for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++) {
          const idx = i + j * nx + k * nx * ny;
          if (!designMask[idx]) continue;
          // Box-average of density in a (2r+1)³ neighbourhood.
          let sum = 0, count = 0;
          for (let dk = -r; dk <= r; dk++) {
            const kk = k + dk; if (kk < 0 || kk >= nz) continue;
            for (let dj = -r; dj <= r; dj++) {
              const jj = j + dj; if (jj < 0 || jj >= ny) continue;
              for (let di = -r; di <= r; di++) {
                const ii = i + di; if (ii < 0 || ii >= nx) continue;
                sum += density[ii + jj * nx + kk * nx * ny];
                count++;
              }
            }
          }
          const avg = sum / Math.max(1, count);
          // A dense voxel embedded in a sparse neighbourhood is "thin".
          // g = ρ_i · max(0, 0.5 - avg). Penalty erodes thin features.
          const thinness = Math.max(0, 0.5 - avg);
          if (density[idx] > 0.4 && thinness > 0.05) diag.minFeatureViolations++;
          out[idx] += w.minFeature * thinness;
        }
      }
    }
  }

  // ── Stress-cap penalty ──────────────────────────────────────────────────
  if (w.stress && options.flow && options.maxStress && options.maxStress > 0) {
    const flow = options.flow;
    const maxS = options.maxStress;
    for (let i = 0; i < density.length; i++) {
      if (!designMask[i]) continue;
      const u2 = flow[i] * flow[i];
      if (u2 > maxS) {
        diag.stressViolations++;
        // Negative contribution → drive density UP in over-stressed cells.
        out[i] -= w.stress * (u2 - maxS) / maxS;
      }
    }
  }

  return { sensitivity: out, diagnostics: diag };
}
