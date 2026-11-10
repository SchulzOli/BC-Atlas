/**
 * Business Central API mock for local development and automated tests.
 *
 * Implements the subset of BC behaviour the gateway relies on:
 *  - Entra ID token endpoint (client credentials, secret or client assertion)
 *  - API v2.0 + custom API route, companies(...)/<entitySet>(...)
 *  - OData $filter (eq ne gt ge lt le, startswith, contains, and), $select,
 *    $orderby, server-driven paging (Prefer: odata.maxpagesize → nextLink)
 *  - ETags / If-Match with Request_EntityChanged conflicts
 *  - Webhook subscriptions incl. validation handshake, and change notifications
 *  - Failure injection (throttling, outages) for resilience tests
 *
 * NOT a full BC emulation – validate against a BC sandbox before production.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { seedCompanies } from './seed.ts';

type Rec = Record<string, unknown>;

export interface BcMockOptions {
  tenantId: string;
  environment: string;
  clientId: string;
  clientSecret: string;
  port?: number;
  host?: string;
  /** default server page size when the client sends no Prefer header */
  defaultPageSize?: number;
}

interface Subscription {
  subscriptionId: string;
  notificationUrl: string;
  resource: string;
  clientState: string;
  expirationDateTime: string;
  version: number;
}

const CUSTOM_ROUTE = 'openbridge/interop/v1.0';
const ROUTES: Record<string, string[]> = {
  'v2.0': ['customers', 'vendors', 'items', 'salesOrders', 'salesInvoices', 'purchaseInvoices', 'accounts', 'generalLedgerEntries'],
  [CUSTOM_ROUTE]: ['customerLedgerEntries', 'externalMappings'],
};
const READ_ONLY = new Set(['salesInvoices', 'purchaseInvoices', 'accounts', 'generalLedgerEntries', 'customerLedgerEntries']);
const NUMBER_PREFIX: Record<string, string> = { customers: 'D', vendors: 'K', items: 'I', salesOrders: 'AU-' };

// ------------------------------------------------------------ OData filter
type Token = { t: 'str' | 'word' | 'lp' | 'rp' | 'comma'; v: string };

function tokenize(s: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === ' ') {
      i++;
    } else if (c === '(') {
      out.push({ t: 'lp', v: c });
      i++;
    } else if (c === ')') {
      out.push({ t: 'rp', v: c });
      i++;
    } else if (c === ',') {
      out.push({ t: 'comma', v: c });
      i++;
    } else if (c === "'") {
      let v = '';
      i++;
      for (;;) {
        if (i >= s.length) throw new Error('unterminated string');
        if (s[i] === "'") {
          if (s[i + 1] === "'") {
            v += "'";
            i += 2;
            continue;
          }
          i++;
          break;
        }
        v += s[i++];
      }
      out.push({ t: 'str', v });
    } else {
      let v = '';
      while (i < s.length && !" (),'".includes(s[i])) v += s[i++];
      out.push({ t: 'word', v });
    }
  }
  return out;
}

type Pred = (r: Rec) => boolean;

function literal(tok: Token): unknown {
  if (tok.t === 'str') return tok.v;
  if (tok.v === 'true') return true;
  if (tok.v === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(tok.v)) return Number(tok.v);
  return tok.v; // guid / date / datetime
}

function compare(a: unknown, b: unknown): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  const x = String(a ?? '').toLowerCase();
  const y = String(b ?? '').toLowerCase();
  return x < y ? -1 : x > y ? 1 : 0;
}

