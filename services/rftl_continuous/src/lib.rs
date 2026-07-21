//! # rftl_continuous
//!
//! High-performance continuous simulation core for the Midwater platform.
//!
//! This crate provides three tightly-coupled primitives used by the industrial
//! reasoning stack:
//!
//! 1. [`MetricTensorField`] — a 3-D Riemannian metric tensor field
//!    `g_ij(x, T) = alpha(T) * delta_ij + sigma_ij(x)` stored as a flat,
//!    contiguous 1-D `Vec<f64>` over a regular spatial grid for optimal cache
//!    locality (Struct-of-Arrays style, `nx * ny * nz * 6` entries — six
//!    independent components per symmetric 3×3 tensor).
//!
//! 2. A finite-difference stencil that computes a discrete approximation of
//!    the **Ricci scalar** curvature field `R(x)` across the grid, used to
//!    detect warping / thermal-distortion hotspots.
//!
//! 3. [`FractionalSolver`] — a spatial-temporal **Caputo fractional**
//!    advection-diffusion-deformation solver with a rolling ring-buffer
//!    history window of length `N`. Time-stepping is data-parallel via
//!    `rayon` and the crate forbids all `unsafe` code (see `Cargo.toml`).
//!
//! ## Safety
//!
//! `#![forbid(unsafe_code)]` is enforced at the crate root. All indexing is
//! bounds-checked; the hot loops use `rayon` parallel iterators with disjoint
//! output slices so aliasing is impossible by construction.

#![forbid(unsafe_code)]
#![deny(missing_docs)]
#![deny(rust_2018_idioms)]

use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use std::f64::consts::PI;
use thiserror::Error;

// ─────────────────────────────────────────────────────────────────────────────
// Errors
// ─────────────────────────────────────────────────────────────────────────────

/// Errors that can arise while constructing or advancing the simulation core.
#[derive(Debug, Error)]
pub enum RftlError {
    /// Grid dimension is zero along at least one axis.
    #[error("invalid grid shape: nx={0}, ny={1}, nz={2} (all must be >= 3)")]
    InvalidGrid(usize, usize, usize),

    /// Spatial step is non-positive or non-finite.
    #[error("invalid spacing: dx={0}, dy={1}, dz={2} (all must be > 0 and finite)")]
    InvalidSpacing(f64, f64, f64),

    /// Fractional order alpha is outside the admissible range `(0, 1]`.
    #[error("fractional order alpha={0} is outside (0, 1]")]
    InvalidFractionalOrder(f64),

    /// History buffer length is smaller than 2.
    #[error("history window length N={0} must be >= 2")]
    InvalidHistoryLength(usize),

    /// The supplied field slice does not match the grid volume.
    #[error("field length mismatch: expected {expected}, got {actual}")]
    FieldLengthMismatch {
        /// Expected element count.
        expected: usize,
        /// Actual element count supplied.
        actual: usize,
    },
}

// ─────────────────────────────────────────────────────────────────────────────
// Grid
// ─────────────────────────────────────────────────────────────────────────────

/// A regular Cartesian 3-D grid description.
///
/// `nx * ny * nz` is the total voxel count. The layout used by every buffer in
/// this crate is `index = ((k * ny) + j) * nx + i`, i.e. `i` (x) is the
/// fastest-varying axis. This maximises cache reuse in the innermost stencil
/// loops.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct Grid {
    /// Number of nodes along the x axis.
    pub nx: usize,
    /// Number of nodes along the y axis.
    pub ny: usize,
    /// Number of nodes along the z axis.
    pub nz: usize,
    /// Node spacing along x (metres).
    pub dx: f64,
    /// Node spacing along y (metres).
    pub dy: f64,
    /// Node spacing along z (metres).
    pub dz: f64,
}

impl Grid {
    /// Construct a grid, validating dimensions and spacing.
    pub fn new(nx: usize, ny: usize, nz: usize, dx: f64, dy: f64, dz: f64) -> Result<Self, RftlError> {
        if nx < 3 || ny < 3 || nz < 3 {
            return Err(RftlError::InvalidGrid(nx, ny, nz));
        }
        if !(dx.is_finite() && dy.is_finite() && dz.is_finite()) || dx <= 0.0 || dy <= 0.0 || dz <= 0.0
        {
            return Err(RftlError::InvalidSpacing(dx, dy, dz));
        }
        Ok(Self { nx, ny, nz, dx, dy, dz })
    }

