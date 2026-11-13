/**
 * Print ready-to-use MCP configuration for the common agent harnesses.
 *
 *   npm run client-config               → all clients
 *   npm run client-config -- codex      → one client
 *   npm run client-config -- codex --url https://gw.example.com --key-env OPENBRIDGE_API_KEY
 *
 * Only prints – it never edits a client's config, so you stay in control of
 * what is registered globally.
 */
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    url: { type: 'string' },
    'key-env': { type: 'string' },
    name: { type: 'string', default: 'business-central' },
  },
});

const server = fileURLToPath(new URL('../src/server.ts', import.meta.url)).replace(/\\/g, '/');
const name = values.name!;
const remote = !!values.url;
const env: Record<string, string> = {};
if (values.url) env.OPENBRIDGE_URL = values.url;
const keyEnv = values['key-env'];

const json = (o: unknown) => JSON.stringify(o, null, 2);
const withEnv = (o: Record<string, unknown>, envValue: (v: string) => string) => {
  const e: Record<string, string> = { ...env };
  if (keyEnv) e.OPENBRIDGE_API_KEY = envValue(keyEnv);
  return Object.keys(e).length ? { ...o, env: e } : o;
};

const clients: Record<string, { title: string; where: string; body: () => string }> = {
  codex: {
    title: 'OpenAI Codex CLI / IDE extension',
    where: 'Run once (writes ~/.codex/config.toml). Codex 0.111 does not read project-level MCP config.',
    body: () => {
      const envFlags = [
        ...Object.entries(env).map(([k, v]) => `--env ${k}=${v}`),
        ...(keyEnv ? [`--env OPENBRIDGE_API_KEY=<your key>`] : []),
      ].join(' ');
      return [
        `codex mcp add ${name} ${envFlags ? `${envFlags} ` : ''}-- node "${server}"`,
        '',
        '# or add to ~/.codex/config.toml:',
        `[mcp_servers.${name}]`,
        'command = "node"',
        `args = ["${server}"]`,
        'startup_timeout_sec = 15',
        'tool_timeout_sec = 120',
        ...(Object.keys(env).length || keyEnv
          ? [`env = { ${[...Object.entries(env).map(([k, v]) => `${k} = "${v}"`), ...(keyEnv ? ['OPENBRIDGE_API_KEY = "<your key>"'] : [])].join(', ')} }`]
          : []),
      ].join('\n');
    },
  },
  'copilot-cli': {
    title: 'GitHub Copilot CLI',
    where: 'Workspace: .mcp.json or .github/mcp.json (folder must be trusted). User-wide: ~/.copilot/mcp-config.json',
    body: () => json({ mcpServers: { [name]: withEnv({ type: 'local', command: 'node', args: [server], tools: ['*'] }, (v) => `\${${v}}`) } }),
  },
  vscode: {
    title: 'VS Code – GitHub Copilot Chat (agent mode)',
    where: '.vscode/mcp.json in the workspace, or "MCP: Open User Configuration"',
    body: () =>
      json({
        ...(keyEnv ? { inputs: [{ type: 'promptString', id: 'openbridge-key', description: 'OpenBridge API key', password: true }] } : {}),
        servers: { [name]: withEnv({ type: 'stdio', command: 'node', args: [server] }, () => '${input:openbridge-key}') },
      }),
  },
  'copilot-cloud': {
    title: 'GitHub Copilot coding agent (github.com → repo Settings → Copilot → MCP)',
    where: 'Runs in GitHub Actions: needs a reachable HTTPS gateway (not localhost) and the key as environment secret COPILOT_MCP_OPENBRIDGE_API_KEY. The repo must contain bc-mcp/.',
    body: () =>
      json({
        mcpServers: {
          [name]: {
            type: 'local',
            command: 'node',
            args: ['bc-mcp/src/server.ts'],
            env: { OPENBRIDGE_URL: values.url ?? 'https://<your-gateway>', OPENBRIDGE_API_KEY: 'COPILOT_MCP_OPENBRIDGE_API_KEY' },
            tools: ['bc_overview', 'bc_find', 'bc_query', 'bc_get', 'bc_customer_overview', 'bc_open_items', 'bc_recent_changes'],
          },
        },
      }),
  },
  claude: {
    title: 'Claude Code',
    where: '.mcp.json in the project (shared with Copilot CLI), or: claude mcp add',
    body: () => json({ mcpServers: { [name]: withEnv({ type: 'stdio', command: 'node', args: [server] }, (v) => `\${${v}}`) } }),
  },
  'claude-desktop': {
    title: 'Claude Desktop',
    where: '%APPDATA%\\Claude\\claude_desktop_config.json (Windows) / ~/Library/Application Support/Claude/ (macOS)',
    body: () => json({ mcpServers: { [name]: withEnv({ command: 'node', args: [server] }, () => '<your key>') } }),
  },
  cursor: {
    title: 'Cursor / Windsurf / Gemini CLI / other mcpServers-style clients',
    where: '.cursor/mcp.json · ~/.codeium/windsurf/mcp_config.json · ~/.gemini/settings.json',
    body: () => json({ mcpServers: { [name]: withEnv({ command: 'node', args: [server] }, () => '<your key>') } }),
  },
};

const wanted = positionals.length ? positionals : Object.keys(clients);
for (const w of wanted) {
  const c = clients[w];
  if (!c) {
    console.error(`Unknown client "${w}". Available: ${Object.keys(clients).join(', ')}`);
    process.exit(1);
  }
  console.log(`\n### ${c.title}\n# ${c.where}\n${c.body()}`);
}
if (!remote) {
  console.log('\n# Local dev: no env needed – the server uses ../bc-openbridge/.dev-agent-key written by `npm run dev:mock`.');
}
