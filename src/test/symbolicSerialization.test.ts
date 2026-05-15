import { describe, expect, it } from 'vitest';
import {
  SYMBOLIC_WIRE_VERSION,
  SymbolicSerializationError,
  canonicalize,
  decodeScalar,
  deserialize,
  encodeScalar,
  fromEnvelope,
  serialize,
  toEnvelope,
} from '@/lib/geometry/symbolic/serialization';
import type {
  RationalLiteral,
  SolveOutcome,
  SymbolicConstraint,
  SymbolicExpr,
  SymbolicPrimitive,
} from '@/lib/geometry/symbolic/types';

const expr: SymbolicExpr = {
  kind: 'expr',
  backendId: 'stub',
  handle: { op: 'add', args: [1, 2] },
  debug: '1+2',
};

const rational: RationalLiteral = { kind: 'rational', num: 22n, den: 7n };

describe('symbolic serialization', () => {
  it('round-trips scalar forms', () => {
    expect(decodeScalar(encodeScalar(3.14))).toBe(3.14);
    const r = decodeScalar(encodeScalar(rational)) as RationalLiteral;
    expect(r.kind).toBe('rational');
    expect(r.num).toBe(22n);
    expect(r.den).toBe(7n);
    const e = decodeScalar(encodeScalar(expr)) as SymbolicExpr;
    expect(e.backendId).toBe('stub');
    expect(e.debug).toBe('1+2');
  });

  it('rejects non-finite numbers and zero denominators', () => {
    expect(() => encodeScalar(Number.NaN)).toThrow(SymbolicSerializationError);
    expect(() => encodeScalar(Infinity)).toThrow(SymbolicSerializationError);
    expect(() =>
      encodeScalar({ kind: 'rational', num: 1n, den: 0n } as RationalLiteral),
    ).toThrow(SymbolicSerializationError);
  });

  it('round-trips primitives, constraints, and solve outcomes via envelopes', () => {
    const prim: SymbolicPrimitive = {
      id: 'p1',
      kind: 'point',
      symbols: ['x', 'y'],
      representation: expr,
      metadata: { label: 'origin' },
    };
    const c: SymbolicConstraint = {
      id: 'c1',
      kind: 'distance',
      operands: ['p1', 'p2'],
      value: rational,
      expression: expr,
    };
    const outcome: SolveOutcome = {
      status: 'solved',
      bindings: [{ symbolId: 'x', value: 1.5 }],
      residual: 0,
      message: 'ok',
    };

    const decodedPrim = fromEnvelope(toEnvelope.primitive(prim), 'primitive');
    expect(decodedPrim.id).toBe('p1');
    expect(decodedPrim.symbols).toEqual(['x', 'y']);
    expect(decodedPrim.metadata).toEqual({ label: 'origin' });

    const decodedC = fromEnvelope(toEnvelope.constraint(c), 'constraint');
    expect(decodedC.kind).toBe('distance');
    expect((decodedC.value as RationalLiteral).num).toBe(22n);

    const decodedO = fromEnvelope(toEnvelope.solveOutcome(outcome), 'solveOutcome');
    expect(decodedO.status).toBe('solved');
    expect(decodedO.bindings[0].value).toBe(1.5);
  });

  it('produces canonical, byte-stable JSON regardless of key order', () => {
    const a = serialize(toEnvelope.scalar(rational));
    const b = serialize({
      data: { value: { den: '7', num: '22' }, form: 'rational' },
      type: 'scalar',
      $schema: SYMBOLIC_WIRE_VERSION,
    });
    expect(a).toBe(b);
  });

  it('serialize/deserialize round-trip for a constraint', () => {
    const c: SymbolicConstraint = {
      id: 'c2',
      kind: 'equation',
      operands: ['a', 'b'],
      expression: expr,
    };
    const decoded = deserialize(serialize(toEnvelope.constraint(c)), 'constraint');
    expect(decoded.id).toBe('c2');
    expect(decoded.expression?.backendId).toBe('stub');
  });

  it('rejects wrong schema or mismatched envelope type', () => {
    expect(() =>
      fromEnvelope({ $schema: 'other/v0', type: 'scalar', data: {} }),
    ).toThrow(SymbolicSerializationError);
    expect(() =>
      fromEnvelope(toEnvelope.scalar(1), 'primitive'),
    ).toThrow(SymbolicSerializationError);
  });

  it('canonicalize sorts keys recursively and drops undefined', () => {
    const out = canonicalize({ b: 1, a: { z: undefined, y: [3, { d: 1, c: 2 }] } });
    expect(JSON.stringify(out)).toBe('{"a":{"y":[3,{"c":2,"d":1}]},"b":1}');
  });
});
