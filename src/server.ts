#!/usr/bin/env node
/**
 * bc-claude – MCP server (stdio transport) that lets Claude operate
 * Business Central through the BC OpenBridge gateway.
 *
 * Environment:
 *   OPENBRIDGE_URL            gateway base URL (default http://localhost:8080)
 *   OPENBRIDGE_API_KEY        API key / bearer token  – or –
 *   OPENBRIDGE_API_KEY_FILE   file containing it (re-read on every request)
 *   BC_CLAUDE_READ_ONLY=true  hide all write tools
 *
 * stdout carries only JSON-RPC; diagnostics go to stderr.
 */
import { createInterface } from 'node:readline';
import { Gateway } from './gateway.ts';
import { GUIDE } from './guide.ts';
import { InputError, Meta } from './meta.ts';
import { PlanStore } from './plans.ts';
import { TOOLS, describeError, type ToolContext } from './tools.ts';

const VERSION = '0.1.0';
const PROTOCOLS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];

type Msg = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> };

const PROMPTS = [
  {
    name: 'kunden-check',
    title: 'Kunden-Check',
    description: 'Bonität und offene Posten eines Kunden bewerten',
    arguments: [
      { name: 'kunde', description: 'Name, Nummer oder ID des Debitors', required: true },
      { name: 'firma', description: 'Firma (optional)', required: false },
    ],
    render: (a: Record<string, string>) =>
      `Erstelle einen Kunden-Check für „${a.kunde}“${a.firma ? ` in der Firma „${a.firma}“` : ''}. ` +
      'Nutze bc_customer_overview. Bewerte Kreditlimit-Auslastung, Überfälligkeiten und offene Aufträge, ' +
      'nenne Stichtag und Beträge und schließe mit einer klaren Empfehlung (z. B. Lieferung freigeben, Mahnung, Limit prüfen).',
  },
  {
    name: 'offene-posten',
    title: 'Offene Posten',
    description: 'Forderungen oder Verbindlichkeiten zusammenfassen und priorisieren',
    arguments: [
      { name: 'art', description: 'forderungen oder verbindlichkeiten', required: true },
      { name: 'firma', description: 'Firma (optional)', required: false },
    ],
    render: (a: Record<string, string>) =>
      `Fasse die offenen ${/verbind/i.test(a.art ?? '') ? 'Verbindlichkeiten' : 'Forderungen'}${a.firma ? ` der Firma „${a.firma}“` : ''} zusammen. ` +
      `Nutze bc_open_items (kind=${/verbind/i.test(a.art ?? '') ? 'payables' : 'receivables'}). Zeige Gesamtsummen, die größten Überfälligkeiten ` +
      'und eine priorisierte Handlungsliste.',
  },
  {
    name: 'sichere-aenderung',
    title: 'Sichere Änderung',
    description: 'Eine Änderung in Business Central mit Vorschau und Bestätigung durchführen',
    arguments: [{ name: 'aenderung', description: 'Was soll geändert oder angelegt werden?', required: true }],
    render: (a: Record<string, string>) =>
      `Führe diese Änderung in Business Central durch: ${a.aenderung}\n` +
      'Ermittle zuerst den betroffenen Datensatz (bc_find/bc_query), bereite die Änderung mit bc_prepare_create bzw. bc_prepare_update vor, ' +
      'zeige mir den Plan und warte auf meine ausdrückliche Bestätigung, bevor du bc_apply_change aufrufst.',
  },
];

export function createHandler(ctx: ToolContext) {
  async function visibleTools() {
    if (ctx.readOnly) return TOOLS.filter((t) => !t.write);
    try {
      const canWrite = (await ctx.meta.entities()).some((e) => e.access.write);
      return canWrite ? TOOLS : TOOLS.filter((t) => !t.write);
    } catch {
      return TOOLS.filter((t) => !t.write);
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
          serverInfo: { name: 'bc-claude', title: 'Business Central (via OpenBridge)', version: VERSION },
          instructions: GUIDE,
        });
      case 'ping':
        return ok(m.id, {});
      case 'tools/list':
        return ok(m.id, {
          tools: (await visibleTools()).map(({ name, title, description, inputSchema, annotations }) => ({ name, title, description, inputSchema, annotations })),
        });
      case 'tools/call': {
        const tool = (await visibleTools()).find((t) => t.name === p.name);
        if (!tool) return fail(m.id, -32602, `Unknown tool: ${String(p.name)}`);
        const args = (p.arguments ?? {}) as Record<string, unknown>;
        try {
          const r = await tool.run(args, ctx);
          return ok(m.id, { content: [{ type: 'text', text: r.text }], structuredContent: r.data, isError: false });
        } catch (err) {
          if (!(err instanceof InputError)) process.stderr.write(`[bc-claude] ${tool.name}: ${(err as Error)?.stack ?? err}\n`);
          return ok(m.id, { content: [{ type: 'text', text: describeError(err) }], isError: true });
        }
      }
      case 'resources/list':
        return ok(m.id, {
          resources: [
            { uri: 'bc://guide', name: 'guide', title: 'Anleitung für Claude', mimeType: 'text/markdown' },
            { uri: 'bc://entities', name: 'entities', title: 'Entitäten, Felder und Rechte', mimeType: 'application/json' },
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
    gw = new Gateway({
      baseUrl: process.env.OPENBRIDGE_URL || 'http://localhost:8080',
      apiKey: process.env.OPENBRIDGE_API_KEY || undefined,
      apiKeyFile: process.env.OPENBRIDGE_API_KEY_FILE || undefined,
    });
  } catch (e) {
    process.stderr.write(`[bc-claude] ${(e as Error).message}\n`);
    process.exit(1);
  }
  const handle = createHandler({
    gw,
    meta: new Meta(gw),
    plans: new PlanStore(),
    readOnly: /^(1|true|yes)$/i.test(process.env.BC_CLAUDE_READ_ONLY ?? ''),
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
  process.stderr.write(`[bc-claude] ready – gateway ${gw.baseUrl}\n`);
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('src/server.ts')) main();
