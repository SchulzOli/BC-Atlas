/**
 * Tamper-evident audit trail (JSON Lines, SHA-256 hash chain).
 *
 * Each record contains the hash of its predecessor; modifying or deleting any
 * line breaks the chain, which `verifyAuditFile` (npm run audit:verify) detects.
 * Supports accountability requirements (GDPR Art. 5(2), GoBD, ISO 27001 A.8.15).
 * Ship the file to WORM storage / a SIEM for full non-repudiation.
 */
import { createHash } from 'node:crypto';
import { appendFile, readFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { logger } from '../observability/log.ts';

export interface AuditEvent {
  action: string;
  outcome: 'success' | 'denied' | 'failure';
  principal?: string;
  resource?: string;
  status?: number;
  traceId?: string;
  ip?: string;
  details?: Record<string, unknown>;
}

export interface AuditRecord extends AuditEvent {
  seq: number;
  ts: string;
  prev: string;
  hash: string;
}

const GENESIS = '0'.repeat(64);

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const keys = Object.keys(value as object)
    .filter((k) => (value as Record<string, unknown>)[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`).join(',')}}`;
}

function hashRecord(rec: Omit<AuditRecord, 'hash'>): string {
  return createHash('sha256').update(canonicalJson(rec)).digest('hex');
}

export class AuditLog {
  readonly #file?: string;
  #prev = GENESIS;
  #seq = 0;
  #queue: Promise<void> = Promise.resolve();
  /** Recent records kept in memory (for tests / admin inspection). */
  readonly recent: AuditRecord[] = [];

  constructor(file?: string) {
    this.#file = file;
    if (file && existsSync(file)) {
      const lines = readFileSync(file, 'utf8').trimEnd().split('\n').filter(Boolean);
      const last = lines.at(-1);
      if (last) {
        const rec = JSON.parse(last) as AuditRecord;
        this.#prev = rec.hash;
        this.#seq = rec.seq;
      }
    }
  }

  record(event: AuditEvent): AuditRecord {
    const base = { ...event, seq: ++this.#seq, ts: new Date().toISOString(), prev: this.#prev };
    const rec: AuditRecord = { ...base, hash: hashRecord(base) };
    this.#prev = rec.hash;
    this.recent.push(rec);
    if (this.recent.length > 500) this.recent.shift();
    if (this.#file) {
      const file = this.#file;
      const line = JSON.stringify(rec) + '\n';
      this.#queue = this.#queue
        .then(() => appendFile(file, line, { encoding: 'utf8', mode: 0o600 }))
        .catch((err) => logger.error('audit write failed', { err }));
    } else {
      logger.info('audit', { audit: rec });
    }
    return rec;
  }

  /** Resolves when all pending writes are flushed. */
  flush(): Promise<void> {
    return this.#queue;
  }
}

export async function verifyAuditFile(file: string): Promise<{ ok: boolean; records: number; brokenAt?: number; reason?: string }> {
  const lines = (await readFile(file, 'utf8')).split('\n').filter(Boolean);
  let prev = GENESIS;
  for (let i = 0; i < lines.length; i++) {
    let rec: AuditRecord;
    try {
      rec = JSON.parse(lines[i]);
    } catch {
      return { ok: false, records: i, brokenAt: i + 1, reason: 'unparseable line' };
    }
    const { hash, ...rest } = rec;
    if (rest.prev !== prev) return { ok: false, records: i, brokenAt: i + 1, reason: 'chain link mismatch' };
    if (hashRecord(rest) !== hash) return { ok: false, records: i, brokenAt: i + 1, reason: 'hash mismatch' };
    prev = hash;
  }
  return { ok: true, records: lines.length };
}
