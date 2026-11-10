/**
 * Configuration from environment variables (12-factor).
 * Secrets can be supplied as files via <NAME>_FILE (Docker/Kubernetes secrets).
 */
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { ApiKeyRecord } from './security/apikeys.ts';
import type { Subscriber } from './events/bus.ts';
import { logger } from './observability/log.ts';

export interface Config {
  port: number;
  host: string;
  publicBaseUrl: string;
  trustProxy: boolean;
  hsts: boolean;
  corsOrigins: string[];
  bodyLimitBytes: number;
  bc: {
    tenantId: string;
    environment: string;
    clientId: string;
    clientSecret?: string;
    certificatePem?: string;
    privateKeyPem?: string;
    apiBase: string;
    authBase: string;
    scope: string;
    allowedCompanies: string[];
    entities: string[];
    timeoutMs: number;
    maxRetries: number;
    /** entity sets to subscribe to via BC webhooks */
    subscribe: string[];
    subscriptionRenewMs: number;
  };
  oidc?: {
    issuer: string;
    audience: string[];
    jwksUri?: string;
    allowInsecure: boolean;
  };
  apiKeys: ApiKeyRecord[];
  cursorSecret: Buffer;
  webhookClientState: string;
  subscribers: Subscriber[];
  outbound: { allowHttp: boolean; allowPrivate: boolean; retryDelaysMs: number[] };
  rateLimit: { perPrincipalRpm: number; burst: number; perIpRpm: number };
  audit: { file?: string; logReads: boolean };
  metricsPublic: boolean;
  eventTypePrefix: string;
  mcp: { enabled: boolean };
}

type Env = Record<string, string | undefined>;

export class ConfigError extends Error {}

function secret(env: Env, name: string): string | undefined {
  if (env[name]) return env[name];
  const file = env[`${name}_FILE`];
  return file ? readFileSync(file, 'utf8').trim() : undefined;
}

