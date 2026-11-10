/**
 * Business logic shared by all northbound protocols (REST, MCP, …):
 * authorization, validation, company allow-listing, output projection,
 * cursor handling and auditing. Protocol adapters stay thin.
 */
import type { BcClient, ODataCollection } from '../bc/client.ts';
import { COMPANY_FIELDS, type EntityDef, type FieldDef, type Operation } from '../bc/entities.ts';
import { buildFilter, buildOrderBy, buildSelect, isGuid, type ListQuery } from '../bc/odata.ts';
import { HttpError, PROBLEM, errors, type FieldError } from '../http/problem.ts';
import type { TraceContext } from '../observability/trace.ts';
import type { AuditLog } from '../security/audit.ts';
import type { CursorCodec } from '../security/cursor.ts';
import { hasAnyRead, requireEntityAccess, type Access, type Principal } from '../security/principal.ts';

export interface CallContext {
  principal: Principal;
  trace: TraceContext;
  ip?: string;
  /** protocol that triggered the call, for the audit trail */
  channel: 'rest' | 'mcp';
}

export interface ServiceDeps {
  bc: BcClient;
  entities: Record<string, EntityDef>;
  allowedCompanies: string[];
  audit: AuditLog;
  cursors: CursorCodec;
  logReads: boolean;
}

export type Rec = Record<string, unknown>;

export interface ListResult {
  data: Rec[];
  nextCursor?: string;
}

export interface ItemResult {
  record: Rec;
  etag?: string;
}

const OP_ACCESS: Record<Operation, Access> = { list: 'read', get: 'read', create: 'write', update: 'write', delete: 'delete' };

export class BcService {
  readonly #d: ServiceDeps;

  constructor(deps: ServiceDeps) {
    this.#d = deps;
  }

  get entities(): Record<string, EntityDef> {
    return this.#d.entities;
  }

  entity(name: string): EntityDef {
    const e = Object.hasOwn(this.#d.entities, name) ? this.#d.entities[name] : undefined;
    if (!e) throw errors.notFound(`Unknown entity set "${name}".`);
    return e;
  }

  #authorize(ctx: CallContext, e: EntityDef, op: Operation): void {
    if (!e.operations.includes(op)) {
      throw new HttpError(405, 'Method Not Allowed', `Operation "${op}" is not supported for ${e.name}.`, {
        type: PROBLEM('operation-not-supported'),
      });
    }
    requireEntityAccess(ctx.principal, e.name, OP_ACCESS[op]);
  }

