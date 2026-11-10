/**
 * OpenAPI 3.1 document generated from the entity registry – usable for
 * client generation (openapi-generator, Kiota, NSwag), API gateways
 * (Azure APIM, Kong), Power Platform custom connectors and AI tooling.
 */
import type { EntityDef } from '../bc/entities.ts';
import { FILTER_OPS, MAX_LIMIT } from '../bc/odata.ts';
import { CLOUD_EVENT_SCHEMA, PROBLEM_SCHEMA, entityInputSchema, entitySchema, fieldSchema, pascal, type Schema } from './schemas.ts';

export interface OpenApiOptions {
  entities: Record<string, EntityDef>;
  publicBaseUrl: string;
  version: string;
  oidcIssuer?: string;
  mcpEnabled: boolean;
}

const problem = (description: string) => ({
  description,
  content: { 'application/problem+json': { schema: { $ref: '#/components/schemas/Problem' } } },
});

const STD_ERRORS = {
  '400': problem('Invalid request'),
  '401': problem('Authentication required'),
  '403': problem('Insufficient scope or company not enabled'),
  '429': problem('Rate limit exceeded'),
  '502': problem('Business Central error'),
};

export function buildOpenApi(o: OpenApiOptions): Schema {
  const schemas: Schema = { Problem: PROBLEM_SCHEMA, CloudEvent: CLOUD_EVENT_SCHEMA };
  const paths: Schema = {};
  const sec = (...scopes: string[]) => [
    ...(o.oidcIssuer ? [{ oidc: scopes }] : []),
    { bearer: [] },
  ];

  const companyParam = { name: 'companyId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } };
  const idParam = { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } };
  const ifMatch = { name: 'If-Match', in: 'header', required: true, schema: { type: 'string' }, description: 'ETag of the record' };
  const idemKey = {
    name: 'Idempotency-Key',
    in: 'header',
    required: false,
    schema: { type: 'string', minLength: 8, maxLength: 255 },
    description: 'Makes retries safe: the same key + body creates the record only once (24 h).',
  };

  paths['/v1/companies'] = {
    get: {
      operationId: 'listCompanies',
      summary: 'List companies enabled for this gateway',
      tags: ['companies'],
      security: sec('bc.read'),
      responses: {
        '200': { description: 'Companies', content: { 'application/json': { schema: { type: 'object', properties: { data: { type: 'array', items: { type: 'object' } } } } } } },
        ...STD_ERRORS,
      },
    },
  };

  for (const e of Object.values(o.entities)) {
    const S = pascal(e.singular);
    schemas[S] = entitySchema(e);
    const ops = e.operations;
    if (ops.includes('create')) schemas[`${S}Create`] = entityInputSchema(e, 'create');
    if (ops.includes('update')) schemas[`${S}Update`] = entityInputSchema(e, 'update');
    const ref = { $ref: `#/components/schemas/${S}` };
    const tag = e.name;

    const filterParams = Object.entries(e.fields)
      .filter(([, f]) => f.filterable !== false)
      .map(([name, f]) => ({
        name: `filter.${name}`,
        in: 'query',
        required: false,
        schema: fieldSchema(f, true),
        description: `Equality filter. Other operators: filter.${name}.<op> with op ∈ ${FILTER_OPS.join(', ')}`,
      }));

    const collection: Schema = {};
    collection.get = {
      operationId: `list${pascal(e.name)}`,
      summary: `List ${e.description}`,
      tags: [tag],
      security: sec('bc.read', `bc.${e.name}.read`),
      parameters: [
        companyParam,
        ...filterParams,
        { name: 'select', in: 'query', schema: { type: 'string' }, description: 'Comma-separated field list' },
        { name: 'sort', in: 'query', schema: { type: 'string' }, description: 'Comma-separated fields, prefix "-" for descending' },
        { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: MAX_LIMIT, default: 50 } },
        { name: 'cursor', in: 'query', schema: { type: 'string' }, description: 'Opaque continuation token from page.nextCursor' },
      ],
      responses: {
        '200': {
          description: 'Page of records',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  data: { type: 'array', items: ref },
                  page: { type: 'object', properties: { nextCursor: { type: 'string' }, limit: { type: 'integer' } } },
                  links: { type: 'object', properties: { next: { type: 'string' } } },
                },
              },
            },
          },
        },
        ...STD_ERRORS,
      },
    };
    if (ops.includes('create')) {
      collection.post = {
        operationId: `create${S}`,
        summary: `Create ${e.singular}`,
        tags: [tag],
        security: sec('bc.write', `bc.${e.name}.write`),
        parameters: [companyParam, idemKey],
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: `#/components/schemas/${S}Create` } } } },
        responses: {
          '201': { description: 'Created', headers: { ETag: { schema: { type: 'string' } }, Location: { schema: { type: 'string' } } }, content: { 'application/json': { schema: ref } } },
          '409': problem('Idempotency key in use'),
          '422': problem('Idempotency key reused with different payload'),
          ...STD_ERRORS,
        },
      };
    }
    paths[`/v1/companies/{companyId}/${e.name}`] = collection;

    const item: Schema = {
      get: {
        operationId: `get${S}`,
        summary: `Get ${e.singular}`,
        tags: [tag],
        security: sec('bc.read', `bc.${e.name}.read`),
        parameters: [companyParam, idParam],
        responses: {
          '200': { description: 'Record', headers: { ETag: { schema: { type: 'string' } } }, content: { 'application/json': { schema: ref } } },
          '404': problem('Not found'),
          ...STD_ERRORS,
        },
      },
    };
    if (ops.includes('update')) {
      item.patch = {
        operationId: `update${S}`,
        summary: `Update ${e.singular} (JSON Merge Patch, optimistic concurrency)`,
        tags: [tag],
        security: sec('bc.write', `bc.${e.name}.write`),
        parameters: [companyParam, idParam, ifMatch],
        requestBody: {
          required: true,
          content: {
            'application/merge-patch+json': { schema: { $ref: `#/components/schemas/${S}Update` } },
            'application/json': { schema: { $ref: `#/components/schemas/${S}Update` } },
          },
        },
        responses: {
          '200': { description: 'Updated', headers: { ETag: { schema: { type: 'string' } } }, content: { 'application/json': { schema: ref } } },
          '412': problem('ETag mismatch – record changed meanwhile'),
          '428': problem('If-Match header missing'),
          ...STD_ERRORS,
        },
      };
    }
    if (ops.includes('delete')) {
      item.delete = {
        operationId: `delete${S}`,
        summary: `Delete ${e.singular}`,
        tags: [tag],
        security: sec('bc.delete'),
        parameters: [companyParam, idParam, ifMatch],
        responses: { '204': { description: 'Deleted' }, '412': problem('ETag mismatch'), '428': problem('If-Match header missing'), ...STD_ERRORS },
      };
    }
    paths[`/v1/companies/{companyId}/${e.name}/{id}`] = item;
  }

  paths['/v1/events'] = {
    get: {
      operationId: 'listEvents',
      summary: 'Poll change events (CloudEvents) – alternative to webhooks',
      tags: ['events'],
      security: sec('events.read'),
      parameters: [
        { name: 'after', in: 'query', schema: { type: 'integer', minimum: 0 }, description: 'Return events with sequence > after' },
        { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 500, default: 100 } },
      ],
      responses: {
        '200': {
          description: 'Events',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  data: { type: 'array', items: { type: 'object', properties: { seq: { type: 'integer' }, event: { $ref: '#/components/schemas/CloudEvent' } } } },
                  next: { type: 'integer' },
                },
              },
            },
          },
        },
        ...STD_ERRORS,
      },
    },
  };

  if (o.mcpEnabled) {
    paths['/mcp'] = {
      post: {
        operationId: 'mcp',
        summary: 'Model Context Protocol endpoint (Streamable HTTP, JSON-RPC 2.0) for AI agents',
        tags: ['mcp'],
        security: sec('mcp.use'),
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object' } } } },
        responses: { '200': { description: 'JSON-RPC response' }, '202': { description: 'Notification accepted' }, ...STD_ERRORS },
      },
    };
  }

  paths['/healthz'] = { get: { operationId: 'health', summary: 'Liveness', tags: ['ops'], security: [], responses: { '200': { description: 'OK' } } } };
  paths['/readyz'] = { get: { operationId: 'ready', summary: 'Readiness (BC reachable)', tags: ['ops'], security: [], responses: { '200': { description: 'Ready' }, '503': problem('Not ready') } } };

  const securitySchemes: Schema = {
    bearer: { type: 'http', scheme: 'bearer', description: 'OAuth 2.0 access token (JWT) or OpenBridge API key (obk_…)' },
  };
  if (o.oidcIssuer) {
    securitySchemes.oidc = { type: 'openIdConnect', openIdConnectUrl: `${o.oidcIssuer.replace(/\/$/, '')}/.well-known/openid-configuration` };
  }

  return {
    openapi: '3.1.0',
    jsonSchemaDialect: 'https://json-schema.org/draft/2020-12/schema',
    info: {
      title: 'BC OpenBridge API',
      version: o.version,
      description:
        'Interoperable, secured facade for Microsoft Dynamics 365 Business Central. ' +
        'Errors use RFC 9457, concurrency uses ETag/If-Match, retries use Idempotency-Key, ' +
        'change events use CloudEvents 1.0 signed per Standard Webhooks.',
      license: { name: 'MIT', identifier: 'MIT' },
    },
    servers: [{ url: o.publicBaseUrl }],
    security: sec(),
    tags: [
      { name: 'companies' },
      ...Object.values(o.entities).map((e) => ({ name: e.name, description: e.description })),
      { name: 'events' },
      { name: 'mcp' },
      { name: 'ops' },
    ],
    paths,
    webhooks: {
      bcChange: {
        post: {
          summary: 'Business Central change event delivered to subscribers',
          description: 'Verify webhook-signature per https://www.standardwebhooks.com before processing. De-duplicate on webhook-id.',
          parameters: [
            { name: 'webhook-id', in: 'header', required: true, schema: { type: 'string' } },
            { name: 'webhook-timestamp', in: 'header', required: true, schema: { type: 'integer' } },
            { name: 'webhook-signature', in: 'header', required: true, schema: { type: 'string' } },
          ],
          requestBody: { content: { 'application/cloudevents+json': { schema: { $ref: '#/components/schemas/CloudEvent' } } } },
          responses: { '2XX': { description: 'Accepted' }, '410': { description: 'Unsubscribe – stop delivering' } },
        },
      },
    },
    components: { schemas, securitySchemes },
  };
}
