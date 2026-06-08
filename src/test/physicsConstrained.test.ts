import { describe, it, expect, beforeEach } from 'vitest';
import {
  PhysicsConstrainedEngine,
  evaluatePhysicalFeasibility,
  getPhysicsConstrainedEngine,
  feasibilityDistance,
  stableDistance,
  failureDistance,
  PHYSICS_VECTOR_DIM,
  type PhysicsSnapshot,
} from '@/lib/physicsConstrained';

function makeSnapshot(overrides: Partial<PhysicsSnapshot> = {}): PhysicsSnapshot {
  const base: PhysicsSnapshot = {
    id: 's1',
    material: {
      family: 'aluminum',
      yieldMPa: 275,
      utsMPa: 310,
      enduranceMPa: 110,
      maxServiceK: 423,
      youngsGPa: 71,
    },
    stress: { vonMisesMPa: 120, principalMPa: 130 },
    strain: { equivalent: 0.002, plastic: 0 },
    thermal: { peakK: 320, meanK: 300, gradientKperMm: 2 },
    vibration: { firstNaturalHz: 400, forcingHz: 60, dampingRatio: 0.05 },
    flow: { reynolds: 5000, pressureDropPa: 2000, peakVelocity: 5, separation: false },
    fatigue: { amplitudeMPa: 40, meanMPa: 80, cyclesToFailure: 1e7, requiredLifeCycles: 1e6 },
    ...overrides,
  };
  return base;
}

describe('PhysicsConstrainedEngine', () => {
  let engine: PhysicsConstrainedEngine;
  beforeEach(() => {
    engine = new PhysicsConstrainedEngine();
  });

  it('builds a normalized fixed-length state vector', () => {
    const v = engine.buildVector(makeSnapshot());
    expect(v.vector).toBeInstanceOf(Float32Array);
    expect(v.vector.length).toBe(PHYSICS_VECTOR_DIM);
    for (let i = 0; i < v.vector.length; i++) {
      expect(v.vector[i]).toBeGreaterThanOrEqual(0);
      expect(v.vector[i]).toBeLessThanOrEqual(1);
    }
  });

  it('marks a comfortable state as feasible and safe', () => {
    const r = engine.evaluatePhysicalFeasibility(makeSnapshot());
    expect(r.feasible).toBe(true);
    expect(r.feasibilityScore).toBeGreaterThan(0.7);
    expect(r.verdict).toBe('safe');
    expect(r.violations).toHaveLength(0);
    expect(r.penalty).toBe(0);
  });

  it('flags a yield violation', () => {
    const r = engine.evaluatePhysicalFeasibility(
      makeSnapshot({ id: 'yield', stress: { vonMisesMPa: 300, principalMPa: 320 } }),
    );
    const kinds = r.violations.map((v) => v.kind);
    expect(kinds).toContain('yield');
    expect(r.penalty).toBeGreaterThan(0);
    expect(r.feasibilityScore).toBeLessThan(0.7);
  });

  it('flags a thermal violation and marks unsafe', () => {
    const r = engine.evaluatePhysicalFeasibility(
      makeSnapshot({
        id: 'thermal',
        thermal: { peakK: 440, meanK: 420, gradientKperMm: 12 },
      }),
    );
    expect(r.violations.some((v) => v.kind === 'thermal')).toBe(true);
    expect(r.verdict).not.toBe('safe');
  });

  it('flags a fatigue violation', () => {
    const r = engine.evaluatePhysicalFeasibility(
      makeSnapshot({
        id: 'fat',
        fatigue: { amplitudeMPa: 150, meanMPa: 80, cyclesToFailure: 1e4, requiredLifeCycles: 1e7 },
      }),
    );
    expect(r.violations.some((v) => v.kind === 'fatigue')).toBe(true);
  });

  it('flags dynamic instability near resonance with low damping', () => {
    const r = engine.evaluatePhysicalFeasibility(
      makeSnapshot({
        id: 'res',
        vibration: { firstNaturalHz: 400, forcingHz: 395, dampingRatio: 0.01 },
      }),
    );
    expect(r.violations.some((v) => v.kind === 'dynamic-instability')).toBe(true);
  });

  it('feasibility distance penalizes infeasible candidates', () => {
    const safe = engine.buildVector(makeSnapshot({ id: 'safe' }));
    const bad = engine.buildVector(
      makeSnapshot({ id: 'bad', stress: { vonMisesMPa: 400, principalMPa: 400 } }),
    );
    const dPlain = feasibilityDistance(safe.vector, bad.vector);
    const dPenalized = feasibilityDistance(safe.vector, bad.vector, {
      candidatePenalty: 2,
      candidateFeasible: false,
    });
    expect(dPenalized).toBeGreaterThan(dPlain);
  });

  it('retrieves stable and failure neighborhoods', () => {
    // Seed safe states
    for (let i = 0; i < 10; i++) {
      engine.evaluateAndStore(makeSnapshot({ id: `safe-${i}`, stress: { vonMisesMPa: 100 + i, principalMPa: 110 } }));
    }
    // Seed failure states
    for (let i = 0; i < 6; i++) {
      engine.evaluateAndStore(
        makeSnapshot({
          id: `fail-${i}`,
          stress: { vonMisesMPa: 320 + i * 5, principalMPa: 330 },
          thermal: { peakK: 450, meanK: 430, gradientKperMm: 20 },
        }),
      );
    }
    const sizes = engine.size();
    expect(sizes.stable).toBeGreaterThan(0);
    expect(sizes.failure).toBeGreaterThan(0);

    const r = engine.evaluatePhysicalFeasibility(makeSnapshot({ id: 'q' }), { k: 3 });
    expect(r.stableNeighbors.length).toBeGreaterThan(0);
    expect(r.stableNeighbors.length).toBeLessThanOrEqual(3);
    expect(r.failureNeighbors.length).toBeGreaterThan(0);
    expect(r.stableNeighbors.every((n) => n.stable)).toBe(true);
    expect(r.failureNeighbors.every((n) => !n.stable)).toBe(true);
    // sorted ascending
    for (let i = 1; i < r.stableNeighbors.length; i++) {
      expect(r.stableNeighbors[i].distance).toBeGreaterThanOrEqual(r.stableNeighbors[i - 1].distance);
    }
  });

  it('stableDistance and failureDistance are non-negative', () => {
    const a = engine.buildVector(makeSnapshot({ id: 'a' }));
    const b = engine.buildVector(makeSnapshot({ id: 'b' }));
    expect(stableDistance(a.vector, b.vector, 0.5)).toBeGreaterThanOrEqual(0);
    expect(failureDistance(a.vector, b.vector, 1.2)).toBeGreaterThanOrEqual(0);
  });

  it('exposes a singleton evaluatePhysicalFeasibility helper', () => {
    getPhysicsConstrainedEngine().reset();
    const r = evaluatePhysicalFeasibility(makeSnapshot());
    expect(r.feasible).toBe(true);
    expect(r.verdict).toBe('safe');
  });

  it('hard-infeasible states are pushed away by the barrier', () => {
    const a = engine.buildVector(makeSnapshot({ id: 'a' }));
    const b = engine.buildVector(makeSnapshot({ id: 'b' }));
    const safeD = feasibilityDistance(a.vector, b.vector, { candidatePenalty: 0, candidateFeasible: true });
    const failD = feasibilityDistance(a.vector, b.vector, { candidatePenalty: 0, candidateFeasible: false });
    expect(failD - safeD).toBeGreaterThanOrEqual(5);
  });
});