export function parseFilter(expr: string): Pred {
  const toks = tokenize(expr);
  let pos = 0;
  const next = () => {
    const t = toks[pos++];
    if (!t) throw new Error('unexpected end of filter');
    return t;
  };
  const preds: Pred[] = [];
  for (;;) {
    const first = next();
    if (first.t === 'word' && (first.v === 'startswith' || first.v === 'contains') && toks[pos]?.t === 'lp') {
      pos++;
      const field = next().v;
      if (next().t !== 'comma') throw new Error('expected comma');
      const val = String(literal(next())).toLowerCase();
      if (next().t !== 'rp') throw new Error('expected )');
      const fn = first.v;
      preds.push((r) => {
        const s = String(r[field] ?? '').toLowerCase();
        return fn === 'startswith' ? s.startsWith(val) : s.includes(val);
      });
    } else {
      const field = first.v;
      const op = next().v;
      const val = literal(next());
      const ops: Record<string, (c: number) => boolean> = {
        eq: (c) => c === 0,
        ne: (c) => c !== 0,
        gt: (c) => c > 0,
        ge: (c) => c >= 0,
        lt: (c) => c < 0,
        le: (c) => c <= 0,
      };
      const f = ops[op];
      if (!f) throw new Error(`unsupported operator ${op}`);
      preds.push((r) => f(compare(r[field], val)));
    }
    if (pos >= toks.length) break;
    const conj = next();
    if (conj.v !== 'and') throw new Error(`unsupported conjunction ${conj.v}`);
  }
  return (r) => preds.every((p) => p(r));
}

