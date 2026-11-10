/** Shared JWT/OIDC fixtures for tests. */
import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto';

export const ISSUER = 'https://login.example.test/tenant/v2.0';
export const AUD = 'api://bc-openbridge';
export const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });
export const ec = generateKeyPairSync('ec', { namedCurve: 'P-256' });
export const rogue = generateKeyPairSync('rsa', { modulusLength: 2048 });

const jwk = (k: KeyObject, kid: string) => ({ ...(k.export({ format: 'jwk' }) as object), kid, use: 'sig' });
const JWKS = { keys: [jwk(rsa.publicKey, 'rsa-1'), jwk(ec.publicKey, 'ec-1')] };

export const stats = { jwksFetches: 0 };
export const fakeFetch = (async (input: string | URL) => {
  const url = String(input);
  if (url === `${ISSUER}/.well-known/openid-configuration`) {
    return Response.json({ issuer: ISSUER, jwks_uri: 'https://login.example.test/keys' });
  }
  if (url === 'https://login.example.test/keys') {
    stats.jwksFetches++;
    return Response.json(JWKS);
  }
  return new Response('not found', { status: 404 });
}) as typeof fetch;

export const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
export const now = Math.floor(Date.now() / 1000);
export const baseClaims = { iss: ISSUER, aud: AUD, sub: 'user-1', oid: 'oid-1', exp: now + 600, iat: now, nbf: now - 1, scp: 'bc.read events.read' };

export function token(claims: object = baseClaims, header: object = { alg: 'RS256', kid: 'rsa-1', typ: 'JWT' }, key: KeyObject = rsa.privateKey): string {
  const input = `${b64(header)}.${b64(claims)}`;
  const h = header as { alg: string };
  let sig: Buffer;
  if (h.alg === 'ES256') sig = sign('sha256', Buffer.from(input), { key, dsaEncoding: 'ieee-p1363' });
  else sig = sign('sha256', Buffer.from(input), key);
  return `${input}.${sig.toString('base64url')}`;
}