  #company(companyId: string): string {
    if (!isGuid(companyId)) throw errors.badRequest('companyId must be a GUID.');
    const c = companyId.toLowerCase();
    const allowed = this.#d.allowedCompanies;
    if (allowed.length && !allowed.includes(c)) throw errors.forbidden('This company is not enabled for the gateway.');
    return c;
  }

  #id(id: string): string {
    if (!isGuid(id)) throw errors.badRequest('id must be a GUID.');
    return id.toLowerCase();
  }

  /** Run an operation and write an audit record for both success and failure. */
  async #audited<T>(ctx: CallContext, action: string, resource: string, audit: boolean, fn: () => Promise<T>, details?: Rec): Promise<T> {
    try {
      const result = await fn();
      if (audit) this.#d.audit.record({ action, outcome: 'success', principal: ctx.principal.id, resource, traceId: ctx.trace.traceId, ip: ctx.ip, details: { channel: ctx.channel, ...details } });
      return result;
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      this.#d.audit.record({
        action,
        outcome: status === 403 ? 'denied' : 'failure',
        principal: ctx.principal.id,
        resource,
        status,
        traceId: ctx.trace.traceId,
        ip: ctx.ip,
        details: { channel: ctx.channel, ...details },
      });
      throw e;
    }
  }

  async listCompanies(ctx: CallContext): Promise<Rec[]> {
    if (!hasAnyRead(ctx.principal)) requireEntityAccess(ctx.principal, 'companies', 'read');
    const res = await this.#d.bc.request<ODataCollection>('GET', this.#d.bc.url('v2.0', 'companies'), {
      trace: ctx.trace,
      op: 'list:companies',
    });
    const allowed = this.#d.allowedCompanies;
    return res.body.value
      .filter((c) => !allowed.length || allowed.includes(String(c.id).toLowerCase()))
      .map((c) => project(COMPANY_FIELDS, c));
  }

  async list(ctx: CallContext, entitySet: string, companyId: string, q: ListQuery): Promise<ListResult> {
    const e = this.entity(entitySet);
    const company = this.#company(companyId);
    const resource = `companies/${company}/${e.name}`;
    return this.#audited(ctx, `bc.${e.name}.list`, resource, this.#d.logReads || !!e.personalData, async () => {
      this.#authorize(ctx, e, 'list');
      const path = `companies(${company})/${e.name}`;
      let url: string;
      if (q.cursor) {
        const c = this.#d.cursors.decode(q.cursor, { e: e.name, c: company, p: ctx.principal.id });
        if (!this.#d.bc.isCollectionUrl(c.u, e.apiRoute, path)) throw errors.badRequest('Invalid cursor.');
        url = c.u;
      } else {
        url = this.#d.bc.url(e.apiRoute, path, {
          $filter: buildFilter(e, q.filters),
          $select: buildSelect(e, q.select),
          $orderby: buildOrderBy(e, q.sort),
        });
      }
      const res = await this.#d.bc.request<ODataCollection>('GET', url, {
        maxPageSize: q.limit,
        trace: ctx.trace,
        op: `list:${e.name}`,
      });
      const next = res.body['@odata.nextLink'];
      return {
        data: res.body.value.map((r) => project(e.fields, r)),
        nextCursor: next ? this.#d.cursors.encode({ u: next, e: e.name, c: company, p: ctx.principal.id }) : undefined,
      };
    }, { filters: q.filters.length, cursor: !!q.cursor });
  }

  async get(ctx: CallContext, entitySet: string, companyId: string, id: string): Promise<ItemResult> {
    const e = this.entity(entitySet);
    const company = this.#company(companyId);
    const rid = this.#id(id);
    return this.#audited(ctx, `bc.${e.name}.get`, `companies/${company}/${e.name}/${rid}`, this.#d.logReads || !!e.personalData, async () => {
      this.#authorize(ctx, e, 'get');
      const res = await this.#d.bc.request<Rec>('GET', this.#d.bc.url(e.apiRoute, `companies(${company})/${e.name}(${rid})`), {
        trace: ctx.trace,
        op: `get:${e.name}`,
      });
      return { record: project(e.fields, res.body), etag: res.etag };
    });
  }

  async create(ctx: CallContext, entitySet: string, companyId: string, body: unknown): Promise<ItemResult> {
    const e = this.entity(entitySet);
    const company = this.#company(companyId);
    return this.#audited(ctx, `bc.${e.name}.create`, `companies/${company}/${e.name}`, true, async () => {
      this.#authorize(ctx, e, 'create');
      const data = validateBody(e, body, 'create');
      const res = await this.#d.bc.request<Rec>('POST', this.#d.bc.url(e.apiRoute, `companies(${company})/${e.name}`), {
        body: data,
        trace: ctx.trace,
        op: `create:${e.name}`,
      });
      return { record: project(e.fields, res.body), etag: res.etag };
    }, { fields: fieldNames(body) });
  }

  async update(ctx: CallContext, entitySet: string, companyId: string, id: string, etag: string | undefined, body: unknown): Promise<ItemResult> {
    const e = this.entity(entitySet);
    const company = this.#company(companyId);
    const rid = this.#id(id);
    return this.#audited(ctx, `bc.${e.name}.update`, `companies/${company}/${e.name}/${rid}`, true, async () => {
      this.#authorize(ctx, e, 'update');
      if (!etag) throw errors.preconditionRequired();
      const data = validateBody(e, body, 'update');
      const res = await this.#d.bc.request<Rec>('PATCH', this.#d.bc.url(e.apiRoute, `companies(${company})/${e.name}(${rid})`), {
        body: data,
        ifMatch: etag,
        trace: ctx.trace,
        op: `update:${e.name}`,
      });
      return { record: project(e.fields, res.body), etag: res.etag };
    }, { fields: fieldNames(body) });
  }

  async remove(ctx: CallContext, entitySet: string, companyId: string, id: string, etag: string | undefined): Promise<void> {
    const e = this.entity(entitySet);
    const company = this.#company(companyId);
    const rid = this.#id(id);
    await this.#audited(ctx, `bc.${e.name}.delete`, `companies/${company}/${e.name}/${rid}`, true, async () => {
      this.#authorize(ctx, e, 'delete');
      if (!etag) throw errors.preconditionRequired();
      await this.#d.bc.request('DELETE', this.#d.bc.url(e.apiRoute, `companies(${company})/${e.name}(${rid})`), {
        ifMatch: etag,
        trace: ctx.trace,
        op: `delete:${e.name}`,
      });
    });
  }
}

