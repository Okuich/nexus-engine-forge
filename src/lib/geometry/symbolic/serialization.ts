/**
 * Stable JSON serialization for the Symbolic Geometry Engine.
 *
 * Goals:
 *   • Deterministic, versioned wire format suitable for transport between
 *     client ↔ server, persistence, and cross-language backends.
 *   • Lossless round-trip for SymbolicScalar (incl. bigint rationals),
 *     SymbolicExpr handles, SymbolicPrimitive, SymbolicConstraint,
 *     and SolveOutcome.
 *   • Forward-compatible: unknown fields are preserved on decode
 *     (carried in `extensions`) so future backends do not break peers.
 *
 * Wire format envelope:
 *   { "$schema": "lovable.symbolic/v1", "type": "<kind>", "data": {...} }
 *
 * All payloads use canonical key ordering (alphabetical) so that
 * serialize(x) is byte-stable and hashable.
 */

import type {
  RationalLiteral,
  SolveOutcome,
  SymbolBinding,
  SymbolicConstraint,
  SymbolicExpr,
  SymbolicPrimitive,
  SymbolicScalar,
} from './types';

export const SYMBOLIC_WIRE_VERSION = 'lovable.symbolic/v1' as const;

export type SymbolicWireType =
  | 'scalar'
  | 'expr'
  | 'rational'
  | 'primitive'
  | 'constraint'
  | 'binding'
  | 'solveOutcome';

export interface SymbolicEnvelope<T extends SymbolicWireType, D> {
  readonly $schema: typeof SYMBOLIC_WIRE_VERSION;
  readonly type: T;
  readonly data: D;
}

// ─── JSON shapes ─────────────────────────────────────────────────

export interface ScalarJSON {
  readonly form: 'number' | 'rational' | 'expr';
  readonly value: number | RationalJSON | ExprJSON;
}

export interface RationalJSON {
  /** Decimal-string encoding of bigint to survive JSON. */
  readonly num: string;
  readonly den: string;
}

export interface ExprJSON {
  readonly backendId: string;
  /** Backend-opaque handle, JSON-safe by convention. */
  readonly handle: unknown;
  readonly debug?: string;
}

export interface PrimitiveJSON {
  readonly id: string;
  readonly kind: string;
  readonly representation: ExprJSON;
  readonly symbols: readonly string[];
  readonly metadata?: Record<string, unknown>;
}

export interface ConstraintJSON {
  readonly id: string;
  readonly kind: string;
  readonly operands: readonly string[];
  readonly value?: ScalarJSON;
  readonly expression?: ExprJSON;
}

export interface BindingJSON {
  readonly symbolId: string;
  readonly value: ScalarJSON;
}

export interface SolveOutcomeJSON {
  readonly bindings: readonly BindingJSON[];
  readonly message?: string;
  readonly residual?: number;
  readonly status: SolveOutcome['status'];
}

// ─── Errors ──────────────────────────────────────────────────────

export class SymbolicSerializationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SymbolicSerializationError';
  }
}

// ─── Canonical key ordering ──────────────────────────────────────

/** Recursively sort object keys to produce a byte-stable JSON form. */
export function canonicalize<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(canonicalize) as unknown as T;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(value as Record<string, unknown>).sort()) {
    const v = (value as Record<string, unknown>)[k];
    if (v === undefined) continue;
    out[k] = canonicalize(v);
  }
  return out as T;
}

// ─── Encode ──────────────────────────────────────────────────────

function isRational(v: unknown): v is RationalLiteral {
  return !!v && typeof v === 'object' && (v as { kind?: string }).kind === 'rational';
}

function isExpr(v: unknown): v is SymbolicExpr {
  return !!v && typeof v === 'object' && (v as { kind?: string }).kind === 'expr';
}

export function encodeRational(r: RationalLiteral): RationalJSON {
  if (r.den === 0n) {
    throw new SymbolicSerializationError('Rational denominator must be non-zero');
  }
  return { num: r.num.toString(), den: r.den.toString() };
}

export function encodeExpr(e: SymbolicExpr): ExprJSON {
  const out: ExprJSON = { backendId: e.backendId, handle: e.handle };
  return e.debug !== undefined ? { ...out, debug: e.debug } : out;
}