// ------------------------------------------------------------------- mock
export class BcMock {
  readonly opts: BcMockOptions;
  readonly companies: Rec[] = [];
  /** companyId → entitySet → id → record */
  readonly data = new Map<string, Map<string, Map<string, Rec>>>();
  readonly versions = new Map<string, number>();
  readonly subscriptions = new Map<string, Subscription>();
  readonly tokens = new Set<string>();
  readonly requestLog: { method: string; path: string; headers: Record<string, string | string[] | undefined> }[] = [];
  tokenRequests = 0;
  #failures: { status: number; remaining: number; retryAfter?: string }[] = [];
  #counter = 900;
  #server = createServer((req, res) => {
    this.#handle(req, res).catch((err) => this.#error(res, 500, 'Internal_ServerError', String(err)));
  });
  #pendingNotifications = new Set<Promise<void>>();
  url = '';

  constructor(opts: BcMockOptions) {
    this.opts = opts;
    for (const s of seedCompanies()) {
      this.companies.push(s.company);
      const sets = new Map<string, Map<string, Rec>>();
      for (const [name, rows] of Object.entries(s.data)) sets.set(name, new Map(rows.map((r) => [String(r.id), { ...r }])));
      this.data.set(String(s.company.id), sets);
    }
  }

  async start(): Promise<string> {
    await new Promise<void>((resolve) => this.#server.listen(this.opts.port ?? 0, this.opts.host ?? '127.0.0.1', resolve));
    const a = this.#server.address() as AddressInfo;
    this.url = `http://127.0.0.1:${a.port}`;
    return this.url;
  }

  async stop(): Promise<void> {
    await this.flushNotifications();
    await new Promise<void>((resolve) => {
      this.#server.close(() => resolve());
      this.#server.closeAllConnections();
    });
  }

  /** Make the next `count` API calls fail with `status` (e.g. 429, 503). */
  failNext(status: number, count = 1, retryAfter?: string): void {
    this.#failures.push({ status, remaining: count, retryAfter });
  }

  async flushNotifications(): Promise<void> {
    while (this.#pendingNotifications.size) await Promise.allSettled([...this.#pendingNotifications]);
  }

  etag(id: string): string {
    const v = this.versions.get(id) ?? 1;
    return `W/"JzE5OzE${Buffer.from(`${id}:${v}`).toString('base64url')}Oyc="`;
  }

  #send(res: ServerResponse, status: number, body?: unknown, headers: Record<string, string> = {}): void {
    const payload = body === undefined ? '' : JSON.stringify(body);
    res.writeHead(status, { ...(payload ? { 'Content-Type': 'application/json; odata.metadata=minimal' } : {}), ...headers });
    res.end(payload);
  }

  #error(res: ServerResponse, status: number, code: string, message: string, headers: Record<string, string> = {}): void {
    if (res.headersSent) return;
    this.#send(res, status, { error: { code, message: `${message}  CorrelationId:  ${randomUUID()}.` } }, headers);
  }

  async #body(req: IncomingMessage): Promise<string> {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    return Buffer.concat(chunks).toString('utf8');
  }

  #withEtag(r: Rec): Rec {
    return { '@odata.etag': this.etag(String(r.id)), ...r };
  }

  async #handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', this.url || 'http://localhost');
    const path = decodeURIComponent(url.pathname);
    this.requestLog.push({ method: req.method ?? '', path, headers: req.headers });

    // --- Entra ID token endpoint
    const tokenMatch = /^\/([^/]+)\/oauth2\/v2\.0\/token$/.exec(path);
    if (tokenMatch && req.method === 'POST') {
      this.tokenRequests++;
      const form = new URLSearchParams(await this.#body(req));
      const okTenant = tokenMatch[1] === this.opts.tenantId;
      const okClient = form.get('client_id') === this.opts.clientId;
      const okSecret =
        form.get('client_secret') === this.opts.clientSecret ||
        (form.get('client_assertion_type') === 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer' && !!form.get('client_assertion'));
      if (form.get('grant_type') !== 'client_credentials' || !okTenant || !okClient || !okSecret) {
        return this.#send(res, 401, { error: 'invalid_client', error_description: 'AADSTS7000215: Invalid client secret provided.' });
      }
      const token = randomBytes(24).toString('base64url');
      this.tokens.add(token);
      return this.#send(res, 200, { token_type: 'Bearer', expires_in: 3599, access_token: token });
    }

    // --- API
    const auth = /^Bearer (.+)$/.exec(req.headers.authorization ?? '');
    if (!auth || !this.tokens.has(auth[1])) {
      return this.#error(res, 401, 'Authentication_InvalidCredentials', 'The credentials provided are incorrect');
    }
    const failure = this.#failures[0];
    if (failure) {
      if (--failure.remaining <= 0) this.#failures.shift();
      return this.#error(res, failure.status, failure.status === 429 ? 'Application_TooManyRequests' : 'Internal_ServiceUnavailable', 'Injected failure', failure.retryAfter ? { 'Retry-After': failure.retryAfter } : {});
    }

    const m = /^\/v2\.0\/([^/]+)\/([^/]+)\/api\/(v2\.0|openbridge\/interop\/v1\.0)\/(.*)$/.exec(path);
    if (!m || m[1] !== this.opts.tenantId || m[2] !== this.opts.environment) {
      return this.#error(res, 404, 'BadRequest_NotFound', 'No HTTP resource was found that matches the request URI');
    }
    const route = m[3];
    const rest = m[4];

    if (rest === 'companies' && req.method === 'GET') {
      return this.#send(res, 200, { value: this.companies.map((c) => this.#select(c, url)) });
    }

    if (route === 'v2.0') {
      const sm = /^subscriptions(?:\('([^']+)'\))?$/.exec(rest);
      if (sm) return this.#subscriptions(req, res, sm[1]);
    }

    const em = /^companies\(([0-9a-f-]{36})\)\/([A-Za-z]+)(?:\(([0-9a-f-]{36})\))?$/i.exec(rest);
    if (!em) return this.#error(res, 404, 'BadRequest_NotFound', 'Resource not found');
    const [, companyId, set, id] = em;
    const company = this.data.get(companyId.toLowerCase());
    if (!company) return this.#error(res, 404, 'Internal_CompanyNotFound', 'Company not found');
    if (!ROUTES[route]?.includes(set)) return this.#error(res, 404, 'BadRequest_NotFound', `Entity set ${set} not found`);
    const table = company.get(set)!;

    if (!id) {
      if (req.method === 'GET') return this.#list(req, res, url, table);
      if (req.method === 'POST' && !READ_ONLY.has(set)) return this.#create(req, res, companyId, set, table, route);
      return this.#error(res, 405, 'BadRequest_MethodNotAllowed', 'Method not allowed');
    }

    const rec = table.get(id.toLowerCase());
    if (!rec) return this.#error(res, 404, 'Internal_RecordNotFound', `The ${set} does not exist. Identification fields and values: Id='${id}'`);
    if (req.method === 'GET') return this.#send(res, 200, this.#withEtag(this.#select(rec, url)), { ETag: this.etag(String(rec.id)) });
    if (READ_ONLY.has(set)) return this.#error(res, 405, 'BadRequest_MethodNotAllowed', 'Method not allowed');

    const ifMatch = req.headers['if-match'];
    if (!ifMatch) return this.#error(res, 400, 'Internal_ETagRequired', 'Could not find a matching If-Match header');
    if (ifMatch !== '*' && ifMatch !== this.etag(String(rec.id))) {
      return this.#error(res, 409, 'Request_EntityChanged', 'Another user has already changed the record.');
    }
    if (req.method === 'PATCH') {
      const body = JSON.parse((await this.#body(req)) || '{}') as Rec;
      if ('id' in body) return this.#error(res, 400, 'BadRequest_InvalidRequestBody', 'id is read-only');
      Object.assign(rec, body, { lastModifiedDateTime: new Date().toISOString() });
      this.versions.set(String(rec.id), (this.versions.get(String(rec.id)) ?? 1) + 1);
      this.#notify(route, companyId, set, String(rec.id), 'updated');
      return this.#send(res, 200, this.#withEtag(rec), { ETag: this.etag(String(rec.id)) });
    }
    if (req.method === 'DELETE') {
      table.delete(String(rec.id));
      this.#notify(route, companyId, set, String(rec.id), 'deleted');
      return this.#send(res, 204);
    }
    return this.#error(res, 405, 'BadRequest_MethodNotAllowed', 'Method not allowed');
  }

  #select(r: Rec, url: URL): Rec {
    const sel = url.searchParams.get('$select');
    if (!sel) return { ...r };
    const out: Rec = {};
    for (const f of sel.split(',')) if (f in r) out[f] = r[f];
    return out;
  }

  #list(req: IncomingMessage, res: ServerResponse, url: URL, table: Map<string, Rec>): void {
    let rows = [...table.values()];
    const filter = url.searchParams.get('$filter');
    if (filter) {
      try {
        rows = rows.filter(parseFilter(filter));
      } catch (e) {
        return this.#error(res, 400, 'BadRequest', `Invalid filter: ${(e as Error).message}`);
      }
    }
    const orderby = url.searchParams.get('$orderby');
    if (orderby) {
      const keys = orderby.split(',').map((s) => s.trim().split(' '));
      rows.sort((a, b) => {
        for (const [f, dir] of keys) {
          const c = compare(a[f], b[f]);
          if (c) return dir === 'desc' ? -c : c;
        }
        return 0;
      });
    }
    const prefer = /odata\.maxpagesize=(\d+)/.exec(String(req.headers.prefer ?? ''));
    const pageSize = prefer ? Number(prefer[1]) : (this.opts.defaultPageSize ?? 20_000);
    const skip = Number(url.searchParams.get('$skiptoken') ?? 0);
    const page = rows.slice(skip, skip + pageSize);
    const body: Rec = { value: page.map((r) => this.#withEtag(this.#select(r, url))) };
    if (skip + pageSize < rows.length) {
      const next = new URL(url.toString());
      next.searchParams.set('$skiptoken', String(skip + pageSize));
      body['@odata.nextLink'] = `http://${req.headers.host}${next.pathname}${next.search}`;
    }
    this.#send(res, 200, body);
  }

  async #create(req: IncomingMessage, res: ServerResponse, companyId: string, set: string, table: Map<string, Rec>, route: string): Promise<void> {
    let body: Rec;
    try {
      body = JSON.parse(await this.#body(req));
    } catch {
      return this.#error(res, 400, 'BadRequest_InvalidRequestBody', 'Invalid JSON');
    }
    if ((set === 'customers' || set === 'vendors' || set === 'items') && !body.displayName) {
      return this.#error(res, 400, 'Internal_FieldMissing', 'Name must have a value');
    }
    const id = randomUUID();
    const n = ++this.#counter;
    const rec: Rec = {
      id,
      number: body.number ?? `${NUMBER_PREFIX[set] ?? 'X'}${n}`,
      ...body,
      lastModifiedDateTime: new Date().toISOString(),
    };
    if (set === 'externalMappings') {
      const dup = [...table.values()].some(
        (x) => x.sourceSystem === (body.sourceSystem ?? 'DEFAULT') && x.entitySet === body.entitySet && x.externalId === body.externalId,
      );
      if (dup) return this.#error(res, 400, 'Internal_EntityWithSameKeyExists', 'The record already exists.');
      delete rec.number;
      Object.assign(rec, { sourceSystem: body.sourceSystem ?? 'DEFAULT', syncStatus: body.syncStatus ?? 'Pending' });
    }
    if (set === 'customers') Object.assign(rec, { balanceDue: 0, blocked: rec.blocked ?? ' ', ...rec });
    if (set === 'salesOrders') {
      const customers = this.data.get(companyId.toLowerCase())!.get('customers')!;
      const c = [...customers.values()].find((x) => x.number === body.customerNumber || x.id === body.customerId);
      if (!c) return this.#error(res, 400, 'Internal_RecordNotFound', 'The customer does not exist.');
      Object.assign(rec, {
        customerId: c.id,
        customerNumber: c.number,
        customerName: c.displayName,
        status: 'Draft',
        totalAmountExcludingTax: 0,
        totalTaxAmount: 0,
        totalAmountIncludingTax: 0,
        fullyShipped: false,
      });
    }
    table.set(id, rec);
    this.versions.set(id, 1);
    this.#notify(route, companyId, set, id, 'created');
    this.#send(res, 201, this.#withEtag(rec), { ETag: this.etag(id) });
  }

  async #subscriptions(req: IncomingMessage, res: ServerResponse, id?: string): Promise<void> {
    const view = (s: Subscription) => ({
      '@odata.etag': `W/"sub-${s.version}"`,
      subscriptionId: s.subscriptionId,
      notificationUrl: s.notificationUrl,
      resource: s.resource,
      userId: randomUUID(),
      lastModifiedDateTime: new Date().toISOString(),
      clientState: s.clientState,
      expirationDateTime: s.expirationDateTime,
    });
    if (!id && req.method === 'GET') return this.#send(res, 200, { value: [...this.subscriptions.values()].map(view) });
    if (!id && req.method === 'POST') {
      const body = JSON.parse(await this.#body(req)) as Rec;
      const notificationUrl = String(body.notificationUrl ?? '');
      // Handshake: BC posts a validation token and expects it echoed back.
      const token = randomBytes(16).toString('hex');
      try {
        const r = await fetch(`${notificationUrl}${notificationUrl.includes('?') ? '&' : '?'}validationToken=${token}`, {
          method: 'POST',
          signal: AbortSignal.timeout(5000),
        });
        if (r.status !== 200 || (await r.text()) !== token) throw new Error('bad handshake');
      } catch {
        return this.#error(res, 400, 'Internal_SubscriptionHandshakeFailed', 'The notification URL did not respond with the validation token');
      }
      const s: Subscription = {
        subscriptionId: randomBytes(16).toString('hex'),
        notificationUrl,
        resource: String(body.resource ?? ''),
        clientState: String(body.clientState ?? ''),
        expirationDateTime: new Date(Date.now() + 3 * 86400_000).toISOString(),
        version: 1,
      };
      this.subscriptions.set(s.subscriptionId, s);
      return this.#send(res, 201, view(s));
    }
    const s = id ? this.subscriptions.get(id) : undefined;
    if (!s) return this.#error(res, 404, 'BadRequest_NotFound', 'Subscription not found');
    if (req.method === 'PATCH') {
      await this.#body(req);
      if (req.headers['if-match'] !== '*' && req.headers['if-match'] !== `W/"sub-${s.version}"`) {
        return this.#error(res, 409, 'Request_EntityChanged', 'Subscription changed');
      }
      s.version++;
      s.expirationDateTime = new Date(Date.now() + 3 * 86400_000).toISOString();
      return this.#send(res, 200, view(s));
    }
    if (req.method === 'DELETE') {
      this.subscriptions.delete(s.subscriptionId);
      return this.#send(res, 204);
    }
    return this.#error(res, 405, 'BadRequest_MethodNotAllowed', 'Method not allowed');
  }

  #notify(route: string, companyId: string, set: string, id: string, changeType: string): void {
    const collection = `api/${route}/companies(${companyId})/${set}`.toLowerCase();
    for (const s of this.subscriptions.values()) {
      if (s.resource.toLowerCase() !== collection) continue;
      const payload = {
        value: [
          {
            subscriptionId: s.subscriptionId,
            clientState: s.clientState,
            expirationDateTime: s.expirationDateTime,
            resource: `api/${route}/companies(${companyId})/${set}(${id})`,
            changeType,
            lastModifiedDateTime: new Date().toISOString(),
          },
        ],
      };
      const p = fetch(s.notificationUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(5000),
      })
        .then((r) => r.body?.cancel())
        .catch(() => undefined);
      this.#pendingNotifications.add(p);
      p.finally(() => this.#pendingNotifications.delete(p));
    }
  }
}
