# BC OpenBridge

Make Microsoft Dynamics 365 Business Central operable through open standards – for any system and any AI agent.

| Folder | What it is |
|---|---|
| [bc-openbridge/](bc-openbridge/) | **Gateway** – REST/OpenAPI 3.1, CloudEvents + Standard Webhooks, AsyncAPI, MCP over HTTP, OAuth 2.0/OIDC, scopes, audit log; BC mock for local development; [AL extension](bc-openbridge/bc-extension/) with custom APIs and a control plane |
| [bc-mcp/](bc-mcp/) | **MCP server for AI agents** (stdio) – task-level tools, two-step writes, no delete; works with Claude Code, OpenAI Codex, GitHub Copilot, Cursor and others |

```
AI agents (Claude Code · Codex · Copilot · …) ──stdio──► bc-mcp ──┐
Other systems (iPaaS, apps, SDKs, Power Platform) ─────────────────┼──► bc-openbridge ──► Business Central
Event consumers ◄── signed CloudEvents ────────────────────────────┘
```

## Quick start (no Business Central tenant needed)

```bash
cd bc-openbridge && npm install && npm run dev:mock
```

Then open this folder in your agent – the `business-central` MCP server is pre-configured:

| Client | Config in this repo |
|---|---|
| Claude Code | `.mcp.json` + skill `.claude/skills/business-central/` |
| GitHub Copilot CLI | `.mcp.json` (trust the folder) |
| VS Code – Copilot Chat | `.vscode/mcp.json` |
| OpenAI Codex | user config only: `cd bc-mcp && npm run client-config -- codex` |
| Others | `cd bc-mcp && npm run client-config` |

Agent rules for every harness: [AGENTS.md](AGENTS.md).

## Development

```bash
cd bc-openbridge && npm install && npm run check
cd bc-mcp && npm install && npm run check
```

Security concept and threat model: [bc-openbridge/docs/SICHERHEIT.md](bc-openbridge/docs/SICHERHEIT.md) · Policy: [SECURITY.md](SECURITY.md)
