/**
 * Manifold Backend Contract
 *
 * Every concrete differential/topological backend implements this
 * contract and registers with `manifoldRegistry`. The facade
 * (`ManifoldEngine`) dispatches by capability.
 *
 * Future backend candidates:
 *   - 'libigl-bridge'     : discrete differential geometry on meshes
 *   - 'geometry-central'  : intrinsic triangulations, geodesics
 *   - 'gudhi-tda'         : persistent homology / TDA
 *   - 'jax-md-research'   : autodiff manifolds for engineering ML
 *   - 'lie-group-kernel'  : SO(3) / SE(3) for autonomous robotics
 *
 * No backend is implemented in this commit.
 */

import type {
  CurvatureSample,
  DECOperator,
  Geodesic,
  ManifoldDescriptor,
  ManifoldKind,
  ManifoldMap,
  ManifoldPoint,
  ManifoldRepresentation,
  ManifoldResult,
  MapKind,
  MetricTensor,
  PersistenceDiagram,
  TangentVector,
  TopologicalInvariants,
} from './types';

export interface ManifoldCapabilities {
  readonly supportsCurvature: boolean;
  readonly supportsGeodesics: boolean;
  readonly supportsTopologicalInvariants: boolean;
  readonly supportsPersistentHomology: boolean;
  readonly supportsDEC: boolean;
  readonly supportsLieGroups: boolean;
  readonly supportsFiberBundles: boolean;
  /** Manifold kinds this backend can ingest. */
  readonly kinds: ReadonlySet<ManifoldKind>;
  /** Representations this backend understands. */
  readonly representations: ReadonlySet<ManifoldRepresentation>;
}

export interface ManifoldBackend {
  readonly id: string;
  readonly version: string;
  readonly capabilities: ManifoldCapabilities;

  // ── Construction ─────────────────────────────────────────────
  createManifold(spec: {
    kind: ManifoldKind;
    representation: ManifoldRepresentation;
    dimension: number;
    embeddingDimension?: number;
    data: unknown;
    metadata?: Record<string, unknown>;
  }): ManifoldResult<ManifoldDescriptor>;

  // ── Topology ─────────────────────────────────────────────────
  invariants(m: ManifoldDescriptor): ManifoldResult<TopologicalInvariants>;
  persistentHomology(
    m: ManifoldDescriptor,
    options?: { maxDimension?: number; filtration?: string },
  ): ManifoldResult<PersistenceDiagram>;

  // ── Differential geometry ────────────────────────────────────
  metric(m: ManifoldDescriptor, p: ManifoldPoint): ManifoldResult<MetricTensor>;
  curvature(m: ManifoldDescriptor, p: ManifoldPoint): ManifoldResult<CurvatureSample>;
  geodesic(
    m: ManifoldDescriptor,
    start: ManifoldPoint,
    endOrTangent: ManifoldPoint | TangentVector,
    options?: { samples?: number; tolerance?: number },
  ): ManifoldResult<Geodesic>;
  parallelTransport(
    m: ManifoldDescriptor,
    v: TangentVector,
    along: Geodesic,
  ): ManifoldResult<TangentVector>;

  // ── Maps between manifolds ───────────────────────────────────
  createMap(spec: {
    kind: MapKind;
    source: ManifoldDescriptor;
    target: ManifoldDescriptor;
    data: unknown;
  }): ManifoldResult<ManifoldMap>;
  pushforward(map: ManifoldMap, v: TangentVector): ManifoldResult<TangentVector>;

  // ── Discrete exterior calculus ───────────────────────────────
  decOperator(
    m: ManifoldDescriptor,
    op: DECOperator,
  ): ManifoldResult<{ rows: number; cols: number; handle: unknown }>;

  // ── Lifecycle ────────────────────────────────────────────────
  dispose?(): void;
}

export function makeManifoldCapabilities(
  partial: Partial<ManifoldCapabilities> = {},
): ManifoldCapabilities {
  return {
    supportsCurvature: false,
    supportsGeodesics: false,
    supportsTopologicalInvariants: false,
    supportsPersistentHomology: false,
    supportsDEC: false,
    supportsLieGroups: false,
    supportsFiberBundles: false,
    kinds: new Set(),
    representations: new Set(),
    ...partial,
  };
}
