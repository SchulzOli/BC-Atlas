import type { IncomingMessage, ServerResponse } from 'node:http';
import { HttpError, PROBLEM, errors } from './problem.ts';

/** Read the raw request body while enforcing a hard size limit. */
export async function readBody(req: IncomingMessage, limitBytes: number): Promise<Buffer> {
  const declared = Number(req.headers['content-length'] ?? 0);
  if (declared > limitBytes) throw tooLarge(limitBytes);
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limitBytes) {
      req.destroy();
      throw tooLarge(limitBytes);
    }
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

function tooLarge(limit: number): HttpError {
  return new HttpError(413, 'Content Too Large', `Request body exceeds ${limit} bytes.`, { type: PROBLEM('too-large') });
}

export function mediaType(req: IncomingMessage): string {
  return String(req.headers['content-type'] ?? '')
    .split(';')[0]
    .trim()
    .toLowerCase();
}

/** Parse a JSON body. Only the listed media types are accepted (defence against CSRF via text/plain forms). */
export async function readJson(
  req: IncomingMessage,
  limitBytes: number,
  accepted: string[] = ['application/json'],
): Promise<unknown> {
  const type = mediaType(req);
  if (!accepted.includes(type)) throw errors.unsupportedMediaType(accepted);
  const raw = await readBody(req, limitBytes);
  if (raw.length === 0) throw errors.badRequest('Request body is empty.');
  try {
    return JSON.parse(raw.toString('utf8'));
  } catch {
    throw errors.badRequest('Request body is not valid JSON.');
  }
}

export function send(
  res: ServerResponse,
  status: number,
  body?: unknown,
  headers: Record<string, string> = {},
  contentType = 'application/json; charset=utf-8',
): void {
  if (res.headersSent) return;
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  if (body === undefined || status === 204 || status === 304) {
    res.writeHead(status);
    res.end();
    return;
  }
  const payload = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Length', Buffer.byteLength(payload));
  res.writeHead(status);
  res.end(payload);
}

export function sendProblem(res: ServerResponse, err: HttpError, instance?: string, traceId?: string): void {
  send(
    res,
    err.status,
    { ...err.toProblem(instance), ...(traceId ? { traceId } : {}) },
    err.headers,
    'application/problem+json; charset=utf-8',
  );
}

/** Baseline security headers (OWASP Secure Headers Project) for a pure JSON API. */
export function applySecurityHeaders(res: ServerResponse, hsts: boolean): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Cache-Control', 'no-store');
  if (hsts) res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains');
}
