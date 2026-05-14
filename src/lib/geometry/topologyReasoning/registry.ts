/**
 * Topology Reasoning Backend Registry.
 *
 * Capability-aware lookup; can pick the cheapest backend whose
 * `maxNodes` covers the graph being analyzed.
 */

import type { TopologyBackend, TopologyCapabilities } from './backend';

type CapabilityFlag = keyof Omit<TopologyCapabilities, 'kinds' | 'flavors' | 'maxNodes'>;

class Registry {
  private backends = new Map<string, TopologyBackend>();
  private defaultId: string | null = null;

  register(b: TopologyBackend): void {
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

  get(id: string): TopologyBackend | undefined {
    return this.backends.get(id);
  }

  list(): readonly TopologyBackend[] {
    return Array.from(this.backends.values());
  }

  setDefault(id: string): void {
    if (!this.backends.has(id)) {
      throw new Error(`Cannot set default: backend '${id}' not registered.`);
    }
    this.defaultId = id;
  }

  getDefault(): TopologyBackend | null {
    return this.defaultId ? this.backends.get(this.defaultId) ?? null : null;
  }

  findByCapability(flag: CapabilityFlag): TopologyBackend | null {
    for (const b of this.backends.values()) {
      if (b.capabilities[flag]) return b;
    }
    return null;
  }

  /** Find the smallest-cost backend that can handle nodeCount + capability. */
  findForWorkload(
    flag: CapabilityFlag,
    nodeCount: number,
  ): TopologyBackend | null {
    let best: TopologyBackend | null = null;
    let bestCap = Infinity;
    for (const b of this.backends.values()) {
      if (!b.capabilities[flag]) continue;
      const cap = b.capabilities.maxNodes ?? Infinity;
      if (cap < nodeCount) continue;
      if (cap < bestCap) {
        best = b;
        bestCap = cap;
      }
    }
    return best;
  }

  clear(): void {
    for (const b of this.backends.values()) b.dispose?.();
    this.backends.clear();
    this.defaultId = null;
  }
}

export const topologyRegistry = new Registry();
export type { CapabilityFlag };
