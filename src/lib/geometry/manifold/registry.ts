/**
 * Manifold Backend Registry — process-wide pluggable lookup.
 */

import type { ManifoldBackend, ManifoldCapabilities } from './backend';

type CapabilityFlag = keyof Omit<ManifoldCapabilities, 'kinds' | 'representations'>;

class Registry {
  private backends = new Map<string, ManifoldBackend>();
  private defaultId: string | null = null;

  register(b: ManifoldBackend): void {
    this.backends.set(b.id, b);
    if (this.defaultId === null) this.defaultId = b.id;
  }

  unregister(id: string): boolean {
    const b = this.backends.get(id);
    b?.dispose?.();
    const ok = this.backends.delete(id);
    if (this.defaultId === id) {
      this.defaultId = this.backends.keys().next().value ?? null;
    }
    return ok;
  }

  get(id: string): ManifoldBackend | undefined {
    return this.backends.get(id);
  }

  list(): readonly ManifoldBackend[] {
    return Array.from(this.backends.values());
  }

  setDefault(id: string): void {
    if (!this.backends.has(id)) {
      throw new Error(`Cannot set default: backend '${id}' not registered.`);
    }
    this.defaultId = id;
  }

  getDefault(): ManifoldBackend | null {
    return this.defaultId ? this.backends.get(this.defaultId) ?? null : null;
  }

  findByCapability(flag: CapabilityFlag): ManifoldBackend | null {
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

export const manifoldRegistry = new Registry();
export type { CapabilityFlag };
