/**
 * Thin client for the BC OpenBridge gateway.
 *
 * bc-mcp deliberately has no access to Business Central of its own: every
 * call goes through the gateway, so its scopes, validation, rate limits and
 * audit trail apply to the AI agent exactly like to any other client.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export type Rec = Record<string, unknown>;

export interface GatewayOptions {
  baseUrl: string;
  apiKey?: string;
  /** read on every request, so a rotated key (e.g. dev:mock restart) is picked up */
  apiKeyFile?: string;
  timeoutMs?: number;
}

export interface Problem {
  type?: string;
  title?: string;
  status?: number;
  detail?: string;
  errors?: { field: string; message: string }[];
  upstreamCode?: string;
  traceId?: string;
}

export class GatewayError extends Error {
  readonly status: number;
  readonly problem: Problem;
  constructor(status: number, problem: Problem) {
    super(`${problem.title ?? 'Gateway error'} (${status})${problem.detail ? `: ${problem.detail}` : ''}`);
    this.status = status;
    this.problem = problem;
  }
}

export type Query = Array<[string, string | number | boolean | undefined]>;

export interface GatewayResponse<T = Rec> {
  status: number;
  body: T;
  etag?: string;
}

export class Gateway {
  readonly baseUrl: string;
  readonly #o: GatewayOptions;

  constructor(o: GatewayOptions) {
    const u = new URL(o.baseUrl);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
    if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) {
      throw new Error(`OPENBRIDGE_URL must use https (http is only allowed for localhost): ${u.origin}`);
    }
    this.baseUrl = u.origin + u.pathname.replace(/\/$/, '');
    this.#o = o;
  }

  #key(): string {
    if (this.#o.apiKey) return this.#o.apiKey;
    if (this.#o.apiKeyFile) {
      try {
        return readFileSync(resolve(this.#o.apiKeyFile), 'utf8').trim();
      } catch {
        throw new Error(`API key file not readable: ${this.#o.apiKeyFile}. Is the gateway (npm run dev:mock) running?`);
      }
    }
    throw new Error('No credentials: set OPENBRIDGE_API_KEY or OPENBRIDGE_API_KEY_FILE.');
  }

  async request<T = Rec>(
    method: string,
    path: string,
    o: { query?: Query; body?: unknown; headers?: Record<string, string> } = {},
  ): Promise<GatewayResponse<T>> {
    const qs = new URLSearchParams();
    for (const [k, v] of o.query ?? []) if (v !== undefined && v !== '') qs.append(k, String(v));
    const url = `${this.baseUrl}${path}${qs.size ? `?${qs}` : ''}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.#key()}`,
      Accept: 'application/json',
      'User-Agent': 'bc-mcp/0.1',
      ...o.headers,
    };
    if (o.body !== undefined) headers['Content-Type'] = 'application/json';
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers,
        body: o.body !== undefined ? JSON.stringify(o.body) : undefined,
        signal: AbortSignal.timeout(this.#o.timeoutMs ?? 60_000),
        redirect: 'error',
      });
    } catch (e) {
      throw new GatewayError(0, { title: 'Gateway not reachable', detail: `${this.baseUrl} – ${(e as Error).message}` });
    }
    const text = await res.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    if (!res.ok) throw new GatewayError(res.status, (body && typeof body === 'object' ? body : { title: res.statusText }) as Problem);
    return { status: res.status, body: body as T, etag: res.headers.get('etag') ?? undefined };
  }

  get<T = Rec>(path: string, query?: Query) {
    return this.request<T>('GET', path, { query });
  }
}
