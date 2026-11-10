/**
 * Model Context Protocol server (Streamable HTTP transport, JSON-RPC 2.0).
 *
 * Exposes Business Central to AI agents (Claude, Copilot Studio, …) through
 * the same authorization, validation and audit pipeline as the REST API.
 * Deliberately conservative: no delete tool, updates require an ETag, tools
 * are only listed when the caller holds a matching scope.
 */
import type { EntityDef } from '../bc/entities.ts';
import { FILTER_OPS, type FilterOp, type ListQuery } from '../bc/odata.ts';
import { HttpError } from '../http/problem.ts';
import { canAccessEntity, type Principal } from '../security/principal.ts';
import type { BcService, CallContext } from '../api/service.ts';
import { fieldSchema } from '../spec/schemas.ts';

export const SUPPORTED_PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
const DEFAULT_PROTOCOL_VERSION = '2025-06-18';

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: unknown;
}

export interface McpReply {
  status: number;
  body?: unknown;
}

interface Tool {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: Record<string, boolean | string>;
  visible: (p: Principal) => boolean;
  run: (args: Record<string, unknown>, ctx: CallContext) => Promise<Record<string, unknown>>;
}

const rpcError = (id: JsonRpcRequest['id'], code: number, message: string, data?: unknown) => ({
  jsonrpc: '2.0',
  id: id ?? null,
  error: { code, message, ...(data !== undefined ? { data } : {}) },
});

class InvalidParams extends Error {}

function str(args: Record<string, unknown>, key: string, required = true): string | undefined {
  const v = args[key];
  if (v === undefined && !required) return undefined;
  if (typeof v !== 'string' || v.length === 0) throw new InvalidParams(`"${key}" must be a non-empty string`);
  return v;
}

export class McpServer {
  readonly #service: BcService;
  readonly #version: string;
  readonly #tools: Tool[];

  constructor(service: BcService, version: string) {
    this.#service = service;
    this.#version = version;
    this.#tools = this.#buildTools();
  }

  #anyAccess(p: Principal, access: 'read' | 'write', filter: (e: EntityDef) => boolean = () => true): boolean {
    return Object.values(this.#service.entities).some((e) => filter(e) && canAccessEntity(p, e.name, access));
  }

