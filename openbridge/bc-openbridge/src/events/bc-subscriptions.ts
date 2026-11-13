/**
 * Manages Business Central webhook subscriptions (API v2.0 `subscriptions`).
 * BC subscriptions expire after 3 days – the manager creates missing ones and
 * renews those that expire within the renewal window.
 */
import type { BcClient, ODataCollection } from '../bc/client.ts';
import type { EntityDef } from '../bc/entities.ts';
import { logger } from '../observability/log.ts';

export interface BcSubscription {
  subscriptionId: string;
  notificationUrl: string;
  resource: string;
  expirationDateTime?: string;
  '@odata.etag'?: string;
}

export interface SubscriptionManagerOptions {
  bc: BcClient;
  entities: Record<string, EntityDef>;
  notificationUrl: string;
  clientState: string;
  subscribe: string[];
  allowedCompanies: string[];
  renewIntervalMs: number;
  /** renew when expiring within this window (default 36 h) */
  renewWindowMs?: number;
}

export interface SyncReport {
  created: string[];
  renewed: string[];
  unchanged: string[];
  errors: { resource: string; error: string }[];
}

export class BcSubscriptionManager {
  readonly #o: SubscriptionManagerOptions;
  #timer?: NodeJS.Timeout;
  lastReport?: SyncReport & { at: string };

  constructor(o: SubscriptionManagerOptions) {
    this.#o = o;
    for (const name of o.subscribe) {
      const e = o.entities[name];
      if (!e) throw new Error(`BC_SUBSCRIBE: unknown entity set "${name}"`);
      if (!e.webhooks) throw new Error(`BC_SUBSCRIBE: entity set "${name}" does not support webhooks`);
    }
  }

  get enabled(): boolean {
    return this.#o.subscribe.length > 0;
  }

  async #companies(): Promise<string[]> {
    if (this.#o.allowedCompanies.length) return this.#o.allowedCompanies;
    const res = await this.#o.bc.request<ODataCollection>('GET', this.#o.bc.url('v2.0', 'companies', { $select: 'id' }), { op: 'list:companies' });
    return res.body.value.map((c) => String(c.id).toLowerCase());
  }

  async list(): Promise<BcSubscription[]> {
    const res = await this.#o.bc.request<ODataCollection<BcSubscription>>('GET', this.#o.bc.url('v2.0', 'subscriptions'), { op: 'list:subscriptions' });
    return res.body.value.filter((s) => s.notificationUrl === this.#o.notificationUrl);
  }

  async sync(now = Date.now()): Promise<SyncReport> {
    const report: SyncReport = { created: [], renewed: [], unchanged: [], errors: [] };
    if (!this.enabled) return report;
    const existing = await this.list();
    const window = this.#o.renewWindowMs ?? 36 * 3600_000;
    for (const company of await this.#companies()) {
      for (const name of this.#o.subscribe) {
        const e = this.#o.entities[name];
        const resource = `api/${e.apiRoute}/companies(${company})/${e.name}`;
        const body = { notificationUrl: this.#o.notificationUrl, resource, clientState: this.#o.clientState };
        try {
          const found = existing.find((s) => s.resource.toLowerCase() === resource.toLowerCase());
          if (!found) {
            await this.#o.bc.request('POST', this.#o.bc.url('v2.0', 'subscriptions'), { body, op: 'create:subscription' });
            report.created.push(resource);
          } else if (!found.expirationDateTime || Date.parse(found.expirationDateTime) - now < window) {
            await this.#o.bc.request('PATCH', this.#o.bc.url('v2.0', `subscriptions('${encodeURIComponent(found.subscriptionId)}')`), {
              body,
              ifMatch: found['@odata.etag'] ?? '*',
              op: 'renew:subscription',
            });
            report.renewed.push(resource);
          } else {
            report.unchanged.push(resource);
          }
        } catch (err) {
          report.errors.push({ resource, error: (err as Error).message });
        }
      }
    }
    this.lastReport = { ...report, at: new Date(now).toISOString() };
    logger.info('BC webhook subscriptions synchronised', {
      created: report.created.length,
      renewed: report.renewed.length,
      unchanged: report.unchanged.length,
      errors: report.errors,
    });
    return report;
  }

  start(): void {
    if (!this.enabled || this.#timer) return;
    const run = () => this.sync().catch((err) => logger.error('subscription sync failed', { err }));
    setTimeout(run, 2000).unref();
    this.#timer = setInterval(run, this.#o.renewIntervalMs);
    this.#timer.unref();
  }

  stop(): void {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = undefined;
  }
}
