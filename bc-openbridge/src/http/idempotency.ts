/**
 * Idempotency-Key support (IETF draft-ietf-httpapi-idempotency-key-header).
 * Guarantees that a retried POST with the same key creates the record in
 * Business Central only once. Keys are scoped per principal.
 *
 * In-memory implementation – for horizontally scaled deployments replace with
 * a shared store (e.g. Redis) implementing the same interface.
 */
import { createHash } from 'node:crypto';
import { HttpError, PROBLEM, errors } from './problem.ts';

export interface StoredResponse {
  status: number;
  headers: Record<string, string>;
  body: unknown;
}

interface Entry {
  fingerprint: string;
  createdAt: number;
  response?: StoredResponse;
}

const KEY_FORMAT = /^[\x21-\x7e]{8,255}$/;

export class IdempotencyStore {
  readonly #entries = new Map<string, Entry>();
  readonly #ttlMs: number;
  readonly #maxEntries: number;

  constructor(ttlMs = 24 * 3600_000, maxEntries = 50_000) {
    this.#ttlMs = ttlMs;
    this.#maxEntries = maxEntries;
  }

  static fingerprint(parts: unknown[]): string {
    return createHash('sha256').update(JSON.stringify(parts)).digest('hex');
  }

  /**
   * Returns a stored response for replay, or `null` when the caller should
   * proceed (the key is then reserved until `complete`/`release` is called).
   */
  begin(scope: string, key: string, fingerprint: string, now = Date.now()): StoredResponse | null {
    if (!KEY_FORMAT.test(key)) throw errors.badRequest('Idempotency-Key must be 8-255 visible ASCII characters.');
    this.#evict(now);
    const id = `${scope}\u0000${key}`;
    const existing = this.#entries.get(id);
    if (existing) {
      if (existing.fingerprint !== fingerprint) {
        throw new HttpError(422, 'Unprocessable Content', 'Idempotency-Key was already used with a different request.', {
          type: PROBLEM('idempotency-key-reuse'),
        });
      }
      if (!existing.response) {
        throw new HttpError(409, 'Conflict', 'A request with this Idempotency-Key is still being processed.', {
          type: PROBLEM('idempotency-in-flight'),
          headers: { 'Retry-After': '1' },
        });
      }
      return existing.response;
    }
    this.#entries.set(id, { fingerprint, createdAt: now });
    return null;
  }

  complete(scope: string, key: string, response: StoredResponse): void {
    const e = this.#entries.get(`${scope}\u0000${key}`);
    if (e) e.response = response;
  }

  /** Release a reservation after a failure that must remain retryable (5xx, network). */
  release(scope: string, key: string): void {
    this.#entries.delete(`${scope}\u0000${key}`);
  }

  #evict(now: number): void {
    for (const [k, e] of this.#entries) {
      if (now - e.createdAt > this.#ttlMs || this.#entries.size > this.#maxEntries) this.#entries.delete(k);
      else break; // Map preserves insertion order → oldest first
    }
  }
}
