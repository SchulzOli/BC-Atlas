/**
 * Authentication: OAuth 2.0 Bearer tokens (RFC 6750) validated as JWTs, or API keys.
 * 401 responses carry RFC 9728 `resource_metadata` so that OAuth-capable clients
 * (including MCP clients) can discover the authorization server automatically.
 */
import type { IncomingMessage } from 'node:http';
import { HttpError, PROBLEM } from '../http/problem.ts';
import { ApiKeyStore, looksLikeApiKey } from './apikeys.ts';
import { JwtError, JwtVerifier, scopesFromClaims } from './jwt.ts';
import type { Principal } from './principal.ts';

export interface AuthenticatorOptions {
  verifier?: JwtVerifier;
  apiKeys: ApiKeyStore;
  resourceMetadataUrl?: string;
}

export class Authenticator {
  readonly #opts: AuthenticatorOptions;

  constructor(opts: AuthenticatorOptions) {
    this.#opts = opts;
  }

  #challenge(error?: string, description?: string): string {
    const parts = ['realm="openbridge"'];
    if (this.#opts.resourceMetadataUrl) parts.push(`resource_metadata="${this.#opts.resourceMetadataUrl}"`);
    if (error) parts.push(`error="${error}"`);
    if (description) parts.push(`error_description="${description.replace(/"/g, "'")}"`);
    return `Bearer ${parts.join(', ')}`;
  }

  #unauthorized(error?: string, description?: string): HttpError {
    return new HttpError(401, 'Unauthorized', description ?? 'Authentication required.', {
      type: PROBLEM('unauthorized'),
      headers: { 'WWW-Authenticate': this.#challenge(error, description) },
    });
  }

  async authenticate(req: IncomingMessage): Promise<Principal> {
    const token = extractCredential(req);
    if (!token) throw this.#unauthorized();

    if (looksLikeApiKey(token)) {
      const p = this.#opts.apiKeys.verify(token);
      if (!p) throw this.#unauthorized('invalid_token', 'Invalid API key');
      return p;
    }

    if (!this.#opts.verifier) throw this.#unauthorized('invalid_token', 'OAuth tokens are not enabled');
    try {
      const claims = await this.#opts.verifier.verify(token);
      const subject = String(claims.oid ?? claims.sub ?? '');
      if (!subject) throw new JwtError('Token without subject');
      return {
        id: `jwt:${subject}`,
        kind: 'jwt',
        displayName: String(claims.name ?? claims.preferred_username ?? claims.azp ?? claims.appid ?? subject),
        scopes: scopesFromClaims(claims),
      };
    } catch (e) {
      if (e instanceof JwtError) throw this.#unauthorized('invalid_token', e.message);
      throw new HttpError(503, 'Service Unavailable', 'Token validation is temporarily unavailable.', {
        headers: { 'Retry-After': '5' },
      });
    }
  }
}

export function extractCredential(req: IncomingMessage): string | null {
  const auth = req.headers.authorization;
  if (auth) {
    const m = /^Bearer\s+([A-Za-z0-9\-._~+/]+=*)$/i.exec(auth.trim());
    return m ? m[1] : null;
  }
  const key = req.headers['x-api-key'];
  return typeof key === 'string' && key.length > 0 ? key.trim() : null;
}
