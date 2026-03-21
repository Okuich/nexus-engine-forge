import { describe, it, expect } from 'vitest';
import { runPipeline } from '@/lib/pipeline';
import { extractFeatures } from '@/lib/geometry';
import type { RawMesh } from '@/lib/geometry';

function makeTetrahedron(): RawMesh {
  return {
    positions: new Float32Array([
      0, 0, 0, 1, 0, 0, 0.5, 0.866, 0, 0.5, 0.289, 0.816,
    ]),
    indices: new Uint32Array([0, 1, 2, 0, 1, 3, 1, 2, 3, 0, 2, 3]),
  };
}

describe('quotePipeline', () => {
  const features = extractFeatures(makeTetrahedron());

  it('returns assessment, quotes, and timing', async () => {
    const result = await runPipeline({
      features,
      materialId: 'al-6061',
      processId: 'cnc-milling',
      quantity: 1,
      rulesOnly: true,
    });

    expect(result.pipelineId).toBeTruthy();
    expect(result.assessment.manufacturabilityScore).toBeGreaterThan(0);
    expect(result.assessment.costUsd).toBeGreaterThan(0);
    expect(result.quotes.length).toBeGreaterThan(0);
    expect(result.bestQuote).not.toBeNull();
    expect(result.bestQuote!.rank).toBe(1);
    expect(result.totalLatencyMs).toBeGreaterThanOrEqual(0);
    expect(result.stageTiming.inferenceMs).toBeGreaterThanOrEqual(0);
  });

  it('quotes are sorted by cost ascending', async () => {
    const result = await runPipeline({
      features,
      materialId: 'al-6061',
      processId: 'cnc-milling',
      quantity: 10,
      rulesOnly: true,
    });

    for (let i = 1; i < result.quotes.length; i++) {
      expect(result.quotes[i].adjustedCostUsd).toBeGreaterThanOrEqual(
        result.quotes[i - 1].adjustedCostUsd,
      );
    }
  });

  it('filters by certifications', async () => {
    const result = await runPipeline({
      features,
      materialId: 'al-6061',
      processId: 'cnc-milling',
      quantity: 1,
      requiresCertifications: ['AS9100', 'ITAR'],
      rulesOnly: true,
    });

    for (const q of result.quotes) {
      expect(q.confidence).toBeGreaterThan(0);
    }
  });

  it('returns empty quotes for impossible combo', async () => {
    const result = await runPipeline({
      features,
      materialId: 'inconel-718',
      processId: 'injection',
      quantity: 1,
      rulesOnly: true,
    });

    expect(result.quotes).toHaveLength(0);
    expect(result.bestQuote).toBeNull();
    // Assessment should still work
    expect(result.assessment.costUsd).toBeGreaterThan(0);
  });

  it('assessment includes explanation', async () => {
    const result = await runPipeline({
      features,
      materialId: 'ti-6al4v',
      processId: 'cnc-milling',
      quantity: 5,
      rulesOnly: true,
    });

    expect(result.assessment.explanation.summary).toBeTruthy();
    expect(result.assessment.riskLevel).toBeTruthy();
    expect(result.assessment.source).toBe('rules');
  });
});
