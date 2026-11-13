/** JSON Schema (2020-12) fragments derived from the entity registry. */
import type { EntityDef, FieldDef } from '../bc/entities.ts';

export type Schema = Record<string, unknown>;

export function fieldSchema(def: FieldDef, forInput = false): Schema {
  const s: Schema = {};
  switch (def.type) {
    case 'string':
      s.type = 'string';
      if (def.maxLength) s.maxLength = def.maxLength;
      if (def.enum) s.enum = def.enum;
      break;
    case 'number':
      s.type = 'number';
      break;
    case 'integer':
      s.type = 'integer';
      break;
    case 'boolean':
      s.type = 'boolean';
      break;
    case 'guid':
      s.type = 'string';
      s.format = 'uuid';
      break;
    case 'date':
      s.type = 'string';
      s.format = 'date';
      break;
    case 'datetime':
      s.type = 'string';
      s.format = 'date-time';
      break;
  }
  if (def.description) s.description = def.description;
  if (!forInput && !def.writable) s.readOnly = true;
  return s;
}

export function pascal(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function entitySchema(e: EntityDef): Schema {
  const properties: Schema = {};
  for (const [k, f] of Object.entries(e.fields)) properties[k] = fieldSchema(f);
  properties.etag = { type: 'string', readOnly: true, description: 'Entity tag – send as If-Match for updates/deletes' };
  return { type: 'object', description: e.description, properties };
}

export function entityInputSchema(e: EntityDef, mode: 'create' | 'update'): Schema {
  const properties: Schema = {};
  const required: string[] = [];
  for (const [k, f] of Object.entries(e.fields)) {
    if (!f.writable) continue;
    properties[k] = fieldSchema(f, true);
    if (mode === 'create' && f.required) required.push(k);
  }
  return {
    type: 'object',
    additionalProperties: false,
    properties,
    ...(required.length ? { required } : {}),
    ...(mode === 'update' ? { minProperties: 1 } : {}),
  };
}

export const CLOUD_EVENT_SCHEMA: Schema = {
  type: 'object',
  description: 'CloudEvents 1.0 structured-mode envelope',
  required: ['specversion', 'id', 'source', 'type', 'time', 'datacontenttype', 'data'],
  properties: {
    specversion: { const: '1.0' },
    id: { type: 'string' },
    source: { type: 'string', format: 'uri-reference' },
    type: { type: 'string', examples: ['io.openbridge.bc.customers.updated'] },
    subject: { type: 'string', examples: ['customers/5d115c9c-44e3-ea11-bb43-000d3a2feca1'] },
    time: { type: 'string', format: 'date-time' },
    datacontenttype: { const: 'application/json' },
    traceparent: { type: 'string', description: 'W3C Trace Context (CloudEvents distributed tracing extension)' },
    data: {
      type: 'object',
      required: ['companyId', 'entitySet', 'changeType'],
      properties: {
        companyId: { type: 'string', format: 'uuid' },
        entitySet: { type: 'string' },
        id: { type: 'string', format: 'uuid' },
        changeType: { enum: ['created', 'updated', 'deleted', 'collection'] },
        lastModifiedDateTime: { type: 'string', format: 'date-time' },
        href: { type: 'string', format: 'uri' },
      },
    },
  },
};

export const PROBLEM_SCHEMA: Schema = {
  type: 'object',
  description: 'RFC 9457 Problem Details',
  properties: {
    type: { type: 'string', format: 'uri-reference' },
    title: { type: 'string' },
    status: { type: 'integer' },
    detail: { type: 'string' },
    instance: { type: 'string' },
    traceId: { type: 'string' },
    errors: {
      type: 'array',
      items: { type: 'object', properties: { field: { type: 'string' }, message: { type: 'string' } } },
    },
  },
};
