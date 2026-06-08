/**
 * Field Core Intelligence (Field OS) — wire types.
 *
 * Canonical shapes are derived from the Zod schemas in `./schemas.ts`,
 * so the runtime contract and the compile-time types cannot drift.
 */

export type {
  FieldOsHealth,
  EikonalRequest,
  EikonalResponse,
  PoissonRequest,
  PoissonResponse,
  LaplacianRequest,
  LaplacianResponse,
} from './schemas';

export type Grid2DPayload = {
  w: number;
  h: number;
  data: number[];
};

export class FieldOsError extends Error {
  status?: number;
  /** Zod issues when the failure was a schema-validation failure. */
  issues?: Array<{ path: (string | number)[]; message: string }>;
  constructor(
    message: string,
    opts?: { status?: number; issues?: FieldOsError['issues'] },
  ) {
    super(message);
    this.name = 'FieldOsError';
    this.status = opts?.status;
    this.issues = opts?.issues;
  }
}
