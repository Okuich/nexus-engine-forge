/**
 * Stub backend — throws SymbolicNotImplementedError on every operation.
 *
 * Provides a registrable placeholder so consuming code can wire imports
 * today and exercise the dispatch path. Replace by a real backend
 * (exact-rational, CGAL bridge, SymPy-WASM, etc.) when the computation
 * engine milestone lands.
 */

import type { SymbolicBackend } from './backend';
import { makeCapabilities } from './backend';
import { SymbolicNotImplementedError } from './types';

const ID = 'stub';

function nope(op: string): never {
  throw new SymbolicNotImplementedError(op, ID);
}

export const stubBackend: SymbolicBackend = {
  id: ID,
  version: '0.0.0-interface-only',
  capabilities: makeCapabilities({
    primitiveKinds: new Set([
      'point', 'line', 'plane', 'circle', 'arc',
      'conic', 'algebraic-curve', 'algebraic-surface',
      'parametric-curve', 'parametric-surface', 'implicit-surface',
      'brep-solid', 'csg-tree',
    ]),
  }),
  createSymbol: () => nope('createSymbol'),
  createPrimitive: () => nope('createPrimitive'),
  createExpression: () => nope('createExpression'),
  boolean: () => nope('boolean'),
  differential: () => nope('differential'),
  predicate: () => nope('predicate'),
  solve: () => nope('solve'),
  evaluate: () => nope('evaluate'),
  format: () => nope('format'),
};
