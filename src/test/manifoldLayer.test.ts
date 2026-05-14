import { describe, it, expect, afterEach } from 'vitest';
import {
  ManifoldEngine,
  manifoldRegistry,
  stubManifoldBackend,
  ManifoldNotImplementedError,
  makeManifoldCapabilities,
  type ManifoldBackend,
} from '@/lib/geometry/manifold';

afterEach(() => manifoldRegistry.clear());

describe('Manifold extension layer (interface-only)', () => {
  it('throws when no backend is registered', () => {
    expect(ManifoldEngine.hasBackend()).toBe(false);
    expect(() =>
      ManifoldEngine.createManifold({
        kind: 'surface-2d',
        representation: 'mesh',
        dimension: 2,
        data: null,
      }),
    ).toThrow(ManifoldNotImplementedError);
  });

  it('stub backend registers and is selected by default', () => {
    manifoldRegistry.register(stubManifoldBackend);
    expect(ManifoldEngine.hasBackend()).toBe(true);
    expect(ManifoldEngine.listBackends()).toHaveLength(1);
  });

  it('stub backend throws on every operation', () => {
    manifoldRegistry.register(stubManifoldBackend);
    expect(() =>
      ManifoldEngine.invariants({
        id: 'm', kind: 'surface-2d', dimension: 2, representation: 'mesh', handle: null,
      }),
    ).toThrow(ManifoldNotImplementedError);
    expect(() =>
      ManifoldEngine.persistentHomology({
        id: 'm', kind: 'point-cloud', dimension: 3, representation: 'sampled', handle: null,
      }),
    ).toThrow(ManifoldNotImplementedError);
  });

  it('routes to capability-matched backend', () => {
    const tda: ManifoldBackend = {
      ...stubManifoldBackend,
      id: 'tda',
      capabilities: makeManifoldCapabilities({ supportsPersistentHomology: true }),
    };
    manifoldRegistry.register(stubManifoldBackend);
    manifoldRegistry.register(tda);
    expect(
      manifoldRegistry.findByCapability('supportsPersistentHomology')?.id,
    ).toBe('tda');
  });

  it('explicit backend override and unregister work', () => {
    manifoldRegistry.register(stubManifoldBackend);
    expect(() =>
      ManifoldEngine.metric(
        { id: 'm', kind: 'surface-2d', dimension: 2, representation: 'mesh', handle: null },
        { manifoldId: 'm', coordinates: [0, 0] },
        { backend: 'stub' },
      ),
    ).toThrow(ManifoldNotImplementedError);
    expect(manifoldRegistry.unregister('stub')).toBe(true);
    expect(ManifoldEngine.hasBackend()).toBe(false);
  });
});
