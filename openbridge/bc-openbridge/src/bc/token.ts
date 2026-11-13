/**
 * Service-to-service authentication against Microsoft Entra ID
 * (OAuth 2.0 client credentials grant, RFC 6749 §4.4).
 *
 * Two credential types:
 *  - client secret
 *  - certificate (private_key_jwt client assertion, RFC 7523) – recommended:
 *    no shared secret ever leaves the gateway.
 */
import { X509Certificate, createHash, createPrivateKey, randomUUID, sign, type KeyObject } from 'node:crypto';
import { logger } from '../observability/log.ts';

export interface TokenProviderOptions {
  authBase: string;
  tenantId: string;
  clientId: string;
  scope: string;
  clientSecret?: string;
  certificatePem?: string;
  privateKeyPem?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export class TokenError extends Error {}

export class TokenProvider {
  readonly #o: TokenProviderOptions;
  readonly #fetch: typeof fetch;
  #token: { value: string; expiresAt: number } | null = null;
  #inflight: Promise<string> | null = null;
  readonly #key?: KeyObject;
  readonly #x5t?: string;
  readonly #x5tS256?: string;

  constructor(o: TokenProviderOptions) {
    this.#o = o;
    this.#fetch = o.fetchImpl ?? fetch;
    if (o.certificatePem && o.privateKeyPem) {
      const cert = new X509Certificate(o.certificatePem);
      this.#key = createPrivateKey(o.privateKeyPem);
      this.#x5t = createHash('sha1').update(cert.raw).digest('base64url');
      this.#x5tS256 = createHash('sha256').update(cert.raw).digest('base64url');
    } else if (!o.clientSecret) {
      throw new TokenError('Either a client secret or a certificate + private key is required.');
    }
  }

  get tokenEndpoint(): string {
    return `${this.#o.authBase.replace(/\/$/, '')}/${encodeURIComponent(this.#o.tenantId)}/oauth2/v2.0/token`;
  }

  invalidate(): void {
    this.#token = null;
  }

  async getToken(now = Date.now()): Promise<string> {
    if (this.#token && this.#token.expiresAt - 120_000 > now) return this.#token.value;
    this.#inflight ??= this.#fetchToken().finally(() => {
      this.#inflight = null;
    });
    return this.#inflight;
  }

  #clientAssertion(): string {
    const now = Math.floor(Date.now() / 1000);
    const header = { alg: 'RS256', typ: 'JWT', x5t: this.#x5t, 'x5t#S256': this.#x5tS256 };
    const payload = {
      aud: this.tokenEndpoint,
      iss: this.#o.clientId,
      sub: this.#o.clientId,
      jti: randomUUID(),
      nbf: now - 30,
      iat: now,
      exp: now + 300,
    };
    const enc = (v: object) => Buffer.from(JSON.stringify(v)).toString('base64url');
    const input = `${enc(header)}.${enc(payload)}`;
    return `${input}.${sign('sha256', Buffer.from(input), this.#key!).toString('base64url')}`;
  }

  async #fetchToken(): Promise<string> {
    const form = new URLSearchParams({ grant_type: 'client_credentials', client_id: this.#o.clientId, scope: this.#o.scope });
    if (this.#key) {
      form.set('client_assertion_type', 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer');
      form.set('client_assertion', this.#clientAssertion());
    } else {
      form.set('client_secret', this.#o.clientSecret!);
    }
    const res = await this.#fetch(this.tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: form,
      signal: AbortSignal.timeout(this.#o.timeoutMs ?? 10_000),
    });
    const body = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string };
    if (!res.ok || !body.access_token) {
      logger.error('Entra ID token request failed', { status: res.status, error: body.error });
      throw new TokenError(`Token request failed (${res.status} ${body.error ?? ''})`.trim());
    }
    this.#token = { value: body.access_token, expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000 };
    return body.access_token;
  }
}
