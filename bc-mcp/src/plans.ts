/**
 * Two-phase writes ("prepare → show the user → apply").
 *
 * A prepare call validates the change against the registry, captures the
 * current ETag and renders a human-readable diff. Nothing is written. Only
 * bc_apply_change executes the plan:
 *   - updates use the captured ETag → if anyone changed the record in the
 *     meantime, BC rejects it (412) instead of silently overwriting;
 *   - creates use the plan id as Idempotency-Key → a retried apply never
 *     creates a duplicate.
 * Plans expire after 15 minutes and can be applied once.
 */
import { randomBytes } from 'node:crypto';
import type { Rec } from './gateway.ts';

export interface Plan {
  id: string;
  kind: 'create' | 'update';
  entity: string;
  companyId: string;
  companyLabel: string;
  recordId?: string;
  etag?: string;
  data: Rec;
  summary: string;
  expiresAt: number;
}

export class PlanStore {
  readonly #plans = new Map<string, Plan>();
  readonly #ttlMs: number;

  constructor(ttlMs = 15 * 60_000) {
    this.#ttlMs = ttlMs;
  }

  add(p: Omit<Plan, 'id' | 'expiresAt'>, now = Date.now()): Plan {
    this.#sweep(now);
    const plan: Plan = { ...p, id: `plan_${randomBytes(9).toString('base64url')}`, expiresAt: now + this.#ttlMs };
    this.#plans.set(plan.id, plan);
    return plan;
  }

  get(id: string, now = Date.now()): Plan | undefined {
    this.#sweep(now);
    return this.#plans.get(id);
  }

  delete(id: string): void {
    this.#plans.delete(id);
  }

  list(now = Date.now()): Plan[] {
    this.#sweep(now);
    return [...this.#plans.values()];
  }

  #sweep(now: number): void {
    for (const [k, p] of this.#plans) if (p.expiresAt <= now) this.#plans.delete(k);
  }
}
