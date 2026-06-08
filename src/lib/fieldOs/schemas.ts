/**
 * Zod schemas for the Field Core Intelligence (Field OS) HTTP API.
 *
 * These schemas are the source of truth for request/response shapes;
 * the TypeScript types in `./types.ts` are kept structurally compatible
 * but the runtime contract is enforced here.
 */

import { z } from 'zod';

// ── Primitives ──────────────────────────────────────────────────
const FiniteNumber = z
  .number()
  .refine((n) => Number.isFinite(n), { message: 'must be a finite number' });

const NonNegInt = z.number().int().nonnegative();
const PosInt = z.number().int().positive();

const GridCoord = z
  .tuple([NonNegInt, NonNegInt])
  .describe('grid cell as [x, y]');

const NumberArray = z.array(FiniteNumber);

const Grid2DPayloadSchema = z
  .object({
    w: PosInt,
    h: PosInt,
    data: NumberArray,
  })
  .superRefine((v, ctx) => {
    if (v.data.length !== v.w * v.h) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `data.length (${v.data.length}) must equal w*h (${v.w * v.h})`,
        path: ['data'],
      });
    }
  });

// ── Health ──────────────────────────────────────────────────────
export const FieldOsHealthSchema = z.object({
  ok: z.boolean(),
  version: z.string().min(1),
  operators: z.array(z.string().min(1)),
});

// ── Eikonal ─────────────────────────────────────────────────────
export const EikonalRequestSchema = z
  .object({
    w: PosInt,
    h: PosInt,
    speed: NumberArray,
    sources: z.array(GridCoord).min(1, 'at least one source required'),
    sweeps: PosInt.max(64).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.speed.length !== v.w * v.h) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `speed.length (${v.speed.length}) must equal w*h (${v.w * v.h})`,
        path: ['speed'],
      });
    }
    for (const s of v.speed) {
      if (s <= 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'speed values must be > 0 (use a small epsilon for obstacles)',
          path: ['speed'],
        });
        break;
      }
    }
    v.sources.forEach(([x, y], i) => {
      if (x >= v.w || y >= v.h) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `source[${i}] (${x},${y}) outside grid ${v.w}x${v.h}`,
          path: ['sources', i],
        });
      }
    });
  });

export const EikonalResponseSchema = z.object({
  operator: z.literal('op.eikonal.fsm'),
  field: Grid2DPayloadSchema,
  stats: z.object({
    min: FiniteNumber,
    max: FiniteNumber,
    sources: NonNegInt,
    sweeps: NonNegInt,
  }),
});

// ── Poisson ─────────────────────────────────────────────────────
export const PoissonRequestSchema = z
  .object({
    w: PosInt,
    h: PosInt,
    u0: NumberArray.optional(),
    f: NumberArray,
    iterations: PosInt.max(10_000).optional(),
    h2: z.number().positive().optional(),
  })
  .superRefine((v, ctx) => {
    const n = v.w * v.h;
    if (v.f.length !== n) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `f.length (${v.f.length}) must equal w*h (${n})`,
        path: ['f'],
      });
    }
    if (v.u0 && v.u0.length !== n) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `u0.length (${v.u0.length}) must equal w*h (${n})`,
        path: ['u0'],
      });
    }
  });

export const PoissonResponseSchema = z.object({
  operator: z.literal('op.poisson.jacobi'),
  field: Grid2DPayloadSchema,
  stats: z.object({
    iterations: NonNegInt,
    residual: FiniteNumber,
  }),
});

// ── Laplacian ───────────────────────────────────────────────────
export const LaplacianRequestSchema = z
  .object({
    w: PosInt,
    h: PosInt,
    src: NumberArray,
  })
  .superRefine((v, ctx) => {
    if (v.src.length !== v.w * v.h) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `src.length (${v.src.length}) must equal w*h (${v.w * v.h})`,
        path: ['src'],
      });
    }
  });

export const LaplacianResponseSchema = z.object({
  operator: z.literal('op.lap.uniform'),
  field: Grid2DPayloadSchema,
});

// ── Inferred types (canonical) ──────────────────────────────────
export type FieldOsHealth = z.infer<typeof FieldOsHealthSchema>;
export type EikonalRequest = z.infer<typeof EikonalRequestSchema>;
export type EikonalResponse = z.infer<typeof EikonalResponseSchema>;
export type PoissonRequest = z.infer<typeof PoissonRequestSchema>;
export type PoissonResponse = z.infer<typeof PoissonResponseSchema>;
export type LaplacianRequest = z.infer<typeof LaplacianRequestSchema>;
export type LaplacianResponse = z.infer<typeof LaplacianResponseSchema>;