const list = (v?: string) =>
  (v ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
const bool = (v: string | undefined, d = false) => (v === undefined ? d : /^(1|true|yes|on)$/i.test(v));
const int = (v: string | undefined, d: number) => (v === undefined || v === '' ? d : Number.parseInt(v, 10));

function readJsonFile<T>(path: string | undefined, fallbackJson?: string): T | undefined {
  if (fallbackJson) return JSON.parse(fallbackJson) as T;
  if (!path) return undefined;
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

export function loadConfig(env: Env = process.env): Config {
  const problems: string[] = [];
  const need = (name: string, v: string | undefined) => {
    if (!v) problems.push(`${name} is required`);
    return v ?? '';
  };

  const port = int(env.PORT, 8080);
  const publicBaseUrl = (env.PUBLIC_BASE_URL ?? `http://localhost:${port}`).replace(/\/$/, '');
  const apiBase = env.BC_API_BASE ?? 'https://api.businesscentral.dynamics.com';
  const authBase = env.BC_AUTH_BASE ?? 'https://login.microsoftonline.com';
  const allowInsecureUpstream = bool(env.BC_ALLOW_INSECURE);
  for (const [name, url] of [
    ['BC_API_BASE', apiBase],
    ['BC_AUTH_BASE', authBase],
  ] as const) {
    if (!url.startsWith('https://') && !allowInsecureUpstream) problems.push(`${name} must use https (set BC_ALLOW_INSECURE=true only for local mocks)`);
  }

  const certFile = env.BC_CLIENT_CERT_FILE;
  const keyFile = env.BC_CLIENT_KEY_FILE;
  const clientSecret = secret(env, 'BC_CLIENT_SECRET');
  if (!clientSecret && !(certFile && keyFile)) problems.push('BC_CLIENT_SECRET or BC_CLIENT_CERT_FILE + BC_CLIENT_KEY_FILE is required');

  let cursorSecret = secret(env, 'CURSOR_SECRET');
  if (!cursorSecret) {
    logger.warn('CURSOR_SECRET not set – using an ephemeral key (cursors break on restart and across replicas)');
    cursorSecret = randomBytes(32).toString('base64url');
  } else if (cursorSecret.length < 32) problems.push('CURSOR_SECRET must be at least 32 characters');

  let clientState = secret(env, 'BC_WEBHOOK_CLIENT_STATE');
  if (!clientState) clientState = randomBytes(24).toString('base64url');
  else if (clientState.length < 16) problems.push('BC_WEBHOOK_CLIENT_STATE must be at least 16 characters');

  const oidcIssuer = env.OIDC_ISSUER;
  const oidc = oidcIssuer
    ? {
        issuer: oidcIssuer,
        audience: list(need('OIDC_AUDIENCE', env.OIDC_AUDIENCE)),
        jwksUri: env.OIDC_JWKS_URI,
        allowInsecure: bool(env.OIDC_ALLOW_INSECURE),
      }
    : undefined;

  let apiKeys: ApiKeyRecord[] = [];
  let subscribers: Subscriber[] = [];
  try {
    apiKeys = readJsonFile<ApiKeyRecord[]>(env.API_KEYS_FILE, env.API_KEYS_JSON) ?? [];
  } catch (e) {
    problems.push(`API keys could not be loaded: ${(e as Error).message}`);
  }
  try {
    subscribers = readJsonFile<Subscriber[]>(env.EVENT_SUBSCRIBERS_FILE, env.EVENT_SUBSCRIBERS_JSON) ?? [];
  } catch (e) {
    problems.push(`Event subscribers could not be loaded: ${(e as Error).message}`);
  }
  if (!oidc && apiKeys.length === 0) problems.push('Configure OIDC_ISSUER and/or API keys – otherwise nobody can authenticate');

  const config: Config = {
    port,
    host: env.HOST ?? '0.0.0.0',
    publicBaseUrl,
    trustProxy: bool(env.TRUST_PROXY),
    hsts: bool(env.HSTS, publicBaseUrl.startsWith('https://')),
    corsOrigins: list(env.CORS_ORIGINS),
    bodyLimitBytes: int(env.BODY_LIMIT_BYTES, 256 * 1024),
    bc: {
      tenantId: need('BC_TENANT_ID', env.BC_TENANT_ID),
      environment: env.BC_ENVIRONMENT ?? 'production',
      clientId: need('BC_CLIENT_ID', env.BC_CLIENT_ID),
      clientSecret,
      certificatePem: certFile ? readFileSync(certFile, 'utf8') : undefined,
      privateKeyPem: keyFile ? readFileSync(keyFile, 'utf8') : undefined,
      apiBase,
      authBase,
      scope: env.BC_SCOPE ?? 'https://api.businesscentral.dynamics.com/.default',
      allowedCompanies: list(env.BC_ALLOWED_COMPANIES).map((c) => c.toLowerCase()),
      entities: list(env.BC_ENTITIES),
      timeoutMs: int(env.BC_TIMEOUT_MS, 30_000),
      maxRetries: int(env.BC_MAX_RETRIES, 4),
      subscribe: list(env.BC_SUBSCRIBE),
      subscriptionRenewMs: int(env.BC_SUBSCRIPTION_RENEW_MS, 12 * 3600_000),
    },
    oidc,
    apiKeys,
    cursorSecret: Buffer.from(cursorSecret, 'utf8'),
    webhookClientState: clientState,
    subscribers,
    outbound: {
      allowHttp: bool(env.OUTBOUND_ALLOW_HTTP),
      allowPrivate: bool(env.OUTBOUND_ALLOW_PRIVATE),
      retryDelaysMs: list(env.OUTBOUND_RETRY_DELAYS_MS).map(Number).filter((n) => n >= 0).length
        ? list(env.OUTBOUND_RETRY_DELAYS_MS).map(Number)
        : [1_000, 10_000, 60_000, 300_000, 1_800_000],
    },
    rateLimit: {
      perPrincipalRpm: int(env.RATE_LIMIT_RPM, 600),
      burst: int(env.RATE_LIMIT_BURST, 100),
      perIpRpm: int(env.RATE_LIMIT_IP_RPM, 1200),
    },
    audit: { file: env.AUDIT_LOG_FILE, logReads: bool(env.AUDIT_LOG_READS, true) },
    metricsPublic: bool(env.METRICS_PUBLIC),
    eventTypePrefix: env.EVENT_TYPE_PREFIX ?? 'io.openbridge.bc',
    mcp: { enabled: bool(env.MCP_ENABLED, true) },
  };

  if (problems.length) throw new ConfigError(`Invalid configuration:\n  - ${problems.join('\n  - ')}`);
  return config;
}
