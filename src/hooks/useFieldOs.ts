import { useCallback, useEffect, useRef, useState } from 'react';
import {
  fieldOs,
  FieldOsError,
  type EikonalResponse,
  type FieldOsHealth,
  type PoissonResponse,
} from '@/lib/fieldOs';

export type FieldOsNavInputs = {
  w: number;
  h: number;
  /** [x,y] in grid coords */
  source: [number, number];
  /** [x,y] in grid coords */
  target: [number, number];
  /** Optional obstacle mask: 1 = open, 0 = blocked. Length w*h. */
  obstacles?: number[];
};

export type FieldOsNavResult = {
  arrival: EikonalResponse;
  potential: PoissonResponse;
};

/**
 * Drives Midwater's two registered Field OS bindings:
 *   op.eikonal.fsm   → MID_ARRIVAL_TIME
 *   op.poisson.jacobi → MID_NAV_POTENTIAL
 */
export function useFieldOs() {
  const [health, setHealth] = useState<FieldOsHealth | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<FieldOsNavResult | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    let cancelled = false;
    fieldOs
      .health()
      .then((h) => {
        if (!cancelled) {
          setHealth(h);
          setHealthError(null);
        }
      })
      .catch((err: FieldOsError) => {
        if (!cancelled) {
          setHealth(null);
          setHealthError(err.message);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const runNavigation = useCallback(async (inputs: FieldOsNavInputs) => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(true);
    setError(null);
    try {
      const { w, h, source, target, obstacles } = inputs;
      const n = w * h;

      // Speed field: 1 in open cells, ~0 inside obstacles.
      const speed = new Array<number>(n);
      for (let i = 0; i < n; i++) {
        speed[i] = obstacles ? (obstacles[i] > 0 ? 1 : 1e-3) : 1;
      }

      // RHS for Poisson navigation potential:
      // negative spike at target (attractor), positive spike at source.
      const f = new Array<number>(n).fill(0);
      f[target[1] * w + target[0]] = -1;
      f[source[1] * w + source[0]] = 1;

      const [arrival, potential] = await Promise.all([
        fieldOs.eikonal(
          { w, h, speed, sources: [target], sweeps: 4 },
          ctrl.signal,
        ),
        fieldOs.poisson(
          { w, h, f, iterations: 120, h2: 1 },
          ctrl.signal,
        ),
      ]);

      setResult({ arrival, potential });
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      setError((err as Error).message);
      setResult(null);
    } finally {
      setLoading(false);
    }
  }, []);

  return { health, healthError, loading, error, result, runNavigation };
}
