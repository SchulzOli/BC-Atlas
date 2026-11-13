/**
 * Opaque pagination cursors.
 *
 * Business Central returns `@odata.nextLink` URLs that contain tenant id and
 * environment name. Handing them to clients would (a) leak internals and (b)
 * allow clients to make the gateway fetch arbitrary URLs. Cursors are therefore
 * encrypted and authenticated with AES-256-GCM and bound to principal, entity,
 * company and an expiry.
 */
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { errors } from '../http/problem.ts';

export interface CursorPayload {
  /** upstream next link */
  u: string;
  /** entity set */
  e: string;
  /** company id */
  c: string;
  /** principal id */
  p: string;
  /** expiry epoch ms */
  x: number;
}

const AAD = Buffer.from('openbridge-cursor-v1');

export class CursorCodec {
  readonly #key: Buffer;
  readonly #ttlMs: number;

  constructor(secret: Buffer, ttlMs = 30 * 60_000) {
    this.#key = Buffer.from(hkdfSync('sha256', secret, Buffer.alloc(0), 'openbridge cursor key', 32));
    this.#ttlMs = ttlMs;
  }

  encode(p: Omit<CursorPayload, 'x'>, now = Date.now()): string {
    const iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', this.#key, iv);
    c.setAAD(AAD);
    const ct = Buffer.concat([c.update(JSON.stringify({ ...p, x: now + this.#ttlMs }), 'utf8'), c.final()]);
    return Buffer.concat([iv, ct, c.getAuthTag()]).toString('base64url');
  }

  decode(token: string, expect: { e: string; c: string; p: string }, now = Date.now()): CursorPayload {
    const invalid = () => errors.badRequest('Invalid or expired cursor. Restart the listing without a cursor.');
    if (!/^[A-Za-z0-9_-]{40,8192}$/.test(token)) throw invalid();
    const raw = Buffer.from(token, 'base64url');
    try {
      const d = createDecipheriv('aes-256-gcm', this.#key, raw.subarray(0, 12));
      d.setAAD(AAD);
      d.setAuthTag(raw.subarray(raw.length - 16));
      const pt = Buffer.concat([d.update(raw.subarray(12, raw.length - 16)), d.final()]);
      const payload = JSON.parse(pt.toString('utf8')) as CursorPayload;
      if (payload.x < now || payload.e !== expect.e || payload.c !== expect.c || payload.p !== expect.p) throw invalid();
      return payload;
    } catch {
      throw invalid();
    }
  }
}
