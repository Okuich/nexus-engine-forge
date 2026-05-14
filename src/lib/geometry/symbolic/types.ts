/**
 * Symbolic Geometry Engine — Core Type Definitions
 *
 * Interface-only architecture for algebraic / symbolic geometry.
 * No computation backend is implemented yet — this layer defines the
 * contracts that future solvers (CGAL-style exact arithmetic, BRep
 * kernels, parametric constraint solvers, semi-algebraic decomposition)
 * will plug into via the SymbolicBackend registry.
 *
 * Activation: future advanced CAD workflows, research-stage operations.
 */

// ─── Numeric / scalar layer ──────────────────────────────────────

/**
 * Scalar value that may be a literal number, an exact rational, or a
 * symbolic expression resolved by the backend.
 */
export type SymbolicScalar = number | RationalLiteral | SymbolicExpr;

export interface RationalLiteral {
  readonly kind: 'rational';
  readonly num: bigint;
  readonly den: bigint;
}

/**
 * Opaque expression node. Backends own the concrete shape; consumers
 * treat it as a tagged handle.
 */
export interface SymbolicExpr {
  readonly kind: 'expr';
  readonly backendId: string;
  readonly handle: unknown;
  /** Optional human-readable form for diagnostics. */
  readonly debug?: string;
}

// ─── Parameter symbols ───────────────────────────────────────────

/** Named symbolic variable (e.g. design parameter, free variable). */
export interface Symbol {
  readonly id: string;
  readonly name: string;
  readonly domain?: 'real' | 'integer' | 'rational' | 'complex' | 'boolean';
  readonly bounds?: { min?: number; max?: number };
  readonly defaultValue?: number;
}

/** Concrete value binding for a symbol (used at evaluation time). */
export interface SymbolBinding {
  readonly symbolId: string;
  readonly value: SymbolicScalar;
}

// ─── Symbolic geometric primitives ───────────────────────────────

/** Discriminator for primitive kinds the engine can describe symbolically. */
export type SymbolicPrimitiveKind =
  | 'point'
  | 'line'
  | 'plane'
  | 'circle'
  | 'arc'
  | 'conic'
  | 'algebraic-curve'
  | 'algebraic-surface'
  | 'parametric-curve'
  | 'parametric-surface'
  | 'implicit-surface'
  | 'brep-solid'
  | 'csg-tree';

export interface SymbolicPrimitive<K extends SymbolicPrimitiveKind = SymbolicPrimitiveKind> {
  readonly id: string;
  readonly kind: K;
  /** Free symbols this primitive depends on. */
  readonly symbols: readonly string[];
  /** Backend-owned algebraic representation. */
  readonly representation: SymbolicExpr;
  /** Optional metadata for tooling / diagnostics. */
  readonly metadata?: Record<string, unknown>;
}

// Concrete-shape aliases (compile-time discrimination only — no runtime impl).
export type SymbolicPoint = SymbolicPrimitive<'point'>;
export type SymbolicLine = SymbolicPrimitive<'line'>;
export type SymbolicPlane = SymbolicPrimitive<'plane'>;
export type SymbolicCircle = SymbolicPrimitive<'circle'>;
export type SymbolicConic = SymbolicPrimitive<'conic'>;
export type SymbolicAlgebraicCurve = SymbolicPrimitive<'algebraic-curve'>;
export type SymbolicAlgebraicSurface = SymbolicPrimitive<'algebraic-surface'>;
export type SymbolicParametricCurve = SymbolicPrimitive<'parametric-curve'>;
export type SymbolicParametricSurface = SymbolicPrimitive<'parametric-surface'>;
export type SymbolicImplicitSurface = SymbolicPrimitive<'implicit-surface'>;
export type SymbolicBRepSolid = SymbolicPrimitive<'brep-solid'>;
export type SymbolicCSGTree = SymbolicPrimitive<'csg-tree'>;

// ─── Constraints (parametric / declarative) ──────────────────────

export type ConstraintKind =
  | 'distance'
  | 'angle'
  | 'parallel'
  | 'perpendicular'
  | 'tangent'
  | 'coincident'
  | 'concentric'
  | 'symmetric'
  | 'fixed'
  | 'equation'   // arbitrary algebraic equation in symbols
  | 'inequality';

export interface SymbolicConstraint {
  readonly id: string;
  readonly kind: ConstraintKind;
  /** Primitive IDs this constraint relates. */
  readonly operands: readonly string[];
  /** Optional scalar parameter (e.g. distance value, angle in radians). */
  readonly value?: SymbolicScalar;
  /** Optional raw expression for 'equation' / 'inequality' kinds. */
  readonly expression?: SymbolicExpr;
}

// ─── Algebraic operations ────────────────────────────────────────

/** Boolean / set operations on symbolic solids. */
export type BooleanOp = 'union' | 'intersection' | 'difference' | 'xor';

/** Differential operations on curves / surfaces. */
export type DifferentialOp =
  | 'tangent-vector'
  | 'normal-vector'
  | 'curvature'
  | 'gradient'
  | 'divergence'
  | 'laplacian'
  | 'jacobian'
  | 'hessian';

/** Topological / set-level predicates. */
export type GeometricPredicate =
  | 'on'           // point on curve / surface
  | 'inside'       // point inside solid
  | 'intersects'
  | 'tangent'
  | 'parallel'
  | 'congruent'
  | 'similar';

// ─── Engine results ──────────────────────────────────────────────

/** Result wrapper carrying provenance + cost metadata. */
export interface SymbolicResult<T> {
  readonly value: T;
  /** Backend that produced this result. */
  readonly backendId: string;
  /** True if produced via exact arithmetic (no FP rounding). */
  readonly exact: boolean;
  /** Optional cost trace for budgeting future calls. */
  readonly cost?: {
    elapsedMs?: number;
    nodesExpanded?: number;
    polynomialDegree?: number;
  };
  /** Backend warnings / diagnostics. */
  readonly diagnostics?: readonly string[];
}

/** Solve outcome for parametric constraint systems. */
export interface SolveOutcome {
  readonly status: 'solved' | 'underdetermined' | 'overdetermined' | 'inconsistent' | 'failed';
  readonly bindings: readonly SymbolBinding[];
  /** Residual norm, if applicable. */
  readonly residual?: number;
  readonly message?: string;
}

// ─── Errors ──────────────────────────────────────────────────────

export class SymbolicNotImplementedError extends Error {
  constructor(operation: string, backendId = 'none') {
    super(
      `Symbolic operation '${operation}' is not yet implemented ` +
      `(backend: ${backendId}). This is an interface-only stub.`,
    );
    this.name = 'SymbolicNotImplementedError';
  }
}

export class SymbolicBackendError extends Error {
  constructor(message: string, public readonly backendId: string) {
    super(`[${backendId}] ${message}`);
    this.name = 'SymbolicBackendError';
  }
}
