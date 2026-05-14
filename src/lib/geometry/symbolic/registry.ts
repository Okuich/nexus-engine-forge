/**
 * Symbolic Backend Registry
 *
 * Process-wide registry that future backends self-register into.
 * The dispatcher (engine.ts) consults this registry to pick the
 * most-capable backend for each operation, with explicit override.
 *
 * No backends are registered in this commit.
 */

import type { SymbolicBackend, SymbolicCapabilities } from './backend';

type CapabilityFlag = keyof Omit<SymbolicCapabilities, 'primitiveKinds'>;

class Registry {
  private backends = new Map<string, SymbolicBackend>();
  private defaultId: string | null = null;

  register(backend: SymbolicBackend): void {
    this.backends.set(backend.id, backend);
    if (this.defaultId === null) this.defaultId = backend.id;
  }

  unregister(id: string): boolean {
    const b = this.backends.get(id);
    if (b?.dispose) b.dispose();
    const removed = this.backends.delete(id);
    if (this.defaultId === id) {
      this.defaultId = this.backends.keys().next().value ?? null;
    }
    return removed;
  }

  get(id: string): SymbolicBackend | undefined {
    return this.backends.get(id);
  }

  list(): readonly SymbolicBackend[] {
    return Array.from(this.backends.values());
  }

  setDefault(id: string): void {
    if (!this.backends.has(id)) {
      throw new Error(`Cannot set default: backend '${id}' not registered.`);
    }
    this.defaultId = id;
  }

  getDefault(): SymbolicBackend | null {
    return this.defaultId ? this.backends.get(this.defaultId) ?? null : null;
  }

  /** Find the first registered backend supporting the given capability. */
  findByCapability(flag: CapabilityFlag): SymbolicBackend | null {
    for (const b of this.backends.values()) {
      if (b.capabilities[flag]) return b;
    }
    return null;
  }

  clear(): void {
    for (const b of this.backends.values()) b.dispose?.();
    this.backends.clear();
    this.defaultId = null;
  }
}

export const symbolicRegistry = new Registry();

export type { CapabilityFlag };
