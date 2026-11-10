/**
 * End-to-end: real stdio process ⇄ BC OpenBridge gateway ⇄ BC mock.
 * The gateway stack is started from the sibling project's test helpers.
 */
import assert from 'node:assert/strict';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { after, before, describe, it } from 'node:test';
import { startStack, type Stack } from '../../bc-openbridge/test/helpers.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

class Client {
  readonly proc: ChildProcessWithoutNullStreams;
  readonly #pending = new Map<number, (v: any) => void>();
  #id = 0;
  stderr = '';

  constructor(env: Record<string, string>) {
    this.proc = spawn(process.execPath, ['src/server.ts'], { cwd: ROOT, env: { ...process.env, ...env } });
    this.proc.stderr.on('data', (d) => (this.stderr += d));
    createInterface({ input: this.proc.stdout }).on('line', (line) => {
      const msg = JSON.parse(line);
      this.#pending.get(msg.id)?.(msg);
      this.#pending.delete(msg.id);
    });
  }

  request(method: string, params: object = {}): Promise<any> {
    const id = ++this.#id;
    return new Promise((resolve) => {
      this.#pending.set(id, resolve);
      this.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  }

  notify(method: string): void {
    this.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method }) + '\n');
  }

  async call(name: string, args: object = {}) {
    const r = await this.request('tools/call', { name, arguments: args });
    assert.ok(r.result, `protocol error: ${JSON.stringify(r.error)}`);
    return r.result as { content: { text: string }[]; structuredContent: any; isError: boolean };
  }

  close(): Promise<void> {
    return new Promise((resolve) => {
      this.proc.on('exit', () => resolve());
      this.proc.stdin.end();
    });
  }
}

