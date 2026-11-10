/**
 * Cross-harness compatibility guard (Claude Code, OpenAI Codex, GitHub Copilot,
 * Cursor, Gemini-style clients). Fails if a tool definition uses schema features
 * that some clients' converters reject, or exceeds common limits.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { Gateway } from '../src/gateway.ts';
import { GUIDE } from '../src/guide.ts';
import { Meta } from '../src/meta.ts';
import { PlanStore } from '../src/plans.ts';
import { PROTOCOLS, createHandler } from '../src/server.ts';
import { TOOLS } from '../src/tools.ts';

const ALLOWED_KEYS = new Set(['type', 'description', 'properties', 'required', 'items', 'enum', 'default', 'minimum', 'maximum', 'minLength', 'maxLength', 'maxItems', 'minItems', 'additionalProperties']);
const TYPES = new Set(['object', 'array', 'string', 'integer', 'number', 'boolean']);

function walk(schema: Record<string, unknown>, path: string, problems: string[]): void {
  for (const k of Object.keys(schema)) if (!ALLOWED_KEYS.has(k)) problems.push(`${path}: keyword "${k}" is not portable`);
  const t = schema.type;
  if (typeof t !== 'string' || !TYPES.has(t)) problems.push(`${path}: needs exactly one primitive "type" (got ${JSON.stringify(t)})`);
  if (t === 'object') {
    if (!schema.properties || typeof schema.properties !== 'object') problems.push(`${path}: object without "properties"`);
    for (const [k, v] of Object.entries((schema.properties ?? {}) as Record<string, Record<string, unknown>>)) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) problems.push(`${path}.${k}: property name not portable`);
      walk(v, `${path}.${k}`, problems);
    }
    for (const r of (schema.required ?? []) as string[]) {
      if (!(r in ((schema.properties ?? {}) as object))) problems.push(`${path}: required "${r}" not in properties`);
    }
  }
  if (t === 'array') {
    if (!schema.items || typeof schema.items !== 'object') problems.push(`${path}: array without "items"`);
    else walk(schema.items as Record<string, unknown>, `${path}[]`, problems);
  }
  if (schema.enum && (!Array.isArray(schema.enum) || schema.enum.some((e) => typeof e !== 'string'))) problems.push(`${path}: enum must be strings`);
}

const unreachable = () => {
  const gw = new Gateway({ baseUrl: 'http://127.0.0.1:9', apiKey: 'obk_test' });
  return createHandler({ gw, meta: new Meta(gw), plans: new PlanStore(), readOnly: false });
};

describe('cross-harness compatibility', () => {
  it('tool names fit OpenAI/Codex/Copilot limits (incl. client prefix)', () => {
    for (const t of TOOLS) {
      assert.match(t.name, /^[a-z][a-z0-9_]*$/, t.name);
      assert.ok(`mcp__business-central__${t.name}`.length <= 64, `${t.name} too long with prefix`);
      assert.ok(t.description.length <= 1024, `${t.name} description too long`);
      assert.ok(t.description.length >= 40, `${t.name} needs a self-explanatory description`);
    }
    assert.equal(new Set(TOOLS.map((t) => t.name)).size, TOOLS.length, 'unique names');
  });

  it('input schemas use only the portable JSON Schema subset', () => {
    const problems: string[] = [];
    for (const t of TOOLS) {
      assert.equal(t.inputSchema.type, 'object', `${t.name}: root must be an object`);
      walk(t.inputSchema, t.name, problems);
    }
    assert.deepEqual(problems, []);
  });

  it('write tools are annotated so clients can require approval', () => {
    const apply = TOOLS.find((t) => t.name === 'bc_apply_change')!;
    assert.equal(apply.annotations.readOnlyHint, false);
    assert.equal(apply.annotations.destructiveHint, true);
    for (const t of TOOLS.filter((x) => !x.write)) assert.equal(t.annotations.readOnlyHint, true, t.name);
    assert.ok(!TOOLS.some((t) => /delete|remove/.test(t.name)));
  });

  it('negotiates every supported protocol version and falls back for unknown ones', async () => {
    const h = unreachable();
    for (const v of PROTOCOLS) {
      const r = (await h({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: v, capabilities: {} } })) as any;
      assert.equal(r.result.protocolVersion, v);
      assert.deepEqual(Object.keys(r.result.capabilities).sort(), ['prompts', 'resources', 'tools']);
    }
    const old = (await h({ jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '2023-01-01' } })) as any;
    assert.ok(PROTOCOLS.includes(old.result.protocolVersion));
  });

  it('lists all tools quickly even when the gateway is down (clients list once at startup)', async () => {
    const h = unreachable();
    const started = Date.now();
    const r = (await h({ jsonrpc: '2.0', id: 1, method: 'tools/list' })) as any;
    assert.ok(Date.now() - started < 3500);
    assert.equal(r.result.tools.length, TOOLS.length);
    for (const t of r.result.tools) assert.deepEqual(Object.keys(t).sort(), ['annotations', 'description', 'inputSchema', 'name', 'title']);
  });

  it('ignores notifications and returns tool errors as results, not protocol errors', async () => {
    const h = unreachable();
    assert.equal(await h({ jsonrpc: '2.0', method: 'notifications/initialized' }), undefined);
    const r = (await h({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'bc_overview', arguments: {} } })) as any;
    assert.equal(r.result.isError, true);
    assert.equal(r.result.structuredContent, undefined, 'text-only by default');
    assert.match(r.result.content[0].text, /npm run dev:mock/);
  });

  it('keeps AGENTS.md in sync with the guide sent as MCP instructions', () => {
    const agents = fileURLToPath(new URL('../../AGENTS.md', import.meta.url));
    if (!existsSync(agents)) return; // bc-mcp checked out on its own
    const norm = (s: string) => s.replace(/\r\n/g, '\n').trim();
    assert.ok(norm(readFileSync(agents, 'utf8')).includes(norm(GUIDE)), 'AGENTS.md must contain src/guide.ts verbatim');
  });
});
