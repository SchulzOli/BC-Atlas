/**
 * Application assembly: request pipeline + routes.
 *
 * Pipeline per request:
 *   trace context → security headers → CORS → IP rate limit → routing →
 *   authentication → principal rate limit → handler → RFC 9457 errors →
 *   access log + metrics
 */
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { BcService, type CallContext } from './api/service.ts';
import { BcClient } from './bc/client.ts';
import { selectEntities } from './bc/entities.ts';
import { parseListQuery } from './bc/odata.ts';
import { TokenProvider } from './bc/token.ts';
import type { Config } from './config.ts';
import { BcSubscriptionManager } from './events/bc-subscriptions.ts';
import { EventBus } from './events/bus.ts';
import { toCloudEvent, type BcNotification } from './events/cloudevents.ts';
import { IdempotencyStore } from './http/idempotency.ts';
import { applySecurityHeaders, readJson, send, sendProblem } from './http/io.ts';
import { HttpError, PROBLEM, errors } from './http/problem.ts';
import { Router, type Ctx } from './http/router.ts';
import { McpServer, SUPPORTED_PROTOCOL_VERSIONS } from './mcp/server.ts';
import { logger } from './observability/log.ts';
import { Metrics } from './observability/metrics.ts';
import { formatTraceparent, startTrace } from './observability/trace.ts';
import { ApiKeyStore } from './security/apikeys.ts';
import { AuditLog } from './security/audit.ts';
import { Authenticator } from './security/auth.ts';
import { CursorCodec } from './security/cursor.ts';
import { JwtVerifier } from './security/jwt.ts';
import { KNOWN_SCOPES, canAccessEntity, requireScope, type Principal } from './security/principal.ts';
import { RateLimiter, rateLimitHeaders } from './security/ratelimit.ts';
import { buildAsyncApi } from './spec/asyncapi.ts';
import { buildOpenApi } from './spec/openapi.ts';
import { VERSION } from './version.ts';

export interface AppOverrides {
  /** fetch used for Business Central + Entra ID (tests/mocks) */
  bcFetch?: typeof fetch;
  /** fetch used for OIDC discovery/JWKS */
  oidcFetch?: typeof fetch;
  /** fetch used for outbound webhooks */
  webhookFetch?: typeof fetch;
}

export interface App {
  server: Server;
  config: Config;
  bus: EventBus;
  subscriptions: BcSubscriptionManager;
  audit: AuditLog;
  metrics: Metrics;
  service: BcService;
  listen(): Promise<string>;
  close(): Promise<void>;
}

const CORS_HEADERS = 'Authorization, Content-Type, If-Match, If-None-Match, Idempotency-Key, X-API-Key, traceparent, MCP-Protocol-Version';
const EXPOSE_HEADERS = 'ETag, Location, Link, Retry-After, RateLimit-Limit, RateLimit-Remaining, RateLimit-Reset, X-Request-Id, Idempotent-Replayed';