    /// Total voxel (node) count.
    #[inline]
    pub fn len(&self) -> usize {
        self.nx * self.ny * self.nz
    }

    /// True when the grid has zero volume — never in practice; provided for
    /// clippy hygiene.
    #[inline]
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    /// Convert a `(i, j, k)` triple to the flat scalar-field index.
    #[inline]
    pub fn idx(&self, i: usize, j: usize, k: usize) -> usize {
        (k * self.ny + j) * self.nx + i
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Metric tensor field
// ─────────────────────────────────────────────────────────────────────────────

/// The six independent components of a symmetric 3×3 tensor, laid out as
/// `[g_xx, g_yy, g_zz, g_xy, g_xz, g_yz]`.
pub const TENSOR_COMPONENTS: usize = 6;

/// A 3-D Riemannian metric tensor field.
///
/// The field is stored as a single flat `Vec<f64>` of length
/// `nx * ny * nz * 6`. For a voxel with flat index `n`, the six components
/// live in `data[n * 6 .. n * 6 + 6]` in the order given by
/// [`TENSOR_COMPONENTS`]. Keeping all six components adjacent per voxel means
/// each stencil evaluation touches one cache line per neighbour rather than six.
///
/// The physical model is
///
/// ```text
/// g_ij(x, T) = alpha(T) * delta_ij + sigma_ij(x)
/// ```
///
/// where `alpha(T)` is a scalar thermal expansion factor and `sigma_ij(x)` is
/// a spatial anisotropy tensor supplied by the caller.
#[derive(Debug, Clone)]
pub struct MetricTensorField {
    grid: Grid,
    data: Vec<f64>,
}

impl MetricTensorField {
    /// Construct a metric field from a per-voxel thermal expansion factor
    /// `alpha(T)` (length = `grid.len()`) and a per-voxel anisotropy tensor
    /// `sigma_ij(x)` (length = `grid.len() * 6`).
    pub fn new(grid: Grid, alpha_of_t: &[f64], sigma: &[f64]) -> Result<Self, RftlError> {
        let n = grid.len();
        if alpha_of_t.len() != n {
            return Err(RftlError::FieldLengthMismatch { expected: n, actual: alpha_of_t.len() });
        }
        if sigma.len() != n * TENSOR_COMPONENTS {
            return Err(RftlError::FieldLengthMismatch {
                expected: n * TENSOR_COMPONENTS,
                actual: sigma.len(),
            });
        }

        // g_ij = alpha * delta_ij + sigma_ij
        //
        // The diagonal receives alpha; off-diagonal components are copied from
        // sigma unchanged. `par_chunks_mut` gives us disjoint writable slices,
        // so no unsafe indexing is required.
        let mut data = vec![0.0_f64; n * TENSOR_COMPONENTS];
        data.par_chunks_mut(TENSOR_COMPONENTS)
            .enumerate()
            .for_each(|(voxel, out)| {
                let a = alpha_of_t[voxel];
                let s = &sigma[voxel * TENSOR_COMPONENTS..voxel * TENSOR_COMPONENTS + TENSOR_COMPONENTS];
                out[0] = a + s[0]; // g_xx
                out[1] = a + s[1]; // g_yy
                out[2] = a + s[2]; // g_zz
                out[3] = s[3];     // g_xy
                out[4] = s[4];     // g_xz
                out[5] = s[5];     // g_yz
            });

        Ok(Self { grid, data })
    }

    /// The underlying grid description.
    pub fn grid(&self) -> Grid {
        self.grid
    }

    /// Immutable access to the flat backing buffer.
    pub fn as_slice(&self) -> &[f64] {
        &self.data
    }

    /// Read the six tensor components at `(i, j, k)`.
    #[inline]
    pub fn tensor_at(&self, i: usize, j: usize, k: usize) -> [f64; TENSOR_COMPONENTS] {
        let base = self.grid.idx(i, j, k) * TENSOR_COMPONENTS;
        [
            self.data[base],
            self.data[base + 1],
            self.data[base + 2],
            self.data[base + 3],
            self.data[base + 4],
            self.data[base + 5],
        ]
    }

    /// Determinant of the metric at a given voxel — used by the curvature
    /// stencil to normalise contracted quantities.
    #[inline]
    pub fn det_at(&self, i: usize, j: usize, k: usize) -> f64 {
        let g = self.tensor_at(i, j, k);
        // g = | gxx gxy gxz |
        //     | gxy gyy gyz |
        //     | gxz gyz gzz |
        let (gxx, gyy, gzz, gxy, gxz, gyz) = (g[0], g[1], g[2], g[3], g[4], g[5]);
        gxx * (gyy * gzz - gyz * gyz)
            - gxy * (gxy * gzz - gyz * gxz)
            + gxz * (gxy * gyz - gyy * gxz)
    }

    // ─── Discrete Ricci scalar curvature ──────────────────────────────────
    //
    // For engineering hotspot detection we do not need the full geometric
    // machinery of the Ricci tensor. Instead we use the identity, valid to
    // leading order for weakly-perturbed metrics `g_ij = delta_ij + h_ij` with
    // `|h| << 1`:
    //
    //     R ≈ ∂_i ∂_j h^{ij} − ∇² tr(h)
    //
    // which is the linearised scalar curvature. Discretising both terms with
    // a second-order central stencil gives an O(h²) approximation that is
    // sufficient for hotspot localisation, is symmetric (no mesh-orientation
    // bias) and is embarrassingly parallel over interior voxels.

    /// Compute the discrete Ricci-scalar curvature field `R(x)` across the
    /// grid using a second-order central finite-difference stencil. Boundary
    /// voxels are set to `0.0` (Neumann-like padding), which is the standard
    /// convention for hotspot maps.
    pub fn ricci_scalar_field(&self) -> Vec<f64> {
        let g = self.grid;
        let n = g.len();
        let mut r = vec![0.0_f64; n];

        // Cache reciprocals — divisions are expensive in the inner loop.
        let inv_dx2 = 1.0 / (g.dx * g.dx);
        let inv_dy2 = 1.0 / (g.dy * g.dy);
        let inv_dz2 = 1.0 / (g.dz * g.dz);
        let inv_4dxdy = 1.0 / (4.0 * g.dx * g.dy);
        let inv_4dxdz = 1.0 / (4.0 * g.dx * g.dz);
        let inv_4dydz = 1.0 / (4.0 * g.dy * g.dz);

        let data = &self.data;
        let comp = TENSOR_COMPONENTS;

        // Small helper — returns tr(h) = (gxx - 1) + (gyy - 1) + (gzz - 1)
        // for a perturbation about the flat metric.
        let trace = |voxel: usize| -> f64 {
            let b = voxel * comp;
            (data[b] - 1.0) + (data[b + 1] - 1.0) + (data[b + 2] - 1.0)
        };

        // Extract a single component (0..6) at a voxel.
        let hcomp = |voxel: usize, c: usize| -> f64 {
            let b = voxel * comp;
            match c {
                0 | 1 | 2 => data[b + c] - 1.0, // diagonal perturbation
                3 | 4 | 5 => data[b + c],       // off-diagonal is the perturbation itself
                _ => 0.0,
            }
        };

        // Parallelise over interior k-planes; each writes a disjoint slab.
        r.par_chunks_mut(g.nx * g.ny)
            .enumerate()
            .for_each(|(k, plane)| {
                if k == 0 || k >= g.nz - 1 {
                    return; // boundary: leave zeros
                }
                for j in 1..g.ny - 1 {
                    for i in 1..g.nx - 1 {
                        let c = g.idx(i, j, k);
                        let xm = g.idx(i - 1, j, k);
                        let xp = g.idx(i + 1, j, k);
                        let ym = g.idx(i, j - 1, k);
                        let yp = g.idx(i, j + 1, k);
                        let zm = g.idx(i, j, k - 1);
                        let zp = g.idx(i, j, k + 1);
                        let xpyp = g.idx(i + 1, j + 1, k);
                        let xpym = g.idx(i + 1, j - 1, k);
                        let xmyp = g.idx(i - 1, j + 1, k);
                        let xmym = g.idx(i - 1, j - 1, k);
                        let xpzp = g.idx(i + 1, j, k + 1);
                        let xpzm = g.idx(i + 1, j, k - 1);
                        let xmzp = g.idx(i - 1, j, k + 1);
                        let xmzm = g.idx(i - 1, j, k - 1);
                        let ypzp = g.idx(i, j + 1, k + 1);
                        let ypzm = g.idx(i, j + 1, k - 1);
                        let ymzp = g.idx(i, j - 1, k + 1);
                        let ymzm = g.idx(i, j - 1, k - 1);

                        // ∇² tr(h)
                        let trc = trace(c);
                        let lap_tr = (trace(xp) - 2.0 * trc + trace(xm)) * inv_dx2
                            + (trace(yp) - 2.0 * trc + trace(ym)) * inv_dy2
                            + (trace(zp) - 2.0 * trc + trace(zm)) * inv_dz2;

                        // ∂_i ∂_j h^{ij} for i,j ∈ {x,y,z}
                        //   diagonal: ∂²h_xx/∂x² + ∂²h_yy/∂y² + ∂²h_zz/∂z²
                        let dd_xx = (hcomp(xp, 0) - 2.0 * hcomp(c, 0) + hcomp(xm, 0)) * inv_dx2;
                        let dd_yy = (hcomp(yp, 1) - 2.0 * hcomp(c, 1) + hcomp(ym, 1)) * inv_dy2;
                        let dd_zz = (hcomp(zp, 2) - 2.0 * hcomp(c, 2) + hcomp(zm, 2)) * inv_dz2;

                        //   cross: 2 * (∂²h_xy/∂x∂y + ∂²h_xz/∂x∂z + ∂²h_yz/∂y∂z)
                        let dd_xy = (hcomp(xpyp, 3) - hcomp(xpym, 3) - hcomp(xmyp, 3) + hcomp(xmym, 3))
                            * inv_4dxdy;
                        let dd_xz = (hcomp(xpzp, 4) - hcomp(xpzm, 4) - hcomp(xmzp, 4) + hcomp(xmzm, 4))
                            * inv_4dxdz;
                        let dd_yz = (hcomp(ypzp, 5) - hcomp(ypzm, 5) - hcomp(ymzp, 5) + hcomp(ymzm, 5))
                            * inv_4dydz;

                        let didjhij = dd_xx + dd_yy + dd_zz + 2.0 * (dd_xy + dd_xz + dd_yz);

                        // R ≈ ∂_i ∂_j h^{ij} − ∇² tr(h)
                        let plane_offset = j * g.nx + i;
                        plane[plane_offset] = didjhij - lap_tr;
                    }
                }
            });

        r
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Fractional Caputo solver
// ─────────────────────────────────────────────────────────────────────────────

/// Immutable configuration of the [`FractionalSolver`].
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct FractionalConfig {
    /// Caputo fractional order, `alpha ∈ (0, 1]`. `alpha == 1` recovers the
    /// classical first-order time derivative.
    pub alpha: f64,
    /// Time step (seconds).
    pub dt: f64,
    /// Isotropic diffusion coefficient (m² / s^alpha).
    pub diffusion: f64,
    /// Deformation coupling — scales the influence of Ricci curvature on the
    /// state evolution.
    pub deformation_coupling: f64,
    /// Length of the rolling history ring buffer, `N >= 2`.
    pub history: usize,
}

impl FractionalConfig {
    /// Validate the configuration.
    pub fn validate(&self) -> Result<(), RftlError> {
        if !(self.alpha > 0.0 && self.alpha <= 1.0 && self.alpha.is_finite()) {
            return Err(RftlError::InvalidFractionalOrder(self.alpha));
        }
        if self.history < 2 {
            return Err(RftlError::InvalidHistoryLength(self.history));
        }
        Ok(())
    }
}

/// A spatial-temporal fractional advection-diffusion-deformation solver.
///
/// The governing equation, discretised on the regular grid provided by
/// [`MetricTensorField`], is
///
/// ```text
/// ^C D_t^alpha u(x, t) = D ∇² u − v · ∇u + κ R(x) u + f(x, t)
/// ```
///
/// where `^C D_t^alpha` is the Caputo fractional time derivative of order
/// `alpha ∈ (0, 1]`, `D` is the diffusion coefficient, `v` is a spatially
/// constant advection velocity, `R(x)` is the Ricci scalar curvature field
/// derived from the metric, and `f` is an optional source term.
///
/// The Caputo derivative is discretised with the standard L1 scheme:
///
/// ```text
/// ^C D_t^alpha u(t_n) ≈ dt^{-alpha} / Γ(2 − alpha)
///     * Σ_{k=0}^{n-1} b_k (u_{n-k} − u_{n-1-k})
/// ```
///
/// with weights `b_k = (k + 1)^{1-alpha} − k^{1-alpha}`. The history required
/// by the summation is held in a **ring buffer of length `N`** — older states
/// are silently discarded, giving bounded memory.
pub struct FractionalSolver {
    grid: Grid,
    metric: MetricTensorField,
    ricci: Vec<f64>,
    config: FractionalConfig,
    /// Rolling history ring buffer. Slot `history[step % N]` holds the state
    /// at that step. `steps_taken` counts total steps advanced (monotonic).
    history: Vec<Vec<f64>>,
    steps_taken: usize,
    /// Advection velocity `(vx, vy, vz)` (m / s).
    velocity: [f64; 3],
    /// Pre-computed L1 weights `b_k = (k+1)^{1-α} − k^{1-α}`.
    l1_weights: Vec<f64>,
    /// Scale factor `dt^{-α} / Γ(2 − α)`.
    l1_scale: f64,
}

impl FractionalSolver {
    /// Construct a new solver. `initial_state` must be the state at `t = 0`
    /// with length equal to `metric.grid().len()`.
    pub fn new(
        metric: MetricTensorField,
        config: FractionalConfig,
        initial_state: Vec<f64>,
        velocity: [f64; 3],
    ) -> Result<Self, RftlError> {
        config.validate()?;
        let grid = metric.grid();
        if initial_state.len() != grid.len() {
            return Err(RftlError::FieldLengthMismatch {
                expected: grid.len(),
                actual: initial_state.len(),
            });
        }

        let ricci = metric.ricci_scalar_field();

        // Pre-compute L1 coefficients for the maximum window we may need.
        let mut l1_weights = Vec::with_capacity(config.history);
        for k in 0..config.history {
            let k_f = k as f64;
            let w = (k_f + 1.0).powf(1.0 - config.alpha) - k_f.powf(1.0 - config.alpha);
            l1_weights.push(w);
        }
        let l1_scale = config.dt.powf(-config.alpha) / gamma(2.0 - config.alpha);

        // Seed the ring buffer with the initial state at slot 0. Other slots
        // are cloned copies (equivalent to holding a steady state for t<0),
        // which is the standard initialisation for Caputo problems.
        let mut history = Vec::with_capacity(config.history);
        for _ in 0..config.history {
            history.push(initial_state.clone());
        }

        Ok(Self {
            grid,
            metric,
            ricci,
            config,
            history,
            steps_taken: 0,
            velocity,
            l1_weights,
            l1_scale,
        })
    }

    /// The underlying metric field.
    pub fn metric(&self) -> &MetricTensorField {
        &self.metric
    }

    /// Ricci scalar curvature field.
    pub fn ricci(&self) -> &[f64] {
        &self.ricci
    }

    /// Current state (latest step).
    pub fn state(&self) -> &[f64] {
        let idx = self.steps_taken % self.config.history;
        &self.history[idx]
    }

    /// Number of time steps executed so far.
    pub fn steps_taken(&self) -> usize {
        self.steps_taken
    }

    /// Advance the solver by a single time step under the source term
    /// `f(x, t_{n+1})`. Pass an all-zero slice for a homogeneous problem.
    ///
    /// The update rule, obtained by solving the L1-discretised Caputo equation
    /// for `u_{n+1}`, is:
    ///
    /// ```text
    /// u_{n+1} = u_n
    ///     + (1 / (l1_scale * b_0)) * (
    ///         D ∇² u_n − v · ∇ u_n + κ R(x) u_n + f_{n+1}
    ///         − l1_scale * Σ_{k=1}^{K-1} b_k (u_{n-k+1} − u_{n-k})
    ///     )
    /// ```
    pub fn step(&mut self, source: &[f64]) -> Result<(), RftlError> {
        let n = self.grid.len();
        if source.len() != n {
            return Err(RftlError::FieldLengthMismatch { expected: n, actual: source.len() });
        }

        let g = self.grid;
        let cfg = self.config;
        let (vx, vy, vz) = (self.velocity[0], self.velocity[1], self.velocity[2]);

        // Snapshot of "current" state u_n before we overwrite anything.
        let current_slot = self.steps_taken % cfg.history;
        let u_n: Vec<f64> = self.history[current_slot].clone();

        // Number of usable history terms (bounded by both steps_taken and N-1).
        let hist_terms = self.steps_taken.min(cfg.history.saturating_sub(1));

        // Build the historical Caputo memory term H(x) at every voxel.
        //   H = Σ_{k=1}^{hist_terms} b_k (u_{n-k+1} − u_{n-k})
        let history_memory: Vec<f64> = (0..n)
            .into_par_iter()
            .map(|voxel| {
                let mut sum = 0.0_f64;
                for k in 1..=hist_terms {
                    let slot_new =
                        (self.steps_taken + cfg.history - (k - 1)) % cfg.history;
                    let slot_old = (self.steps_taken + cfg.history - k) % cfg.history;
                    let diff = self.history[slot_new][voxel] - self.history[slot_old][voxel];
                    sum += self.l1_weights[k] * diff;
                }
                sum
            })
            .collect();

        // Compute the spatial RHS operator applied to u_n, plus the source,
        // minus the memory term, then divide by (l1_scale * b_0) to get the
        // increment. `par_chunks_mut` provides disjoint mutable slabs.
        let b0 = self.l1_weights[0];
        let denom = self.l1_scale * b0;
        let inv_dx2 = 1.0 / (g.dx * g.dx);
        let inv_dy2 = 1.0 / (g.dy * g.dy);
        let inv_dz2 = 1.0 / (g.dz * g.dz);
        let inv_2dx = 1.0 / (2.0 * g.dx);
        let inv_2dy = 1.0 / (2.0 * g.dy);
        let inv_2dz = 1.0 / (2.0 * g.dz);

        let mut u_next = vec![0.0_f64; n];

        u_next
            .par_chunks_mut(g.nx * g.ny)
            .enumerate()
            .for_each(|(k, plane)| {
                for j in 0..g.ny {
                    for i in 0..g.nx {
                        let c = g.idx(i, j, k);
                        let uc = u_n[c];

                        // Boundary voxels: Dirichlet — hold current value.
                        if i == 0
                            || j == 0
                            || k == 0
                            || i == g.nx - 1
                            || j == g.ny - 1
                            || k == g.nz - 1
                        {
                            plane[j * g.nx + i] = uc;
                            continue;
                        }

                        let xm = u_n[g.idx(i - 1, j, k)];
                        let xp = u_n[g.idx(i + 1, j, k)];
                        let ym = u_n[g.idx(i, j - 1, k)];
                        let yp = u_n[g.idx(i, j + 1, k)];
                        let zm = u_n[g.idx(i, j, k - 1)];
                        let zp = u_n[g.idx(i, j, k + 1)];

                        // Laplacian (isotropic, standard 7-point).
                        let laplacian = (xp - 2.0 * uc + xm) * inv_dx2
                            + (yp - 2.0 * uc + ym) * inv_dy2
                            + (zp - 2.0 * uc + zm) * inv_dz2;

                        // Advection (central differences).
                        let advection = vx * (xp - xm) * inv_2dx
                            + vy * (yp - ym) * inv_2dy
                            + vz * (zp - zm) * inv_2dz;

                        // Deformation coupling via Ricci curvature.
                        let deformation = cfg.deformation_coupling * self.ricci[c] * uc;

                        let rhs = cfg.diffusion * laplacian - advection + deformation + source[c];
                        let increment = (rhs - self.l1_scale * history_memory[c]) / denom;
                        plane[j * g.nx + i] = uc + increment;
                    }
                }
            });

        // Commit to the ring buffer at the next slot.
        self.steps_taken += 1;
        let next_slot = self.steps_taken % cfg.history;
        self.history[next_slot] = u_next;

        Ok(())
    }

    /// Recompute the Ricci curvature field from the current metric. Call this
    /// after mutating the metric via [`Self::replace_metric`].
    pub fn refresh_curvature(&mut self) {
        self.ricci = self.metric.ricci_scalar_field();
    }

    /// Replace the metric tensor field (e.g. after a thermal state update).
    pub fn replace_metric(&mut self, metric: MetricTensorField) -> Result<(), RftlError> {
        if metric.grid().len() != self.grid.len() {
            return Err(RftlError::FieldLengthMismatch {
                expected: self.grid.len(),
                actual: metric.grid().len(),
            });
        }
        self.metric = metric;
        self.refresh_curvature();
        Ok(())
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Gamma function — Lanczos approximation (double precision, ~1e-15 accuracy)
// ─────────────────────────────────────────────────────────────────────────────

/// Lanczos approximation of Γ(x) valid for `x > 0`.
fn gamma(x: f64) -> f64 {
    // Coefficients from Numerical Recipes (Press et al.), g=7, n=9.
    const G: f64 = 7.0;
    const P: [f64; 9] = [
        0.999_999_999_999_809_93,
        676.520_368_121_885_1,
        -1_259.139_216_722_402_8,
        771.323_428_777_653_13,
        -176.615_029_162_140_59,
        12.507_343_278_686_905,
        -0.138_571_095_265_720_12,
        9.984_369_578_019_570_9e-6,
        1.505_632_735_149_311_6e-7,
    ];

    if x < 0.5 {
        // Reflection formula
        PI / ((PI * x).sin() * gamma(1.0 - x))
    } else {
        let x = x - 1.0;
        let mut a = P[0];
        for (i, &p) in P.iter().enumerate().skip(1) {
            a += p / (x + i as f64);
        }
        let t = x + G + 0.5;
        (2.0 * PI).sqrt() * t.powf(x + 0.5) * (-t).exp() * a
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn small_grid() -> Grid {
        Grid::new(5, 5, 5, 0.1, 0.1, 0.1).unwrap()
    }

    #[test]
    fn grid_indexing_is_bijective() {
        let g = small_grid();
        let mut seen = std::collections::HashSet::new();
        for k in 0..g.nz {
            for j in 0..g.ny {
                for i in 0..g.nx {
                    assert!(seen.insert(g.idx(i, j, k)));
                }
            }
        }
        assert_eq!(seen.len(), g.len());
    }

    #[test]
    fn flat_metric_has_zero_curvature() {
        let g = small_grid();
        let alpha = vec![1.0; g.len()];
        let sigma = vec![0.0; g.len() * TENSOR_COMPONENTS];
        let m = MetricTensorField::new(g, &alpha, &sigma).unwrap();
        let r = m.ricci_scalar_field();
        assert!(r.iter().all(|v| v.abs() < 1e-9));
    }

    #[test]
    fn solver_step_preserves_shape() {
        let g = small_grid();
        let alpha = vec![1.0; g.len()];
        let sigma = vec![0.0; g.len() * TENSOR_COMPONENTS];
        let m = MetricTensorField::new(g, &alpha, &sigma).unwrap();
        let cfg = FractionalConfig {
            alpha: 0.8,
            dt: 1e-3,
            diffusion: 1e-4,
            deformation_coupling: 0.0,
            history: 8,
        };
        let u0 = vec![1.0; g.len()];
        let mut s = FractionalSolver::new(m, cfg, u0, [0.0, 0.0, 0.0]).unwrap();
        for _ in 0..5 {
            s.step(&vec![0.0; g.len()]).unwrap();
        }
        assert_eq!(s.state().len(), g.len());
        assert_eq!(s.steps_taken(), 5);
    }

    #[test]
    fn gamma_matches_known_values() {
        assert!((gamma(1.0) - 1.0).abs() < 1e-12);
        assert!((gamma(2.0) - 1.0).abs() < 1e-12);
        assert!((gamma(5.0) - 24.0).abs() < 1e-9);
        assert!((gamma(0.5) - PI.sqrt()).abs() < 1e-12);
    }
}
