/**
 * Cached metadata (companies, entity registry incl. the caller's rights) and
 * forgiving resolution of what a model typically passes: company names
 * instead of GUIDs, "Customer" instead of "customers", or no company at all
 * when there is only one.
 */
import type { Gateway, Rec } from './gateway.ts';

export interface FieldMeta {
  type: string;
  writable?: boolean;
  required?: boolean;
  maxLength?: number;
  enum?: string[];
}

export interface EntityMeta {
  name: string;
  description: string;
  operations: string[];
  requiresExtension: boolean;
  access: { read: boolean; write: boolean; delete: boolean };
  fields: Record<string, FieldMeta>;
}

export interface Company {
  id: string;
  name?: string;
  displayName?: string;
}

export class InputError extends Error {}

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isGuid = (s: string) => GUID.test(s);

export class Meta {
  readonly #gw: Gateway;
  readonly #ttlMs: number;
  #companies?: { at: number; value: Company[] };
  #entities?: { at: number; value: EntityMeta[] };

  constructor(gw: Gateway, ttlMs = 60_000) {
    this.#gw = gw;
    this.#ttlMs = ttlMs;
  }

  async companies(): Promise<Company[]> {
    if (this.#companies && Date.now() - this.#companies.at < this.#ttlMs) return this.#companies.value;
    const r = await this.#gw.get<{ data: Company[] }>('/v1/companies');
    this.#companies = { at: Date.now(), value: r.body.data };
    return r.body.data;
  }

  async entities(): Promise<EntityMeta[]> {
    if (this.#entities && Date.now() - this.#entities.at < this.#ttlMs) return this.#entities.value;
    const r = await this.#gw.get<{ data: EntityMeta[] }>('/v1/entities');
    this.#entities = { at: Date.now(), value: r.body.data };
    return r.body.data;
  }

  async entity(input: string): Promise<EntityMeta> {
    const all = await this.entities();
    const norm = input.trim().toLowerCase();
    const e =
      all.find((x) => x.name.toLowerCase() === norm) ??
      all.find((x) => x.name.toLowerCase() === `${norm}s`) ??
      all.find((x) => x.name.toLowerCase().replace(/ies$/, 'y') === norm);
    if (!e) throw new InputError(`Unknown entity "${input}". Available: ${all.map((x) => x.name).join(', ')}`);
    return e;
  }

  async company(input?: string): Promise<Company> {
    const all = await this.companies();
    if (!input) {
      if (all.length === 1) return all[0];
      throw new InputError(`Several companies are available – pass companyId (id or name): ${describeCompanies(all)}`);
    }
    const norm = input.trim().toLowerCase();
    const c =
      all.find((x) => x.id.toLowerCase() === norm) ??
      all.find((x) => x.name?.toLowerCase() === norm || x.displayName?.toLowerCase() === norm) ??
      single(all.filter((x) => `${x.name} ${x.displayName}`.toLowerCase().includes(norm)));
    if (!c) throw new InputError(`Company "${input}" not found or ambiguous. Available: ${describeCompanies(all)}`);
    return c;
  }
}

function single<T>(xs: T[]): T | undefined {
  return xs.length === 1 ? xs[0] : undefined;
}

export function describeCompanies(cs: Company[]): string {
  return cs.map((c) => `"${c.displayName ?? c.name}" (${c.id})`).join(', ');
}

export function companyLabel(c: Company): string {
  return c.displayName ?? c.name ?? c.id;
}

export type { Rec };
