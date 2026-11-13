#!/usr/bin/env node
/**
 * bc-mcp – harness-neutral MCP server (stdio transport) that lets AI agents
 * (Claude Code, OpenAI Codex, GitHub Copilot, Cursor, …) operate Business
 * Central through the BC OpenBridge gateway.
 *
 * Environment (all optional for local development):
 *   OPENBRIDGE_URL             gateway base URL (default http://localhost:8080)
 *   OPENBRIDGE_API_KEY         API key / bearer token  – or –
 *   OPENBRIDGE_API_KEY_FILE    file containing it (re-read on every request; relative to cwd).
 *                              Default for a localhost gateway: ../bc-openbridge/.dev-agent-key
 *                              (written by `npm run dev:mock`), so no client-specific env is needed.
 *   BC_MCP_READ_ONLY=true      hide all write tools
 *   BC_MCP_STRUCTURED_OUTPUT=true  also return structuredContent (off by default: some clients
 *                              send structuredContent instead of the text to the model, which
 *                              would drop the <bc-data> fencing and the Markdown tables)
 *
 * Compatibility choices: newline-delimited JSON-RPC on stdout only (logs → stderr),
 * protocol versions 2024-11-05 … 2025-11-25, plain JSON Schemas (no union types,
 * no $ref/oneOf, objects always with `properties`), self-explanatory tool descriptions
 * (not every client forwards server instructions to the model).
 */
import { existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { Gateway } from './gateway.ts';
import { GUIDE } from './guide.ts';
import { InputError, Meta } from './meta.ts';
import { PlanStore } from './plans.ts';
import { TOOLS, describeError, type ToolContext } from './tools.ts';

export const VERSION = '0.2.0';
export const PROTOCOLS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
export const DEV_KEY_FILE = fileURLToPath(new URL('../../bc-openbridge/.dev-agent-key', import.meta.url));

export interface ServerOptions extends ToolContext {
  structuredOutput?: boolean;
}

type Msg = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> };

const PROMPTS = [
  {
    name: 'customer-check',
    title: 'Customer check',
    description: 'Assess credit standing and open items of one customer',
    arguments: [
      { name: 'customer', description: 'Customer name, number or id', required: true },
      { name: 'company', description: 'Company (optional)', required: false },
    ],
    render: (a: Record<string, string>) =>
      `Run a customer check for "${a.customer}"${a.company ? ` in company "${a.company}"` : ''}. ` +
      'Use bc_customer_overview. Assess credit-limit utilisation, overdue items and open orders, ' +
      'state amounts with the as-of date and finish with a clear recommendation (e.g. release delivery, send reminder, review limit).',
  },
  {
    name: 'open-items',
    title: 'Open items',
    description: 'Summarise and prioritise receivables or payables',
    arguments: [
      { name: 'kind', description: 'receivables or payables', required: true },
      { name: 'company', description: 'Company (optional)', required: false },
    ],
    render: (a: Record<string, string>) => {
      const kind = /pay|verbind/i.test(a.kind ?? '') ? 'payables' : 'receivables';
      return (
        `Summarise the open ${kind}${a.company ? ` of company "${a.company}"` : ''}. ` +
        `Use bc_open_items (kind=${kind}). Show totals, the largest overdue amounts and a prioritised action list.`
      );
    },
  },
  {
    name: 'safe-change',
    title: 'Safe change',
    description: 'Change data in Business Central with preview and confirmation',
    arguments: [{ name: 'change', description: 'What should be created or changed?', required: true }],
    render: (a: Record<string, string>) =>
      `Make this change in Business Central: ${a.change}\n` +
      'First identify the affected record (bc_find/bc_query), prepare the change with bc_prepare_create or bc_prepare_update, ' +
      'show me the plan and wait for my explicit confirmation before calling bc_apply_change.',
  },
];

