import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Principal } from '../security/principal.ts';
import type { TraceContext } from '../observability/trace.ts';
import { errors } from './problem.ts';

export interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  method: string;
  params: Record<string, string>;
  requestId: string;
  trace: TraceContext;
  clientIp: string;
  principal?: Principal;
  /** Route pattern – used as low-cardinality metric label. */
  route: string;
}

export type Handler = (ctx: Ctx) => Promise<void>;

export interface RouteOptions {
  /** Require an authenticated principal (default: true). */
  auth?: boolean;
}

interface Route {
  method: string;
  pattern: string;
  regex: RegExp;
  keys: string[];
  handler: Handler;
  auth: boolean;
}

export type Match =
  | { kind: 'ok'; route: Route; params: Record<string, string> }
  | { kind: 'method'; allow: string[] }
  | { kind: 'none' };

export class Router {
  readonly #routes: Route[] = [];

  on(method: string, pattern: string, handler: Handler, opts: RouteOptions = {}): this {
    const keys: string[] = [];
    const source = pattern
      .split('/')
      .map((seg) => {
        if (seg.startsWith(':')) {
          keys.push(seg.slice(1));
          return '([^/]+)';
        }
        return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      })
      .join('/');
    this.#routes.push({
      method: method.toUpperCase(),
      pattern,
      regex: new RegExp(`^${source}/?$`),
      keys,
      handler,
      auth: opts.auth ?? true,
    });
    return this;
  }

  match(method: string, pathname: string): Match {
    const allow = new Set<string>();
    for (const route of this.#routes) {
      const m = route.regex.exec(pathname);
      if (!m) continue;
      if (route.method !== method) {
        allow.add(route.method);
        continue;
      }
      const params: Record<string, string> = {};
      route.keys.forEach((k, i) => {
        try {
          params[k] = decodeURIComponent(m[i + 1]);
        } catch {
          throw errors.badRequest(`Malformed path segment for "${k}".`);
        }
      });
      return { kind: 'ok', route, params };
    }
    return allow.size ? { kind: 'method', allow: [...allow] } : { kind: 'none' };
  }
}
