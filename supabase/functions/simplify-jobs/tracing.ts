/**
 * Lightweight OpenTelemetry-compatible tracing for the simplify-jobs worker.
 *
 * - Parses incoming W3C `traceparent` (and optional `tracestate`) headers; if
 *   absent, mints a fresh trace + root span.
 * - Exposes a `Span` API with `child()`, `event()`, `setAttr()`, `end()`.
 * - Emits structured JSON log lines (one per span/event) on stdout so they can
 *   be picked up by any OTLP-compatible log/trace shipper.
 * - Returns headers that should be merged into every HTTP response so callers
 *   can correlate their request with our server-side trace.
 *
 * Format reference: https://www.w3.org/TR/trace-context/
 */

const VERSION = '00';
const FLAG_SAMPLED = 0x01;

const HEX = '0123456789abcdef';
function randHex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  let out = '';
  for (let i = 0; i < buf.length; i++) {
    out += HEX[(buf[i] >> 4) & 0xf] + HEX[buf[i] & 0xf];
  }
  return out;
}

export function newTraceId(): string {
  // 16-byte trace id, never all-zero.
  let id = randHex(16);
  if (/^0+$/.test(id)) id = id.slice(0, -1) + '1';
  return id;
}
export function newSpanId(): string {
  let id = randHex(8);
  if (/^0+$/.test(id)) id = id.slice(0, -1) + '1';
  return id;
}

export interface TraceContext {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  sampled: boolean;
  traceState?: string;
}

/** Parse a `traceparent` header (returns null on any malformed input). */
export function parseTraceparent(header: string | null): TraceContext | null {
  if (!header) return null;
  const parts = header.trim().split('-');
  if (parts.length !== 4) return null;
  const [version, traceId, parentSpanId, flags] = parts;
  if (version !== VERSION) return null;
  if (!/^[0-9a-f]{32}$/.test(traceId) || /^0+$/.test(traceId)) return null;
  if (!/^[0-9a-f]{16}$/.test(parentSpanId) || /^0+$/.test(parentSpanId)) return null;
  if (!/^[0-9a-f]{2}$/.test(flags)) return null;
  const sampled = (parseInt(flags, 16) & FLAG_SAMPLED) === FLAG_SAMPLED;
  return { traceId, spanId: newSpanId(), parentSpanId, sampled };
}

export function formatTraceparent(ctx: TraceContext): string {
  const flags = (ctx.sampled ? FLAG_SAMPLED : 0).toString(16).padStart(2, '0');
  return `${VERSION}-${ctx.traceId}-${ctx.spanId}-${flags}`;
}

export type SpanStatus = 'ok' | 'error';

export class Span {
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId?: string;
  readonly name: string;
  readonly startMs: number;
  readonly attrs: Record<string, unknown> = {};
  private ended = false;
  private status: SpanStatus = 'ok';
  private statusMsg?: string;

  constructor(name: string, ctx: TraceContext) {
    this.name = name;
    this.traceId = ctx.traceId;
    this.spanId = ctx.spanId;
    this.parentSpanId = ctx.parentSpanId;
    this.startMs = Date.now();
  }

  setAttr(k: string, v: unknown): this {
    this.attrs[k] = v;
    return this;
  }
  setAttrs(obj: Record<string, unknown>): this {
    Object.assign(this.attrs, obj);
    return this;
  }
  setStatus(status: SpanStatus, message?: string): this {
    this.status = status;
    this.statusMsg = message;
    return this;
  }

  /** Emit an in-span event log line, correlated by trace + span id. */
  event(name: string, attrs: Record<string, unknown> = {}, level: 'info' | 'warn' | 'error' = 'info'): void {
    log(level, name, { ...attrs, trace_id: this.traceId, span_id: this.spanId, span_name: this.name });
  }

  /** Create a child span that inherits trace id / sampled flag. */
  child(name: string): Span {
    return new Span(name, {
      traceId: this.traceId,
      spanId: newSpanId(),
      parentSpanId: this.spanId,
      sampled: true,
    });
  }

  end(): void {
    if (this.ended) return;
    this.ended = true;
    const durationMs = Date.now() - this.startMs;
    log(this.status === 'error' ? 'error' : 'info', 'span.end', {
      trace_id: this.traceId,
      span_id: this.spanId,
      parent_span_id: this.parentSpanId,
      span_name: this.name,
      duration_ms: durationMs,
      status: this.status,
      status_message: this.statusMsg,
      attrs: this.attrs,
    });
  }
}

/** Start (or continue) a trace from an incoming Request. */
export function startSpanFromRequest(req: Request, name: string): Span {
  const incoming = parseTraceparent(req.headers.get('traceparent'));
  const ctx: TraceContext = incoming ?? {
    traceId: newTraceId(),
    spanId: newSpanId(),
    sampled: true,
  };
  const tracestate = req.headers.get('tracestate');
  if (tracestate) ctx.traceState = tracestate;
  const span = new Span(name, ctx);
  span.setAttrs({
    'http.method': req.method,
    'http.url': req.url,
    'http.user_agent': req.headers.get('user-agent') ?? undefined,
  });
  return span;
}

/** Headers to merge into responses so clients can correlate. */
export function traceResponseHeaders(span: Span, sampled = true): Record<string, string> {
  const traceparent = formatTraceparent({
    traceId: span.traceId,
    spanId: span.spanId,
    parentSpanId: span.parentSpanId,
    sampled,
  });
  return {
    traceparent,
    'x-trace-id': span.traceId,
    'x-span-id': span.spanId,
  };
}

/** Structured JSON log writer (newline-delimited). */
export function log(
  level: 'debug' | 'info' | 'warn' | 'error',
  msg: string,
  fields: Record<string, unknown> = {},
): void {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    msg,
    ...fields,
  });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}
