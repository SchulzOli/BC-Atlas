import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, it } from 'node:test';
import { EventBus, matchesType } from '../src/events/bus.ts';
import { parseBcResource, toCloudEvent } from '../src/events/cloudevents.ts';
import { generateWebhookSecret, signWebhook, verifyWebhook } from '../src/events/standard-webhooks.ts';
import './helpers.ts';

describe('Standard Webhooks', () => {
  it('matches the reference test vector of the specification', () => {
    const sig = signWebhook('whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw', 'msg_p5jXN8AQM9LWM0D4loKWxJek', 1614265330, '{"test": 2432232314}');
    assert.equal(sig, 'v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=');
  });

  it('verifies signatures, rejects tampering and stale timestamps', () => {
    const secret = generateWebhookSecret();
    const ts = Math.floor(Date.now() / 1000);
    const body = '{"a":1}';
    const signature = signWebhook(secret, 'msg_1', ts, body);
    assert.ok(verifyWebhook(secret, { id: 'msg_1', timestamp: String(ts), signature }, body));
    assert.ok(verifyWebhook(secret, { id: 'msg_1', timestamp: String(ts), signature: `v1,bogus ${signature}` }, body), 'multiple signatures');
    assert.ok(!verifyWebhook(secret, { id: 'msg_1', timestamp: String(ts), signature }, '{"a":2}'));
    assert.ok(!verifyWebhook(secret, { id: 'msg_2', timestamp: String(ts), signature }, body));
    assert.ok(!verifyWebhook(generateWebhookSecret(), { id: 'msg_1', timestamp: String(ts), signature }, body));
    const old = ts - 3600;
    assert.ok(!verifyWebhook(secret, { id: 'msg_1', timestamp: String(old), signature: signWebhook(secret, 'msg_1', old, body) }, body));
  });
});

describe('CloudEvents mapping', () => {
  const ctx = { typePrefix: 'io.openbridge.bc', environment: 'production', publicBaseUrl: 'https://gw.example.com' };
  const company = '5d115c9c-44e3-ea11-bb43-000d3a2feca1';
  const rec = '6e2f9a10-1111-4222-8333-444455556666';

  it('parses BC resource paths incl. custom API routes', () => {
    assert.deepEqual(parseBcResource(`api/v2.0/companies(${company})/customers(${rec})`), {
      apiRoute: 'v2.0',
      companyId: company,
      entitySet: 'customers',
      id: rec,
    });
    assert.equal(parseBcResource(`api/openbridge/interop/v1.0/companies(${company})/customerLedgerEntries`)?.apiRoute, 'openbridge/interop/v1.0');
    assert.equal(parseBcResource('garbage'), null);
  });

  it('produces spec-compliant, deterministic events', () => {
    const n = {
      subscriptionId: 'sub1',
      resource: `api/v2.0/companies(${company})/customers(${rec})`,
      changeType: 'updated',
      lastModifiedDateTime: '2026-11-10T10:00:00Z',
    };
    const ev = toCloudEvent(n, ctx)!;
    assert.equal(ev.specversion, '1.0');
    assert.equal(ev.type, 'io.openbridge.bc.customers.updated');
    assert.equal(ev.source, `/businesscentral/production/companies/${company}`);
    assert.equal(ev.subject, `customers/${rec}`);
    assert.equal(ev.data.href, `https://gw.example.com/v1/companies/${company}/customers/${rec}`);
    assert.equal(toCloudEvent(n, ctx)!.id, ev.id, 'same notification → same id (dedupe)');
  });
});

describe('EventBus delivery', () => {
  it('matches type patterns', () => {
    assert.ok(matchesType(undefined, 'a.b'));
    assert.ok(matchesType(['io.openbridge.bc.customers.*'], 'io.openbridge.bc.customers.created'));
    assert.ok(!matchesType(['io.openbridge.bc.customers.*'], 'io.openbridge.bc.items.created'));
  });

  it('retries failed deliveries and dead-letters after exhausting retries', async () => {
    let calls = 0;
    const server = createServer((req, res) => {
      calls++;
      req.resume();
      res.writeHead(calls < 3 ? 500 : 204).end();
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
    const secret = generateWebhookSecret();
    const bus = new EventBus({
      subscribers: [
        { id: 'flaky', url, secret },
        { id: 'blocked', url: 'http://169.254.169.254/latest', secret },
      ],
      policy: { allowHttp: true, allowPrivate: false },
      retryDelaysMs: [5, 5],
    });
    // allowPrivate=false → the local test server is also blocked; use a permissive bus for it
    const permissive = new EventBus({ subscribers: [{ id: 'flaky', url, secret }], policy: { allowHttp: true, allowPrivate: true }, retryDelaysMs: [5, 5] });
    const ev = toCloudEvent(
      { subscriptionId: 's', resource: 'api/v2.0/companies(5d115c9c-44e3-ea11-bb43-000d3a2feca1)/items(6e2f9a10-1111-4222-8333-444455556666)', changeType: 'created' },
      { typePrefix: 'p', environment: 'e', publicBaseUrl: 'https://x' },
    )!;
    assert.ok(permissive.publish(ev));
    assert.equal(permissive.publish(ev), false, 'duplicate suppressed');
    await permissive.idle();
    assert.equal(calls, 3, 'two failures + one success');
    assert.equal(permissive.deadLetters().length, 0);

    bus.publish(ev);
    await bus.idle();
    const dead = bus.deadLetters();
    assert.equal(dead.length, 2, 'both subscribers blocked by SSRF policy');
    assert.ok(dead.every((d) => d.attempts === 3 && /blocked/.test(d.lastError ?? '')));
    assert.equal(permissive.feed(0).length, 1);
    bus.close();
    permissive.close();
    await new Promise<void>((r) => server.close(() => r()));
  });
});
