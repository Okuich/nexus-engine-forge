/**
 * Symbolic Geometry Engine — public API surface (interface only).
 *
 * Architecture:
 *
 *   ┌────────────────────────────────────────────────────────┐
 *   │                  SymbolicEngine (facade)               │
 *   │   stable API used by CAD, optimizer, research tools    │
 *   └─────────────────────────┬──────────────────────────────┘
 *                             │ dispatches via
 *                             ▼
 *   ┌────────────────────────────────────────────────────────┐
 *   │                 symbolicRegistry                       │
 *   │   pluggable backend lookup + capability negotiation    │
 *   └─────────────────────────┬──────────────────────────────┘
 *                             │ implements
 *                             ▼
 *   ┌────────────────────────────────────────────────────────┐
 *   │                 SymbolicBackend (contract)             │
 *   │  exact-rational • CGAL • SymPy-WASM • Parasolid • …    │
 *   └────────────────────────────────────────────────────────┘
 *
 * Computation backends are NOT implemented in this commit. Only the
 * stub backend ships, throwing SymbolicNotImplementedError on use.
 */

export { SymbolicEngine } from './engine';
export type { DispatchOptions, SymbolicEngineApi } from './engine';

export { symbolicRegistry } from './registry';
export type { CapabilityFlag } from './registry';

export { makeCapabilities } from './backend';
export type { SymbolicBackend, SymbolicCapabilities } from './backend';

export { stubBackend } from './stubBackend';

export {
  SymbolicNotImplementedError,
  SymbolicBackendError,
} from './types';

export type {
  SymbolicScalar,
  RationalLiteral,
  SymbolicExpr,
  Symbol as SymbolicSymbol,
  SymbolBinding,
  SymbolicPrimitiveKind,
  SymbolicPrimitive,
  SymbolicPoint,
  SymbolicLine,
  SymbolicPlane,
  SymbolicCircle,
  SymbolicConic,
  SymbolicAlgebraicCurve,
  SymbolicAlgebraicSurface,
  SymbolicParametricCurve,
  SymbolicParametricSurface,
  SymbolicImplicitSurface,
  SymbolicBRepSolid,
  SymbolicCSGTree,
  ConstraintKind,
  SymbolicConstraint,
  BooleanOp,
  DifferentialOp,
  GeometricPredicate,
  SymbolicResult,
  SolveOutcome,
} from './types';
