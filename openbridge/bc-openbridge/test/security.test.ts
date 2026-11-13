import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { ApiKeyStore, generateApiKey } from '../src/security/apikeys.ts';
import { AuditLog, verifyAuditFile } from '../src/security/audit.ts';
import { CursorCodec } from '../src/security/cursor.ts';
import { canAccessEntity, type Principal } from '../src/security/principal.ts';
import { RateLimiter } from '../src/security/ratelimit.ts';
import { assertSafeOutboundUrl, isBlockedAddress } from '../src/security/ssrf.ts';
import { redact } from '../src/observability/log.ts';
import './helpers.ts';

describe('API keys', () => {
  it('verifies generated keys and rejects tampering, expiry and disabled keys', () => {
    const a = generateApiKey('a', ['bc.read']);
    const b = generateApiKey('b', ['bc.write'], new Date(Date.now() - 1000).toISOString());
    const c = generateApiKey('c', ['bc.read']);
    const store = new ApiKeyStore([a.record, b.record, { ...c.record, disabled: true }]);
    const p = store.verify(a.key);
    assert.equal(p?.id, `apikey:${a.record.id}`);
    assert.ok(p?.scopes.has('bc.read'));
    assert.equal(store.verify(a.key.slice(0, -1) + (a.key.endsWith('A') ? 'B' : 'A')), null);
    assert.equal(store.verify(b.key), null, 'expired');
    assert.equal(store.verify(c.key), null, 'disabled');
    assert.equal(store.verify('obk_garbage'), null);
    assert.ok(!JSON.stringify(a.record).includes(a.key.split('_')[2]), 'plaintext secret is not stored');
  });
});

describe('scopes', () => {
  const p = (scopes: string[]): Principal => ({ id: 'x', kind: 'apikey', displayName: 'x', scopes: new Set(scopes) });
  it('supports global and per-entity scopes; delete needs bc.delete + write', () => {
    assert.ok(canAccessEntity(p(['bc.read']), 'customers', 'read'));
    assert.ok(!canAccessEntity(p(['bc.read']), 'customers', 'write'));
    assert.ok(canAccessEntity(p(['bc.customers.write']), 'customers', 'write'));
    assert.ok(!canAccessEntity(p(['bc.customers.write']), 'vendors', 'write'));
    assert.ok(!canAccessEntity(p(['bc.write']), 'customers', 'delete'));
    assert.ok(canAccessEntity(p(['bc.write', 'bc.delete']), 'customers', 'delete'));
  });
});

describe('cursor codec', () => {
  const codec = new CursorCodec(Buffer.from('k'.repeat(40)));
  const bind = { e: 'customers', c: 'c1', p: 'apikey:1' };
  it('round-trips and hides the upstream URL', () => {
    const t = codec.encode({ u: 'https://api.businesscentral.dynamics.com/v2.0/tenant-secret/prod/api/v2.0/x', ...bind });
    assert.ok(!Buffer.from(t, 'base64url').toString('latin1').includes('tenant-secret'));
    assert.equal(codec.decode(t, bind).u.includes('tenant-secret'), true);
  });
  it('rejects tampering, other principals and expiry', () => {
    const t = codec.encode({ u: 'u', ...bind });
    const flipped = Buffer.from(t, 'base64url');
    flipped[20] ^= 1;
    assert.throws(() => codec.decode(flipped.toString('base64url'), bind), /Invalid/);
    assert.throws(() => codec.decode(t, { ...bind, p: 'apikey:2' }), /Invalid/);
    assert.throws(() => codec.decode(t, bind, Date.now() + 3600_000), /Invalid/);
    assert.throws(() => new CursorCodec(Buffer.from('other'.repeat(10))).decode(t, bind), /Invalid/);
  });
});

describe('rate limiter', () => {
  it('enforces burst and refills over time', () => {
    const rl = new RateLimiter(60, 3);
    const t0 = 1_000_000;
    assert.ok(rl.take('a', t0).allowed);
    assert.ok(rl.take('a', t0).allowed);
    assert.ok(rl.take('a', t0).allowed);
    const denied = rl.take('a', t0);
    assert.equal(denied.allowed, false);
    assert.ok(denied.retryAfterSec >= 1);
    assert.ok(rl.take('b', t0).allowed, 'buckets are per key');
    assert.ok(rl.take('a', t0 + 1100).allowed, 'refilled after ~1s at 60 rpm');
    rl.sweep(t0 + 3_600_000);
    assert.equal(rl.size, 0);
  });
});

describe('SSRF guard', () => {
  it('blocks private, loopback, link-local and mapped addresses', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.1.1', '169.254.169.254', '::1', 'fe80::1', 'fd00::1', '::ffff:127.0.0.1', '0.0.0.0']) {
      assert.ok(isBlockedAddress(ip), ip);
    }
    for (const ip of ['8.8.8.8', '2606:4700:4700::1111']) assert.ok(!isBlockedAddress(ip), ip);
  });
  it('rejects http, credentials and internal targets', async () => {
    const policy = { allowHttp: false, allowPrivate: false };
    await assert.rejects(assertSafeOutboundUrl('http://8.8.8.8/hook', policy), /Protocol/);
    await assert.rejects(assertSafeOutboundUrl('https://user:pw@8.8.8.8/hook', policy), /Credentials/);
    await assert.rejects(assertSafeOutboundUrl('https://169.254.169.254/latest/meta-data', policy), /blocked/);
    await assert.rejects(assertSafeOutboundUrl('https://[::1]/x', policy), /blocked/);
    await assertSafeOutboundUrl('https://8.8.8.8/hook', policy);
  });
});

describe('audit log', () => {
  it('builds a verifiable hash chain and detects tampering', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'obaudit-'));
    const file = join(dir, 'audit.jsonl');
    const log = new AuditLog(file);
    log.record({ action: 'bc.customers.get', outcome: 'success', principal: 'apikey:1' });
    log.record({ action: 'bc.customers.update', outcome: 'success', principal: 'apikey:1', details: { fields: ['city'] } });
    await log.flush();
    // a restarted instance continues the chain
    const log2 = new AuditLog(file);
    log2.record({ action: 'auth', outcome: 'denied' });
    await log2.flush();
    assert.deepEqual(await verifyAuditFile(file), { ok: true, records: 3 });

    const lines = readFileSync(file, 'utf8').trim().split('\n');
    const rec = JSON.parse(lines[1]);
    rec.principal = 'apikey:attacker';
    lines[1] = JSON.stringify(rec);
    writeFileSync(file, lines.join('\n') + '\n');
    const res = await verifyAuditFile(file);
    assert.equal(res.ok, false);
    assert.equal(res.brokenAt, 2);
  });
});

describe('log redaction', () => {
  it('redacts secrets recursively', () => {
    const out = redact({ authorization: 'Bearer x', nested: { client_secret: 's', ok: 1 }, list: [{ apiKey: 'k' }] }) as Record<string, any>;
    assert.equal(out.authorization, '[REDACTED]');
    assert.equal(out.nested.client_secret, '[REDACTED]');
    assert.equal(out.nested.ok, 1);
    assert.equal(out.list[0].apiKey, '[REDACTED]');
  });
});
