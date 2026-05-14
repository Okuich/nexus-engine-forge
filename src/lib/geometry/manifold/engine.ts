/**
 * Manifold Engine — stable facade over pluggable backends.
 *
 * All methods delegate to a registry-resolved backend. Without a
 * registered backend, calls throw `ManifoldNotImplementedError`.
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
import { ManifoldNotImplementedError } from './types';
import type { ManifoldBackend } from './backend';
import { manifoldRegistry } from './registry';

export interface ManifoldDispatch {
  backend?: string;
}

function resolve(opts?: ManifoldDispatch): ManifoldBackend {
  if (opts?.backend) {
    const b = manifoldRegistry.get(opts.backend);
    if (!b) throw new ManifoldNotImplementedError('resolve', opts.backend);
    return b;
  }
  const def = manifoldRegistry.getDefault();
  if (!def) throw new ManifoldNotImplementedError('resolve', 'none');
  return def;
}

export const ManifoldEngine = {
  // ── Construction ─────────────────────────────────────────────
  createManifold(
    spec: {
      kind: ManifoldKind;
      representation: ManifoldRepresentation;
      dimension: number;
      embeddingDimension?: number;
      data: unknown;
      metadata?: Record<string, unknown>;
    },
    opts?: ManifoldDispatch,
  ): ManifoldResult<ManifoldDescriptor> {
    return resolve(opts).createManifold(spec);
  },

  // ── Topology ─────────────────────────────────────────────────
  invariants(
    m: ManifoldDescriptor,
    opts?: ManifoldDispatch,
  ): ManifoldResult<TopologicalInvariants> {
    return resolve(opts).invariants(m);
  },
  persistentHomology(
    m: ManifoldDescriptor,
    options?: { maxDimension?: number; filtration?: string },
    opts?: ManifoldDispatch,
  ): ManifoldResult<PersistenceDiagram> {
    return resolve(opts).persistentHomology(m, options);
  },

  // ── Differential ─────────────────────────────────────────────
  metric(
    m: ManifoldDescriptor,
    p: ManifoldPoint,
    opts?: ManifoldDispatch,
  ): ManifoldResult<MetricTensor> {
    return resolve(opts).metric(m, p);
  },
  curvature(
    m: ManifoldDescriptor,
    p: ManifoldPoint,
    opts?: ManifoldDispatch,
  ): ManifoldResult<CurvatureSample> {
    return resolve(opts).curvature(m, p);
  },
  geodesic(
    m: ManifoldDescriptor,
    start: ManifoldPoint,
    endOrTangent: ManifoldPoint | TangentVector,
    options?: { samples?: number; tolerance?: number },
    opts?: ManifoldDispatch,
  ): ManifoldResult<Geodesic> {
    return resolve(opts).geodesic(m, start, endOrTangent, options);
  },
  parallelTransport(
    m: ManifoldDescriptor,
    v: TangentVector,
    along: Geodesic,
    opts?: ManifoldDispatch,
  ): ManifoldResult<TangentVector> {
    return resolve(opts).parallelTransport(m, v, along);
  },

  // ── Maps ─────────────────────────────────────────────────────
  createMap(
    spec: {
      kind: MapKind;
      source: ManifoldDescriptor;
      target: ManifoldDescriptor;
      data: unknown;
    },
    opts?: ManifoldDispatch,
  ): ManifoldResult<ManifoldMap> {
    return resolve(opts).createMap(spec);
  },
  pushforward(
    map: ManifoldMap,
    v: TangentVector,
    opts?: ManifoldDispatch,
  ): ManifoldResult<TangentVector> {
    return resolve(opts).pushforward(map, v);
  },

  // ── Discrete exterior calculus ───────────────────────────────
  decOperator(
    m: ManifoldDescriptor,
    op: DECOperator,
    opts?: ManifoldDispatch,
  ): ManifoldResult<{ rows: number; cols: number; handle: unknown }> {
    return resolve(opts).decOperator(m, op);
  },

  // ── Introspection ────────────────────────────────────────────
  listBackends(): readonly ManifoldBackend[] {
    return manifoldRegistry.list();
  },
  hasBackend(): boolean {
    return manifoldRegistry.getDefault() !== null;
  },
} as const;

export type ManifoldEngineApi = typeof ManifoldEngine;
