/**
 * OAuth 2.0 / OpenID Connect access token validation (RFC 7519, RFC 7515,
 * RFC 8725 "JWT Best Current Practices", RFC 9068).
 *
 *  - Only asymmetric algorithms (RS*, PS*, ES*) – `none` and HMAC are rejected,
 *    which prevents algorithm-confusion attacks.
 *  - Keys come exclusively from the issuer's JWKS (fetched over HTTPS, discovered
 *    via OIDC metadata with issuer mix-up check). Embedded `jwk`/`jku`/`x5u`
 *    headers are ignored.
 *  - `iss`, `aud`, `exp`, `nbf`, `iat` are enforced with a small clock skew.
 */
import { constants, createPublicKey, verify as cryptoVerify, type KeyObject } from 'node:crypto';

export type JwtClaims = Record<string, unknown> & {
  iss?: string;
  sub?: string;
  aud?: string | string[];
  exp?: number;
  nbf?: number;
  iat?: number;
};

export class JwtError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JwtError';
  }
}

interface AlgSpec {
  hash: string;
  kty: 'RSA' | 'EC';
  pss?: boolean;
  crv?: string;
}

const ALGS: Record<string, AlgSpec> = {
  RS256: { hash: 'sha256', kty: 'RSA' },
  RS384: { hash: 'sha384', kty: 'RSA' },
  RS512: { hash: 'sha512', kty: 'RSA' },
  PS256: { hash: 'sha256', kty: 'RSA', pss: true },
  PS384: { hash: 'sha384', kty: 'RSA', pss: true },
  PS512: { hash: 'sha512', kty: 'RSA', pss: true },
  ES256: { hash: 'sha256', kty: 'EC', crv: 'P-256' },
  ES384: { hash: 'sha384', kty: 'EC', crv: 'P-384' },
};

export interface JwtVerifierOptions {
  issuer: string;
  audience: string[];
  jwksUri?: string;
  clockToleranceSec?: number;
  /** Allow http:// URLs for discovery/JWKS (tests and local mocks only). */
  allowInsecure?: boolean;
  fetchImpl?: typeof fetch;
  /** Minimum interval between JWKS refreshes triggered by unknown `kid`s. */
  refreshCooldownMs?: number;
}

interface CachedKey {
  key: KeyObject;
  kty: string;
  alg?: string;
  crv?: string;
}

interface Jwk {
  kty?: string;
  kid?: string;
  use?: string;
  alg?: string;
  n?: string;
  e?: string;
  crv?: string;
  x?: string;
  y?: string;
}

function decodeSegment(seg: string, what: string): Record<string, unknown> {
  if (!/^[A-Za-z0-9_-]+$/.test(seg)) throw new JwtError(`Malformed ${what}`);
  try {
    const v = JSON.parse(Buffer.from(seg, 'base64url').toString('utf8'));
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new Error();
    return v;
  } catch {
    throw new JwtError(`Malformed ${what}`);
  }
}

export class JwtVerifier {
  readonly #opts: Required<Omit<JwtVerifierOptions, 'jwksUri'>> & { jwksUri?: string };
  readonly #keys = new Map<string, CachedKey>();
  #lastFetch = 0;
  #inflight: Promise<void> | null = null;

