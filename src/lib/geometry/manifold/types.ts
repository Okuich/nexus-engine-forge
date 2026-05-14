/**
 * Manifold Analysis Extension Layer — Type Definitions
 *
 * Interface-only architecture for differential / topological analysis
 * of geometric manifolds (curves, surfaces, n-dim configuration spaces).
 *
 * No solvers are implemented in this commit. Future backends may bind
 * to libigl, geometry-central, JAX-MD, GUDHI (TDA), or research kernels
 * for autonomous engineering systems.
 *
 * Activation: advanced geometry research, future autonomous engineering.
 */

import type { Vec3 } from '../types';

// ─── Manifold descriptor ─────────────────────────────────────────

export type ManifoldKind =
  | 'curve-1d'           // 1-manifold embedded in R^n
  | 'surface-2d'         // 2-manifold (mesh, parametric, implicit)
  | 'volume-3d'          // 3-manifold (solid)
  | 'config-space'       // abstract configuration / parameter manifold
  | 'lie-group'          // SO(3), SE(3), etc.
  | 'fiber-bundle'       // base + fiber composite
  | 'simplicial-complex' // arbitrary-dim chain complex
  | 'point-cloud';       // empirical / sampled

export type ManifoldRepresentation =
  | 'mesh'               // triangle / tet mesh
  | 'parametric'         // f: R^k → R^n
  | 'implicit'           // {x : F(x) = 0}
  | 'chart-atlas'        // collection of overlapping local charts
  | 'sampled';           // discrete point cloud + connectivity

export interface ManifoldDescriptor {
  readonly id: string;
  readonly kind: ManifoldKind;
  /** Intrinsic dimension (e.g. 2 for a surface). */
  readonly dimension: number;
  /** Embedding dimension if any (e.g. 3 for a surface in R^3). */
  readonly embeddingDimension?: number;
  readonly representation: ManifoldRepresentation;
  /** Backend-owned handle to the actual manifold data. */
  readonly handle: unknown;
  readonly metadata?: Record<string, unknown>;
}

// ─── Topological invariants ──────────────────────────────────────

export interface TopologicalInvariants {
  /** Euler characteristic χ. */
  readonly eulerCharacteristic?: number;
  /** Genus (orientable surfaces). */
  readonly genus?: number;
  /** Number of connected components. */
  readonly connectedComponents?: number;
  /** Number of boundary components. */
  readonly boundaryComponents?: number;
  /** Betti numbers b_0, b_1, b_2, … */
  readonly bettiNumbers?: readonly number[];
  /** True if orientable. */
  readonly orientable?: boolean;
  /** True if closed (compact, no boundary). */
  readonly closed?: boolean;
}

// ─── Differential structure ──────────────────────────────────────

/** Tangent vector in the local chart of a point. */
export interface TangentVector {
  readonly basePoint: ManifoldPoint;
  readonly components: readonly number[];
}

/** Cotangent / 1-form sample. */
export interface Covector {
  readonly basePoint: ManifoldPoint;
  readonly components: readonly number[];
}

/** Point on the manifold — opaque, backend-owned coordinates. */
export interface ManifoldPoint {
  readonly manifoldId: string;
  readonly coordinates: readonly number[];
  /** Optional embedding-space coordinates for visualization. */
  readonly embedded?: Vec3 | readonly number[];
  /** Chart id when atlas-based. */
  readonly chartId?: string;
}

/** Riemannian / pseudo-Riemannian metric tensor sample. */
export interface MetricTensor {
  readonly basePoint: ManifoldPoint;
  /** Row-major symmetric (d × d) matrix. */
  readonly components: readonly number[];
  readonly signature?: 'riemannian' | 'lorentzian' | 'degenerate';
}

/** Geodesic path between two points (or initial-value problem). */
export interface Geodesic {
  readonly start: ManifoldPoint;
  readonly end?: ManifoldPoint;
  /** Sampled points along the path. */
  readonly samples: readonly ManifoldPoint[];
  readonly length?: number;
}

// ─── Curvature ───────────────────────────────────────────────────

export interface CurvatureSample {
  readonly basePoint: ManifoldPoint;
  readonly gaussian?: number;
  readonly mean?: number;
  readonly principalMin?: number;
  readonly principalMax?: number;
  /** Riemann tensor components, packed by backend. */
  readonly riemann?: readonly number[];
  /** Ricci tensor (symmetric). */
  readonly ricci?: readonly number[];
  readonly scalar?: number;
}

// ─── Maps between manifolds ──────────────────────────────────────

export type MapKind =
  | 'embedding'
  | 'immersion'
  | 'submersion'
  | 'diffeomorphism'
  | 'homeomorphism'
  | 'covering'
  | 'projection';

export interface ManifoldMap {
  readonly id: string;
  readonly kind: MapKind;
  readonly source: string; // manifold id
  readonly target: string; // manifold id
  /** Backend-owned representation. */
  readonly handle: unknown;
}

// ─── Persistent homology / TDA ───────────────────────────────────

export interface PersistencePair {
  readonly dimension: number;
  readonly birth: number;
  readonly death: number;
}

export interface PersistenceDiagram {
  readonly maxDimension: number;
  readonly pairs: readonly PersistencePair[];
  readonly filtration?: 'vietoris-rips' | 'cech' | 'alpha' | 'sublevel' | 'lower-star';
}

// ─── Discrete exterior calculus operators ────────────────────────

export type DECOperator =
  | 'd0' | 'd1' | 'd2'    // exterior derivatives
  | 'star0' | 'star1' | 'star2' // Hodge stars
  | 'laplace-beltrami';

// ─── Result wrapper ──────────────────────────────────────────────

export interface ManifoldResult<T> {
  readonly value: T;
  readonly backendId: string;
  readonly approximation?: 'exact' | 'discrete' | 'fitted' | 'sampled';
  readonly diagnostics?: readonly string[];
  readonly cost?: { elapsedMs?: number; memoryBytes?: number };
}

// ─── Errors ──────────────────────────────────────────────────────

export class ManifoldNotImplementedError extends Error {
  constructor(operation: string, backendId = 'none') {
    super(
      `Manifold operation '${operation}' is not yet implemented ` +
      `(backend: ${backendId}). Interface-only stub.`,
    );
    this.name = 'ManifoldNotImplementedError';
  }
}

export class ManifoldBackendError extends Error {
  constructor(message: string, public readonly backendId: string) {
    super(`[${backendId}] ${message}`);
    this.name = 'ManifoldBackendError';
  }
}
