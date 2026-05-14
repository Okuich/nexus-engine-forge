/**
 * Stub manifold backend — throws on every operation.
 *
 * Lets downstream code wire imports today and exercise dispatch
 * without committing to a concrete differential-geometry library.
 */

import type { ManifoldBackend } from './backend';
import { makeManifoldCapabilities } from './backend';
import { ManifoldNotImplementedError } from './types';

const ID = 'stub';
const nope = (op: string): never => {
  throw new ManifoldNotImplementedError(op, ID);
};

export const stubManifoldBackend: ManifoldBackend = {
  id: ID,
  version: '0.0.0-interface-only',
  capabilities: makeManifoldCapabilities({
    kinds: new Set([
      'curve-1d', 'surface-2d', 'volume-3d', 'config-space',
      'lie-group', 'fiber-bundle', 'simplicial-complex', 'point-cloud',
    ]),
    representations: new Set([
      'mesh', 'parametric', 'implicit', 'chart-atlas', 'sampled',
    ]),
  }),
  createManifold: () => nope('createManifold'),
  invariants: () => nope('invariants'),
  persistentHomology: () => nope('persistentHomology'),
  metric: () => nope('metric'),
  curvature: () => nope('curvature'),
  geodesic: () => nope('geodesic'),
  parallelTransport: () => nope('parallelTransport'),
  createMap: () => nope('createMap'),
  pushforward: () => nope('pushforward'),
  decOperator: () => nope('decOperator'),
};
