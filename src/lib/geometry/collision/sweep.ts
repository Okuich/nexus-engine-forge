/**
 * Motion sweep — sample-based time-of-impact analysis for moving assemblies.
 *
 * For each sample t in [0,1], rebuild transforms from each part's motion
 * track and run a static collision pass. Reports first contact time and
 * the union of pair contacts seen across the sweep.
 */

import { detectCollisions } from './detector';
import { sampleMotion } from './transform';
import type {
  AssemblyPart,
  MotionSweepOptions,
  MotionSweepResult,
  MovingPart,
} from './types';

export function sweepMotion(
  parts: Array<AssemblyPart | MovingPart>,
  options: MotionSweepOptions = {},
): MotionSweepResult {
  const t0 =
    typeof performance !== 'undefined' ? performance.now() : Date.now();
  const samples = Math.max(2, options.samples ?? 16);

  // Determine global motion time range from any keyframes present.
  let tMin = Infinity, tMax = -Infinity;
  for (const p of parts) {
    const m = (p as MovingPart).motion;
    if (m && m.length > 0) {
      tMin = Math.min(tMin, m[0].t);
      tMax = Math.max(tMax, m[m.length - 1].t);
    }
  }
  if (!isFinite(tMin)) { tMin = 0; tMax = 1; }
  if (tMax === tMin) tMax = tMin + 1;

  const timeline: MotionSweepResult['timeline'] = [];
  const contactKeys = new Set<string>();
  const contactPairs: Array<[string, string]> = [];
  let firstContactT: number | null = null;

  for (let i = 0; i < samples; i++) {
    const t = tMin + ((tMax - tMin) * i) / (samples - 1);
    const snapshot: AssemblyPart[] = parts.map((p) => {
      const m = (p as MovingPart).motion;
      if (!m || m.length === 0) return p;
      return { ...p, transform: sampleMotion(m, t) };
    });
    const report = detectCollisions(snapshot, options);
    timeline.push({ t, report });

    if (report.pairs.length > 0 && firstContactT === null) firstContactT = t;
    for (const pr of report.pairs) {
      const key = pr.partA < pr.partB
        ? `${pr.partA}|${pr.partB}`
        : `${pr.partB}|${pr.partA}`;
      if (!contactKeys.has(key)) {
        contactKeys.add(key);
        contactPairs.push([pr.partA, pr.partB]);
      }
    }
  }

  const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  return { timeline, firstContactT, contactPairs, elapsedMs: t1 - t0 };
}
