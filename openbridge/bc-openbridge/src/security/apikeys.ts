/**
 * API keys for machine clients that cannot do OAuth.
 *
 * Format:  obk_<8 hex id>_<43 char base64url secret>   (256 bit entropy)
 * Storage: only the SHA-256 hash is stored – a slow KDF is unnecessary for
 *          high-entropy random secrets. Comparison is constant-time.
 * The `obk_` prefix makes leaked keys detectable by secret scanners.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Principal } from './principal.ts';

export interface ApiKeyRecord {
  id: string;
  name: string;
  /** hex SHA-256 of the full key */
  hash: string;
  scopes: string[];
  /** ISO 8601 – optional expiry */
  expiresAt?: string;
  disabled?: boolean;
}

const FORMAT = /^obk_([0-9a-f]{8})_([A-Za-z0-9_-]{43})$/;

export function hashApiKey(key: string): string {
  return createHash('sha256').update(key, 'utf8').digest('hex');
}

export function generateApiKey(name: string, scopes: string[], expiresAt?: string): { key: string; record: ApiKeyRecord } {
  const id = randomBytes(4).toString('hex');
  const key = `obk_${id}_${randomBytes(32).toString('base64url')}`;
  return { key, record: { id, name, hash: hashApiKey(key), scopes, ...(expiresAt ? { expiresAt } : {}) } };
}

export function looksLikeApiKey(token: string): boolean {
  return token.startsWith('obk_');
}

const DUMMY = Buffer.alloc(32);

export class ApiKeyStore {
  readonly #byId = new Map<string, ApiKeyRecord>();

  constructor(records: ApiKeyRecord[]) {
    for (const r of records) {
      if (!/^[0-9a-f]{8}$/.test(r.id) || !/^[0-9a-f]{64}$/.test(r.hash)) {
        throw new Error(`Invalid API key record "${r.name ?? r.id}"`);
      }
      this.#byId.set(r.id, r);
    }
  }

  get size(): number {
    return this.#byId.size;
  }

  verify(key: string, now = Date.now()): Principal | null {
    const m = FORMAT.exec(key);
    const presented = createHash('sha256').update(key, 'utf8').digest();
    const rec = m ? this.#byId.get(m[1]) : undefined;
    const expected = rec ? Buffer.from(rec.hash, 'hex') : DUMMY;
    const equal = timingSafeEqual(presented, expected);
    if (!rec || !equal || rec.disabled) return null;
    if (rec.expiresAt && Date.parse(rec.expiresAt) <= now) return null;
    return { id: `apikey:${rec.id}`, kind: 'apikey', displayName: rec.name, scopes: new Set(rec.scopes) };
  }
}
