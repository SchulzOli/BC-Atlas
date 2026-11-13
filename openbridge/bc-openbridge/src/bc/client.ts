/**
 * Resilient HTTP client for the Business Central API (OData v4).
 *
 *  - OAuth 2.0 client credentials (see token.ts), automatic token refresh on 401
 *  - Timeouts, retries with exponential backoff + jitter, honours Retry-After
 *    (BC throttles with 429 – see "Working with API limits in Business Central")
 *  - Read requests use `Data-Access-Intent: ReadOnly` → served by BC read replicas
 *  - Server-driven paging via `Prefer: odata.maxpagesize`
 *  - Optimistic concurrency via ETag / If-Match
 *  - Upstream errors are mapped to RFC 9457 problems without leaking internals
 */
import { HttpError, PROBLEM } from '../http/problem.ts';
import { logger } from '../observability/log.ts';
import type { Metrics } from '../observability/metrics.ts';
import { formatTraceparent, type TraceContext } from '../observability/trace.ts';
import { TokenError, type TokenProvider } from './token.ts';

export interface BcClientOptions {
  apiBase: string;
  tenantId: string;
  environment: string;
  tokens: TokenProvider;
  metrics?: Metrics;
  timeoutMs?: number;
  maxRetries?: number;
  retryBaseMs?: number;
  fetchImpl?: typeof fetch;
}

export interface BcRequestOptions {
  body?: unknown;
  ifMatch?: string;
  maxPageSize?: number;
  trace?: TraceContext;
  /** label for metrics */
  op?: string;
}

export interface BcResult<T = unknown> {
  status: number;
  body: T;
  etag?: string;
  headers: Headers;
}

