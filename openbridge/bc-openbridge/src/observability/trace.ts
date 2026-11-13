/**
 * W3C Trace Context (https://www.w3.org/TR/trace-context/) – minimal implementation.
 * Incoming `traceparent` headers are continued, otherwise a new trace is started.
 * The context is propagated to Business Central and into emitted CloudEvents
 * (CloudEvents Distributed Tracing extension).
 */
import { randomBytes } from 'node:crypto';

export interface TraceContext {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  sampled: boolean;
}

const TRACEPARENT = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/;

export function parseTraceparent(header: string | undefined): { traceId: string; parentId: string; flags: number } | null {
  if (!header) return null;
  const m = TRACEPARENT.exec(header.trim().toLowerCase());
  if (!m) return null;
  const [, traceId, parentId, flags] = m;
  if (/^0+$/.test(traceId) || /^0+$/.test(parentId)) return null;
  return { traceId, parentId, flags: parseInt(flags, 16) };
}

export function startTrace(incoming?: string): TraceContext {
  const parent = parseTraceparent(incoming);
  const spanId = randomBytes(8).toString('hex');
  if (parent) {
    return { traceId: parent.traceId, spanId, parentSpanId: parent.parentId, sampled: (parent.flags & 1) === 1 };
  }
  return { traceId: randomBytes(16).toString('hex'), spanId, sampled: true };
}

export function formatTraceparent(t: TraceContext): string {
  return `00-${t.traceId}-${t.spanId}-${t.sampled ? '01' : '00'}`;
}
