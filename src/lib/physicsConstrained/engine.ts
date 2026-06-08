/**
 * Physics-Constrained Engine — public facade.
 *
 *   evaluatePhysicalFeasibility(state) → vector, feasibility verdict,
 *   per-violation breakdown, stable & failure neighborhoods, and a
 *   safe/caution/unsafe verdict.
 *
 * Integrates with the Physics OS simulation engine: the raw inputs
 * (stress, strain, thermal, vibration, flow, fatigue) are produced
 * by the FEA/CFD engines and fed into this evaluator before any
 * recommendation is surfaced to the user.
 */

import { evaluateViolations } from './feasibility';
import { extractRaw, normalize } from './normalizer';
import { PhysicsNeighborhoodStore } from './neighborhoodStore';
import {
  PHYSICS_VECTOR_DIM,
  type FeasibilityResult,
  type FindOptions,
  type PhysicsSnapshot,
  type PhysicsStateVector,
  type StoredPhysicsState,
} from './types';

function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return (crypto as Crypto).randomUUID();
  }
  return `phx-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function buildVector(s: PhysicsSnapshot): PhysicsStateVector {
  const raw = extractRaw(s);
  const vec = normalize(raw);
  return { id: newId(), snapshotId: s.id, vector: vec, raw };
}

export class PhysicsConstrainedEngine {
  private readonly store: PhysicsNeighborhoodStore;

  constructor(store?: PhysicsNeighborhoodStore) {
    this.store = store ?? new PhysicsNeighborhoodStore();
  }

  size() {
    return this.store.size();
  }

  reset() {
    this.store.clear();
  }

  /** Build a PhysicsStateVector from a snapshot without persisting it. */
  buildVector(snapshot: PhysicsSnapshot): PhysicsStateVector {
    return buildVector(snapshot);
  }

  /**
   * Evaluate a snapshot AND register it in the neighborhood store
   * for future similarity queries. Returns the same shape as
   * `evaluatePhysicalFeasibility` for convenience.
   */
  evaluateAndStore(snapshot: PhysicsSnapshot, opts: FindOptions = {}): FeasibilityResult {
    const result = this.evaluatePhysicalFeasibility(snapshot, opts);
    const stored: StoredPhysicsState = {
      vector: result.vector,
      feasible: result.feasible,
      penalty: result.penalty,
      violations: result.violations,
    };
    this.store.add(stored);
    return result;
  }

  /**
   * Pure evaluation: does not mutate the store. Use this on candidate
   * recommendations before showing them to users.
   */
  evaluatePhysicalFeasibility(
    snapshot: PhysicsSnapshot,
    opts: FindOptions = {},
  ): FeasibilityResult {
    const vector = buildVector(snapshot);
    if (vector.vector.length !== PHYSICS_VECTOR_DIM) {
      throw new Error(
        `Physics vector length ${vector.vector.length} does not match ${PHYSICS_VECTOR_DIM}`,
      );
    }
    const verdict = evaluateViolations(snapshot);
    const stableNeighbors = this.store.nearestStable(vector, opts);
    const failureNeighbors = this.store.nearestFailure(vector, opts);

    let outcome: FeasibilityResult['verdict'] = 'safe';
    if (!verdict.feasible) outcome = 'unsafe';
    else if (verdict.feasibilityScore < 0.7 || verdict.violations.length > 0) outcome = 'caution';

    return {
      snapshotId: snapshot.id,
      vector,
      feasible: verdict.feasible,
      feasibilityScore: verdict.feasibilityScore,
      penalty: verdict.penalty,
      violations: verdict.violations,
      stableNeighbors,
      failureNeighbors,
      verdict: outcome,
    };
  }
}

// ─── Shared singleton + top-level API ────────────────────────────

let shared: PhysicsConstrainedEngine | null = null;

export function getPhysicsConstrainedEngine(): PhysicsConstrainedEngine {
  if (!shared) shared = new PhysicsConstrainedEngine();
  return shared;
}

export function evaluatePhysicalFeasibility(
  snapshot: PhysicsSnapshot,
  opts?: FindOptions,
): FeasibilityResult {
  return getPhysicsConstrainedEngine().evaluatePhysicalFeasibility(snapshot, opts);
}