export interface ODataCollection<T = Record<string, unknown>> {
  value: T[];
  '@odata.nextLink'?: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class BcClient {
  readonly #o: Required<Omit<BcClientOptions, 'metrics' | 'fetchImpl'>> & Pick<BcClientOptions, 'metrics'>;
  readonly #fetch: typeof fetch;

  constructor(o: BcClientOptions) {
    this.#o = { timeoutMs: 30_000, maxRetries: 4, retryBaseMs: 500, ...o };
    this.#fetch = o.fetchImpl ?? fetch;
  }

  /** e.g. https://api.businesscentral.dynamics.com/v2.0/<tenant>/<env>/api */
  get root(): string {
    const { apiBase, tenantId, environment } = this.#o;
    return `${apiBase.replace(/\/$/, '')}/v2.0/${encodeURIComponent(tenantId)}/${encodeURIComponent(environment)}/api`;
  }

  url(apiRoute: string, path: string, query: Record<string, string | undefined> = {}): string {
    const qs = Object.entries(query)
      .filter(([, v]) => v !== undefined && v !== '')
      .map(([k, v]) => `${k}=${encodeURIComponent(v!)}`)
      .join('&');
    return `${this.root}/${apiRoute}/${path}${qs ? `?${qs}` : ''}`;
  }

  /** True if `url` points to the given collection of this BC environment (used to validate next links). */
  isCollectionUrl(url: string, apiRoute: string, path: string): boolean {
    try {
      const u = new URL(url);
      const expected = new URL(`${this.root}/${apiRoute}/${path}`);
      return u.origin === expected.origin && decodeURIComponent(u.pathname) === decodeURIComponent(expected.pathname);
    } catch {
      return false;
    }
  }

  async request<T = unknown>(method: string, url: string, opts: BcRequestOptions = {}): Promise<BcResult<T>> {
    const isRead = method === 'GET';
    let refreshed = false;
    for (let attempt = 0; ; attempt++) {
      const started = performance.now();
      let res: Response;
      try {
        const token = await this.#o.tokens.getToken();
        const headers: Record<string, string> = {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
          'User-Agent': 'bc-openbridge/0.1',
        };
        if (opts.trace) headers.traceparent = formatTraceparent(opts.trace);
        if (isRead) headers['Data-Access-Intent'] = 'ReadOnly';
        if (opts.maxPageSize) headers.Prefer = `odata.maxpagesize=${opts.maxPageSize}`;
        if (opts.ifMatch) headers['If-Match'] = opts.ifMatch;
        if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
        res = await this.#fetch(url, {
          method,
          headers,
          body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
          signal: AbortSignal.timeout(this.#o.timeoutMs),
          redirect: 'error',
        });
      } catch (err) {
        this.#observe(opts.op ?? method, 'network', started);
        if (err instanceof TokenError) {
          throw new HttpError(502, 'Bad Gateway', 'Could not authenticate against Business Central.', {
            type: PROBLEM('upstream-auth'),
          });
        }
        if (isRead && attempt < this.#o.maxRetries) {
          await sleep(this.#backoff(attempt));
          continue;
        }
        const timeout = (err as Error).name === 'TimeoutError';
        logger.warn('BC request failed', { method, err, timeout });
        throw new HttpError(timeout ? 504 : 502, timeout ? 'Gateway Timeout' : 'Bad Gateway', 'Business Central is not reachable.', {
          type: PROBLEM('upstream-unavailable'),
        });
      }
      this.#observe(opts.op ?? method, String(res.status), started);

      if (res.status === 401 && !refreshed) {
        refreshed = true;
        this.#o.tokens.invalidate();
        continue;
      }
      const retryable = res.status === 429 || (isRead && (res.status === 502 || res.status === 503 || res.status === 504));
      if (retryable && attempt < this.#o.maxRetries) {
        const ra = Number(res.headers.get('retry-after'));
        await res.body?.cancel();
        await sleep(Number.isFinite(ra) && ra > 0 ? Math.min(ra, 30) * 1000 : this.#backoff(attempt));
        continue;
      }

      const text = await res.text();
      let body: unknown = null;
      if (text && (res.headers.get('content-type') ?? '').includes('json')) {
        try {
          body = JSON.parse(text);
        } catch {
          body = null;
        }
      }
      if (!res.ok) throw mapBcError(res.status, body, res.headers.get('retry-after'));
      const etag = res.headers.get('etag') ?? (body as Record<string, string> | null)?.['@odata.etag'] ?? undefined;
      return { status: res.status, body: body as T, etag, headers: res.headers };
    }
  }

  #backoff(attempt: number): number {
    const exp = Math.min(8000, this.#o.retryBaseMs * 2 ** attempt);
    return exp / 2 + Math.random() * (exp / 2);
  }

  #observe(op: string, status: string, started: number): void {
    this.#o.metrics?.bcRequests.inc({ op, status });
    this.#o.metrics?.bcDuration.observe({ op }, (performance.now() - started) / 1000);
  }
}

export function mapBcError(status: number, body: unknown, retryAfter?: string | null): HttpError {
  const err = (body as { error?: { code?: string; message?: string } } | null)?.error;
  const code = err?.code;
  const message = err?.message?.slice(0, 1000);
  const extras = code ? { upstreamCode: code } : {};
  if (status === 400 || status === 422) {
    return new HttpError(400, 'Rejected by Business Central', message, { type: PROBLEM('upstream-validation'), extras });
  }
  if (status === 401 || status === 403) {
    logger.error('Business Central denied the gateway service principal', { status, code, message });
    return new HttpError(502, 'Bad Gateway', 'The gateway is not authorized in Business Central.', {
      type: PROBLEM('upstream-auth'),
      extras,
    });
  }
  if (status === 404) return new HttpError(404, 'Not Found', message ?? 'Resource not found.', { type: PROBLEM('not-found'), extras });
  if (status === 412 || (status === 409 && /EntityChanged/i.test(code ?? ''))) {
    return new HttpError(412, 'Precondition Failed', 'The record was changed by someone else. Reload it and retry with the new ETag.', {
      type: PROBLEM('etag-mismatch'),
      extras,
    });
  }
  if (status === 409) return new HttpError(409, 'Conflict', message, { type: PROBLEM('conflict'), extras });
  if (status === 429) {
    return new HttpError(429, 'Too Many Requests', 'Business Central is throttling requests.', {
      type: PROBLEM('upstream-throttled'),
      headers: { 'Retry-After': retryAfter ?? '5' },
    });
  }
  logger.error('Business Central server error', { status, code, message });
  return new HttpError(status === 503 ? 503 : 502, status === 503 ? 'Service Unavailable' : 'Bad Gateway', 'Business Central returned an error.', {
    type: PROBLEM('upstream-error'),
    extras,
  });
}
