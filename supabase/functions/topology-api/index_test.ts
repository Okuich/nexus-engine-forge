/**
 * Tests for the topology compliance evaluator. The HTTP layer is exercised
 * indirectly via the exported `evaluateCompliance` pure function.
 */
import { assertEquals, assertAlmostEquals } from 'jsr:@std/assert@1';
import { evaluateCompliance } from './compliance.ts';

Deno.test('weighted-sum aggregation matches Σ wᵢ·cᵢ', () => {
  const result = evaluateCompliance({
    loadCases: [
      { name: 'a', loads: [{ point: [0, 0, 0], force: [10, 0, 0] }], weight: 1 },
      { name: 'b', loads: [{ point: [0, 0, 0], force: [0, 20, 0] }], weight: 2 },
    ],
    supports: [{ point: [1, 0, 0], fixed: true }],
  });
  assertEquals(result.loadCaseAggregation, 'weighted-sum');
  assertEquals(result.perCaseCompliance.length, 2);
  assertAlmostEquals(result.perCaseCompliance[0], 100);
  assertAlmostEquals(result.perCaseCompliance[1], 400);
  assertAlmostEquals(result.aggregatedCompliance, 1 * 100 + 2 * 400);
  assertEquals(result.ksRho, undefined);
});

Deno.test('ks aggregation is bounded by max·weight and reduces to it as ρ→∞', () => {
  const cases = [
    { name: 'small', loads: [{ point: [0, 0, 0] as [number, number, number], force: [3, 0, 0] as [number, number, number] }] },
    { name: 'big',   loads: [{ point: [0, 0, 0] as [number, number, number], force: [10, 0, 0] as [number, number, number] }] },
  ];
  const sharp = evaluateCompliance({
    loadCases: cases,
    loadCaseAggregation: 'ks',
    ksRho: 200,
  });
  assertEquals(sharp.loadCaseAggregation, 'ks');
  assertEquals(sharp.ksRho, 200);
  // KS ≥ each per-case (weighted) compliance and approaches the max as ρ grows.
  assertAlmostEquals(sharp.aggregatedCompliance, 100, 0.5);
});

Deno.test('perCaseCompliance order matches input loadCases order', () => {
  const result = evaluateCompliance({
    loadCases: [
      { name: 'first',  loads: [{ point: [0, 0, 0], force: [1, 0, 0] }] },
      { name: 'second', loads: [{ point: [0, 0, 0], force: [2, 0, 0] }] },
      { name: 'third',  loads: [{ point: [0, 0, 0], force: [3, 0, 0] }] },
    ],
  });
  assertEquals(result.perCase.map(p => p.name), ['first', 'second', 'third']);
  assertEquals(result.perCaseCompliance, [1, 4, 9]);
});

Deno.test('per-case supports override top-level supports in the denominator', () => {
  const result = evaluateCompliance({
    loadCases: [
      // 4 own supports → denom 4
      {
        loads: [{ point: [0, 0, 0], force: [4, 0, 0] }],
        supports: [
          { point: [1, 0, 0] }, { point: [0, 1, 0] },
          { point: [0, 0, 1] }, { point: [-1, 0, 0] },
        ],
      },
      // no override → falls back to 1 top-level support → denom 1
      { loads: [{ point: [0, 0, 0], force: [4, 0, 0] }] },
    ],
    supports: [{ point: [0, 0, 0] }],
  });
  assertAlmostEquals(result.perCaseCompliance[0], 16 / 4);
  assertAlmostEquals(result.perCaseCompliance[1], 16 / 1);
});