export function createHandler(ctx: ServerOptions) {
  /**
   * Many clients list tools only once at startup. Hide write tools only when we KNOW the
   * key cannot write; if the gateway is not up yet, list them – the gateway enforces
   * rights on every call anyway. Bounded so a slow gateway never delays client startup.
   */
  async function visibleTools() {
    if (ctx.readOnly) return TOOLS.filter((t) => !t.write);
    try {
      const entities = await Promise.race([
        ctx.meta.entities(),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000).unref()),
      ]);
      return entities.some((e) => e.access.write) ? TOOLS : TOOLS.filter((t) => !t.write);
    } catch {
      return TOOLS;
    }
  }

  const ok = (id: Msg['id'], result: unknown) => ({ jsonrpc: '2.0', id, result });
  const fail = (id: Msg['id'], code: number, message: string) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });

  return async function handle(m: Msg): Promise<unknown | undefined> {
    if (!m || m.jsonrpc !== '2.0') return fail(null, -32600, 'Invalid Request');
    if (m.id === undefined) return undefined; // notification
    if (!m.method) return undefined; // response to a server request – none are sent
    const p = m.params ?? {};
    switch (m.method) {
      case 'initialize':
        return ok(m.id, {
          protocolVersion: PROTOCOLS.includes(String(p.protocolVersion)) ? p.protocolVersion : '2025-06-18',
          capabilities: { tools: {}, resources: {}, prompts: {} },
          serverInfo: { name: 'bc-mcp', title: 'Business Central (via OpenBridge)', version: VERSION },
          instructions: GUIDE,
        });
      case 'ping':
        return ok(m.id, {});
      case 'tools/list':
        return ok(m.id, {
          tools: (await visibleTools()).map(({ name, title, description, inputSchema, annotations }) => ({ name, title, description, inputSchema, annotations })),
        });
      case 'tools/call': {
        const tool = TOOLS.find((t) => t.name === p.name && !(t.write && ctx.readOnly));
        if (!tool) return fail(m.id, -32602, `Unknown tool: ${String(p.name)}`);
        const args = (p.arguments ?? {}) as Record<string, unknown>;
        try {
          const r = await tool.run(args, ctx);
          return ok(m.id, {
            content: [{ type: 'text', text: r.text }],
            ...(ctx.structuredOutput ? { structuredContent: r.data } : {}),
            isError: false,
          });
        } catch (err) {
          if (!(err instanceof InputError)) process.stderr.write(`[bc-mcp] ${tool.name}: ${(err as Error)?.stack ?? err}\n`);
          return ok(m.id, { content: [{ type: 'text', text: describeError(err) }], isError: true });
        }
      }
      case 'resources/list':
        return ok(m.id, {
          resources: [
            { uri: 'bc://guide', name: 'guide', title: 'Usage guide for AI agents', mimeType: 'text/markdown' },
            { uri: 'bc://entities', name: 'entities', title: 'Entity sets, fields and your rights', mimeType: 'application/json' },
          ],
        });
      case 'resources/read': {
        if (p.uri === 'bc://guide') return ok(m.id, { contents: [{ uri: 'bc://guide', mimeType: 'text/markdown', text: GUIDE }] });
        if (p.uri === 'bc://entities') {
          try {
            const entities = await ctx.meta.entities();
            return ok(m.id, { contents: [{ uri: 'bc://entities', mimeType: 'application/json', text: JSON.stringify(entities, null, 2) }] });
          } catch (err) {
            return fail(m.id, -32603, describeError(err));
          }
        }
        return fail(m.id, -32002, `Resource not found: ${String(p.uri)}`);
      }
      case 'prompts/list':
        return ok(m.id, { prompts: PROMPTS.map(({ render: _r, ...rest }) => rest) });
      case 'prompts/get': {
        const prompt = PROMPTS.find((x) => x.name === p.name);
        if (!prompt) return fail(m.id, -32602, `Unknown prompt: ${String(p.name)}`);
        const args = (p.arguments ?? {}) as Record<string, string>;
        for (const a of prompt.arguments) if (a.required && !args[a.name]) return fail(m.id, -32602, `Missing argument: ${a.name}`);
        return ok(m.id, { description: prompt.description, messages: [{ role: 'user', content: { type: 'text', text: prompt.render(args) } }] });
      }
      default:
        return fail(m.id, -32601, `Method not found: ${m.method}`);
    }
  };
}

function main(): void {
  let gw: Gateway;
  try {
    const baseUrl = process.env.OPENBRIDGE_URL || 'http://localhost:8080';
    const apiKey = process.env.OPENBRIDGE_API_KEY || undefined;
    let apiKeyFile = process.env.OPENBRIDGE_API_KEY_FILE || undefined;
    if (!apiKey && !apiKeyFile && /^http:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(baseUrl)) apiKeyFile = DEV_KEY_FILE;
    gw = new Gateway({ baseUrl, apiKey, apiKeyFile });
    if (apiKeyFile === DEV_KEY_FILE && !existsSync(DEV_KEY_FILE)) {
      process.stderr.write('[bc-mcp] no dev key yet – start the gateway: cd bc-openbridge && npm run dev:mock\n');
    }
  } catch (e) {
    process.stderr.write(`[bc-mcp] ${(e as Error).message}\n`);
    process.exit(1);
  }
  const handle = createHandler({
    gw,
    meta: new Meta(gw),
    plans: new PlanStore(),
    readOnly: /^(1|true|yes)$/i.test(process.env.BC_MCP_READ_ONLY ?? ''),
    structuredOutput: /^(1|true|yes)$/i.test(process.env.BC_MCP_STRUCTURED_OUTPUT ?? ''),
  });
  const write = (o: unknown) => process.stdout.write(JSON.stringify(o) + '\n');
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  rl.on('line', (line) => {
    if (!line.trim()) return;
    let msg: Msg;
    try {
      msg = JSON.parse(line);
    } catch {
      write({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
      return;
    }
    if (Array.isArray(msg)) {
      write({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Batching is not supported' } });
      return;
    }
    handle(msg)
      .then((reply) => reply && write(reply))
      .catch((err) => write({ jsonrpc: '2.0', id: msg.id ?? null, error: { code: -32603, message: String((err as Error)?.message ?? err) } }));
  });
  rl.on('close', () => process.exit(0));
  process.stderr.write(`[bc-mcp] ready – gateway ${gw.baseUrl}\n`);
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('src/server.ts')) main();