  #buildTools(): Tool[] {
    const entities = Object.values(this.#service.entities);
    const names = entities.map((e) => e.name);
    const creatable = entities.filter((e) => e.operations.includes('create')).map((e) => e.name);
    const updatable = entities.filter((e) => e.operations.includes('update')).map((e) => e.name);
    const companyId = { type: 'string', format: 'uuid', description: 'Company id from bc_list_companies' };
    const svc = this.#service;

    return [
      {
        name: 'bc_list_companies',
        title: 'List companies',
        description: 'List the Business Central companies (Mandanten) this gateway may access. Call this first to obtain a companyId.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        annotations: { readOnlyHint: true, openWorldHint: false },
        visible: (p) => this.#anyAccess(p, 'read'),
        run: async (_a, ctx) => ({ companies: await svc.listCompanies(ctx) }),
      },
      {
        name: 'bc_describe_entities',
        title: 'Describe entities',
        description: 'Describe the available entity sets, their fields (with types) and supported operations for the current caller.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        annotations: { readOnlyHint: true, openWorldHint: false },
        visible: (p) => this.#anyAccess(p, 'read'),
        run: async (_a, ctx) => ({
          entities: entities
            .filter((e) => canAccessEntity(ctx.principal, e.name, 'read'))
            .map((e) => ({
              name: e.name,
              description: e.description,
              operations: e.operations.filter((op) => op === 'list' || op === 'get' || canAccessEntity(ctx.principal, e.name, 'write')),
              fields: Object.fromEntries(Object.entries(e.fields).map(([k, f]) => [k, { ...fieldSchema(f), writable: !!f.writable }])),
            })),
        }),
      },
      {
        name: 'bc_query',
        title: 'Query records',
        description:
          'Query records of an entity set with optional filters, field selection and sorting. Returns at most `limit` records and a `nextCursor` for further pages.',
        inputSchema: {
          type: 'object',
          required: ['entity', 'companyId'],
          additionalProperties: false,
          properties: {
            entity: { type: 'string', enum: names },
            companyId,
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
            select: { type: 'array', items: { type: 'string' }, description: 'Fields to return' },
            sort: {
              type: 'array',
              maxItems: 3,
              items: { type: 'object', required: ['field'], properties: { field: { type: 'string' }, desc: { type: 'boolean' } } },
            },
            limit: { type: 'integer', minimum: 1, maximum: 200, default: 20 },
            cursor: { type: 'string', description: 'nextCursor from a previous call' },
          },
        },
        annotations: { readOnlyHint: true, openWorldHint: false },
        visible: (p) => this.#anyAccess(p, 'read'),
        run: async (a, ctx) => {
          const q: ListQuery = { filters: [], limit: 20 };
          if (a.filters !== undefined) {
            if (!Array.isArray(a.filters)) throw new InvalidParams('"filters" must be an array');
            q.filters = a.filters.map((f: Record<string, unknown>) => {
              if (typeof f?.field !== 'string' || !['string', 'number', 'boolean'].includes(typeof f.value)) {
                throw new InvalidParams('each filter needs "field" and a scalar "value"');
              }
              return { field: f.field, op: (typeof f.op === 'string' ? f.op : 'eq') as FilterOp, value: String(f.value) };
            });
          }
          if (a.select !== undefined) {
            if (!Array.isArray(a.select) || a.select.some((s) => typeof s !== 'string')) throw new InvalidParams('"select" must be a string array');
            q.select = a.select as string[];
          }
          if (a.sort !== undefined) {
            if (!Array.isArray(a.sort)) throw new InvalidParams('"sort" must be an array');
            q.sort = a.sort.map((s: Record<string, unknown>) => ({ field: String(s?.field ?? ''), desc: s?.desc === true }));
          }
          if (a.limit !== undefined) {
            if (!Number.isInteger(a.limit) || (a.limit as number) < 1 || (a.limit as number) > 200) throw new InvalidParams('"limit" must be 1-200');
            q.limit = a.limit as number;
          }
          q.cursor = str(a, 'cursor', false);
          const r = await svc.list(ctx, str(a, 'entity')!, str(a, 'companyId')!, q);
          return { count: r.data.length, records: r.data, ...(r.nextCursor ? { nextCursor: r.nextCursor } : {}) };
        },
      },
      {
        name: 'bc_get',
        title: 'Get record',
        description: 'Read a single record by id. The returned `etag` is required for bc_update.',
        inputSchema: {
          type: 'object',
          required: ['entity', 'companyId', 'id'],
          additionalProperties: false,
          properties: { entity: { type: 'string', enum: names }, companyId, id: { type: 'string', format: 'uuid' } },
        },
        annotations: { readOnlyHint: true, openWorldHint: false },
        visible: (p) => this.#anyAccess(p, 'read'),
        run: async (a, ctx) => (await svc.get(ctx, str(a, 'entity')!, str(a, 'companyId')!, str(a, 'id')!)).record,
      },
      {
        name: 'bc_create',
        title: 'Create record',
        description: 'Create a new record. Only writable fields (see bc_describe_entities) are accepted. Creates real data in Business Central.',
        inputSchema: {
          type: 'object',
          required: ['entity', 'companyId', 'data'],
          additionalProperties: false,
          properties: { entity: { type: 'string', enum: creatable }, companyId, data: { type: 'object' } },
        },
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        visible: (p) => this.#anyAccess(p, 'write', (e) => e.operations.includes('create')),
        run: async (a, ctx) => (await svc.create(ctx, str(a, 'entity')!, str(a, 'companyId')!, a.data)).record,
      },
      {
        name: 'bc_update',
        title: 'Update record',
        description:
          'Update fields of an existing record. Requires the current `etag` from bc_get/bc_query (optimistic concurrency – fails if the record changed meanwhile).',
        inputSchema: {
          type: 'object',
          required: ['entity', 'companyId', 'id', 'etag', 'data'],
          additionalProperties: false,
          properties: {
            entity: { type: 'string', enum: updatable },
            companyId,
            id: { type: 'string', format: 'uuid' },
            etag: { type: 'string' },
            data: { type: 'object' },
          },
        },
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
        visible: (p) => this.#anyAccess(p, 'write', (e) => e.operations.includes('update')),
        run: async (a, ctx) =>
          (await svc.update(ctx, str(a, 'entity')!, str(a, 'companyId')!, str(a, 'id')!, str(a, 'etag')!, a.data)).record,
      },
    ];
  }

