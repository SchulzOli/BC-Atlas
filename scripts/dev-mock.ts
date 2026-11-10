/**
 * Local playground without a Business Central tenant:
 *   BC mock (:4010)  ←  OpenBridge gateway (:8080)  →  webhook receiver (:4020)
 *
 *   npm run dev:mock
 */
import { randomBytes } from 'node:crypto';
import { rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';
import { generateWebhookSecret } from '../src/events/standard-webhooks.ts';
import { BcMock } from '../src/mock/bc-mock.ts';
import { setLogLevel } from '../src/observability/log.ts';
import { generateApiKey } from '../src/security/apikeys.ts';
import { startEventReceiver } from '../examples/event-receiver.ts';

setLogLevel((process.env.LOG_LEVEL as 'info') ?? 'warn');

const tenant = 'demo-tenant';
const clientSecret = randomBytes(16).toString('hex');
const mock = new BcMock({ tenantId: tenant, environment: 'sandbox', clientId: 'demo-client', clientSecret, port: 4010 });
const mockUrl = await mock.start();

const whsec = generateWebhookSecret();
const receiver = await startEventReceiver({
  port: 4020,
  secret: whsec,
  onEvent: (ev) => console.log(`  ⚡ event received: ${ev.type}  ${ev.subject}`),
});

const admin = generateApiKey('demo-admin', ['bc.read', 'bc.write', 'bc.delete', 'events.read', 'mcp.use', 'metrics.read', 'admin']);
const reader = generateApiKey('demo-reader', ['bc.read', 'events.read', 'mcp.use']);
// Least-privilege key for Claude (bc-claude MCP server): read + write, no delete, no admin.
const claude = generateApiKey('claude', ['bc.read', 'bc.write', 'events.read']);
const claudeKeyFile = fileURLToPath(new URL('../.dev-claude-key', import.meta.url));
writeFileSync(claudeKeyFile, `${claude.key}\n`, { mode: 0o600 });

const config = loadConfig({
  PORT: '8080',
  HOST: '127.0.0.1',
  PUBLIC_BASE_URL: 'http://localhost:8080',
  BC_TENANT_ID: tenant,
  BC_ENVIRONMENT: 'sandbox',
  BC_CLIENT_ID: 'demo-client',
  BC_CLIENT_SECRET: clientSecret,
  BC_API_BASE: mockUrl,
  BC_AUTH_BASE: mockUrl,
  BC_ALLOW_INSECURE: 'true',
  BC_SUBSCRIBE: 'customers,items,salesOrders',
  CURSOR_SECRET: randomBytes(32).toString('base64url'),
  API_KEYS_JSON: JSON.stringify([admin.record, reader.record, claude.record]),
  EVENT_SUBSCRIBERS_JSON: JSON.stringify([{ id: 'local-receiver', url: receiver.url, secret: whsec, types: ['io.openbridge.bc.*'] }]),
  OUTBOUND_ALLOW_HTTP: 'true',
  OUTBOUND_ALLOW_PRIVATE: 'true',
  AUDIT_LOG_FILE: 'audit-dev.jsonl',
  CORS_ORIGINS: 'http://localhost:5173',
});

const app = createApp(config);
const url = await app.listen();
const report = await app.subscriptions.sync();

const companyId = String(mock.companies[0].id);
console.log(`
┌──────────────────────────────────────────────────────────────────────┐
│  BC OpenBridge – Dev-Umgebung mit Business-Central-Mock              │
└──────────────────────────────────────────────────────────────────────┘
  Gateway        ${url}
  OpenAPI        ${url}/openapi.json
  AsyncAPI       ${url}/asyncapi.json
  MCP            ${url}/mcp
  BC-Mock        ${mockUrl}
  Webhook-Sink   ${receiver.url}
  BC-Webhooks    ${report.created.length} Subscriptions angelegt

  API-Key (admin):  ${admin.key}
  API-Key (lesen):  ${reader.key}
  Claude-Key:       ${claudeKeyFile}  (für bc-claude, ohne Löschen/Admin)

  Beispiele (bash):
    export KEY=${admin.key}
    curl -s -H "Authorization: Bearer $KEY" ${url}/v1/companies
    curl -s -H "Authorization: Bearer $KEY" "${url}/v1/companies/${companyId}/customers?filter.city=Berlin&select=number,displayName,balanceDue"
    curl -s -H "Authorization: Bearer $KEY" "${url}/v1/companies/${companyId}/customers?filter.balanceDue.gt=5000&sort=-balanceDue&limit=3"
    curl -s -X POST -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" -H "Idempotency-Key: demo-0001" \\
         -d '{"displayName":"Neukunde GmbH","city":"Dresden"}' ${url}/v1/companies/${companyId}/customers
    curl -s -H "Authorization: Bearer $KEY" ${url}/v1/events

  Audit-Log: audit-dev.jsonl  (prüfen: npm run audit:verify -- audit-dev.jsonl)
  Beenden mit Strg+C
`);

process.on('SIGINT', async () => {
  rmSync(claudeKeyFile, { force: true });
  await app.close();
  await receiver.close();
  await mock.stop();
  process.exit(0);
});
