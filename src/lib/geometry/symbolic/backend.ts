/**
 * Symbolic Geometry Engine — Backend Contract
 *
 * Defines the interface every concrete computation backend must satisfy.
 * Examples of future backends:
 *   - 'exact-rational'   : pure-bigint exact arithmetic for 2D sketches
 *   - 'cgal-bridge'      : exact-construction kernel for 3D BRep
 *   - 'sympy-wasm'       : symbolic algebra for differential operators
 *   - 'parasolid-proxy'  : industrial BRep kernel via remote service
 *   - 'maple-research'   : Gröbner-basis solver for algebraic geometry
 *
 * No backend is implemented in this commit. Stub backends throw
 * `SymbolicNotImplementedError` from every method.
 */

import type {
  BooleanOp,
  DifferentialOp,
  GeometricPredicate,
  SolveOutcome,
  Symbol,
  SymbolBinding,
  SymbolicConstraint,
  SymbolicExpr,
  SymbolicPrimitive,
  SymbolicPrimitiveKind,
  SymbolicResult,
  SymbolicScalar,
} from './types';

/**
 * Capability matrix advertised by a backend so dispatchers can route
 * operations to the most-capable available implementation.
 */
export interface SymbolicCapabilities {
  readonly exactArithmetic: boolean;
  readonly supportsBRep: boolean;
  readonly supportsCSG: boolean;
  readonly supportsImplicitSurfaces: boolean;
  readonly supportsParametricSolving: boolean;
  readonly supportsDifferential: boolean;
  readonly supportsGroebnerBasis: boolean;
  /** Supported primitive kinds (subset of SymbolicPrimitiveKind). */
  readonly primitiveKinds: ReadonlySet<SymbolicPrimitiveKind>;
}

export interface SymbolicBackend {
  readonly id: string;
  readonly version: string;
  readonly capabilities: SymbolicCapabilities;

  // ── Construction ─────────────────────────────────────────────
  createSymbol(symbol: Symbol): SymbolicResult<Symbol>;
  createPrimitive<K extends SymbolicPrimitiveKind>(
    kind: K,
    spec: Record<string, unknown>,
  ): SymbolicResult<SymbolicPrimitive<K>>;
  createExpression(source: string | unknown): SymbolicResult<SymbolicExpr>;

  // ── Algebraic operations ─────────────────────────────────────
  boolean(
    op: BooleanOp,
    lhs: SymbolicPrimitive,
    rhs: SymbolicPrimitive,
  ): SymbolicResult<SymbolicPrimitive>;

  differential(
    op: DifferentialOp,
    target: SymbolicPrimitive,
    parameters?: Record<string, SymbolicScalar>,
  ): SymbolicResult<SymbolicExpr>;

  // ── Predicates ───────────────────────────────────────────────
  predicate(
    pred: GeometricPredicate,
    operands: readonly SymbolicPrimitive[],
  ): SymbolicResult<boolean>;

  // ── Constraint solving ───────────────────────────────────────
  solve(
    symbols: readonly Symbol[],
    constraints: readonly SymbolicConstraint[],
    initialGuess?: readonly SymbolBinding[],
  ): SymbolicResult<SolveOutcome>;

  // ── Evaluation ───────────────────────────────────────────────
  evaluate(
    expr: SymbolicExpr,
    bindings: readonly SymbolBinding[],
  ): SymbolicResult<number>;

  /** Optional: return a human-readable form (LaTeX / s-expr / etc.). */
  format?(expr: SymbolicExpr, mode: 'latex' | 'sexpr' | 'text'): string;

  /** Optional cleanup hook for backends that hold native handles. */
  dispose?(): void;
}

/**
 * Helper for backends to declare full capabilities (defaults to false).
 */
export function makeCapabilities(
  partial: Partial<SymbolicCapabilities> = {},
): SymbolicCapabilities {
  return {
    exactArithmetic: false,
    supportsBRep: false,
    supportsCSG: false,
    supportsImplicitSurfaces: false,
    supportsParametricSolving: false,
    supportsDifferential: false,
    supportsGroebnerBasis: false,
    primitiveKinds: new Set(),
    ...partial,
  };
}
