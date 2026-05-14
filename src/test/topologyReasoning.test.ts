import { describe, it, expect, afterEach } from 'vitest';
import {
  TopologyReasoningEngine,
  topologyRegistry,
  stubTopologyBackend,
  TopologyNotImplementedError,
  makeTopologyCapabilities,
  type TopologyBackend,
} from '@/lib/geometry/topologyReasoning';

afterEach(() => topologyRegistry.clear());

describe('Topology reasoning extension layer', () => {
  it('throws when no backend is registered', () => {
    expect(TopologyReasoningEngine.hasBackend()).toBe(false);
    expect(() =>
      TopologyReasoningEngine.createGraph({
        kind: 'generic', flavor: ['undirected'], nodes: [], edges: [],
      }),
    ).toThrow(TopologyNotImplementedError);
  });

  it('stub backend registers as default', () => {
    topologyRegistry.register(stubTopologyBackend);
    expect(TopologyReasoningEngine.hasBackend()).toBe(true);
    expect(TopologyReasoningEngine.listBackends()).toHaveLength(1);
  });

  it('stub backend throws on every operation', () => {
    topologyRegistry.register(stubTopologyBackend);
    const fakeGraph = {
      id: 'g', kind: 'generic' as const, flavor: ['undirected' as const],
      nodeCount: 0, edgeCount: 0, handle: null,
    };
    expect(() =>
      TopologyReasoningEngine.invariants(fakeGraph),
    ).toThrow(TopologyNotImplementedError);
    expect(() =>
      TopologyReasoningEngine.centrality(fakeGraph, 'pagerank'),
    ).toThrow(TopologyNotImplementedError);
  });

  it('routes by capability', () => {
    const tda: TopologyBackend = {
      ...stubTopologyBackend,
      id: 'tda',
      capabilities: makeTopologyCapabilities({ supportsMotifMining: true }),
    };
    topologyRegistry.register(stubTopologyBackend);
    topologyRegistry.register(tda);
    expect(
      topologyRegistry.findByCapability('supportsMotifMining')?.id,
    ).toBe('tda');
  });

  it('findForWorkload picks smallest-cap backend that fits', () => {
    const small: TopologyBackend = {
      ...stubTopologyBackend,
      id: 'small',
      capabilities: makeTopologyCapabilities({
        supportsCentrality: true, maxNodes: 1_000,
      }),
    };
    const big: TopologyBackend = {
      ...stubTopologyBackend,
      id: 'big',
      capabilities: makeTopologyCapabilities({
        supportsCentrality: true, maxNodes: 1_000_000,
      }),
    };
    topologyRegistry.register(big);
    topologyRegistry.register(small);
    expect(
      topologyRegistry.findForWorkload('supportsCentrality', 500)?.id,
    ).toBe('small');
    expect(
      topologyRegistry.findForWorkload('supportsCentrality', 50_000)?.id,
    ).toBe('big');
  });

  it('explicit backend override works; unregister removes', () => {
    topologyRegistry.register(stubTopologyBackend);
    expect(() =>
      TopologyReasoningEngine.community(
        { id: 'g', kind: 'generic', flavor: ['undirected'], nodeCount: 0, edgeCount: 0, handle: null },
        'louvain',
        undefined,
        { backend: 'stub' },
      ),
    ).toThrow(TopologyNotImplementedError);
    expect(topologyRegistry.unregister('stub')).toBe(true);
    expect(TopologyReasoningEngine.hasBackend()).toBe(false);
  });
});
