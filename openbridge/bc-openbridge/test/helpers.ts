import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp, type App, type AppOverrides } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';
import { generateWebhookSecret } from '../src/events/standard-webhooks.ts';
import { BcMock } from '../src/mock/bc-mock.ts';
import { setLogLevel } from '../src/observability/log.ts';
import { generateApiKey } from '../src/security/apikeys.ts';
import { startEventReceiver, type Receiver } from '../examples/event-receiver.ts';

setLogLevel('silent');

export async function freePort(): Promise<number> {
  const s = createServer();
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
  const { port } = s.address() as AddressInfo;
  await new Promise<void>((r) => s.close(() => r()));
  return port;
}

export const ALL_SCOPES = ['bc.read', 'bc.write', 'bc.delete', 'events.read', 'mcp.use', 'metrics.read', 'admin'];

export interface Stack {
  mock: BcMock;
  receiver: Receiver;
  app: App;
  url: string;
  keys: { admin: string; reader: string; customers: string; noScopes: string };
  companyId: string;
  otherCompanyId: string;
  req(method: string, path: string, o?: { key?: string | null; body?: unknown; headers?: Record<string, string> }): Promise<{ status: number; headers: Headers; json: any; text: string }>;
  close(): Promise<void>;
}

export async function startStack(env: Record<string, string> = {}, overrides: AppOverrides = {}): Promise<Stack> {
  const mock = new BcMock({ tenantId: 't-1', environment: 'sandbox', clientId: 'client-1', clientSecret: 'secret-1' });
  const mockUrl = await mock.start();
  const whsec = generateWebhookSecret();
  const receiver = await startEventReceiver({ port: 0, secret: whsec });
  const port = await freePort();

  const admin = generateApiKey('admin', ALL_SCOPES);
  const reader = generateApiKey('reader', ['bc.read', 'events.read', 'mcp.use']);
  const customers = generateApiKey('customers-only', ['bc.customers.read', 'bc.customers.write', 'events.read', 'mcp.use']);
  const noScopes = generateApiKey('no-scopes', []);

  const config = loadConfig({
    PORT: String(port),
    HOST: '127.0.0.1',
    PUBLIC_BASE_URL: `http://127.0.0.1:${port}`,
    BC_TENANT_ID: 't-1',
    BC_ENVIRONMENT: 'sandbox',
    BC_CLIENT_ID: 'client-1',
    BC_CLIENT_SECRET: 'secret-1',
    BC_API_BASE: mockUrl,
    BC_AUTH_BASE: mockUrl,
    BC_ALLOW_INSECURE: 'true',
    BC_MAX_RETRIES: '2',
    BC_SUBSCRIBE: 'customers,items',
    BC_WEBHOOK_CLIENT_STATE: 'client-state-for-tests-0123456789',
    CURSOR_SECRET: 'x'.repeat(40),
    API_KEYS_JSON: JSON.stringify([admin.record, reader.record, customers.record, noScopes.record]),
    EVENT_SUBSCRIBERS_JSON: JSON.stringify([{ id: 'sink', url: receiver.url, secret: whsec, types: ['io.openbridge.bc.customers.*'] }]),
    OUTBOUND_ALLOW_HTTP: 'true',
    OUTBOUND_ALLOW_PRIVATE: 'true',
    OUTBOUND_RETRY_DELAYS_MS: '10,20',
    CORS_ORIGINS: 'https://app.example.com',
    ...env,
  });
  const app = createApp(config, overrides);
  const url = await app.listen();

  return {
    mock,
    receiver,
    app,
    url,
    keys: { admin: admin.key, reader: reader.key, customers: customers.key, noScopes: noScopes.key },
    companyId: String(mock.companies[0].id),
    otherCompanyId: String(mock.companies[1].id),
    async req(method, path, o = {}) {
      const headers: Record<string, string> = { ...(o.headers ?? {}) };
      const key = o.key === undefined ? admin.key : o.key;
      if (key) headers.Authorization = `Bearer ${key}`;
      let body: string | undefined;
      if (o.body !== undefined) {
        body = typeof o.body === 'string' ? o.body : JSON.stringify(o.body);
        headers['Content-Type'] ??= 'application/json';
      }
      const res = await fetch(`${url}${path}`, { method, headers, body });
      const text = await res.text();
      let json: any = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = null;
      }
      return { status: res.status, headers: res.headers, json, text };
    },
    async close() {
      await app.close();
      await receiver.close();
      await mock.stop();
    },
  };
}
