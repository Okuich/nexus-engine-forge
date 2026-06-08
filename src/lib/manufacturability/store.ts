/**
 * In-memory store + nearest-neighbor retrieval over the
 * manufacturability metric space.
 */

import {
  difficultyDistance,
  geometricDistance,
  geometricSimilarity,
} from './distance';
import { difficultyWeightVector } from './normalizer';
import type {
  ManufacturabilityVector,
  NearestNeighborOptions,
  SimilarPart,
  StoredManufacturablePart,
} from './types';

export class ManufacturabilityStore {
  private readonly items: StoredManufacturablePart[] = [];
  private readonly weights = difficultyWeightVector();
  private readonly capacity: number;

  constructor(capacity = 20_000) {
    this.capacity = capacity;
  }

  size(): number {
    return this.items.length;
  }

  clear(): void {
    this.items.length = 0;
  }

  add(item: StoredManufacturablePart): void {
    this.items.push(item);
    if (this.items.length > this.capacity) this.items.shift();
  }

  /** k-NN with either geometric or difficulty distance. */
  nearest(
    query: ManufacturabilityVector,
    options: NearestNeighborOptions = {},
  ): SimilarPart[] {
    const k = Math.max(1, options.k ?? 5);
    const metric = options.metric ?? 'geometric';

    const scored: Array<{ item: StoredManufacturablePart; d: number; sim: number }> = [];
    for (const it of this.items) {
      if (it.vector.id === query.id) continue;
      const d =
        metric === 'difficulty'
          ? difficultyDistance(query.vector, it.vector.vector, this.weights)
          : geometricDistance(query.vector, it.vector.vector);
      const sim = geometricSimilarity(query.vector, it.vector.vector);
      scored.push({ item: it, d, sim });
    }
    scored.sort((a, b) => a.d - b.d);

    return scored.slice(0, k).map<SimilarPart>((s) => ({
      modelId: s.item.vector.modelId,
      modelName: s.item.modelName,
      geometricSimilarity: s.sim,
      difficultyDistance:
        metric === 'difficulty'
          ? s.d
          : difficultyDistance(query.vector, s.item.vector.vector, this.weights),
      process: s.item.process,
      actualScore: s.item.actualScore,
    }));
  }
}