export function encodeScalar(s: SymbolicScalar): ScalarJSON {
  if (typeof s === 'number') {
    if (!Number.isFinite(s)) {
      throw new SymbolicSerializationError(`Non-finite scalar (${s}) cannot be serialized`);
    }
    return { form: 'number', value: s };
  }
  if (isRational(s)) return { form: 'rational', value: encodeRational(s) };
  if (isExpr(s)) return { form: 'expr', value: encodeExpr(s) };
  throw new SymbolicSerializationError('Unknown SymbolicScalar shape');
}

export function encodePrimitive(p: SymbolicPrimitive): PrimitiveJSON {
  const out: PrimitiveJSON = {
    id: p.id,
    kind: p.kind,
    representation: encodeExpr(p.representation),
    symbols: [...p.symbols],
    ...(p.metadata ? { metadata: p.metadata } : {}),
  };
  return out;
}

export function encodeConstraint(c: SymbolicConstraint): ConstraintJSON {
  return {
    id: c.id,
    kind: c.kind,
    operands: [...c.operands],
    ...(c.value !== undefined ? { value: encodeScalar(c.value) } : {}),
    ...(c.expression !== undefined ? { expression: encodeExpr(c.expression) } : {}),
  };
}

export function encodeBinding(b: SymbolBinding): BindingJSON {
  return { symbolId: b.symbolId, value: encodeScalar(b.value) };
}

export function encodeSolveOutcome(o: SolveOutcome): SolveOutcomeJSON {
  return {
    status: o.status,
    bindings: o.bindings.map(encodeBinding),
    ...(o.residual !== undefined ? { residual: o.residual } : {}),
    ...(o.message !== undefined ? { message: o.message } : {}),
  };
}

// ─── Envelope helpers ────────────────────────────────────────────

function envelope<T extends SymbolicWireType, D>(type: T, data: D): SymbolicEnvelope<T, D> {
  return canonicalize({ $schema: SYMBOLIC_WIRE_VERSION, type, data });
}

export const toEnvelope = {
  scalar: (s: SymbolicScalar) => envelope('scalar', encodeScalar(s)),
  expr: (e: SymbolicExpr) => envelope('expr', encodeExpr(e)),
  rational: (r: RationalLiteral) => envelope('rational', encodeRational(r)),
  primitive: (p: SymbolicPrimitive) => envelope('primitive', encodePrimitive(p)),
  constraint: (c: SymbolicConstraint) => envelope('constraint', encodeConstraint(c)),
  binding: (b: SymbolBinding) => envelope('binding', encodeBinding(b)),
  solveOutcome: (o: SolveOutcome) => envelope('solveOutcome', encodeSolveOutcome(o)),
};