function fieldNames(body: unknown): string[] | undefined {
  return body && typeof body === 'object' && !Array.isArray(body) ? Object.keys(body).slice(0, 50) : undefined;
}

/** Output allow-list: only registry fields (plus the ETag) ever leave the gateway. */
export function project(fields: Record<string, FieldDef>, rec: Rec): Rec {
  const out: Rec = {};
  for (const k of Object.keys(fields)) if (k in rec) out[k] = rec[k];
  if (typeof rec['@odata.etag'] === 'string') out.etag = rec['@odata.etag'];
  return out;
}

const VALUE_RE = {
  guid: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  date: /^\d{4}-\d{2}-\d{2}$/,
  datetime: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/,
};

function checkValue(def: FieldDef, v: unknown): string | null {
  switch (def.type) {
    case 'string':
      if (typeof v !== 'string') return 'must be a string';
      if (def.maxLength && v.length > def.maxLength) return `must be at most ${def.maxLength} characters`;
      if (def.enum && !def.enum.includes(v)) return `must be one of ${def.enum.map((x) => JSON.stringify(x)).join(', ')}`;
      if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v)) return 'must not contain control characters';
      return null;
    case 'number':
      return typeof v === 'number' && Number.isFinite(v) ? null : 'must be a number';
    case 'integer':
      return Number.isInteger(v) ? null : 'must be an integer';
    case 'boolean':
      return typeof v === 'boolean' ? null : 'must be a boolean';
    case 'guid':
      return typeof v === 'string' && VALUE_RE.guid.test(v) ? null : 'must be a GUID';
    case 'date':
      return typeof v === 'string' && VALUE_RE.date.test(v) && !Number.isNaN(Date.parse(v)) ? null : 'must be a date (YYYY-MM-DD)';
    case 'datetime':
      return typeof v === 'string' && VALUE_RE.datetime.test(v) ? null : 'must be an ISO 8601 date-time';
  }
}

/** Strict input validation against the registry (unknown & read-only fields are rejected, not ignored). */
export function validateBody(e: EntityDef, body: unknown, mode: 'create' | 'update'): Rec {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw errors.validation([{ field: '$', message: 'must be a JSON object' }]);
  const errs: FieldError[] = [];
  const out: Rec = {};
  for (const [k, v] of Object.entries(body)) {
    const def = Object.hasOwn(e.fields, k) ? e.fields[k] : undefined;
    if (!def) errs.push({ field: k, message: 'unknown field' });
    else if (!def.writable) errs.push({ field: k, message: 'field is read-only' });
    else {
      const msg = checkValue(def, v);
      if (msg) errs.push({ field: k, message: msg });
      else out[k] = v;
    }
  }
  if (mode === 'create') {
    for (const [k, def] of Object.entries(e.fields)) {
      if (def.required && !(k in (body as Rec))) errs.push({ field: k, message: 'is required' });
    }
  } else if (Object.keys(body).length === 0) {
    errs.push({ field: '$', message: 'at least one field must be provided' });
  }
  if (errs.length) throw errors.validation(errs);
  return out;
}
