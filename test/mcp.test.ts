import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { startStack, type Stack } from './helpers.ts';

describe('MCP endpoint (Streamable HTTP, JSON-RPC 2.0)', () => {
  let s: Stack;
  let n = 0;
  const rpc = (method: string, params: object = {}, key?: string, headers: Record<string, string> = {}) =>
    s.req('POST', '/mcp', {
      key,
      body: { jsonrpc: '2.0', id: ++n, method, params },
      headers: { Accept: 'application/json, text/event-stream', ...headers },
    });
  const call = async (name: string, args: object, key?: string) => (await rpc('tools/call', { name, arguments: args }, key)).json.result;

  before(async () => {
    s = await startStack();
  });
  after(async () => s.close());

  it('initializes and negotiates the protocol version', async () => {
    const r = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
    assert.equal(r.status, 200);
    assert.equal(r.json.result.protocolVersion, '2025-06-18');
    assert.ok(r.json.result.capabilities.tools);
    const unknown = await rpc('initialize', { protocolVersion: '1999-01-01' });
    assert.equal(unknown.json.result.protocolVersion, '2025-06-18');
    const notif = await s.req('POST', '/mcp', { body: { jsonrpc: '2.0', method: 'notifications/initialized' } });
    assert.equal(notif.status, 202);
  });

  it('requires auth + mcp.use scope and blocks foreign origins', async () => {
    assert.equal((await rpc('ping', {}, '')).status, 401);
    assert.equal((await rpc('ping', {}, s.keys.noScopes)).status, 403);
    assert.equal((await rpc('ping', {}, undefined, { Origin: 'https://evil.example' })).status, 403);
    assert.equal((await rpc('ping', {}, undefined, { 'MCP-Protocol-Version': '1999-01-01' })).status, 400);
  });

  it('lists tools according to the caller scopes', async () => {
    const admin = (await rpc('tools/list')).json.result.tools.map((t: any) => t.name);
    assert.deepEqual(admin.sort(), ['bc_create', 'bc_describe_entities', 'bc_get', 'bc_list_companies', 'bc_query', 'bc_update']);
    const reader = (await rpc('tools/list', {}, s.keys.reader)).json.result.tools.map((t: any) => t.name);
    assert.ok(!reader.includes('bc_create') && !reader.includes('bc_update'));
    assert.ok(!admin.includes('bc_delete'), 'no destructive delete tool for agents');
  });

  it('queries, reads and updates Business Central data through tools', async () => {
    const companies = await call('bc_list_companies', {});
    const companyId = companies.structuredContent.companies[0].id;
    const q = await call('bc_query', {
      entity: 'customers',
      companyId,
      filters: [{ field: 'balanceDue', op: 'gt', value: 1000 }],
      select: ['number', 'displayName', 'balanceDue'],
      sort: [{ field: 'balanceDue', desc: true }],
      limit: 3,
    });
    assert.equal(q.isError, false);
    assert.equal(q.structuredContent.records.length, 3);
    const first = q.structuredContent.records[0];
    assert.ok(first.balanceDue > 1000);

    const got = await call('bc_get', { entity: 'customers', companyId, id: first.id });
    assert.ok(got.structuredContent.etag);
    const upd = await call('bc_update', { entity: 'customers', companyId, id: first.id, etag: got.structuredContent.etag, data: { city: 'Potsdam' } });
    assert.equal(upd.isError, false);
    assert.equal(upd.structuredContent.city, 'Potsdam');
    const stale = await call('bc_update', { entity: 'customers', companyId, id: first.id, etag: got.structuredContent.etag, data: { city: 'Erfurt' } });
    assert.equal(stale.isError, true);
    assert.match(stale.content[0].text, /Precondition Failed/);
  });

  it('returns validation problems as tool errors (not protocol errors)', async () => {
    const companyId = s.companyId;
    const bad = await call('bc_query', { entity: 'customers', companyId, filters: [{ field: 'balanceDue', op: 'gt', value: '1 or 1 eq 1' }] });
    assert.equal(bad.isError, true);
    assert.match(bad.content[0].text, /filter\.balanceDue/);
    const denied = await call('bc_query', { entity: 'vendors', companyId }, s.keys.customers);
    assert.equal(denied.isError, true);
    assert.match(denied.content[0].text, /403/);
    const unknown = await rpc('tools/call', { name: 'bc_delete', arguments: {} });
    assert.equal(unknown.json.error.code, -32602);
    const method = await rpc('does/not/exist');
    assert.equal(method.json.error.code, -32601);
  });

  it('audits MCP calls with their channel', () => {
    assert.ok(s.app.audit.recent.some((r) => r.action === 'bc.customers.update' && (r.details as any)?.channel === 'mcp'));
  });
});
