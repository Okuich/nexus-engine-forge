/**
 * Manifold Analysis Extension Layer — public API (interface only).
 *
 * Architecture
 * ────────────
 *
 *   ┌──────────────────────────────────────────────────────────┐
 *   │                  ManifoldEngine (facade)                 │
 *   │   stable API: research tools, autonomous engineering,    │
 *   │   advanced CAD, ML-driven design exploration             │
 *   └────────────────────────────┬─────────────────────────────┘
 *                                │ dispatches via
 *                                ▼
 *   ┌──────────────────────────────────────────────────────────┐
 *   │                 manifoldRegistry                         │
 *   │   pluggable backend lookup + capability negotiation      │
 *   └────────────────────────────┬─────────────────────────────┘
 *                                │ implements
 *                                ▼
 *   ┌──────────────────────────────────────────────────────────┐
 *   │              ManifoldBackend (contract)                  │
 *   │  libigl • geometry-central • GUDHI • JAX-MD • Lie kernel │
 *   └──────────────────────────────────────────────────────────┘
 *
 * Future integration points
 * ─────────────────────────
 *   • Geometry OS feature pipeline   → consume `curvature`/`metric`
 *     to enrich the 12D feature matrix with intrinsic invariants.
 *   • Topology optimization engine   → use `invariants` to detect
 *     genus changes during SIMP iterations and reject non-manufacturable
 *     proposals.
 *   • Simulation engine (FEA / CFD)  → query `decOperator('laplace-beltrami')`
 *     for surface PDE solvers (heat, wave, electrostatics).
 *   • Symbolic geometry engine       → cross-check parametric solves
 *     against manifold predicates (immersion / submersion conditions).
 *   • Autonomous engineering agents  → use `persistentHomology` as a
 *     shape-aware reward signal for generative design loops.
 *
 * Implementation status
 * ─────────────────────
 *   - All interfaces, registry, facade, and stub backend: shipped.
 *   - No solvers / kernels: deliberately deferred until a research
 *     workflow activates.
 *   - Stub backend throws `ManifoldNotImplementedError` on every call.
 */

export { ManifoldEngine } from './engine';
export type { ManifoldDispatch, ManifoldEngineApi } from './engine';

export { manifoldRegistry } from './registry';
export type { CapabilityFlag as ManifoldCapabilityFlag } from './registry';

export { makeManifoldCapabilities } from './backend';
export type { ManifoldBackend, ManifoldCapabilities } from './backend';

export { stubManifoldBackend } from './stubBackend';

export {
  ManifoldNotImplementedError,
  ManifoldBackendError,
} from './types';

export type {
  ManifoldKind,
  ManifoldRepresentation,
  ManifoldDescriptor,
  ManifoldPoint,
  TangentVector,
  Covector,
  MetricTensor,
  CurvatureSample,
  Geodesic,
  TopologicalInvariants,
  PersistencePair,
  PersistenceDiagram,
  ManifoldMap,
  MapKind,
  DECOperator,
  ManifoldResult,
} from './types';
