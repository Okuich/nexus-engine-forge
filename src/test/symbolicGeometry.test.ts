import { describe, it, expect, afterEach } from 'vitest';
import {
  SymbolicEngine,
  symbolicRegistry,
  stubBackend,
  SymbolicNotImplementedError,
  makeCapabilities,
  type SymbolicBackend,
} from '@/lib/geometry/symbolic';

afterEach(() => symbolicRegistry.clear());

describe('SymbolicEngine architecture', () => {
  it('throws when no backend is registered', () => {
    expect(SymbolicEngine.hasBackend()).toBe(false);
    expect(() =>
      SymbolicEngine.createSymbol({ id: 'x', name: 'x' }),
    ).toThrow(SymbolicNotImplementedError);
  });

  it('stub backend registers and is selected by default', () => {
    symbolicRegistry.register(stubBackend);
    expect(SymbolicEngine.hasBackend()).toBe(true);
    expect(SymbolicEngine.listBackends()).toHaveLength(1);
  });

  it('stub backend throws on every operation (interface-only)', () => {
    symbolicRegistry.register(stubBackend);
    expect(() => SymbolicEngine.createSymbol({ id: 'x', name: 'x' }))
      .toThrow(SymbolicNotImplementedError);
    expect(() => SymbolicEngine.solve([], []))
      .toThrow(SymbolicNotImplementedError);
  });

  it('registry routes to capability-matched backend', () => {
    const exact: SymbolicBackend = {
      ...stubBackend,
      id: 'exact',
      capabilities: makeCapabilities({ exactArithmetic: true }),
    };
    symbolicRegistry.register(stubBackend);
    symbolicRegistry.register(exact);
    expect(symbolicRegistry.findByCapability('exactArithmetic')?.id).toBe('exact');
  });

  it('explicit backend override works', () => {
    symbolicRegistry.register(stubBackend);
    expect(() =>
      SymbolicEngine.createSymbol({ id: 'x', name: 'x' }, { backend: 'stub' }),
    ).toThrow(SymbolicNotImplementedError);
    expect(() =>
      SymbolicEngine.createSymbol({ id: 'x', name: 'x' }, { backend: 'missing' }),
    ).toThrow(SymbolicNotImplementedError);
  });

  it('unregister removes backend', () => {
    symbolicRegistry.register(stubBackend);
    expect(symbolicRegistry.unregister('stub')).toBe(true);
    expect(SymbolicEngine.hasBackend()).toBe(false);
  });
});
