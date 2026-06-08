import { describe, it, expect } from 'vitest';
import {
  EikonalRequestSchema,
  EikonalResponseSchema,
  PoissonRequestSchema,
  FieldOsHealthSchema,
} from '@/lib/fieldOs/schemas';

describe('Field OS Zod schemas', () => {
  it('accepts a well-formed eikonal request', () => {
    const r = EikonalRequestSchema.safeParse({
      w: 2,
      h: 2,
      speed: [1, 1, 1, 1],
      sources: [[0, 0]],
    });
    expect(r.success).toBe(true);
  });

  it('rejects speed length mismatch', () => {
    const r = EikonalRequestSchema.safeParse({
      w: 2,
      h: 2,
      speed: [1, 1, 1], // 3 vs 4
      sources: [[0, 0]],
    });
    expect(r.success).toBe(false);
  });

  it('rejects non-positive speed', () => {
    const r = EikonalRequestSchema.safeParse({
      w: 2,
      h: 2,
      speed: [1, 0, 1, 1],
      sources: [[0, 0]],
    });
    expect(r.success).toBe(false);
  });

  it('rejects source outside grid', () => {
    const r = EikonalRequestSchema.safeParse({
      w: 2,
      h: 2,
      speed: [1, 1, 1, 1],
      sources: [[5, 0]],
    });
    expect(r.success).toBe(false);
  });

  it('validates eikonal response', () => {
    const r = EikonalResponseSchema.safeParse({
      operator: 'op.eikonal.fsm',
      field: { w: 2, h: 2, data: [0, 1, 1, 2] },
      stats: { min: 0, max: 2, sources: 1, sweeps: 4 },
    });
    expect(r.success).toBe(true);
  });

  it('rejects response with wrong operator literal', () => {
    const r = EikonalResponseSchema.safeParse({
      operator: 'op.poisson.jacobi',
      field: { w: 2, h: 2, data: [0, 1, 1, 2] },
      stats: { min: 0, max: 2, sources: 1, sweeps: 4 },
    });
    expect(r.success).toBe(false);
  });

  it('rejects poisson f-length mismatch', () => {
    const r = PoissonRequestSchema.safeParse({
      w: 3,
      h: 3,
      f: [0, 0, 0],
    });
    expect(r.success).toBe(false);
  });

  it('accepts a well-formed health payload', () => {
    const r = FieldOsHealthSchema.safeParse({
      ok: true,
      version: '0.1.0',
      operators: ['op.eikonal.fsm', 'op.poisson.jacobi'],
    });
    expect(r.success).toBe(true);
  });
});
