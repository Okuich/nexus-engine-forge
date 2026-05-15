import { assert, assertEquals, assertNotEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  parseTraceparent,
  formatTraceparent,
  newTraceId,
  newSpanId,
  startSpanFromRequest,
  traceResponseHeaders,
  Span,
} from './tracing.ts';

Deno.test('newTraceId / newSpanId produce well-formed hex of expected length', () => {
  const tid = newTraceId();
  const sid = newSpanId();
  assertEquals(tid.length, 32);
  assertEquals(sid.length, 16);
  assert(/^[0-9a-f]+$/.test(tid));
  assert(/^[0-9a-f]+$/.test(sid));
  assertNotEquals(tid, '0'.repeat(32));
  assertNotEquals(sid, '0'.repeat(16));
});

Deno.test('parseTraceparent rejects malformed input', () => {
  assertEquals(parseTraceparent(null), null);
  assertEquals(parseTraceparent('garbage'), null);
  // wrong version
  assertEquals(
    parseTraceparent('ff-' + 'a'.repeat(32) + '-' + 'b'.repeat(16) + '-01'),
    null,
  );
  // all-zero trace id
  assertEquals(
    parseTraceparent('00-' + '0'.repeat(32) + '-' + 'b'.repeat(16) + '-01'),
    null,
  );
});

Deno.test('parseTraceparent extracts trace + parent span id, mints fresh span id', () => {
  const traceId = 'a'.repeat(32);
  const parentId = 'b'.repeat(16);
  const ctx = parseTraceparent(`00-${traceId}-${parentId}-01`);
  assert(ctx);
  assertEquals(ctx!.traceId, traceId);
  assertEquals(ctx!.parentSpanId, parentId);
  assertEquals(ctx!.sampled, true);
  assertNotEquals(ctx!.spanId, parentId);
  assertEquals(ctx!.spanId.length, 16);
});

Deno.test('formatTraceparent round-trips through parseTraceparent', () => {
  const ctx = { traceId: newTraceId(), spanId: newSpanId(), sampled: true };
  const header = formatTraceparent(ctx);
  const parsed = parseTraceparent(header);
  assert(parsed);
  assertEquals(parsed!.traceId, ctx.traceId);
  assertEquals(parsed!.parentSpanId, ctx.spanId);
});

Deno.test('startSpanFromRequest continues incoming trace and emits matching response headers', () => {
  const traceId = 'c'.repeat(32);
  const parentId = 'd'.repeat(16);
  const req = new Request('https://example.com/simplify-jobs/create', {
    method: 'POST',
    headers: { traceparent: `00-${traceId}-${parentId}-01` },
  });
  const span = startSpanFromRequest(req, 'http.POST create');
  assertEquals(span.traceId, traceId);
  assertEquals(span.parentSpanId, parentId);

  const headers = traceResponseHeaders(span);
  assertEquals(headers['x-trace-id'], traceId);
  assert(headers['traceparent'].startsWith(`00-${traceId}-`));
  span.end();
});

Deno.test('startSpanFromRequest mints a new trace when no header is present', () => {
  const req = new Request('https://example.com/simplify-jobs/health');
  const span = startSpanFromRequest(req, 'http.GET health');
  assertEquals(span.traceId.length, 32);
  assertEquals(span.parentSpanId, undefined);
  span.end();
});

Deno.test('Span.child inherits trace id but has fresh span id and parent linkage', () => {
  const root = new Span('root', { traceId: newTraceId(), spanId: newSpanId(), sampled: true });
  const child = root.child('child.work');
  assertEquals(child.traceId, root.traceId);
  assertEquals(child.parentSpanId, root.spanId);
  assertNotEquals(child.spanId, root.spanId);
  child.setAttr('foo', 'bar').end();
  root.end();
});
