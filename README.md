# bc-mcp

**MCP server for operating Microsoft Dynamics 365 Business Central with AI agents** – through the
[BC OpenBridge gateway](../bc-openbridge). Harness-neutral: tested with **Claude Code**, **OpenAI Codex**
and **GitHub Copilot** (CLI, VS Code agent mode), usable by any MCP client (Cursor, Windsurf, Gemini CLI, Claude Desktop …).

The gateway offers generic, standards-based interfaces for *all* systems. bc-mcp is the layer next to
it, shaped around how an AI agent works:

| Built for agents | Why |
|---|---|
| **Orientation first** (`bc_overview`) | one call returns companies, entity sets, fields and your own rights |
| **Task tools, not table tools** (`bc_customer_overview`, `bc_open_items`) | one question = one call; aggregated, with KPIs and as-of date |
| **Forgiving inputs** | company name instead of GUID, "Customer" instead of "customers", company optional when unique, customer number or name instead of id |
| **Compact output** | Markdown tables with sensible columns per entity instead of JSON dumps |
| **Two-step writes** | `bc_prepare_*` shows a before/after plan, only `bc_apply_change` writes |
| **No delete** | not available at all |
| **Prompt-injection hygiene** | BC content is fenced in `<bc-data>` and marked as data |
| **No rights of its own** | everything goes through the gateway: scopes, validation, rate limits and the audit log apply to the agent too |

## Tools

| Tool | Purpose | Writes |
|---|---|---|
| `bc_overview` | companies, entity sets, rights, field names | – |
| `bc_find` | find customers/vendors/items by part of name or number | – |
| `bc_query` | filtered list of one entity set (filters, fields, sort, cursor) | – |
| `bc_get` | one complete record | – |
| `bc_customer_overview` | customer 360°: master data, credit utilisation, open/overdue invoices, orders, open ledger entries | – |
| `bc_open_items` | receivables or payables per partner incl. overdue amounts | – |
| `bc_recent_changes` | recently received change events | – |
| `bc_prepare_create` / `bc_prepare_update` | validate a change and show it as a plan | – |
| `bc_apply_change` | execute a confirmed plan (ETag protection, idempotent) | ✔ |

Plus resources (`bc://guide`, `bc://entities`) and prompts (`customer-check`, `open-items`, `safe-change`) for clients that support them.

### Why two steps?
* **Visibility:** the user sees exactly which field changes from what to what before anything is written.
* **No lost updates:** the plan keeps the ETag; if someone changed the record meanwhile, BC rejects it (412) and nothing is written.
* **No duplicates:** creates use the plan id as `Idempotency-Key`.
* **Honest limit:** the real confirmation gate is your client's approval prompt for `bc_apply_change` (annotated *destructive*).
  Never auto-approve it (Claude Code permissions, Codex approval policy, Copilot `--allow-tool`/"Always allow"). Read tools can be auto-approved,
  e.g. Copilot CLI: `--allow-tool 'business-central' --deny-tool 'business-central(bc_apply_change)'`.

## Setup

### 1. Start the gateway (local, with the BC mock)

```bash
cd bc-openbridge && npm run dev:mock
```

`dev:mock` writes a dedicated agent key to `bc-openbridge/.dev-agent-key` (scopes `bc.read`, `bc.write`,
`events.read` – no delete, no admin) and removes it on Ctrl+C. With a localhost gateway, bc-mcp finds
that file by itself, so **no client needs any environment variables**.

### 2. Register the server in your client

Ready-made files in the `NewPriojects` workspace:

| Client | Config | Status |
|---|---|---|
| Claude Code | `.mcp.json` | picked up automatically (approve once) |
| GitHub Copilot CLI | `.mcp.json` (same file) | picked up when the folder is trusted |
| VS Code – Copilot Chat agent mode | `.vscode/mcp.json` | picked up automatically (start the server in the MCP view) |
| OpenAI Codex | user config only | run the command from `npm run client-config -- codex` |
| Copilot coding agent (github.com), Claude Desktop, Cursor, Windsurf, Gemini CLI | see below | `npm run client-config -- <client>` |

```bash
npm run client-config            # print the config for every client, with absolute paths
npm run client-config -- codex   # e.g.: codex mcp add business-central -- node ".../bc-mcp/src/server.ts"
```

Agent instructions live in `AGENTS.md` (read by Codex, Copilot, Cursor and others) and in the Claude skill
`.claude/skills/business-central/`; the server also sends them as MCP `instructions`.

### Production gateway

| Variable | Meaning |
|---|---|
| `OPENBRIDGE_URL` | gateway URL (https; http only for localhost) |
| `OPENBRIDGE_API_KEY` or `OPENBRIDGE_API_KEY_FILE` | a dedicated API key for the agent (a file is re-read on every call) |
| `BC_MCP_READ_ONLY=true` | hide all write tools |
| `BC_MCP_STRUCTURED_OUTPUT=true` | additionally return `structuredContent` (see below) |

```bash
npm run client-config -- codex vscode --url https://bc-gateway.example.com --key-env OPENBRIDGE_API_KEY
```

Create the key with the smallest scopes needed, e.g. read-only:

```bash
cd bc-openbridge && npm run create-api-key -- --name ai-agent --scopes bc.read,events.read --file api-keys.json
```

For remote-only clients (no local process possible) the gateway itself offers MCP over Streamable HTTP at `/mcp`.

## Compatibility notes

| Decision | Reason |
|---|---|
| stdio transport, newline-delimited JSON-RPC, logs only on stderr | supported by every MCP client |
| protocol versions 2024-11-05 … 2025-11-25, echo the client's version | older and newer clients |
| plain JSON Schemas: single `type`, no `$ref`/`oneOf`/union types, no `format`, every `object` has `properties`, every `array` has `items` | OpenAI/Codex and Gemini-style schema converters reject or drop richer schemas; enforced by `test/compat.test.ts` |
| tool names `[a-z_]`, ≤ 64 chars incl. client prefix; descriptions ≤ 1024 chars | OpenAI function-calling limits |
| text content only by default, `structuredContent` opt-in | some clients forward `structuredContent` instead of the text, which would drop the Markdown and the `<bc-data>` fencing |
| all ids, cursors and plan ids also in the text | clients that only show text still have everything needed for follow-up calls |
| self-explanatory tool descriptions + `AGENTS.md` | not every client passes server `instructions` to the model |
| write tools listed unless the key provably cannot write | many clients list tools only once at startup (gateway may not be up yet); rights are enforced per call anyway |
| no client-specific env syntax in shared config files | `${VAR:-default}` works in Claude Code but not elsewhere; the server needs no env for local dev |

## Development

```bash
npm install
npm run check     # typecheck + tests (starts BC mock and gateway from ../bc-openbridge)
```

No runtime dependencies; Node ≥ 24 runs TypeScript directly.