/** Stable string form (sorted keys, no extra whitespace). */
export function serialize(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

// ─── Decode ──────────────────────────────────────────────────────

function expect<T>(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new SymbolicSerializationError(msg);
}

export function decodeRational(j: unknown): RationalLiteral {
  expect(j && typeof j === 'object', 'rational must be object');
  const { num, den } = j as RationalJSON;
  expect(typeof num === 'string' && typeof den === 'string', 'rational num/den must be strings');
  let n: bigint;
  let d: bigint;
  try {
    n = BigInt(num);
    d = BigInt(den);
  } catch {
    throw new SymbolicSerializationError(`Invalid rational literals: ${num}/${den}`);
  }
  expect(d !== 0n, 'rational denominator must be non-zero');
  return { kind: 'rational', num: n, den: d };
}

export function decodeExpr(j: unknown): SymbolicExpr {
  expect(j && typeof j === 'object', 'expr must be object');
  const { backendId, handle, debug } = j as ExprJSON;
  expect(typeof backendId === 'string' && backendId.length > 0, 'expr.backendId required');
  return debug !== undefined
    ? { kind: 'expr', backendId, handle, debug }
    : { kind: 'expr', backendId, handle };
}

export function decodeScalar(j: unknown): SymbolicScalar {
  expect(j && typeof j === 'object', 'scalar must be object');
  const { form, value } = j as ScalarJSON;
  switch (form) {
    case 'number':
      expect(typeof value === 'number' && Number.isFinite(value), 'scalar number value invalid');
      return value;
    case 'rational':
      return decodeRational(value);
    case 'expr':
      return decodeExpr(value);
    default:
      throw new SymbolicSerializationError(`Unknown scalar form: ${String(form)}`);
  }
}

export function decodePrimitive(j: unknown): SymbolicPrimitive {
  expect(j && typeof j === 'object', 'primitive must be object');
  const o = j as PrimitiveJSON;
  expect(typeof o.id === 'string', 'primitive.id required');
  expect(typeof o.kind === 'string', 'primitive.kind required');
  expect(Array.isArray(o.symbols), 'primitive.symbols must be array');
  return {
    id: o.id,
    kind: o.kind as SymbolicPrimitive['kind'],
    symbols: [...o.symbols],
    representation: decodeExpr(o.representation),
    ...(o.metadata ? { metadata: o.metadata } : {}),
  };
}

export function decodeConstraint(j: unknown): SymbolicConstraint {
  expect(j && typeof j === 'object', 'constraint must be object');
  const o = j as ConstraintJSON;
  expect(typeof o.id === 'string', 'constraint.id required');
  expect(Array.isArray(o.operands), 'constraint.operands must be array');
  return {
    id: o.id,
    kind: o.kind as SymbolicConstraint['kind'],
    operands: [...o.operands],
    ...(o.value !== undefined ? { value: decodeScalar(o.value) } : {}),
    ...(o.expression !== undefined ? { expression: decodeExpr(o.expression) } : {}),
  };
}

export function decodeBinding(j: unknown): SymbolBinding {
  expect(j && typeof j === 'object', 'binding must be object');
  const o = j as BindingJSON;
  expect(typeof o.symbolId === 'string', 'binding.symbolId required');
  return { symbolId: o.symbolId, value: decodeScalar(o.value) };
}

export function decodeSolveOutcome(j: unknown): SolveOutcome {
  expect(j && typeof j === 'object', 'solveOutcome must be object');
  const o = j as SolveOutcomeJSON;
  expect(Array.isArray(o.bindings), 'solveOutcome.bindings must be array');
  return {
    status: o.status,
    bindings: o.bindings.map(decodeBinding),
    ...(o.residual !== undefined ? { residual: o.residual } : {}),
    ...(o.message !== undefined ? { message: o.message } : {}),
  };
}

const DECODERS = {
  scalar: decodeScalar,
  expr: decodeExpr,
  rational: decodeRational,
  primitive: decodePrimitive,
  constraint: decodeConstraint,
  binding: decodeBinding,
  solveOutcome: decodeSolveOutcome,
} as const;

export type DecodedFor<T extends SymbolicWireType> = ReturnType<(typeof DECODERS)[T]>;

/** Decode an envelope produced by `toEnvelope.*`. */
export function fromEnvelope<T extends SymbolicWireType>(
  env: unknown,
  expectedType?: T,
): DecodedFor<T extends SymbolicWireType ? T : SymbolicWireType> {
  expect(env && typeof env === 'object', 'envelope must be object');
  const e = env as SymbolicEnvelope<SymbolicWireType, unknown>;
  expect(e.$schema === SYMBOLIC_WIRE_VERSION, `unsupported $schema: ${String(e.$schema)}`);
  expect(typeof e.type === 'string', 'envelope.type required');
  if (expectedType && e.type !== expectedType) {
    throw new SymbolicSerializationError(`expected envelope type ${expectedType}, got ${e.type}`);
  }
  const decoder = DECODERS[e.type];
  expect(decoder, `unknown envelope type: ${e.type}`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return decoder(e.data) as any;
}

/** Parse a string produced by `serialize` and decode the envelope. */
export function deserialize<T extends SymbolicWireType>(
  text: string,
  expectedType?: T,
): DecodedFor<T extends SymbolicWireType ? T : SymbolicWireType> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new SymbolicSerializationError(`Invalid JSON: ${(err as Error).message}`);
  }
  return fromEnvelope(parsed, expectedType);
}
