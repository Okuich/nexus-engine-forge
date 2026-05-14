/**
 * Stub topology reasoning backend — throws on every call.
 */

import type { TopologyBackend } from './backend';
import { makeTopologyCapabilities } from './backend';
import { TopologyNotImplementedError } from './types';

const ID = 'stub';
const nope = (op: string): never => {
  throw new TopologyNotImplementedError(op, ID);
};

export const stubTopologyBackend: TopologyBackend = {
  id: ID,
  version: '0.0.0-interface-only',
  capabilities: makeTopologyCapabilities({
    kinds: new Set([
      'face-adjacency', 'assembly', 'feature', 'workflow',
      'constraint', 'design-space', 'reeb', 'mapper', 'generic',
    ]),
    flavors: new Set([
      'undirected', 'directed', 'multigraph', 'hypergraph',
      'weighted', 'attributed',
    ]),
  }),
  createGraph: () => nope('createGraph'),
  invariants: () => nope('invariants'),
  centrality: () => nope('centrality'),
  community: () => nope('community'),
  path: () => nope('path'),
  flow: () => nope('flow'),
  isomorphism: () => nope('isomorphism'),
  matchMotif: () => nope('matchMotif'),
  transform: () => nope('transform'),
};
