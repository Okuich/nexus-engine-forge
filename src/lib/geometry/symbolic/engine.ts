/**
 * Symbolic Geometry Engine — Public Facade
 *
 * Stable high-level API that downstream features (parametric CAD,
 * research workflows, optimization with algebraic constraints) call
 * regardless of which backend is active.
 *
 * Every method delegates to the registry-resolved backend. If no
 * backend is registered, calls throw `SymbolicNotImplementedError` —
 * this is intentional for the interface-only milestone.
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
import { SymbolicNotImplementedError } from './types';
import type { SymbolicBackend } from './backend';
import { symbolicRegistry } from './registry';

export interface DispatchOptions {
  /** Force a specific backend by id. */
  backend?: string;
}

function resolveBackend(opts?: DispatchOptions): SymbolicBackend {
  if (opts?.backend) {
    const b = symbolicRegistry.get(opts.backend);
    if (!b) throw new SymbolicNotImplementedError('resolveBackend', opts.backend);
    return b;
  }
  const def = symbolicRegistry.getDefault();
  if (!def) throw new SymbolicNotImplementedError('resolveBackend', 'none');
  return def;
}

export const SymbolicEngine = {
  // ── Construction ─────────────────────────────────────────────
  createSymbol(s: Symbol, opts?: DispatchOptions): SymbolicResult<Symbol> {
    return resolveBackend(opts).createSymbol(s);
  },
  createPrimitive<K extends SymbolicPrimitiveKind>(
    kind: K,
    spec: Record<string, unknown>,
    opts?: DispatchOptions,
  ): SymbolicResult<SymbolicPrimitive<K>> {
    return resolveBackend(opts).createPrimitive(kind, spec);
  },
  createExpression(
    source: string | unknown,
    opts?: DispatchOptions,
  ): SymbolicResult<SymbolicExpr> {
    return resolveBackend(opts).createExpression(source);
  },

  // ── Algebraic ────────────────────────────────────────────────
  boolean(
    op: BooleanOp,
    lhs: SymbolicPrimitive,
    rhs: SymbolicPrimitive,
    opts?: DispatchOptions,
  ): SymbolicResult<SymbolicPrimitive> {
    return resolveBackend(opts).boolean(op, lhs, rhs);
  },
  differential(
    op: DifferentialOp,
    target: SymbolicPrimitive,
    parameters?: Record<string, SymbolicScalar>,
    opts?: DispatchOptions,
  ): SymbolicResult<SymbolicExpr> {
    return resolveBackend(opts).differential(op, target, parameters);
  },

  // ── Predicates ───────────────────────────────────────────────
  predicate(
    pred: GeometricPredicate,
    operands: readonly SymbolicPrimitive[],
    opts?: DispatchOptions,
  ): SymbolicResult<boolean> {
    return resolveBackend(opts).predicate(pred, operands);
  },

  // ── Constraint solving ───────────────────────────────────────
  solve(
    symbols: readonly Symbol[],
    constraints: readonly SymbolicConstraint[],
    initialGuess?: readonly SymbolBinding[],
    opts?: DispatchOptions,
  ): SymbolicResult<SolveOutcome> {
    return resolveBackend(opts).solve(symbols, constraints, initialGuess);
  },

  // ── Evaluation ───────────────────────────────────────────────
  evaluate(
    expr: SymbolicExpr,
    bindings: readonly SymbolBinding[],
    opts?: DispatchOptions,
  ): SymbolicResult<number> {
    return resolveBackend(opts).evaluate(expr, bindings);
  },

  // ── Introspection ────────────────────────────────────────────
  listBackends(): readonly SymbolicBackend[] {
    return symbolicRegistry.list();
  },
  hasBackend(): boolean {
    return symbolicRegistry.getDefault() !== null;
  },
} as const;

export type SymbolicEngineApi = typeof SymbolicEngine;
