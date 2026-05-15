/**
 * Benchmark: runtime + readbacks vs. number of load cases C.
 *
 * Verifies the GPU multi-load optimizer keeps the GPU→CPU transfer cost
 * (`readbacks`) essentially independent of C, and that convergence behavior
 * stays stable as C grows. Skips automatically when no real WebGPU adapter
 * is available (e.g. CI / sandbox), so it only runs on developer machines
 * with a GPU.
 *
 * Expected readback budget per outer iteration:
 *   - weightsAggBuf  (C+1 floats)   ← tiny, sub-linear in C
 *   - filtSens       (N    floats)  ← independent of C
 * Plus one final perCase readback when no onIteration callback is provided.
 * Total: readbacks === 2 * iterations + 1, identical formula for every C.
 */
import { describe, it, expect } from 'vitest';
import {
  hasWebGPUForSIMP,
  runSIMPGPUMultiLoad,
  type VoxelDomain,
  type LoadCase,
  type SupportCondition,
} from '@/lib/geometry/topology';

function cubeDomain(n = 8): VoxelDomain {
  const N = n * n * n;
  return {
    dims: [n, n, n],
    origin: [0, 0, 0],
    voxelSize: 1 / n,
    designMask: new Uint8Array(N).fill(1),
  };
}

/** Generate `count` distinct load cases by rotating the force around y. */
function loadCases(count: number): LoadCase[] {
  const out: LoadCase[] = [];
  for (let i = 0; i < count; i++) {
    const θ = (i / count) * Math.PI * 2;
    out.push({
      name: `lc${i}`,
      weight: 1,
      loads: [{ point: [0.1, 0.5, 0.5], force: [Math.cos(θ), -1, Math.sin(θ)] }],
    });
  }
  return out;
}

const supports: SupportCondition[] = [{ point: [0.9, 0.5, 0.5] }];

describe('runSIMPGPUMultiLoad — readback & runtime scaling vs. C', () => {
  it('readbacks per iteration stay constant as C grows; runtime scales sub-linearly', async () => {
    if (!(await hasWebGPUForSIMP())) {
      // Sandbox / CI has no GPU adapter. The invariants under test only hold
      // for the real WebGPU path; skip cleanly instead of asserting on a
      // CPU fallback.
      return;
    }

    const domain = cubeDomain(8);
    const cs = [1, 2, 4, 8];
    const opts = {
      maxIterations: 6,
      targetVolumeFraction: 0.4,
      penalty: 3,
      filterRadius: 1.5,
      // Disable early stop so every run hits exactly `maxIterations` and the
      // readback count is deterministic (= 2·iter + 1).
      convergenceTol: 0,
      loadCaseAggregation: 'ks' as const,
      ksRho: 8,
    };

    const results = await Promise.all(
      cs.map(async (C) => {
        const r = await runSIMPGPUMultiLoad(domain, loadCases(C), supports, opts);
        return { C, ...r };
      }),
    );

    // ── 1. readbacks formula is constant in C ────────────────────────────
    // Each run does 2 readbacks per iteration + 1 final perCase readback.
    for (const r of results) {
      expect(r.backend).toBe('webgpu-multiload');
      expect(r.readbacks).toBe(2 * r.iterations + 1);
    }
    // The per-iteration readback count is *exactly* the same across all C.
    const perIter = results.map((r) => (r.readbacks - 1) / r.iterations);
    expect(new Set(perIter).size).toBe(1);
    expect(perIter[0]).toBe(2);

    // ── 2. runtime scales sub-linearly in C ──────────────────────────────
    // Wall-clock should grow much slower than O(C). With the GPU aggregation
    // path the dominant cost stays the per-N filter; we allow generous slack
    // to avoid flakes on shared GPUs but still catch O(C) regressions.
    const r1 = results[0];
    const r8 = results[results.length - 1];
    const perIter1 = r1.elapsedMs / Math.max(1, r1.iterations);
    const perIter8 = r8.elapsedMs / Math.max(1, r8.iterations);
    // 8× cases should *not* cost 8× per-iteration. Cap at 4× to leave slack.
    expect(perIter8).toBeLessThan(perIter1 * 4);

    // ── 3. convergence behaviour stays stable across C ───────────────────
    for (const r of results) {
      expect(r.history.length).toBe(r.iterations);
      expect(r.history.every((v) => Number.isFinite(v) && v >= 0)).toBe(true);
      // KS-aggregated compliance should trend downward (non-strict) over the
      // run; compare first vs. last sample with a small tolerance.
      const first = r.history[0];
      const last = r.history[r.history.length - 1];
      expect(last).toBeLessThanOrEqual(first * 1.05);
      expect(r.perCaseCompliance.length).toBe(r.C);
    }
  }, 30_000);
});