describe('bc-claude MCP server', () => {
  let s: Stack;
  let c: Client;
  let reader: Client;

  before(async () => {
    s = await startStack();
    c = new Client({ OPENBRIDGE_URL: s.url, OPENBRIDGE_API_KEY: s.keys.admin });
    reader = new Client({ OPENBRIDGE_URL: s.url, OPENBRIDGE_API_KEY: s.keys.reader });
  });
  after(async () => {
    await c.close();
    await reader.close();
    await s.close();
  });

  it('speaks MCP over stdio and ships instructions', async () => {
    const init = await c.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } });
    assert.equal(init.result.protocolVersion, '2025-06-18');
    assert.match(init.result.instructions, /bc_overview/);
    c.notify('notifications/initialized');
    assert.deepEqual((await c.request('ping')).result, {});
    assert.equal((await c.request('nope/nope')).error.code, -32601);
  });

  it('offers write tools only when the key may write', async () => {
    const all = (await c.request('tools/list')).result.tools.map((t: any) => t.name);
    assert.ok(all.includes('bc_apply_change'));
    assert.ok(!all.some((n: string) => /delete/.test(n)), 'no delete tool');
    const ro = (await reader.request('tools/list')).result.tools.map((t: any) => t.name);
    assert.ok(ro.includes('bc_customer_overview'));
    assert.ok(!ro.some((n: string) => n.startsWith('bc_prepare') || n === 'bc_apply_change'));
  });

  it('bc_overview gives orientation in one call', async () => {
    const r = await c.call('bc_overview');
    assert.equal(r.isError, false);
    assert.equal(r.structuredContent.companies.length, 2);
    assert.match(r.content[0].text, /customers \| read\+write/);
  });

  it('resolves company names and finds records by partial name', async () => {
    const r = await c.call('bc_find', { text: 'Nordwind', companyId: 'Cronos Handels' });
    assert.equal(r.isError, false);
    assert.equal(r.structuredContent.hits.length, 1);
    assert.equal(r.structuredContent.hits[0].number, 'D10000');
    assert.match(r.content[0].text, /<bc-data>/);
  });

  it('asks for a company when several exist', async () => {
    const r = await c.call('bc_query', { entity: 'customers' });
    assert.equal(r.isError, true);
    assert.match(r.content[0].text, /Several companies/);
  });

  it('queries with filters, sorting and compact tables', async () => {
    const r = await c.call('bc_query', {
      entity: 'Customer',
      companyId: s.companyId,
      filters: [{ field: 'balanceDue', op: 'gt', value: 5000 }],
      sort: '-balanceDue',
      limit: 3,
    });
    assert.equal(r.isError, false);
    const recs = r.structuredContent.records;
    assert.equal(recs.length, 3);
    assert.ok(recs[0].balanceDue >= recs[1].balanceDue);
    assert.match(r.content[0].text, /\| number \| displayName \| city \| balanceDue/);
    assert.ok(r.structuredContent.nextCursor);
  });

  it('builds a customer 360° overview from a customer number', async () => {
    const r = await c.call('bc_customer_overview', { customer: 'D10030', companyId: s.companyId });
    assert.equal(r.isError, false);
    const k = r.structuredContent.kpis;
    assert.equal(r.structuredContent.customer.number, 'D10030');
    assert.ok(k.openInvoices >= 1 && k.overdueAmount > 0, 'seeded invoice for D10030 is open and overdue');
    assert.match(r.content[0].text, /Überfällig/);
    assert.ok(Array.isArray(r.structuredContent.openLedgerEntries), 'custom AL API used');
  });

  it('aggregates open receivables with overdue amounts', async () => {
    const r = await c.call('bc_open_items', { kind: 'receivables', companyId: s.companyId });
    assert.equal(r.isError, false);
    assert.ok(r.structuredContent.totalOpen > 0);
    assert.ok(r.structuredContent.totalOverdue <= r.structuredContent.totalOpen);
    assert.ok(r.structuredContent.byParty.length >= 1);
  });

  it('changes data only via prepare → apply, with diff and ETag protection', async () => {
    const before = s.mock.requestLog.filter((l) => l.method === 'PATCH').length;
    const prep = await c.call('bc_prepare_update', { entity: 'customers', companyId: s.companyId, id: (await firstCustomer()).id, changes: { city: 'Potsdam' } });
    assert.equal(prep.isError, false);
    assert.match(prep.content[0].text, /NICHT ausgeführt/);
    assert.match(prep.content[0].text, /\| city \| .* \| Potsdam \|/);
    assert.equal(s.mock.requestLog.filter((l) => l.method === 'PATCH').length, before, 'prepare writes nothing');

    const applied = await c.call('bc_apply_change', { planId: prep.structuredContent.planId });
    assert.equal(applied.isError, false);
    assert.equal(applied.structuredContent.record.city, 'Potsdam');
    const again = await c.call('bc_apply_change', { planId: prep.structuredContent.planId });
    assert.equal(again.isError, true, 'plans are single-use');
  });

  it('refuses to overwrite a record changed after preparing', async () => {
    const cust = await firstCustomer();
    const prep = await c.call('bc_prepare_update', { entity: 'customers', companyId: s.companyId, id: cust.id, changes: { city: 'Erfurt' } });
    // someone else changes the record in the meantime
    const cur = await s.req('GET', `/v1/companies/${s.companyId}/customers/${cust.id}`);
    await s.req('PATCH', `/v1/companies/${s.companyId}/customers/${cust.id}`, { body: { city: 'Weimar' }, headers: { 'If-Match': cur.headers.get('etag')! } });
    const r = await c.call('bc_apply_change', { planId: prep.structuredContent.planId });
    assert.equal(r.isError, true);
    assert.match(r.content[0].text, /changed by someone else/);
    const now = await s.req('GET', `/v1/companies/${s.companyId}/customers/${cust.id}`);
    assert.equal(now.json.city, 'Weimar', 'the other change survived');
  });

  it('validates before planning and creates exactly once', async () => {
    const bad = await c.call('bc_prepare_create', { entity: 'customers', companyId: s.companyId, data: { city: 'X', balanceDue: 1 } });
    assert.equal(bad.isError, true);
    assert.match(bad.content[0].text, /balanceDue: read-only/);
    assert.match(bad.content[0].text, /displayName: required/);

    const prep = await c.call('bc_prepare_create', { entity: 'customers', companyId: s.companyId, data: { displayName: 'Claude Test GmbH', city: 'Jena' } });
    assert.equal(prep.isError, false);
    const done = await c.call('bc_apply_change', { planId: prep.structuredContent.planId });
    assert.equal(done.isError, false);
    const found = await s.req('GET', `/v1/companies/${s.companyId}/customers?filter.displayName=Claude%20Test%20GmbH`);
    assert.equal(found.json.data.length, 1);
    assert.ok(s.app.audit.recent.some((a) => a.action === 'bc.customers.create'), 'gateway audit trail covers Claude');
  });

  it('serves resources and prompts', async () => {
    const res = await c.request('resources/read', { uri: 'bc://entities' });
    assert.ok(JSON.parse(res.result.contents[0].text).some((e: any) => e.name === 'customers'));
    const p = await c.request('prompts/get', { name: 'kunden-check', arguments: { kunde: 'Nordwind' } });
    assert.match(p.result.messages[0].content.text, /bc_customer_overview/);
    assert.equal((await c.request('prompts/get', { name: 'kunden-check', arguments: {} })).error.code, -32602);
  });

  it('reports gateway problems helpfully', async () => {
    const down = new Client({ OPENBRIDGE_URL: 'http://127.0.0.1:9', OPENBRIDGE_API_KEY: 'obk_x' });
    const r = await down.call('bc_overview');
    assert.equal(r.isError, true);
    assert.match(r.content[0].text, /npm run dev:mock/);
    await down.close();
    const insecure = spawn(process.execPath, ['src/server.ts'], { cwd: ROOT, env: { ...process.env, OPENBRIDGE_URL: 'http://example.com' } });
    const code = await new Promise((r) => insecure.on('exit', r));
    assert.equal(code, 1, 'refuses plain http to remote hosts');
  });

  async function firstCustomer() {
    const r = await s.req('GET', `/v1/companies/${s.companyId}/customers?limit=1&filter.blocked=%20`);
    return r.json.data[0];
  }
});
