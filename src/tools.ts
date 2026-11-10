/**
 * Tools designed for how Claude works:
 *  - orientation first (bc_overview), then targeted reads – never "dump all"
 *  - task-level tools (customer overview, open items) that bundle several
 *    API calls and pre-aggregate, so answers need fewer round trips and less context
 *  - forgiving inputs (names instead of GUIDs, singular/plural entity names)
 *  - compact Markdown output + structuredContent for exact values
 *  - writes only via prepare → apply, no delete tool at all
 */
import { GatewayError, type Gateway, type Query, type Rec } from './gateway.ts';
import { DATA_NOTE, bcData, columnsFor, keyValues, money, table } from './format.ts';
import { InputError, Meta, companyLabel, isGuid, type Company, type EntityMeta } from './meta.ts';
import type { PlanStore } from './plans.ts';

export interface ToolContext {
  gw: Gateway;
  meta: Meta;
  plans: PlanStore;
  readOnly: boolean;
  today?: () => string;
}

export interface ToolResult {
  text: string;
  data: Record<string, unknown>;
}

export interface Tool {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: Record<string, boolean>;
  write?: boolean;
  run(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult>;
}

const FILTER_OPS = ['eq', 'ne', 'gt', 'ge', 'lt', 'le', 'startswith', 'contains'];

// ---------------------------------------------------------------- helpers
function str(a: Record<string, unknown>, k: string, required = true): string | undefined {
  const v = a[k];
  if (v === undefined || v === null || v === '') {
    if (required) throw new InputError(`"${k}" is required`);
    return undefined;
  }
  if (typeof v !== 'string') throw new InputError(`"${k}" must be a string`);
  return v.trim();
}

function int(a: Record<string, unknown>, k: string, def: number, max: number): number {
  const v = a[k];
  if (v === undefined) return def;
  if (!Number.isInteger(v) || (v as number) < 1 || (v as number) > max) throw new InputError(`"${k}" must be an integer 1-${max}`);
  return v as number;
}

function requireRead(e: EntityMeta): void {
  if (!e.access.read) throw new InputError(`No read permission for ${e.name} (scope bc.read or bc.${e.name}.read).`);
}

const base = (c: Company, entity: string) => `/v1/companies/${c.id}/${entity}`;

async function list(gw: Gateway, c: Company, entity: string, query: Query): Promise<{ data: Rec[]; nextCursor?: string }> {
  const r = await gw.get<{ data: Rec[]; page: { nextCursor?: string } }>(base(c, entity), query);
  return { data: r.body.data, nextCursor: r.body.page?.nextCursor };
}

/** Fetch up to maxPages pages (for aggregations). */
async function listAll(gw: Gateway, c: Company, entity: string, query: Query, maxPages = 5): Promise<{ data: Rec[]; truncated: boolean }> {
  const out: Rec[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < maxPages; i++) {
    const page = await list(gw, c, entity, cursor ? [['limit', 1000], ['cursor', cursor]] : [...query, ['limit', 1000]]);
    out.push(...page.data);
    cursor = page.nextCursor;
    if (!cursor) return { data: out, truncated: false };
  }
  return { data: out, truncated: true };
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

function checkValue(field: string, f: EntityMeta['fields'][string], v: unknown): string | null {
  switch (f.type) {
    case 'string':
      if (typeof v !== 'string') return `${field}: must be text`;
      if (f.maxLength && v.length > f.maxLength) return `${field}: max ${f.maxLength} characters`;
      if (f.enum && !f.enum.includes(v)) return `${field}: one of ${f.enum.map((x) => JSON.stringify(x)).join(', ')}`;
      return null;
    case 'number':
      return typeof v === 'number' ? null : `${field}: must be a number`;
    case 'integer':
      return Number.isInteger(v) ? null : `${field}: must be an integer`;
    case 'boolean':
      return typeof v === 'boolean' ? null : `${field}: must be true/false`;
    case 'guid':
      return typeof v === 'string' && isGuid(v) ? null : `${field}: must be a GUID`;
    case 'date':
      return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? null : `${field}: must be YYYY-MM-DD`;
    default:
      return null;
  }
}

function validateWrite(e: EntityMeta, data: unknown, mode: 'create' | 'update'): Rec {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new InputError('"data"/"changes" must be an object of field → value');
  const problems: string[] = [];
  for (const [k, v] of Object.entries(data)) {
    const f = e.fields[k];
    if (!f) problems.push(`${k}: unknown field`);
    else if (!f.writable) problems.push(`${k}: read-only`);
    else {
      const p = checkValue(k, f, v);
      if (p) problems.push(p);
    }
  }
  if (mode === 'create') {
    for (const [k, f] of Object.entries(e.fields)) if (f.required && !(k in (data as Rec))) problems.push(`${k}: required`);
  } else if (Object.keys(data).length === 0) problems.push('no changes given');
  if (problems.length) {
    const writable = Object.entries(e.fields).filter(([, f]) => f.writable).map(([k]) => k);
    throw new InputError(`Invalid change for ${e.name}:\n- ${problems.join('\n- ')}\nWritable fields: ${writable.join(', ')}`);
  }
  return data as Rec;
}

const companyProp = { type: 'string', description: 'Company id or name. Optional if only one company exists.' };
const entityProp = (names?: string[]) => ({ type: 'string', description: 'Entity set, e.g. customers, vendors, items, salesOrders', ...(names ? { examples: names } : {}) });

// ------------------------------------------------------------------ tools
export const TOOLS: Tool[] = [
  {
    name: 'bc_overview',
    title: 'Business Central overview',
    description:
      'START HERE. Lists the companies and entity sets you can access, with your read/write rights and field names. Call once per conversation before other bc_ tools.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
    async run(_a, ctx) {
      const [companies, entities] = await Promise.all([ctx.meta.companies(), ctx.meta.entities()]);
      const rows = entities.map((e) => ({
        entity: e.name,
        rights: [e.access.read && 'read', e.access.write && 'write'].filter(Boolean).join('+') || '–',
        operations: e.operations.join(','),
        fields: Object.keys(e.fields).join(', '),
      }));
      const text = [
        `## Firmen (${companies.length})`,
        table(companies as unknown as Rec[], ['displayName', 'name', 'id']),
        '',
        '## Entitäten',
        table(rows, ['entity', 'rights', 'operations', 'fields']),
        '',
        ctx.readOnly ? 'Modus: **nur lesen** (Schreibwerkzeuge deaktiviert).' : 'Änderungen: bc_prepare_create / bc_prepare_update → Nutzer bestätigen lassen → bc_apply_change.',
      ].join('\n');
      return { text, data: { companies, entities: rows } };
    },
  },

  {
    name: 'bc_find',
    title: 'Find records by name or number',
    description:
      'Fuzzy lookup of customers, vendors and items by (part of) name or number across companies. Use this to turn a name the user mentions into an id.',
    inputSchema: {
      type: 'object',
      required: ['text'],
      additionalProperties: false,
      properties: {
        text: { type: 'string', minLength: 2, description: 'Part of the name, or the beginning of the number' },
        companyId: companyProp,
        entities: { type: 'array', items: { type: 'string' }, description: 'Default: customers, vendors, items' },
      },
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
    async run(a, ctx) {
      const text = str(a, 'text')!;
      if (text.length < 2) throw new InputError('"text" needs at least 2 characters');
      const companies = a.companyId ? [await ctx.meta.company(str(a, 'companyId'))] : (await ctx.meta.companies()).slice(0, 5);
      const wanted = Array.isArray(a.entities) ? (a.entities as string[]) : ['customers', 'vendors', 'items'];
      const entities = (await Promise.all(wanted.map((w) => ctx.meta.entity(w)))).filter((e) => e.access.read && e.fields.displayName && e.fields.number);
      const hits: Rec[] = [];
      await Promise.all(
        companies.flatMap((c) =>
          entities.map(async (e) => {
            const [byName, byNumber] = await Promise.all([
              list(ctx.gw, c, e.name, [['filter.displayName.contains', text], ['select', 'number,displayName'], ['limit', 10]]),
              list(ctx.gw, c, e.name, [['filter.number.startswith', text], ['select', 'number,displayName'], ['limit', 10]]),
            ]);
            const seen = new Set<string>();
            for (const r of [...byNumber.data, ...byName.data]) {
              if (seen.has(String(r.id))) continue;
              seen.add(String(r.id));
              hits.push({ company: companyLabel(c), companyId: c.id, entity: e.name, number: r.number, displayName: r.displayName, id: r.id });
            }
          }),
        ),
      );
      return {
        text: `${hits.length} Treffer für „${text}“\n${bcData(table(hits, ['company', 'entity', 'number', 'displayName', 'id']))}\n${DATA_NOTE}`,
        data: { hits },
      };
    },
  },

  {
    name: 'bc_query',
    title: 'Query records',
    description:
      'List records of one entity set with filters, chosen fields and sorting. Prefer narrow filters and small limits. Returns nextCursor if more rows exist.',
    inputSchema: {
      type: 'object',
      required: ['entity'],
      additionalProperties: false,
      properties: {
        entity: entityProp(),
        companyId: companyProp,
        filters: {
          type: 'array',
          maxItems: 10,
          items: {
            type: 'object',
            required: ['field', 'value'],
            additionalProperties: false,
            properties: {
              field: { type: 'string' },
              op: { type: 'string', enum: FILTER_OPS, default: 'eq' },
              value: { type: ['string', 'number', 'boolean'] },
            },
          },
        },
        fields: { type: 'array', items: { type: 'string' }, description: 'Columns to return (default: sensible set per entity)' },
        sort: { type: 'string', description: 'Comma-separated fields, "-" prefix for descending, e.g. "-balanceDue,number"' },
        limit: { type: 'integer', minimum: 1, maximum: 200, default: 25 },
        cursor: { type: 'string' },
      },
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
    async run(a, ctx) {
      const e = await ctx.meta.entity(str(a, 'entity')!);
      requireRead(e);
      const c = await ctx.meta.company(str(a, 'companyId', false));
      const limit = int(a, 'limit', 25, 200);
      const fields = Array.isArray(a.fields) ? (a.fields as string[]) : undefined;
      const query: Query = [['limit', limit]];
      const cursor = str(a, 'cursor', false);
      if (cursor) query.push(['cursor', cursor]);
      else {
        for (const f of (Array.isArray(a.filters) ? a.filters : []) as Rec[]) {
          const op = typeof f.op === 'string' ? f.op : 'eq';
          if (!FILTER_OPS.includes(op)) throw new InputError(`Unknown operator ${op}`);
          query.push([op === 'eq' ? `filter.${String(f.field)}` : `filter.${String(f.field)}.${op}`, String(f.value)]);
        }
        if (fields) query.push(['select', fields.join(',')]);
        const sort = str(a, 'sort', false);
        if (sort) query.push(['sort', sort]);
      }
      const r = await list(ctx.gw, c, e.name, query);
      const cols = columnsFor(e.name, r.data, fields);
      const text = [
        `${e.name} in ${companyLabel(c)}: ${r.data.length} Datensätze${r.nextCursor ? ' (weitere vorhanden → cursor)' : ''}`,
        bcData(table(r.data, cols)),
        DATA_NOTE,
      ].join('\n');
      return { text, data: { entity: e.name, companyId: c.id, records: r.data, ...(r.nextCursor ? { nextCursor: r.nextCursor } : {}) } };
    },
  },

  {
    name: 'bc_get',
    title: 'Get one record',
    description: 'Read all fields of a single record by id.',
    inputSchema: {
      type: 'object',
      required: ['entity', 'id'],
      additionalProperties: false,
      properties: { entity: entityProp(), companyId: companyProp, id: { type: 'string', format: 'uuid' } },
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
    async run(a, ctx) {
      const e = await ctx.meta.entity(str(a, 'entity')!);
      requireRead(e);
      const c = await ctx.meta.company(str(a, 'companyId', false));
      const r = await ctx.gw.get(`${base(c, e.name)}/${encodeURIComponent(str(a, 'id')!)}`);
      const { etag: _etag, ...rec } = r.body;
      return { text: `${e.name} in ${companyLabel(c)}\n${bcData(keyValues(rec))}\n${DATA_NOTE}`, data: { record: rec } };
    },
  },

  {
    name: 'bc_customer_overview',
    title: 'Customer 360° overview',
    description:
      'Everything relevant about one customer in one call: master data, credit utilisation, open and overdue invoices, open sales orders and open ledger entries. Accepts id, customer number or (part of) the name.',
    inputSchema: {
      type: 'object',
      required: ['customer'],
      additionalProperties: false,
      properties: { customer: { type: 'string', description: 'Customer id, number or name' }, companyId: companyProp },
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
    async run(a, ctx) {
      const c = await ctx.meta.company(str(a, 'companyId', false));
      const customers = await ctx.meta.entity('customers');
      requireRead(customers);
      const input = str(a, 'customer')!;
      let cust: Rec | undefined;
      if (isGuid(input)) cust = (await ctx.gw.get(`${base(c, 'customers')}/${input}`)).body;
      else {
        cust = (await list(ctx.gw, c, 'customers', [['filter.number', input], ['limit', 1]])).data[0];
        if (!cust) {
          const cands = (await list(ctx.gw, c, 'customers', [['filter.displayName.contains', input], ['limit', 10]])).data;
          if (cands.length === 1) cust = cands[0];
          else if (cands.length > 1) {
            return {
              text: `Mehrere Debitoren passen zu „${input}“ – bitte genauer angeben:\n${bcData(table(cands, ['number', 'displayName', 'city', 'id']))}\n${DATA_NOTE}`,
              data: { candidates: cands },
            };
          }
        }
      }
      if (!cust) throw new InputError(`No customer matches "${input}" in ${companyLabel(c)}.`);

      const today = ctx.today?.() ?? new Date().toISOString().slice(0, 10);
      const no = String(cust.number);
      const optional = async (entity: string, q: Query) => {
        try {
          const e = await ctx.meta.entity(entity);
          if (!e.access.read) return null;
          return (await list(ctx.gw, c, entity, q)).data;
        } catch (err) {
          if (err instanceof GatewayError || err instanceof InputError) return null;
          throw err;
        }
      };
      const [invoices, orders, ledger] = await Promise.all([
        optional('salesInvoices', [['filter.customerNumber', no], ['filter.status', 'Open'], ['sort', 'dueDate'], ['limit', 50]]),
        optional('salesOrders', [['filter.customerNumber', no], ['sort', '-orderDate'], ['limit', 20]]),
        optional('customerLedgerEntries', [['filter.customerNumber', no], ['filter.open', true], ['sort', 'dueDate'], ['limit', 50]]),
      ]);
      const open = (invoices ?? []).reduce((s, i) => s + num(i.remainingAmount), 0);
      const overdueInv = (invoices ?? []).filter((i) => String(i.dueDate) < today && num(i.remainingAmount) > 0);
      const overdue = overdueInv.reduce((s, i) => s + num(i.remainingAmount), 0);
      const limit = num(cust.creditLimit);
      const balance = num(cust.balanceDue);
      const utilisation = limit > 0 ? Math.round((balance / limit) * 100) : null;

      const kpis = {
        balanceDue: balance,
        creditLimit: limit,
        creditUtilisationPercent: utilisation,
        openInvoices: invoices?.length ?? null,
        openInvoiceAmount: open,
        overdueInvoices: overdueInv.length,
        overdueAmount: overdue,
        oldestOverdueDueDate: overdueInv[0]?.dueDate ?? null,
        blocked: cust.blocked,
      };
      const text = [
        `## ${String(cust.displayName)} (${no}) – ${companyLabel(c)}`,
        bcData(keyValues({ city: cust.city, country: cust.country, email: cust.email, phoneNumber: cust.phoneNumber, salespersonCode: cust.salespersonCode, blocked: cust.blocked, id: cust.id })),
        '',
        '### Kennzahlen',
        `- Saldo: ${money(balance)} · Kreditlimit: ${limit ? money(limit) : 'keins'}${utilisation !== null ? ` · Auslastung: ${utilisation} %` : ''}`,
        `- Offene Rechnungen: ${invoices ? `${invoices.length} über ${money(open)}` : 'keine Leserechte'}`,
        `- Überfällig (Stand ${today}): ${overdueInv.length} über ${money(overdue)}${overdueInv[0] ? `, älteste fällig seit ${String(overdueInv[0].dueDate)}` : ''}`,
        '',
        '### Offene Rechnungen',
        invoices ? bcData(table(invoices, ['number', 'invoiceDate', 'dueDate', 'totalAmountIncludingTax', 'remainingAmount'])) : '_keine Leserechte_',
        '',
        '### Aufträge',
        orders ? bcData(table(orders, ['number', 'orderDate', 'status', 'totalAmountIncludingTax'])) : '_keine Leserechte_',
        '',
        '### Offene Posten (AL-Extension)',
        ledger ? bcData(table(ledger, ['documentNumber', 'postingDate', 'dueDate', 'amount', 'remainingAmount'])) : '_nicht verfügbar (Extension fehlt oder keine Rechte)_',
        '',
        DATA_NOTE,
      ].join('\n');
      return { text, data: { customer: cust, kpis, openInvoices: invoices, salesOrders: orders, openLedgerEntries: ledger } };
    },
  },

  {
    name: 'bc_open_items',
    title: 'Open receivables / payables',
    description:
      'Aggregated open items: receivables (open sales invoices by customer, with overdue amounts) or payables (open purchase invoices by vendor). Use for dunning, cash-flow and risk questions.',
    inputSchema: {
      type: 'object',
      required: ['kind'],
      additionalProperties: false,
      properties: {
        kind: { type: 'string', enum: ['receivables', 'payables'] },
        companyId: companyProp,
        top: { type: 'integer', minimum: 1, maximum: 100, default: 15 },
      },
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
    async run(a, ctx) {
      const kind = str(a, 'kind');
      if (kind !== 'receivables' && kind !== 'payables') throw new InputError('"kind" must be receivables or payables');
      const c = await ctx.meta.company(str(a, 'companyId', false));
      const top = int(a, 'top', 15, 100);
      const today = ctx.today?.() ?? new Date().toISOString().slice(0, 10);
      const entity = kind === 'receivables' ? 'salesInvoices' : 'purchaseInvoices';
      requireRead(await ctx.meta.entity(entity));
      const { data, truncated } = await listAll(ctx.gw, c, entity, [['filter.status', 'Open']]);
      const partyNo = kind === 'receivables' ? 'customerNumber' : 'vendorNumber';
      const partyName = kind === 'receivables' ? 'customerName' : 'vendorName';
      const amountOf = (r: Rec) => (kind === 'receivables' ? num(r.remainingAmount) : num(r.totalAmountIncludingTax));
      const groups = new Map<string, Rec & { open: number; overdue: number; count: number; oldestDue: string }>();
      for (const r of data) {
        const key = String(r[partyNo]);
        const g = groups.get(key) ?? { number: key, name: r[partyName], open: 0, overdue: 0, count: 0, oldestDue: '9999-12-31' };
        const amt = amountOf(r);
        g.open += amt;
        g.count++;
        if (String(r.dueDate) < today) g.overdue += amt;
        if (String(r.dueDate) < g.oldestDue) g.oldestDue = String(r.dueDate);
        groups.set(key, g);
      }
      const rows = [...groups.values()].sort((x, y) => y.overdue - x.overdue || y.open - x.open);
      const totalOpen = rows.reduce((s, g) => s + g.open, 0);
      const totalOverdue = rows.reduce((s, g) => s + g.overdue, 0);
      const label = kind === 'receivables' ? 'Forderungen (offene Verkaufsrechnungen)' : 'Verbindlichkeiten (offene Einkaufsrechnungen)';
      const text = [
        `## ${label} – ${companyLabel(c)}, Stand ${today}`,
        `Gesamt offen: ${money(totalOpen)} · davon überfällig: ${money(totalOverdue)} · ${data.length} Belege, ${rows.length} ${kind === 'receivables' ? 'Debitoren' : 'Kreditoren'}${truncated ? ' · ⚠ gekürzt (mehr als 5000 Belege)' : ''}`,
        bcData(table(rows.slice(0, top).map((g) => ({ ...g, open: money(g.open), overdue: money(g.overdue) })), ['number', 'name', 'count', 'open', 'overdue', 'oldestDue'])),
        DATA_NOTE,
      ].join('\n');
      return { text, data: { kind, companyId: c.id, asOf: today, totalOpen, totalOverdue, documents: data.length, truncated, byParty: rows } };
    },
  },

  {
    name: 'bc_recent_changes',
    title: 'Recent changes',
    description: 'Change events (created/updated/deleted) recently received from Business Central. Pass `after` = the returned `next` to continue.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: { after: { type: 'integer', minimum: 0, default: 0 }, limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 } },
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
    async run(a, ctx) {
      const after = a.after === undefined ? 0 : Number(a.after);
      const r = await ctx.gw.get<{ data: { seq: number; event: Rec }[]; next: number }>('/v1/events', [
        ['after', after],
        ['limit', int(a, 'limit', 50, 200)],
      ]);
      const rows = r.body.data.map(({ seq, event }) => ({ seq, type: event.type, subject: event.subject, time: event.time }));
      return {
        text: `${rows.length} Änderungen (next=${r.body.next})\n${bcData(table(rows, ['seq', 'time', 'type', 'subject']))}`,
        data: { events: r.body.data, next: r.body.next },
      };
    },
  },

  // ------------------------------------------------------------- writes
  {
    name: 'bc_prepare_create',
    title: 'Prepare creating a record',
    description:
      'Validates a new record and returns a plan WITHOUT writing anything. Show the plan to the user and only call bc_apply_change after they explicitly confirm.',
    write: true,
    inputSchema: {
      type: 'object',
      required: ['entity', 'data'],
      additionalProperties: false,
      properties: { entity: entityProp(), companyId: companyProp, data: { type: 'object', description: 'field → value' } },
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
    async run(a, ctx) {
      const e = await ctx.meta.entity(str(a, 'entity')!);
      if (!e.operations.includes('create')) throw new InputError(`${e.name} cannot be created via the API.`);
      if (!e.access.write) throw new InputError(`No write permission for ${e.name}.`);
      const c = await ctx.meta.company(str(a, 'companyId', false));
      const data = validateWrite(e, a.data, 'create');
      const rows = Object.entries(data).map(([field, value]) => ({ field, value }));
      const summary = `Neu anlegen: ${e.name} in ${companyLabel(c)}\n${table(rows, ['field', 'value'])}`;
      const plan = ctx.plans.add({ kind: 'create', entity: e.name, companyId: c.id, companyLabel: companyLabel(c), data, summary });
      return planResult(plan.id, summary, plan.expiresAt);
    },
  },

  {
    name: 'bc_prepare_update',
    title: 'Prepare changing a record',
    description:
      'Loads the current record, validates the changes and returns a before/after diff plus a plan WITHOUT writing. Show the diff to the user and only call bc_apply_change after they explicitly confirm.',
    write: true,
    inputSchema: {
      type: 'object',
      required: ['entity', 'id', 'changes'],
      additionalProperties: false,
      properties: {
        entity: entityProp(),
        companyId: companyProp,
        id: { type: 'string', format: 'uuid' },
        changes: { type: 'object', description: 'field → new value' },
      },
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
    async run(a, ctx) {
      const e = await ctx.meta.entity(str(a, 'entity')!);
      if (!e.operations.includes('update')) throw new InputError(`${e.name} cannot be changed via the API.`);
      if (!e.access.write) throw new InputError(`No write permission for ${e.name}.`);
      const c = await ctx.meta.company(str(a, 'companyId', false));
      const id = str(a, 'id')!;
      const changes = validateWrite(e, a.changes, 'update');
      const current = await ctx.gw.get(`${base(c, e.name)}/${encodeURIComponent(id)}`);
      const diff = Object.entries(changes)
        .filter(([k, v]) => current.body[k] !== v)
        .map(([field, value]) => ({ field, before: current.body[field], after: value }));
      if (diff.length === 0) throw new InputError('The record already has these values – nothing to change.');
      const effective = Object.fromEntries(diff.map((d) => [d.field, d.after]));
      const label = `${String(current.body.displayName ?? current.body.number ?? id)}`;
      const summary = `Ändern: ${e.name} „${label}“ in ${companyLabel(c)}\n${table(diff, ['field', 'before', 'after'])}`;
      const plan = ctx.plans.add({
        kind: 'update',
        entity: e.name,
        companyId: c.id,
        companyLabel: companyLabel(c),
        recordId: id,
        etag: current.etag ?? String(current.body.etag ?? ''),
        data: effective,
        summary,
      });
      return planResult(plan.id, summary, plan.expiresAt);
    },
  },

  {
    name: 'bc_apply_change',
    title: 'Apply a prepared change',
    description:
      'Executes a plan from bc_prepare_create/bc_prepare_update. ONLY call this after the user has explicitly confirmed exactly this plan. Fails safely if the record was changed in the meantime.',
    write: true,
    inputSchema: {
      type: 'object',
      required: ['planId'],
      additionalProperties: false,
      properties: { planId: { type: 'string' } },
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    async run(a, ctx) {
      const plan = ctx.plans.get(str(a, 'planId')!);
      if (!plan) throw new InputError('Unknown or expired plan – prepare the change again.');
      const path = `/v1/companies/${plan.companyId}/${plan.entity}`;
      try {
        const r =
          plan.kind === 'create'
            ? await ctx.gw.request('POST', path, { body: plan.data, headers: { 'Idempotency-Key': plan.id } })
            : await ctx.gw.request('PATCH', `${path}/${plan.recordId}`, { body: plan.data, headers: { 'If-Match': plan.etag || '*' } });
        ctx.plans.delete(plan.id);
        const { etag: _e, ...rec } = r.body;
        return {
          text: `✔ Ausgeführt (${plan.kind === 'create' ? 'angelegt' : 'geändert'}): ${plan.entity} in ${plan.companyLabel}\n${bcData(keyValues(rec))}`,
          data: { planId: plan.id, kind: plan.kind, entity: plan.entity, companyId: plan.companyId, record: rec },
        };
      } catch (err) {
        if (err instanceof GatewayError && err.status === 412) {
          ctx.plans.delete(plan.id);
          throw new InputError('The record was changed by someone else since the plan was prepared. Nothing was written. Prepare the change again and show the new diff.');
        }
        throw err;
      }
    },
  },
];

function planResult(planId: string, summary: string, expiresAt: number): ToolResult {
  const until = new Date(expiresAt).toISOString().slice(11, 16);
  return {
    text: [
      `### Geplante Änderung – noch NICHT ausgeführt`,
      bcData(summary),
      `planId: \`${planId}\` (gültig bis ${until} UTC)`,
      '',
      'Zeige dem Nutzer diese Änderung und hole eine ausdrückliche Bestätigung ein. Erst danach bc_apply_change mit dieser planId aufrufen.',
    ].join('\n'),
    data: { planId, expiresAt: new Date(expiresAt).toISOString(), summary },
  };
}

export function describeError(err: unknown): string {
  if (err instanceof InputError) return err.message;
  if (err instanceof GatewayError) {
    const p = err.problem;
    const lines = [`${p.title ?? 'Error'} (HTTP ${err.status})${p.detail ? `: ${p.detail}` : ''}`];
    for (const e of p.errors ?? []) lines.push(`- ${e.field}: ${e.message}`);
    if (err.status === 401) lines.push('Hint: the API key is missing/invalid – check OPENBRIDGE_API_KEY(_FILE).');
    if (err.status === 403) lines.push('Hint: your key lacks the required scope – ask the user/admin, do not retry.');
    if (err.status === 429) lines.push('Hint: rate limited – wait before retrying.');
    if (err.status === 0) lines.push('Hint: start the gateway (cd bc-openbridge && npm run dev:mock) or check OPENBRIDGE_URL.');
    if (p.traceId) lines.push(`traceId: ${p.traceId}`);
    return lines.join('\n');
  }
  return `Unexpected error: ${(err as Error)?.message ?? String(err)}`;
}
