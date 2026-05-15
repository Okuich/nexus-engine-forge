/**
 * Tests for the SSE iteration stream builder. We bypass HTTP and consume
 * the raw ReadableStream directly to assert: ordering (open → N×iteration
 * → done), throttle spacing, monotonic iteration index, perCaseCompliance
 * shape, and abort behavior.
 */
import { describe, it, expect } from 'vitest';
import { buildIterationStream } from '../../supabase/functions/topology-api/stream';

interface SseRecord { event: string; data: any }

async function collect(stream: ReadableStream<Uint8Array>): Promise<SseRecord[]> {
  const reader = stream.getReader();
  const dec = new TextDecoder();
  const out: SseRecord[] = [];
  let buf = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let sep: number;
    while ((sep = buf.indexOf('\n\n')) >= 0) {
      const block = buf.slice(0, sep);
      buf = buf.slice(sep + 2);
      let event = 'message';
      const dataLines: string[] = [];
      for (const line of block.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
      }
      out.push({ event, data: JSON.parse(dataLines.join('\n')) });
    }
  }
  return out;
}

const baseReq = {
  loadCases: [
    { name: 'a', loads: [{ point: [0, 0, 0] as [number, number, number], force: [10, 0, 0] as [number, number, number] }], weight: 1 },
    { name: 'b', loads: [{ point: [1, 0, 0] as [number, number, number], force: [0, 5, 0] as [number, number, number] }], weight: 2 },
  ],
  supports: [{ point: [0, 0, 0] as [number, number, number], fixed: true }],
};

describe('topology-api iteration stream', () => {
  it('emits open, N throttled iterations, then done', async () => {
    const stream = buildIterationStream(baseReq, { throttleMs: 1, maxIterations: 5 });
    const events = await collect(stream);
    expect(events[0].event).toBe('open');
    expect(events[events.length - 1].event).toBe('done');
    const iters = events.filter(e => e.event === 'iteration');
    expect(iters).toHaveLength(5);
    iters.forEach((e, i) => {
      expect(e.data.data.iteration).toBe(i + 1);
      expect(e.data.data.perCaseCompliance).toHaveLength(2);
      expect(e.data.data.compliance).toBeGreaterThanOrEqual(0);
    });
    // Compliance should monotonically decrease toward the surrogate target.
    const series = iters.map(e => e.data.data.compliance);
    for (let i = 1; i < series.length; i++) expect(series[i]).toBeLessThanOrEqual(series[i - 1] + 1e-9);
  });

  it('respects throttleMs spacing', async () => {
    const t0 = Date.now();
    const stream = buildIterationStream(baseReq, { throttleMs: 25, maxIterations: 4 });
    await collect(stream);
    // 4 iterations + 1 leading delay → ≥ 4*25ms (allow scheduler slop).
    expect(Date.now() - t0).toBeGreaterThanOrEqual(80);
  });

  it('aborts cleanly via signal', async () => {
    const ac = new AbortController();
    const stream = buildIterationStream(baseReq, { throttleMs: 50, maxIterations: 100 }, ac.signal);
    setTimeout(() => ac.abort(), 30);
    const events = await collect(stream);
    expect(events.find(e => e.event === 'done')).toBeUndefined();
    // We always get at least the open event.
    expect(events[0].event).toBe('open');
  });

  it('emits densityPreview on intermediate iterations and full density only on the final one', async () => {
    const stream = buildIterationStream(baseReq, {
      throttleMs: 0, maxIterations: 4, previewSize: 4, fullSize: 8, includeDensity: true,
    });
    const events = await collect(stream);
    const iters = events.filter(e => e.event === 'iteration').map(e => e.data.data);
    expect(iters).toHaveLength(4);
    // Intermediate (1..3): only densityPreview, no full density.
    for (const s of iters.slice(0, -1)) {
      expect(s.isFinal).toBe(false);
      expect(s.density).toBeUndefined();
      expect(s.densityPreview).toHaveLength(4 * 4 * 4);
      expect(s.previewDims).toEqual([4, 4, 4]);
    }
    // Final iteration: full density, no preview.
    const last = iters[iters.length - 1];
    expect(last.isFinal).toBe(true);
    expect(last.densityPreview).toBeUndefined();
    expect(last.density).toHaveLength(8 * 8 * 8);
    expect(last.dims).toEqual([8, 8, 8]);
    // Final payload should be larger than intermediates.
    const interSize = JSON.stringify(iters[0]).length;
    const finalSize = JSON.stringify(last).length;
    expect(finalSize).toBeGreaterThan(interSize);
  });

  it('omits density entirely when includeDensity=false', async () => {
    const stream = buildIterationStream(baseReq, {
      throttleMs: 0, maxIterations: 3, includeDensity: false,
    });
    const events = await collect(stream);
    const iters = events.filter(e => e.event === 'iteration').map(e => e.data.data);
    for (const s of iters) {
      expect(s.density).toBeUndefined();
      expect(s.densityPreview).toBeUndefined();
    }
  });
});
