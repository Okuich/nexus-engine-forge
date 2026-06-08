/**
 * Stable / Failure neighborhood store.
 *
 * Maintains two indexed pools of historical physics states:
 *   - stable[]  → physically feasible reference points
 *   - failure[] → known-infeasible reference points
 *
 * Used to retrieve StableStateNeighborhoods and
 * FailureStateNeighborhoods for any query state.
 */

import { failureDistance, stableDistance } from './distance';
import type {
  FindOptions,
  NeighborhoodHit,
  PhysicsStateVector,
  StoredPhysicsState,
} from './types';

export class PhysicsNeighborhoodStore {
  private readonly stable: StoredPhysicsState[] = [];
  private readonly failure: StoredPhysicsState[] = [];
  private readonly capacity: number;

  constructor(capacity = 20_000) {
    this.capacity = capacity;
  }

  size(): { stable: number; failure: number } {
    return { stable: this.stable.length, failure: this.failure.length };
  }

  clear(): void {
    this.stable.length = 0;
    this.failure.length = 0;
  }

  add(item: StoredPhysicsState): void {
    const pool = item.feasible ? this.stable : this.failure;
    pool.push(item);
    if (pool.length > this.capacity) pool.shift();
  }

  /** k nearest stable reference states. */
  nearestStable(query: PhysicsStateVector, opts: FindOptions = {}): NeighborhoodHit[] {
    const k = Math.max(1, opts.k ?? 5);
    return this.stable
      .filter((s) => s.vector.id !== query.id)
      .map<NeighborhoodHit>((s) => ({
        snapshotId: s.vector.snapshotId,
        distance: stableDistance(query.vector, s.vector.vector, s.penalty),
        stable: true,
        penalty: s.penalty,
      }))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, k);
  }

  /** k nearest failure reference states. */
  nearestFailure(query: PhysicsStateVector, opts: FindOptions = {}): NeighborhoodHit[] {
    const k = Math.max(1, opts.k ?? 5);
    return this.failure
      .filter((s) => s.vector.id !== query.id)
      .map<NeighborhoodHit>((s) => ({
        snapshotId: s.vector.snapshotId,
        distance: failureDistance(query.vector, s.vector.vector, s.penalty),
        stable: false,
        penalty: s.penalty,
      }))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, k);
  }
}