function safeEqual(a: unknown, b: string): boolean {
  if (typeof a !== 'string') return false;
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function createApp(config: Config, o: AppOverrides = {}): App {
  const metrics = new Metrics();
  const audit = new AuditLog(config.audit.file);
  const entities = selectEntities(config.bc.entities);

  const tokens = new TokenProvider({
    authBase: config.bc.authBase,
    tenantId: config.bc.tenantId,
    clientId: config.bc.clientId,
    clientSecret: config.bc.clientSecret,
    certificatePem: config.bc.certificatePem,
    privateKeyPem: config.bc.privateKeyPem,
    scope: config.bc.scope,
    fetchImpl: o.bcFetch,
  });
  const bc = new BcClient({
    apiBase: config.bc.apiBase,
    tenantId: config.bc.tenantId,
    environment: config.bc.environment,
    tokens,
    metrics,
    timeoutMs: config.bc.timeoutMs,
    maxRetries: config.bc.maxRetries,
    fetchImpl: o.bcFetch,
  });

  const service = new BcService({
    bc,
    entities,
    allowedCompanies: config.bc.allowedCompanies,
    audit,
    cursors: new CursorCodec(config.cursorSecret),
    logReads: config.audit.logReads,
  });

  const resourceMetadataUrl = config.oidc ? `${config.publicBaseUrl}/.well-known/oauth-protected-resource` : undefined;
  const authenticator = new Authenticator({
    apiKeys: new ApiKeyStore(config.apiKeys),
    resourceMetadataUrl,
    verifier: config.oidc
      ? new JwtVerifier({
          issuer: config.oidc.issuer,
          audience: config.oidc.audience,
          jwksUri: config.oidc.jwksUri,
          allowInsecure: config.oidc.allowInsecure,
          fetchImpl: o.oidcFetch,
        })
      : undefined,
  });

  const bus = new EventBus({
    subscribers: config.subscribers,
    policy: { allowHttp: config.outbound.allowHttp, allowPrivate: config.outbound.allowPrivate },
    retryDelaysMs: config.outbound.retryDelaysMs,
    metrics,
    fetchImpl: o.webhookFetch,
  });

  const subscriptions = new BcSubscriptionManager({
    bc,
    entities,
    notificationUrl: `${config.publicBaseUrl}/webhooks/bc`,
    clientState: config.webhookClientState,
    subscribe: config.bc.subscribe,
    allowedCompanies: config.bc.allowedCompanies,
    renewIntervalMs: config.bc.subscriptionRenewMs,
  });

  const mcp = new McpServer(service, VERSION);
  const idempotency = new IdempotencyStore();
  const ipLimiter = new RateLimiter(config.rateLimit.perIpRpm, Math.max(20, Math.ceil(config.rateLimit.perIpRpm / 6)));
  const principalLimiter = new RateLimiter(config.rateLimit.perPrincipalRpm, config.rateLimit.burst);
  const sweeper = setInterval(() => {
    ipLimiter.sweep();
    principalLimiter.sweep();
  }, 60_000);
  sweeper.unref();

  let openapi: unknown;
  let asyncapi: unknown;
  const callCtx = (ctx: Ctx, channel: CallContext['channel']): CallContext => ({
    principal: ctx.principal!,
    trace: ctx.trace,
    ip: ctx.clientIp,
    channel,
  });

  // ---------------------------------------------------------------- routes
  const r = new Router();

  r.on('GET', '/healthz', async (ctx) => send(ctx.res, 200, { status: 'ok', version: VERSION }), { auth: false });

  r.on(
    'GET',
    '/readyz',
    async (ctx) => {
      try {
        await tokens.getToken();
        send(ctx.res, 200, { status: 'ready' });
      } catch {
        throw new HttpError(503, 'Service Unavailable', 'Cannot obtain a Business Central token.', { type: PROBLEM('not-ready') });
      }
    },
    { auth: false },
  );

  r.on(
    'GET',
    '/openapi.json',
    async (ctx) => {
      openapi ??= buildOpenApi({
        entities,
        publicBaseUrl: config.publicBaseUrl,
        version: VERSION,
        oidcIssuer: config.oidc?.issuer,
        mcpEnabled: config.mcp.enabled,
      });
      send(ctx.res, 200, openapi, { 'Cache-Control': 'public, max-age=300' }, 'application/vnd.oai.openapi+json; charset=utf-8');
    },
    { auth: false },
  );

  r.on(
    'GET',
    '/asyncapi.json',
    async (ctx) => {
      asyncapi ??= buildAsyncApi({ entities, version: VERSION, typePrefix: config.eventTypePrefix });
      send(ctx.res, 200, asyncapi, { 'Cache-Control': 'public, max-age=300' });
    },
    { auth: false },
  );

  // RFC 9728 – OAuth 2.0 Protected Resource Metadata (also used by MCP clients)
  if (config.oidc) {
    const prm = async (ctx: Ctx) =>
      send(
        ctx.res,
        200,
        {
          resource: config.publicBaseUrl,
          authorization_servers: [config.oidc!.issuer],
          scopes_supported: [...KNOWN_SCOPES, ...Object.keys(entities).flatMap((e) => [`bc.${e}.read`, `bc.${e}.write`])],
          bearer_methods_supported: ['header'],
          resource_name: 'BC OpenBridge',
          resource_documentation: `${config.publicBaseUrl}/openapi.json`,
        },
        { 'Cache-Control': 'public, max-age=3600' },
      );
    r.on('GET', '/.well-known/oauth-protected-resource', prm, { auth: false });
    r.on('GET', '/.well-known/oauth-protected-resource/mcp', prm, { auth: false });
  }

  r.on(
    'GET',
    '/metrics',
    async (ctx) => {
      if (!config.metricsPublic) requireScope(ctx.principal!, 'metrics.read');
      send(ctx.res, 200, metrics.render(), {}, 'text/plain; version=0.0.4; charset=utf-8');
    },
    { auth: !config.metricsPublic },
  );

  r.on('GET', '/v1/entities', async (ctx) => {
    const p = ctx.principal!;
    send(ctx.res, 200, {
      data: Object.values(entities).map((e) => ({
        name: e.name,
        description: e.description,
        operations: e.operations,
        requiresExtension: !!e.requiresExtension,
        webhooks: !!e.webhooks,
        access: { read: canAccessEntity(p, e.name, 'read'), write: canAccessEntity(p, e.name, 'write'), delete: canAccessEntity(p, e.name, 'delete') },
        fields: e.fields,
      })),
    });
  });

  r.on('GET', '/v1/companies', async (ctx) => {
    send(ctx.res, 200, { data: await service.listCompanies(callCtx(ctx, 'rest')) });
  });

  r.on('GET', '/v1/companies/:companyId/:entity', async (ctx) => {
    const { companyId, entity } = ctx.params;
    const q = parseListQuery(ctx.url.searchParams);
    const result = await service.list(callCtx(ctx, 'rest'), entity, companyId, q);
    const next = result.nextCursor
      ? `${config.publicBaseUrl}/v1/companies/${companyId}/${entity}?limit=${q.limit}&cursor=${encodeURIComponent(result.nextCursor)}`
      : undefined;
    send(
      ctx.res,
      200,
      { data: result.data, page: { limit: q.limit, ...(result.nextCursor ? { nextCursor: result.nextCursor } : {}) }, links: next ? { next } : {} },
      next ? { Link: `<${next}>; rel="next"` } : {},
    );
  });

  r.on('POST', '/v1/companies/:companyId/:entity', async (ctx) => {
    const { companyId, entity } = ctx.params;
    const p = ctx.principal!;
    const body = await readJson(ctx.req, config.bodyLimitBytes);
    const key = ctx.req.headers['idempotency-key'];
    const idemKey = typeof key === 'string' ? key : undefined;
    if (idemKey) {
      const replay = idempotency.begin(p.id, idemKey, IdempotencyStore.fingerprint([companyId.toLowerCase(), entity, body]));
      if (replay) return send(ctx.res, replay.status, replay.body, { ...replay.headers, 'Idempotent-Replayed': 'true' });
    }
    try {
      const { record, etag } = await service.create(callCtx(ctx, 'rest'), entity, companyId, body);
      const headers: Record<string, string> = {
        Location: `${config.publicBaseUrl}/v1/companies/${companyId}/${entity}/${String(record.id)}`,
        ...(etag ? { ETag: etag } : {}),
      };
      if (idemKey) idempotency.complete(p.id, idemKey, { status: 201, headers, body: record });
      send(ctx.res, 201, record, headers);
    } catch (e) {
      if (idemKey) idempotency.release(p.id, idemKey);
      throw e;
    }
  });

  r.on('GET', '/v1/companies/:companyId/:entity/:id', async (ctx) => {
    const { companyId, entity, id } = ctx.params;
    const { record, etag } = await service.get(callCtx(ctx, 'rest'), entity, companyId, id);
    if (etag && ctx.req.headers['if-none-match'] === etag) return send(ctx.res, 304, undefined, { ETag: etag });
    send(ctx.res, 200, record, etag ? { ETag: etag } : {});
  });

  r.on('PATCH', '/v1/companies/:companyId/:entity/:id', async (ctx) => {
    const { companyId, entity, id } = ctx.params;
    const ifMatch = ctx.req.headers['if-match'];
    if (!ifMatch) throw errors.preconditionRequired();
    const body = await readJson(ctx.req, config.bodyLimitBytes, ['application/json', 'application/merge-patch+json']);
    const { record, etag } = await service.update(callCtx(ctx, 'rest'), entity, companyId, id, ifMatch, body);
    send(ctx.res, 200, record, etag ? { ETag: etag } : {});
  });

  r.on('DELETE', '/v1/companies/:companyId/:entity/:id', async (ctx) => {
    const { companyId, entity, id } = ctx.params;
    const ifMatch = ctx.req.headers['if-match'];
    if (!ifMatch) throw errors.preconditionRequired();
    await service.remove(callCtx(ctx, 'rest'), entity, companyId, id, ifMatch);
    send(ctx.res, 204);
  });

  r.on('GET', '/v1/events', async (ctx) => {
    const p = ctx.principal!;
    requireScope(p, 'events.read');
    const after = Number(ctx.url.searchParams.get('after') ?? 0);
    const limit = Number(ctx.url.searchParams.get('limit') ?? 100);
    if (!Number.isInteger(after) || after < 0) throw errors.validation([{ field: 'after', message: 'must be a non-negative integer' }]);
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw errors.validation([{ field: 'limit', message: 'must be 1-500' }]);
    const raw = bus.feed(after, limit);
    const data = raw.filter((e) => canAccessEntity(p, String((e.event.data as { entitySet?: string })?.entitySet), 'read'));
    send(ctx.res, 200, { data, next: raw.at(-1)?.seq ?? after });
  });

  // Business Central → gateway webhook receiver
  r.on(
    'POST',
    '/webhooks/bc',
    async (ctx) => {
      const token = ctx.url.searchParams.get('validationToken');
      if (token !== null) {
        if (!/^[\x20-\x7e]{1,2048}$/.test(token)) throw errors.badRequest('Invalid validationToken.');
        return send(ctx.res, 200, token, {}, 'text/plain; charset=utf-8');
      }
      const body = (await readJson(ctx.req, 4 * 1024 * 1024)) as { value?: BcNotification[] };
      if (!Array.isArray(body?.value)) throw errors.badRequest('Expected { "value": [...] }.');
      let accepted = 0;
      let duplicates = 0;
      let rejected = 0;
      for (const n of body.value) {
        if (!n || !safeEqual(n.clientState, config.webhookClientState)) {
          rejected++;
          continue;
        }
        const ev = toCloudEvent(n, {
          typePrefix: config.eventTypePrefix,
          environment: config.bc.environment,
          publicBaseUrl: config.publicBaseUrl,
          trace: ctx.trace,
        });
        const data = ev?.data;
        if (
          !ev ||
          !data ||
          !Object.hasOwn(entities, data.entitySet) ||
          (config.bc.allowedCompanies.length > 0 && !config.bc.allowedCompanies.includes(data.companyId))
        ) {
          rejected++;
          continue;
        }
        metrics.eventsReceived.inc({ entity: data.entitySet, changeType: data.changeType });
        if (bus.publish(ev)) accepted++;
        else duplicates++;
      }
      if (rejected > 0 && accepted + duplicates === 0) {
        audit.record({ action: 'webhook.bc.receive', outcome: 'denied', ip: ctx.clientIp, status: 401, details: { rejected } });
        throw new HttpError(401, 'Unauthorized', 'Notification clientState mismatch.', { type: PROBLEM('webhook-auth') });
      }
      send(ctx.res, 202, { accepted, duplicates, rejected });
    },
    { auth: false },
  );

  if (config.mcp.enabled) {
    r.on('POST', '/mcp', async (ctx) => {
      requireScope(ctx.principal!, 'mcp.use');
      const pv = ctx.req.headers['mcp-protocol-version'];
      if (typeof pv === 'string' && !SUPPORTED_PROTOCOL_VERSIONS.includes(pv)) {
        throw errors.badRequest(`Unsupported MCP-Protocol-Version. Supported: ${SUPPORTED_PROTOCOL_VERSIONS.join(', ')}`);
      }
      const accept = String(ctx.req.headers.accept ?? '*/*');
      if (!/application\/json|\*\/\*/.test(accept)) throw new HttpError(406, 'Not Acceptable', 'Accept must include application/json.');
      let message: unknown;
      try {
        message = await readJson(ctx.req, config.bodyLimitBytes);
      } catch (e) {
        if (e instanceof HttpError && e.status === 400) {
          return send(ctx.res, 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
        }
        throw e;
      }
      const reply = await mcp.handle(message, callCtx(ctx, 'mcp'));
      send(ctx.res, reply.status, reply.body);
    });
  }

  // admin
  r.on('GET', '/admin/subscriptions', async (ctx) => {
    requireScope(ctx.principal!, 'admin');
    send(ctx.res, 200, { enabled: subscriptions.enabled, lastSync: subscriptions.lastReport ?? null, subscriptions: subscriptions.enabled ? await subscriptions.list() : [] });
  });
  r.on('POST', '/admin/subscriptions/sync', async (ctx) => {
    requireScope(ctx.principal!, 'admin');
    const report = await subscriptions.sync();
    audit.record({ action: 'admin.subscriptions.sync', outcome: 'success', principal: ctx.principal!.id, traceId: ctx.trace.traceId, details: { ...report } });
    send(ctx.res, 200, report);
  });
  r.on('GET', '/admin/deliveries/failed', async (ctx) => {
    requireScope(ctx.principal!, 'admin');
    send(ctx.res, 200, { data: bus.deadLetters() });
  });

  // ------------------------------------------------------------- pipeline
  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const started = performance.now();
    const trace = startTrace(typeof req.headers.traceparent === 'string' ? req.headers.traceparent : undefined);
    const requestId = randomUUID();
    const fwd = req.headers['x-forwarded-for'];
    const clientIp =
      config.trustProxy && typeof fwd === 'string' ? fwd.split(',')[0].trim() : (req.socket.remoteAddress ?? 'unknown');
    let url: URL;
    try {
      url = new URL(req.url ?? '/', 'http://gateway.invalid');
    } catch {
      url = new URL('http://gateway.invalid/');
    }
    const ctx: Ctx = { req, res, url, method: req.method ?? 'GET', params: {}, requestId, trace, clientIp, route: 'unmatched' };

    res.setHeader('X-Request-Id', requestId);
    res.setHeader('traceparent', formatTraceparent(trace));
    applySecurityHeaders(res, config.hsts);
    res.on('finish', () => {
      const seconds = (performance.now() - started) / 1000;
      metrics.httpRequests.inc({ method: ctx.method, route: ctx.route, status: String(res.statusCode) });
      metrics.httpDuration.observe({ method: ctx.method, route: ctx.route }, seconds);
      logger.info('request', {
        method: ctx.method,
        path: url.pathname,
        route: ctx.route,
        status: res.statusCode,
        durationMs: Math.round(seconds * 1000),
        principal: ctx.principal?.id,
        ip: clientIp,
        requestId,
        traceId: trace.traceId,
      });
    });

    try {
      const origin = req.headers.origin;
      const corsOk = typeof origin === 'string' && config.corsOrigins.includes(origin);
      if (corsOk) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Expose-Headers', EXPOSE_HEADERS);
        res.setHeader('Vary', 'Origin');
      }
      if (ctx.method === 'OPTIONS') {
        if (corsOk) {
          res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE');
          res.setHeader('Access-Control-Allow-Headers', CORS_HEADERS);
          res.setHeader('Access-Control-Max-Age', '600');
        }
        return send(res, 204);
      }
      // Browsers: requests from foreign origins to the MCP endpoint are refused (DNS-rebinding protection).
      if (typeof origin === 'string' && !corsOk && url.pathname === '/mcp') throw errors.forbidden('Origin not allowed.');

      const ipDecision = ipLimiter.take(`ip:${clientIp}`);
      if (!ipDecision.allowed) {
        metrics.rateLimited.inc({ scope: 'ip' });
        throw new HttpError(429, 'Too Many Requests', 'Rate limit exceeded.', { type: PROBLEM('rate-limited'), headers: rateLimitHeaders(ipDecision) });
      }

      const match = r.match(ctx.method, url.pathname);
      if (match.kind === 'none') throw errors.notFound();
      if (match.kind === 'method') throw errors.methodNotAllowed(match.allow);
      ctx.route = match.route.pattern;
      ctx.params = match.params;

      if (match.route.auth) {
        let principal: Principal;
        try {
          principal = await authenticator.authenticate(req);
        } catch (e) {
          metrics.authFailures.inc({ route: ctx.route });
          if (e instanceof HttpError && e.status === 401 && (req.headers.authorization || req.headers['x-api-key'])) {
            audit.record({ action: 'auth', outcome: 'denied', ip: clientIp, status: 401, traceId: trace.traceId, details: { route: ctx.route, reason: e.detail } });
          }
          throw e;
        }
        ctx.principal = principal;
        const d = principalLimiter.take(principal.id);
        for (const [k, v] of Object.entries(rateLimitHeaders(d))) res.setHeader(k, v);
        if (!d.allowed) {
          metrics.rateLimited.inc({ scope: 'principal' });
          throw new HttpError(429, 'Too Many Requests', 'Rate limit exceeded.', { type: PROBLEM('rate-limited'), headers: rateLimitHeaders(d) });
        }
      }

      await match.route.handler(ctx);
    } catch (err) {
      let he: HttpError;
      if (err instanceof HttpError) he = err;
      else {
        logger.error('unhandled error', { err, stack: (err as Error)?.stack, requestId, traceId: trace.traceId });
        he = errors.internal();
      }
      sendProblem(res, he, url.pathname, trace.traceId);
    }
  }

  const server = createServer({ requestTimeout: 60_000, headersTimeout: 15_000 }, (req, res) => {
    handle(req, res).catch((err) => {
      logger.error('request pipeline failure', { err });
      if (!res.headersSent) res.writeHead(500).end();
    });
  });
  server.keepAliveTimeout = 5_000;

  return {
    server,
    config,
    bus,
    subscriptions,
    audit,
    metrics,
    service,
    listen: () =>
      new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(config.port, config.host, () => {
          const a = server.address() as AddressInfo;
          const host = a.family === 'IPv6' ? `[${a.address}]` : a.address;
          resolve(`http://${host === '0.0.0.0' || host === '[::]' ? 'localhost' : host}:${a.port}`);
        });
      }),
    close: async () => {
      clearInterval(sweeper);
      subscriptions.stop();
      bus.close();
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      });
      await audit.flush();
    },
  };
}