  constructor(opts: JwtVerifierOptions) {
    this.#opts = {
      clockToleranceSec: 60,
      allowInsecure: false,
      fetchImpl: fetch,
      refreshCooldownMs: 60_000,
      ...opts,
    };
  }

  async verify(token: string, now = Math.floor(Date.now() / 1000)): Promise<JwtClaims> {
    if (token.length > 16_384) throw new JwtError('Token too large');
    const parts = token.split('.');
    if (parts.length !== 3) throw new JwtError('Malformed token');
    const header = decodeSegment(parts[0], 'header');
    const claims = decodeSegment(parts[1], 'payload') as JwtClaims;

    const alg = String(header.alg ?? '');
    const spec = ALGS[alg];
    if (!spec) throw new JwtError(`Algorithm "${alg}" is not allowed`);
    if (header.crit !== undefined) throw new JwtError('Unsupported critical header');
    if (header.typ !== undefined && !/^(jwt|at\+jwt|application\/at\+jwt)$/i.test(String(header.typ))) {
      throw new JwtError('Unexpected token type');
    }
    if (typeof header.kid !== 'string' || header.kid.length === 0) throw new JwtError('Missing key id');

    const k = await this.#getKey(header.kid);
    if (k.kty !== spec.kty) throw new JwtError('Key type does not match algorithm');
    if (k.alg && k.alg !== alg) throw new JwtError('Key algorithm mismatch');
    if (spec.crv && k.crv !== spec.crv) throw new JwtError('Curve mismatch');

    const signature = Buffer.from(parts[2], 'base64url');
    const data = Buffer.from(`${parts[0]}.${parts[1]}`, 'ascii');
    let ok = false;
    try {
      if (spec.kty === 'EC') ok = cryptoVerify(spec.hash, data, { key: k.key, dsaEncoding: 'ieee-p1363' }, signature);
      else if (spec.pss)
        ok = cryptoVerify(
          spec.hash,
          data,
          { key: k.key, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: constants.RSA_PSS_SALTLEN_DIGEST },
          signature,
        );
      else ok = cryptoVerify(spec.hash, data, k.key, signature);
    } catch {
      ok = false;
    }
    if (!ok) throw new JwtError('Invalid signature');

    this.#checkClaims(claims, now);
    return claims;
  }

  #checkClaims(c: JwtClaims, now: number): void {
    const tol = this.#opts.clockToleranceSec;
    if (typeof c.exp !== 'number') throw new JwtError('Missing exp');
    if (now - tol >= c.exp) throw new JwtError('Token expired');
    if (typeof c.nbf === 'number' && now + tol < c.nbf) throw new JwtError('Token not yet valid');
    if (typeof c.iat === 'number' && now + tol < c.iat) throw new JwtError('Token issued in the future');
    if (c.iss !== this.#opts.issuer) throw new JwtError('Invalid issuer');
    const aud = Array.isArray(c.aud) ? c.aud : c.aud !== undefined ? [c.aud] : [];
    if (!aud.some((a) => this.#opts.audience.includes(a))) throw new JwtError('Invalid audience');
  }

  async #getKey(kid: string): Promise<CachedKey> {
    let k = this.#keys.get(kid);
    if (k) return k;
    if (Date.now() - this.#lastFetch >= this.#opts.refreshCooldownMs || this.#lastFetch === 0) {
      await this.refresh();
      k = this.#keys.get(kid);
    }
    if (!k) throw new JwtError('Unknown signing key');
    return k;
  }

  /** (Re)load the JWKS. Concurrent callers share one request. */
  refresh(): Promise<void> {
    this.#inflight ??= this.#load().finally(() => {
      this.#inflight = null;
    });
    return this.#inflight;
  }

  async #load(): Promise<void> {
    this.#lastFetch = Date.now();
    const jwksUri = this.#opts.jwksUri ?? (await this.#discover());
    const jwks = (await this.#fetchJson(jwksUri)) as { keys?: Jwk[] };
    if (!Array.isArray(jwks.keys)) throw new JwtError('Invalid JWKS');
    this.#keys.clear();
    for (const jwk of jwks.keys) {
      if (!jwk.kid || (jwk.use && jwk.use !== 'sig')) continue;
      try {
        const minimal =
          jwk.kty === 'RSA'
            ? { kty: 'RSA', n: jwk.n, e: jwk.e }
            : jwk.kty === 'EC'
              ? { kty: 'EC', crv: jwk.crv, x: jwk.x, y: jwk.y }
              : null;
        if (!minimal) continue;
        const key = createPublicKey({ key: minimal as never, format: 'jwk' });
        this.#keys.set(jwk.kid, { key, kty: jwk.kty!, alg: jwk.alg, crv: jwk.crv });
      } catch {
        // skip unusable keys
      }
    }
  }

  async #discover(): Promise<string> {
    const url = `${this.#opts.issuer.replace(/\/$/, '')}/.well-known/openid-configuration`;
    const meta = (await this.#fetchJson(url)) as { issuer?: string; jwks_uri?: string };
    if (meta.issuer !== this.#opts.issuer) throw new JwtError('OIDC metadata issuer mismatch');
    if (!meta.jwks_uri) throw new JwtError('OIDC metadata without jwks_uri');
    this.#opts.jwksUri = meta.jwks_uri;
    return meta.jwks_uri;
  }

  async #fetchJson(url: string): Promise<unknown> {
    const u = new URL(url);
    if (u.protocol !== 'https:' && !this.#opts.allowInsecure) throw new JwtError(`Refusing non-HTTPS URL ${u.origin}`);
    const res = await this.#opts.fetchImpl(u, { signal: AbortSignal.timeout(5000), headers: { Accept: 'application/json' } });
    if (!res.ok) throw new JwtError(`Fetching ${u.origin}${u.pathname} failed with ${res.status}`);
    return res.json();
  }
}

/** Extract OAuth scopes from common claim shapes (scp, scope, roles – Entra ID & generic OIDC). */
export function scopesFromClaims(c: JwtClaims): Set<string> {
  const out = new Set<string>();
  for (const claim of ['scp', 'scope']) {
    const v = c[claim];
    if (typeof v === 'string') v.split(' ').filter(Boolean).forEach((s) => out.add(s));
    else if (Array.isArray(v)) v.forEach((s) => typeof s === 'string' && out.add(s));
  }
  if (Array.isArray(c.roles)) c.roles.forEach((r) => typeof r === 'string' && out.add(r));
  return out;
}
