import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { verifyAuditFile } from '../src/security/audit.ts';
import { startStack, type Stack } from './helpers.ts';
import { AUD as TEST_AUDIENCE, ISSUER as TEST_ISSUER, fakeFetch as oidcFetch, token as signTestToken } from './jwt-fixtures.ts';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const auditFile = join(mkdtempSync(join(tmpdir(), 'ob-e2e-')), 'audit.jsonl');

describe('gateway end-to-end (BC mock)', () => {
  let s: Stack;
  before(async () => {
    s = await startStack(
      { OIDC_ISSUER: TEST_ISSUER, OIDC_AUDIENCE: TEST_AUDIENCE, AUDIT_LOG_FILE: auditFile },
      { oidcFetch },
    );
  });
  after(async () => s.close());

  it('serves health, OpenAPI 3.1, AsyncAPI 3.0 and RFC 9728 metadata without auth', async () => {
    assert.equal((await s.req('GET', '/healthz', { key: null })).status, 200);
    assert.equal((await s.req('GET', '/readyz', { key: null })).status, 200);
    const oas = await s.req('GET', '/openapi.json', { key: null });
    assert.equal(oas.json.openapi, '3.1.0');
    assert.ok(oas.json.paths['/v1/companies/{companyId}/customers'].get);
    assert.ok(oas.json.paths['/v1/companies/{companyId}/customers/{id}'].patch);
    assert.equal(oas.json.paths['/v1/companies/{companyId}/salesInvoices'].post, undefined, 'read-only entity has no POST');
    assert.ok(oas.json.webhooks.bcChange);
    const aas = await s.req('GET', '/asyncapi.json', { key: null });
    assert.equal(aas.json.asyncapi, '3.0.0');
    const prm = await s.req('GET', '/.well-known/oauth-protected-resource', { key: null });
    assert.deepEqual(prm.json.authorization_servers, [TEST_ISSUER]);
  });

  it('sets security headers and trace context', async () => {
    const r = await s.req('GET', '/healthz', { key: null, headers: { traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01' } });
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.match(r.headers.get('content-security-policy') ?? '', /default-src 'none'/);
    assert.equal(r.headers.get('cache-control'), 'no-store');
    assert.match(r.headers.get('traceparent') ?? '', /^00-4bf92f3577b34da6a3ce929d0e0e4736-[0-9a-f]{16}-01$/);
  });

  it('requires authentication with RFC 6750/9728 challenges and RFC 9457 problems', async () => {
    const r = await s.req('GET', '/v1/companies', { key: null });
    assert.equal(r.status, 401);
    assert.match(r.headers.get('content-type') ?? '', /application\/problem\+json/);
    assert.match(r.headers.get('www-authenticate') ?? '', /resource_metadata=/);
    assert.equal(r.json.status, 401);
    const bad = await s.req('GET', '/v1/companies', { key: 'obk_00000000_' + 'A'.repeat(43) });
    assert.equal(bad.status, 401);
    assert.match(bad.headers.get('www-authenticate') ?? '', /invalid_token/);
  });

  it('accepts OAuth 2.0 JWT access tokens and maps scopes', async () => {
    const jwt = signTestToken();
    const r = await s.req('GET', '/v1/companies', { key: jwt });
    assert.equal(r.status, 200);
    const w = await s.req('POST', `/v1/companies/${s.companyId}/customers`, { key: jwt, body: { displayName: 'x' } });
    assert.equal(w.status, 403, 'token only has bc.read');
    assert.match(w.headers.get('www-authenticate') ?? '', /insufficient_scope/);
  });

  it('lists companies and projects only registry fields', async () => {
    const r = await s.req('GET', '/v1/companies');
    assert.equal(r.status, 200);
    assert.equal(r.json.data.length, 2);
    assert.equal(r.json.data[0].timestamp, undefined, 'non-registry field stripped');
  });

  it('filters, selects, sorts and pages with opaque cursors', async () => {
    const base = `/v1/companies/${s.companyId}/customers`;
    const berlin = await s.req('GET', `${base}?filter.city=Berlin&select=number,displayName,city`);
    assert.equal(berlin.status, 200);
    assert.ok(berlin.json.data.length > 0);
    assert.ok(berlin.json.data.every((c: any) => c.city === 'Berlin' && c.email === undefined && c.id));

    const sorted = await s.req('GET', `${base}?filter.balanceDue.gt=1000&sort=-balanceDue`);
    const balances = sorted.json.data.map((c: any) => c.balanceDue);
    assert.deepEqual(balances, [...balances].sort((a: number, b: number) => b - a));
    assert.ok(balances.every((b: number) => b > 1000));

    const p1 = await s.req('GET', `${base}?limit=5`);
    assert.equal(p1.json.data.length, 5);
    assert.ok(p1.json.page.nextCursor);
    assert.match(p1.headers.get('link') ?? '', /rel="next"/);
    assert.ok(!p1.json.page.nextCursor.includes('t-1'), 'tenant not exposed');
    const p2 = await s.req('GET', `${base}?limit=5&cursor=${encodeURIComponent(p1.json.page.nextCursor)}`);
    assert.equal(p2.json.data.length, 5);
    assert.notEqual(p2.json.data[0].id, p1.json.data[0].id);
    // a cursor is bound to its principal
    const stolen = await s.req('GET', `${base}?limit=5&cursor=${encodeURIComponent(p1.json.page.nextCursor)}`, { key: s.keys.reader });
    assert.equal(stolen.status, 400);
  });

  it('rejects injection and invalid parameters before reaching BC', async () => {
    const before = s.mock.requestLog.length;
    const base = `/v1/companies/${s.companyId}/customers`;
    for (const q of ['filter.balanceDue.gt=0%20or%201%20eq%201', 'filter.password=x', '%24filter=1', 'filter.city.regex=x', 'select=secret']) {
      const r = await s.req('GET', `${base}?${q}`);
      assert.equal(r.status, 400, q);
      assert.equal(r.json.type, 'urn:openbridge:problem:validation', q);
    }
    assert.equal((await s.req('GET', `/v1/companies/not-a-guid/customers`)).status, 400);
    assert.equal((await s.req('GET', `/v1/companies/${s.companyId}/secrets`)).status, 404);
    assert.equal(s.mock.requestLog.length, before, 'no upstream calls for invalid requests');
  });

  it('runs a full CRUD lifecycle with ETags, If-Match and idempotency', async () => {
    const base = `/v1/companies/${s.companyId}/customers`;
    const key = 'idem-key-0001-test';
    const created = await s.req('POST', base, { body: { displayName: 'Testkunde GmbH', city: 'Dresden' }, headers: { 'Idempotency-Key': key } });
    assert.equal(created.status, 201);
    assert.ok(created.headers.get('etag'));
    assert.match(created.headers.get('location') ?? '', new RegExp(`${base}/${created.json.id}$`));

    const replay = await s.req('POST', base, { body: { displayName: 'Testkunde GmbH', city: 'Dresden' }, headers: { 'Idempotency-Key': key } });
    assert.equal(replay.status, 201);
    assert.equal(replay.headers.get('idempotent-replayed'), 'true');
    assert.equal(replay.json.id, created.json.id, 'no duplicate created');
    const reuse = await s.req('POST', base, { body: { displayName: 'Other' }, headers: { 'Idempotency-Key': key } });
    assert.equal(reuse.status, 422);

    const id = created.json.id;
    const got = await s.req('GET', `${base}/${id}`);
    const etag = got.headers.get('etag')!;
    assert.equal((await s.req('GET', `${base}/${id}`, { headers: { 'If-None-Match': etag } })).status, 304);

    assert.equal((await s.req('PATCH', `${base}/${id}`, { body: { city: 'Leipzig' } })).status, 428);
    const upd = await s.req('PATCH', `${base}/${id}`, {
      body: { city: 'Leipzig' },
      headers: { 'If-Match': etag, 'Content-Type': 'application/merge-patch+json' },
    });
    assert.equal(upd.status, 200);
    assert.equal(upd.json.city, 'Leipzig');
    const stale = await s.req('PATCH', `${base}/${id}`, { body: { city: 'Halle' }, headers: { 'If-Match': etag } });
    assert.equal(stale.status, 412, 'lost-update protection');

    const del = await s.req('DELETE', `${base}/${id}`, { headers: { 'If-Match': upd.headers.get('etag')! } });
    assert.equal(del.status, 204);
    assert.equal((await s.req('GET', `${base}/${id}`)).status, 404);
  });

  it('validates write payloads strictly', async () => {
    const base = `/v1/companies/${s.companyId}/customers`;
    const r = await s.req('POST', base, { body: { city: 'X'.repeat(31), balanceDue: 5, hacker: true, type: 'Robot' } });
    assert.equal(r.status, 400);
    const fields = r.json.errors.map((e: any) => e.field).sort();
    assert.deepEqual(fields, ['balanceDue', 'city', 'displayName', 'hacker', 'type']);
    assert.equal((await s.req('POST', base, { body: 'displayName=x', headers: { 'Content-Type': 'text/plain' } })).status, 415);
    assert.equal((await s.req('POST', `/v1/companies/${s.companyId}/salesInvoices`, { body: { number: 'x' } })).status, 405);
  });

  it('enforces scopes per entity and operation', async () => {
    const c = `/v1/companies/${s.companyId}`;
    assert.equal((await s.req('GET', `${c}/customers`, { key: s.keys.customers })).status, 200);
    assert.equal((await s.req('GET', `${c}/vendors`, { key: s.keys.customers })).status, 403);
    assert.equal((await s.req('POST', `${c}/items`, { key: s.keys.reader, body: { displayName: 'x' } })).status, 403);
    const list = await s.req('GET', `${c}/customers?limit=1`);
    const id = list.json.data[0].id;
    const del = await s.req('DELETE', `${c}/customers/${id}`, { key: s.keys.customers, headers: { 'If-Match': '*' } });
    assert.equal(del.status, 403, 'delete needs bc.delete');
    assert.equal((await s.req('GET', '/v1/companies', { key: s.keys.noScopes })).status, 403);
    assert.equal((await s.req('GET', '/admin/deliveries/failed', { key: s.keys.reader })).status, 403);
  });

  it('serves the custom AL extension API (customerLedgerEntries)', async () => {
    const r = await s.req('GET', `/v1/companies/${s.companyId}/customerLedgerEntries?filter.open=true`);
    assert.equal(r.status, 200);
    assert.ok(r.json.data.length > 0 && r.json.data.every((e: any) => e.open === true));
    assert.ok(s.mock.requestLog.some((l) => l.path.includes('/api/openbridge/interop/v1.0/')));
  });

  it('retries BC throttling (429) transparently and surfaces persistent errors', async () => {
    s.mock.failNext(429, 1, '0');
    const ok = await s.req('GET', `/v1/companies/${s.companyId}/items?limit=2`);
    assert.equal(ok.status, 200);
    s.mock.failNext(503, 5);
    const down = await s.req('GET', `/v1/companies/${s.companyId}/items?limit=2`);
    assert.equal(down.status, 503);
    assert.equal(down.json.type, 'urn:openbridge:problem:upstream-error');
    assert.ok(!down.text.includes('t-1'), 'no upstream internals leaked');
  });

  it('uses Data-Access-Intent ReadOnly for reads and never forwards client credentials', async () => {
    await s.req('GET', `/v1/companies/${s.companyId}/items?limit=1`);
    const last = s.mock.requestLog.filter((l) => l.method === 'GET' && l.path.endsWith('/items')).at(-1)!;
    assert.equal(last.headers['data-access-intent'], 'ReadOnly');
    assert.ok(!String(last.headers.authorization).includes('obk_'));
  });

  it('handles CORS preflight only for allow-listed origins', async () => {
    const ok = await s.req('OPTIONS', '/v1/companies', { key: null, headers: { Origin: 'https://app.example.com', 'Access-Control-Request-Method': 'GET' } });
    assert.equal(ok.status, 204);
    assert.equal(ok.headers.get('access-control-allow-origin'), 'https://app.example.com');
    const evil = await s.req('OPTIONS', '/v1/companies', { key: null, headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'GET' } });
    assert.equal(evil.headers.get('access-control-allow-origin'), null);
  });

  it('exposes Prometheus metrics to authorised callers', async () => {
    assert.equal((await s.req('GET', '/metrics', { key: s.keys.reader })).status, 403);
    const m = await s.req('GET', '/metrics');
    assert.equal(m.status, 200);
    assert.match(m.text, /openbridge_http_requests_total\{/);
    assert.match(m.text, /openbridge_bc_requests_total\{/);
  });

  it('writes a verifiable audit trail', async () => {
    await s.app.audit.flush();
    const res = await verifyAuditFile(auditFile);
    assert.equal(res.ok, true);
    assert.ok(res.records > 5);
    const actions = s.app.audit.recent.map((r) => r.action);
    assert.ok(actions.includes('bc.customers.create'));
    assert.ok(actions.includes('bc.customers.delete'));
    assert.ok(s.app.audit.recent.some((r) => r.action === 'auth' && r.outcome === 'denied'));
  });
});

describe('events end-to-end: BC webhook → CloudEvent → signed delivery', () => {
  let s: Stack;
  before(async () => {
    s = await startStack();
  });
  after(async () => s.close());

  it('creates BC subscriptions (with handshake) and renews them', async () => {
    const r = await s.req('POST', '/admin/subscriptions/sync');
    assert.equal(r.status, 200);
    assert.equal(r.json.created.length, 4, '2 companies × customers,items');
    assert.equal(s.mock.subscriptions.size, 4);
    const again = await s.app.subscriptions.sync(Date.now() + 2.5 * 86400_000);
    assert.equal(again.renewed.length, 4, 'expiring subscriptions renewed');
    const list = await s.req('GET', '/admin/subscriptions');
    assert.equal(list.json.subscriptions.length, 4);
  });

  it('turns BC notifications into signed CloudEvents for subscribers and the feed', async () => {
    const base = `/v1/companies/${s.companyId}/customers`;
    const created = await s.req('POST', base, { body: { displayName: 'Event GmbH' } });
    assert.equal(created.status, 201);
    await s.req('POST', `/v1/companies/${s.companyId}/items`, { body: { displayName: 'Event-Artikel' } });
    await s.mock.flushNotifications();
    await s.app.bus.idle();

    const ev = s.receiver.received.find((e) => e.subject === `customers/${created.json.id}`);
    assert.ok(ev, 'subscriber received the event with a valid signature');
    assert.equal(ev!.type, 'io.openbridge.bc.customers.created');
    assert.equal((ev!.data as any).href, `${s.app.config.publicBaseUrl}${base}/${created.json.id}`);
    assert.equal(s.receiver.rejected, 0);
    assert.ok(!s.receiver.received.some((e) => e.type.includes('.items.')), 'type filter respected');

    const feed = await s.req('GET', '/v1/events', { key: s.keys.reader });
    assert.ok(feed.json.data.some((e: any) => e.event.id === ev!.id));
    const restricted = await s.req('GET', '/v1/events', { key: s.keys.customers });
    assert.ok(restricted.json.data.every((e: any) => e.event.data.entitySet === 'customers'), 'feed filtered by entity scopes');
  });

  it('rejects forged notifications (clientState) and answers the validation handshake', async () => {
    const hs = await s.req('POST', '/webhooks/bc?validationToken=abc123', { key: null });
    assert.equal(hs.status, 200);
    assert.equal(hs.text, 'abc123');
    const forged = await s.req('POST', '/webhooks/bc', {
      key: null,
      body: { value: [{ subscriptionId: 'x', clientState: 'guess', resource: `api/v2.0/companies(${s.companyId})/customers`, changeType: 'collection' }] },
    });
    assert.equal(forged.status, 401);
  });
});
