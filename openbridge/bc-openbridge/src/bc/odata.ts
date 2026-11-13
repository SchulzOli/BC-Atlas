/**
 * Safe translation of client query parameters into OData v4 query options.
 *
 * Clients never send raw OData. Every field is checked against the registry and
 * every literal is type-checked and escaped, which rules out OData injection
 * (e.g. `' or 1 eq 1`), access to non-exposed fields and expensive expressions.
 *
 * Query syntax (REST):
 *   filter.<field>=<value>           equality
 *   filter.<field>.<op>=<value>      op ∈ eq ne gt ge lt le startswith contains
 *   select=a,b,c                     projection
 *   sort=a,-b                        ordering (- = descending)
 *   limit=50                         page size
 *   cursor=…                         continuation (opaque)
 */
import { errors, type FieldError } from '../http/problem.ts';
import type { EntityDef, FieldDef } from './entities.ts';

export type FilterOp = 'eq' | 'ne' | 'gt' | 'ge' | 'lt' | 'le' | 'startswith' | 'contains';
export const FILTER_OPS: FilterOp[] = ['eq', 'ne', 'gt', 'ge', 'lt', 'le', 'startswith', 'contains'];

export interface FilterClause {
  field: string;
  op: FilterOp;
  value: string;
}

export interface SortClause {
  field: string;
  desc: boolean;
}

export interface ListQuery {
  filters: FilterClause[];
  select?: string[];
  sort?: SortClause[];
  limit: number;
  cursor?: string;
}

export const MAX_FILTERS = 10;
export const MAX_LITERAL = 250;
export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 1000;

const RE = {
  number: /^-?\d{1,18}(\.\d{1,10})?$/,
  integer: /^-?\d{1,18}$/,
  guid: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  date: /^\d{4}-\d{2}-\d{2}$/,
  datetime: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,7})?)?(Z|[+-]\d{2}:\d{2})$/,
};

export function isGuid(v: string): boolean {
  return RE.guid.test(v);
}

/** Format a client-supplied value as a typed OData literal or throw a validation error. */
export function toLiteral(field: string, def: FieldDef, raw: string, op: FilterOp): string {
  const bad = (msg: string) => errors.validation([{ field: `filter.${field}`, message: msg }]);
  if (raw.length > MAX_LITERAL) throw bad(`Value exceeds ${MAX_LITERAL} characters.`);
  if ((op === 'startswith' || op === 'contains') && def.type !== 'string') {
    throw bad(`Operator "${op}" is only supported for text fields.`);
  }
  switch (def.type) {
    case 'string':
      if (def.enum && (op === 'eq' || op === 'ne') && !def.enum.includes(raw)) {
        throw bad(`Must be one of: ${def.enum.map((v) => JSON.stringify(v)).join(', ')}.`);
      }
      if (/[\u0000-\u001f]/.test(raw)) throw bad('Control characters are not allowed.');
      return `'${raw.replace(/'/g, "''")}'`;
    case 'number':
      if (!RE.number.test(raw)) throw bad('Must be a decimal number.');
      return raw;
    case 'integer':
      if (!RE.integer.test(raw)) throw bad('Must be an integer.');
      return raw;
    case 'boolean':
      if (raw !== 'true' && raw !== 'false') throw bad('Must be true or false.');
      return raw;
    case 'guid':
      if (!RE.guid.test(raw)) throw bad('Must be a GUID.');
      return raw.toLowerCase();
    case 'date':
      if (!RE.date.test(raw) || Number.isNaN(Date.parse(raw))) throw bad('Must be a date (YYYY-MM-DD).');
      return raw;
    case 'datetime':
      if (!RE.datetime.test(raw) || Number.isNaN(Date.parse(raw))) throw bad('Must be an ISO 8601 date-time with offset.');
      return raw;
  }
}

export function buildFilter(entity: EntityDef, clauses: FilterClause[]): string | undefined {
  if (clauses.length === 0) return undefined;
  if (clauses.length > MAX_FILTERS) throw errors.badRequest(`At most ${MAX_FILTERS} filter conditions are allowed.`);
  return clauses
    .map((c) => {
      const def = entity.fields[c.field];
      if (!def || def.filterable === false) {
        throw errors.validation([{ field: `filter.${c.field}`, message: 'Unknown or non-filterable field.' }]);
      }
      if (!FILTER_OPS.includes(c.op)) {
        throw errors.validation([{ field: `filter.${c.field}`, message: `Unknown operator "${c.op}".` }]);
      }
      const lit = toLiteral(c.field, def, c.value, c.op);
      return c.op === 'startswith' || c.op === 'contains' ? `${c.op}(${c.field},${lit})` : `${c.field} ${c.op} ${lit}`;
    })
    .join(' and ');
}

export function buildSelect(entity: EntityDef, select?: string[]): string | undefined {
  if (!select || select.length === 0) return undefined;
  const unknown = select.filter((f) => !entity.fields[f]);
  if (unknown.length) throw errors.validation(unknown.map((f) => ({ field: 'select', message: `Unknown field "${f}".` })));
  return [...new Set(['id', ...select])].join(',');
}

export function buildOrderBy(entity: EntityDef, sort?: SortClause[]): string | undefined {
  if (!sort || sort.length === 0) return undefined;
  if (sort.length > 3) throw errors.badRequest('At most 3 sort fields are allowed.');
  for (const s of sort) {
    if (!entity.fields[s.field]) throw errors.validation([{ field: 'sort', message: `Unknown field "${s.field}".` }]);
  }
  return sort.map((s) => `${s.field} ${s.desc ? 'desc' : 'asc'}`).join(',');
}

/** Parse REST query parameters into a ListQuery. Unknown parameters are rejected. */
export function parseListQuery(params: URLSearchParams): ListQuery {
  const q: ListQuery = { filters: [], limit: DEFAULT_LIMIT };
  const errs: FieldError[] = [];
  for (const [key, value] of params) {
    if (key.startsWith('filter.')) {
      const [, field, op = 'eq'] = key.split('.');
      if (!field || key.split('.').length > 3) {
        errs.push({ field: key, message: 'Use filter.<field> or filter.<field>.<op>.' });
        continue;
      }
      q.filters.push({ field, op: op as FilterOp, value });
    } else if (key === 'select') {
      q.select = value.split(',').map((s) => s.trim()).filter(Boolean);
    } else if (key === 'sort') {
      q.sort = value
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => (s.startsWith('-') ? { field: s.slice(1), desc: true } : { field: s, desc: false }));
    } else if (key === 'limit') {
      const n = Number(value);
      if (!Number.isInteger(n) || n < 1 || n > MAX_LIMIT) errs.push({ field: 'limit', message: `Must be 1-${MAX_LIMIT}.` });
      else q.limit = n;
    } else if (key === 'cursor') {
      q.cursor = value;
    } else {
      errs.push({ field: key, message: 'Unknown query parameter.' });
    }
  }
  if (errs.length) throw errors.validation(errs);
  return q;
}
