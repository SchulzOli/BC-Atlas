/**
 * Event bus: de-duplicates incoming CloudEvents, keeps a pollable feed and
 * fans events out to webhook subscribers with Standard-Webhooks signatures,
 * SSRF protection, retries with backoff and a dead-letter list.
 *
 * Delivery is at-least-once; receivers de-duplicate via `webhook-id`.
 * For production fan-out at scale, forward events to a broker instead (the
 * CloudEvents format maps 1:1 onto Kafka/AMQP/MQTT/NATS protocol bindings).
 */
import { logger } from '../observability/log.ts';
import type { Metrics } from '../observability/metrics.ts';
import { assertSafeOutboundUrl, type OutboundPolicy } from '../security/ssrf.ts';
import type { CloudEvent } from './cloudevents.ts';
import { signWebhook } from './standard-webhooks.ts';

export interface Subscriber {
  id: string;
  url: string;
  /** Standard Webhooks secret (whsec_…) */
  secret: string;
  /** event type patterns, `*` suffix wildcard. Empty = all */
  types?: string[];
  /** company ids. Empty = all */
  companies?: string[];
  enabled?: boolean;
}

export interface Delivery {
  subscriberId: string;
  eventId: string;
  eventType: string;
  attempts: number;
  state: 'pending' | 'delivered' | 'failed';
  lastStatus?: number;
  lastError?: string;
  updatedAt: string;
}

export interface FeedEntry {
  seq: number;
  event: CloudEvent;
}

export interface EventBusOptions {
  subscribers: Subscriber[];
  policy: OutboundPolicy;
  retryDelaysMs: number[];
  metrics?: Metrics;
  fetchImpl?: typeof fetch;
  feedSize?: number;
  timeoutMs?: number;
}

export function matchesType(patterns: string[] | undefined, type: string): boolean {
  if (!patterns || patterns.length === 0) return true;
  return patterns.some((p) => (p.endsWith('*') ? type.startsWith(p.slice(0, -1)) : p === type));
}

export class EventBus {
  readonly #o: EventBusOptions;
  readonly #fetch: typeof fetch;
  readonly #feed: FeedEntry[] = [];
  #seq = 0;
  readonly #seen = new Set<string>();
  readonly #deadLetters: Delivery[] = [];
  readonly #pending = new Set<Promise<void>>();
  readonly #timers = new Set<NodeJS.Timeout>();
  #closed = false;

  constructor(o: EventBusOptions) {
    this.#o = o;
    this.#fetch = o.fetchImpl ?? fetch;
    for (const s of o.subscribers) {
      if (!s.id || !s.url || !s.secret) throw new Error('Subscriber requires id, url and secret');
    }
  }

  /** Publish an event. Returns false for duplicates. */
  publish(ev: CloudEvent): boolean {
    if (this.#seen.has(ev.id)) return false;
    this.#seen.add(ev.id);
    if (this.#seen.size > 10_000) this.#seen.delete(this.#seen.values().next().value!);

    this.#feed.push({ seq: ++this.#seq, event: ev });
    if (this.#feed.length > (this.#o.feedSize ?? 1000)) this.#feed.shift();

    const company = (ev.data as { companyId?: string } | null)?.companyId;
    for (const sub of this.#o.subscribers) {
      if (sub.enabled === false || !matchesType(sub.types, ev.type)) continue;
      if (sub.companies?.length && (!company || !sub.companies.includes(company))) continue;
      const d: Delivery = {
        subscriberId: sub.id,
        eventId: ev.id,
        eventType: ev.type,
        attempts: 0,
        state: 'pending',
        updatedAt: new Date().toISOString(),
      };
      this.#track(this.#attempt(sub, ev, JSON.stringify(ev), d));
    }
    return true;
  }

  /** Events after a sequence number (for polling clients). */
  feed(after = 0, limit = 100): FeedEntry[] {
    return this.#feed.filter((e) => e.seq > after).slice(0, limit);
  }

  get lastSeq(): number {
    return this.#seq;
  }

  deadLetters(): Delivery[] {
    return [...this.#deadLetters];
  }

  /** Wait until all in-flight deliveries (incl. scheduled retries) are done. */
  async idle(): Promise<void> {
    while (this.#pending.size) await Promise.allSettled([...this.#pending]);
  }

  close(): void {
    this.#closed = true;
    for (const t of this.#timers) clearTimeout(t);
    this.#timers.clear();
    this.#pending.clear();
  }

  #track(p: Promise<void>): void {
    this.#pending.add(p);
    p.finally(() => this.#pending.delete(p));
  }

  async #attempt(sub: Subscriber, ev: CloudEvent, body: string, d: Delivery): Promise<void> {
    if (this.#closed) return;
    d.attempts++;
    let permanent = false;
    try {
      const url = await assertSafeOutboundUrl(sub.url, this.#o.policy);
      const ts = Math.floor(Date.now() / 1000);
      const res = await this.#fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/cloudevents+json; charset=utf-8',
          'User-Agent': 'bc-openbridge-webhooks/0.1',
          'webhook-id': ev.id,
          'webhook-timestamp': String(ts),
          'webhook-signature': signWebhook(sub.secret, ev.id, ts, body),
          ...(ev.traceparent ? { traceparent: ev.traceparent } : {}),
        },
        body,
        redirect: 'manual',
        signal: AbortSignal.timeout(this.#o.timeoutMs ?? 10_000),
      });
      await res.body?.cancel();
      d.lastStatus = res.status;
      if (res.status >= 200 && res.status < 300) {
        d.state = 'delivered';
        d.updatedAt = new Date().toISOString();
        this.#o.metrics?.webhookDeliveries.inc({ subscriber: sub.id, outcome: 'delivered' });
        return;
      }
      permanent = res.status === 410; // Gone → receiver asks us to stop
      throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      d.lastError = (err as Error).message;
      d.updatedAt = new Date().toISOString();
      this.#o.metrics?.webhookDeliveries.inc({ subscriber: sub.id, outcome: 'error' });
      const delay = this.#o.retryDelaysMs[d.attempts - 1];
      if (!permanent && delay !== undefined && !this.#closed) {
        this.#track(
          new Promise<void>((resolve) => {
            const t = setTimeout(() => {
              this.#timers.delete(t);
              this.#attempt(sub, ev, body, d).finally(resolve);
            }, delay);
            t.unref();
            this.#timers.add(t);
          }),
        );
        return;
      }
      d.state = 'failed';
      this.#deadLetters.push(d);
      if (this.#deadLetters.length > 1000) this.#deadLetters.shift();
      logger.warn('webhook delivery failed permanently', { subscriber: sub.id, eventId: ev.id, error: d.lastError });
    }
  }
}
