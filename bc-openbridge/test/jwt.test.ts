import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { describe, it } from 'node:test';
import { JwtVerifier, scopesFromClaims } from '../src/security/jwt.ts';
import { AUD, ISSUER, b64, baseClaims, ec, fakeFetch, now, rogue, rsa, stats, token } from './jwt-fixtures.ts';

const verifier = () => new JwtVerifier({ issuer: ISSUER, audience: [AUD], fetchImpl: fakeFetch });

describe('JWT verification', () => {
  it('accepts a valid RS256 token via OIDC discovery', async () => {
    const claims = await verifier().verify(token());
    assert.equal(claims.sub, 'user-1');
    assert.deepEqual([...scopesFromClaims(claims)].sort(), ['bc.read', 'events.read']);
  });

  it('accepts ES256', async () => {
    await verifier().verify(token(baseClaims, { alg: 'ES256', kid: 'ec-1' }, ec.privateKey));
  });

  it('rejects alg=none and HMAC (algorithm confusion)', async () => {
    const v = verifier();
    const none = `${b64({ alg: 'none', kid: 'rsa-1' })}.${b64(baseClaims)}.`;
    await assert.rejects(v.verify(none), /not allowed/);
    const pub = rsa.publicKey.export({ type: 'spki', format: 'pem' });
    const input = `${b64({ alg: 'HS256', kid: 'rsa-1' })}.${b64(baseClaims)}`;
    const hs = `${input}.${createHmac('sha256', pub).update(input).digest('base64url')}`;
    await assert.rejects(v.verify(hs), /not allowed/);
  });

  it('rejects wrong key type for alg', async () => {
    await assert.rejects(verifier().verify(token(baseClaims, { alg: 'ES256', kid: 'rsa-1' }, ec.privateKey)), /Key type/);
  });

  it('rejects forged signatures', async () => {
    await assert.rejects(verifier().verify(token(baseClaims, undefined, rogue.privateKey)), /Invalid signature/);
  });

  it('enforces iss, aud, exp, nbf', async () => {
    const v = verifier();
    await assert.rejects(v.verify(token({ ...baseClaims, iss: 'https://evil.test' })), /issuer/);
    await assert.rejects(v.verify(token({ ...baseClaims, aud: 'other-api' })), /audience/);
    await assert.rejects(v.verify(token({ ...baseClaims, exp: now - 3600 })), /expired/);
    await assert.rejects(v.verify(token({ ...baseClaims, nbf: now + 3600 })), /not yet valid/);
    const { exp: _exp, ...noExp } = baseClaims;
    await assert.rejects(v.verify(token(noExp)), /Missing exp/);
  });

  it('rejects unknown kid and rate-limits JWKS refresh', async () => {
    const v = verifier();
    await v.verify(token());
    const before = stats.jwksFetches;
    await assert.rejects(v.verify(token(baseClaims, { alg: 'RS256', kid: 'unknown' })), /Unknown signing key/);
    await assert.rejects(v.verify(token(baseClaims, { alg: 'RS256', kid: 'unknown-2' })), /Unknown signing key/);
    assert.equal(stats.jwksFetches, before, 'no refetch within cooldown');
  });

  it('refuses non-HTTPS discovery', async () => {
    const v = new JwtVerifier({ issuer: 'http://insecure.test', audience: [AUD], fetchImpl: fakeFetch });
    await assert.rejects(v.verify(token({ ...baseClaims, iss: 'http://insecure.test' })), /non-HTTPS/);
  });

  it('rejects malformed tokens', async () => {
    const v = verifier();
    await assert.rejects(v.verify('a.b'), /Malformed/);
    await assert.rejects(v.verify('!!!.e30.e30'), /Malformed/);
  });
});

