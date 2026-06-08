/**
 * Field Core Intelligence (Field OS) — shared wire types.
 *
 * Mirrors the operator contracts declared in Field OS's
 * `src/lib/field/registry.ts` (op.eikonal.fsm, op.poisson.jacobi,
 * op.lap.uniform, op.solve.cg). 2D fields are serialized as flat
 * row-major number arrays with explicit width/height.
 */

export type FieldOsHealth = {
  ok: boolean;
  version: string;
  operators: string[];
};

export type Grid2DPayload = {
  w: number;
  h: number;
  data: number[]; // row-major, length = w*h
};

// ── Eikonal (op.eikonal.fsm) ────────────────────────────────────
export type EikonalRequest = {
  w: number;
  h: number;
  /** Speed field F > 0; obstacles → small value (e.g. 1e-3). */
  speed: number[]; // length w*h
  /** Source seeds in grid coords. Arrival time T(source) = 0. */
  sources: Array<[number, number]>;
  sweeps?: number;
};

export type EikonalResponse = {
  operator: 'op.eikonal.fsm';
  field: Grid2DPayload; // arrival times T
  stats: { min: number; max: number; sources: number; sweeps: number };
};

// ── Poisson (op.poisson.jacobi) ─────────────────────────────────
export type PoissonRequest = {
  w: number;
  h: number;
  /** Initial guess for u (length w*h, defaults to zeros if omitted). */
  u0?: number[];
  /** Source / RHS field f in Δu = f. */
  f: number[];
  iterations?: number;
  h2?: number;
};

export type PoissonResponse = {
  operator: 'op.poisson.jacobi';
  field: Grid2DPayload; // potential u
  stats: { iterations: number; residual: number };
};

// ── Laplacian (op.lap.uniform) ──────────────────────────────────
export type LaplacianRequest = {
  w: number;
  h: number;
  src: number[];
};
export type LaplacianResponse = {
  operator: 'op.lap.uniform';
  field: Grid2DPayload;
};

// ── Errors ──────────────────────────────────────────────────────
export class FieldOsError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = 'FieldOsError';
    this.status = status;
  }
}