  async handle(message: unknown, ctx: CallContext): Promise<McpReply> {
    if (Array.isArray(message)) return { status: 400, body: rpcError(null, -32600, 'Batching is not supported') };
    const m = message as JsonRpcRequest;
    if (!m || typeof m !== 'object' || m.jsonrpc !== '2.0') return { status: 400, body: rpcError(null, -32600, 'Invalid JSON-RPC 2.0 message') };

    // Notifications and responses from the client: acknowledge without body.
    if (m.id === undefined || m.method === undefined) return { status: 202 };

    const id = m.id;
    const params = m.params ?? {};
    try {
      switch (m.method) {
        case 'initialize': {
          const requested = String(params.protocolVersion ?? '');
          return this.#ok(id, {
            protocolVersion: SUPPORTED_PROTOCOL_VERSIONS.includes(requested) ? requested : DEFAULT_PROTOCOL_VERSION,
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: 'bc-openbridge', title: 'Business Central via OpenBridge', version: this.#version },
            instructions:
              'Tools operate on Microsoft Dynamics 365 Business Central. Start with bc_list_companies and bc_describe_entities. ' +
              'Use bc_query with filters instead of fetching everything. Writes are audited and require explicit user intent.',
          });
        }
        case 'ping':
          return this.#ok(id, {});
        case 'tools/list':
          return this.#ok(id, {
            tools: this.#tools
              .filter((t) => t.visible(ctx.principal))
              .map(({ name, title, description, inputSchema, annotations }) => ({ name, title, description, inputSchema, annotations })),
          });
        case 'tools/call': {
          const name = params.name;
          const tool = this.#tools.find((t) => t.name === name && t.visible(ctx.principal));
          if (!tool) return { status: 200, body: rpcError(id, -32602, `Unknown tool: ${String(name)}`) };
          const args = (params.arguments ?? {}) as Record<string, unknown>;
          if (typeof args !== 'object' || Array.isArray(args)) return { status: 200, body: rpcError(id, -32602, 'arguments must be an object') };
          try {
            const result = await tool.run(args, ctx);
            return this.#ok(id, { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], structuredContent: result, isError: false });
          } catch (e) {
            if (e instanceof InvalidParams) return this.#ok(id, toolError(e.message));
            if (e instanceof HttpError) {
              const errs = (e.extras.errors as { field: string; message: string }[] | undefined)?.map((x) => `- ${x.field}: ${x.message}`).join('\n');
              return this.#ok(id, toolError(`${e.title} (${e.status})${e.detail ? `: ${e.detail}` : ''}${errs ? `\n${errs}` : ''}`));
            }
            throw e;
          }
        }
        case 'resources/list':
          return this.#ok(id, { resources: [] });
        case 'prompts/list':
          return this.#ok(id, { prompts: [] });
        default:
          return { status: 200, body: rpcError(id, -32601, `Method not found: ${m.method}`) };
      }
    } catch {
      return { status: 200, body: rpcError(id, -32603, 'Internal error') };
    }
  }

  #ok(id: JsonRpcRequest['id'], result: unknown): McpReply {
    return { status: 200, body: { jsonrpc: '2.0', id, result } };
  }
}

function toolError(text: string) {
  return { content: [{ type: 'text', text }], isError: true };
}
