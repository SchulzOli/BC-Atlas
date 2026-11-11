# Agent integration

Use the capability manifest before an agent constructs a BC Atlas command.

```sh
bca help --format json
```

The command writes versioned JSON to standard output. It defines command IDs, argument templates, options, output contracts, and exit codes.

## Invocation rules

1. Pass each argument as a separate array item.
2. Do not construct a shell command string.
3. Use `graph query`, `export --view <view> --format json`, `check --format json`, `architecture --format json`, or `docs ... --format json` for machine reads.
4. Check for exit code `0` before you parse standard output.
5. Run `docs set` and `docs unset` with `--dry-run` first.
6. Pass `--expected-hash` when you write AL metadata.

## Guided setup

`bca setup agent --agent claude|copilot|cursor` writes a `/bca-setup` command
that lets the agent set up BC Atlas through the CLI: it reads
`bca setup plan --format json`, asks the user, previews with
`bca setup apply --dry-run --format json`, and applies after confirmation.
`bca setup agent` without `--agent` prints the same instructions for any other
agent. See [Guided setup](./setup.md).

## Source of truth

AL source is authoritative. JSON, Markdown, D2, and SVG files are generated outputs.

Read the [generated capability summary](./reference/cli-capabilities.md) for the current command list. Use `bca help --format json` for the complete machine contract.

## MCP server

BC Atlas includes a local MCP server. Install the package, then configure your MCP host to start `bca-mcp` (or `bca mcp`; both start the same server).

In VS Code, the [BC Atlas extension](./vscode.md) registers the server for you: agents in the editor (for example GitHub Copilot in agent mode) list **BC Atlas** among their MCP servers without any configuration.

### `.mcp.json` example

Copy [the MCP JSON example](./examples/mcp.json) to the configuration location for your MCP host.

When you open this repository in a Copilot-compatible host, its root `.mcp.json`
starts the local checkout with `node src/mcp.js`. Run `npm ci` first so the
server dependencies are available, then approve the server when prompted.

Architecture tools accept `projectRoot` separately from `path`. Set `path` to
the folder that the agent should render and `projectRoot` to the app or
multi-app workspace that it should analyze.

```json
{
  "mcpServers": {
    "bc-atlas": {
      "command": "npx",
      "args": ["--yes", "--package", "bc-atlas", "bca-mcp"]
    }
  }
}
```

This configuration uses `npx` to get BC Atlas and start its `bca-mcp` executable.

If BC Atlas is installed globally, use this shorter configuration:

```json
{
  "mcpServers": {
    "bc-atlas": {
      "command": "bca-mcp"
    }
  }
}
```

For a repository checkout, use an absolute source path:

```json
{
  "mcpServers": {
    "bc-atlas": {
      "command": "node",
      "args": ["C:/path/to/BC-Atlas/src/mcp.js"]
    }
  }
}
```

The server uses stdio. It writes protocol messages to standard output and logs to standard error.

### MCP tools

- `bc_atlas_capabilities` reads the command contract.
- `bc_atlas_inspect` returns an architecture model.
- `bc_atlas_check` returns the architecture health report used by `bca check`.
- `bc_atlas_simulate` runs the [battle test](./battle-test.md): agents with the company's roles, permission sets, and task groups perform the process tests. It returns who is blocked at which step and by which missing permission, who can do what they must not, the processes, the fit-gap analysis, and findings with what to do; `agent` or `task` returns the details of one agent or one process test, `markdown: true` the report as documentation.
- `bc_atlas_ai_context` returns the grounding for narrative documentation:
  for the system or one process, the facts BC Atlas read from the source as
  Markdown. An agent that writes documentation writes from it; the tool
  calls no model. `bc_atlas_ai_write` lets the model configured for the
  project write the pages (see [BC Atlas AI](../plugins/ai/README.md)).
- `bc_atlas_simulation_define` defines the simulation: operations add or
  change an agent, a role, a task group, or a requirement, remove one, or
  ground a process test on a recording of Business Central. The changed
  simulation runs at once and its result comes back; `dryRun` writes
  nothing. An agent that fixes a finding changes the company, reads the
  result, and goes on.
- `bc_atlas_view` is the [BC Atlas view](./vscode.md#the-bc-atlas-view) without a window: without arguments it returns the lenses and stories of the project; `lens` returns that part of the one graph (nodes with their facts and findings, and relations), `inside` an object's procedures and what each does, `focus` a node and what is near it, `story` a generated walk through the graph (what the system is, a process step by step, what to fix). `format` `text`, `md`, or `csv` returns that text; `output` writes a file, also a picture (`svg`, `png`) in a `form`. The same as `bca view`.
- `bc_atlas_architecture` returns the target architecture with work items (with the `bca refactor` command for moves), data ownership, and checks.
- `bc_atlas_extraction_plan` plans extracting one component as an app: blockers, `app.json`, data moves, and steps.
- `bc_atlas_refactor_surface` sets `Access = Internal` on objects no other component uses and writes `exposes` to `.bca.json`; `dryRun` by default.
- `bc_atlas_refactor_move` moves an object to another component with namespace and using fixes; `dryRun` (default) returns the diff, `dryRun: false` writes it. See [Split a monolith into apps](./modularization.md).
- `bc_atlas_report` writes the Markdown architecture report (`bca export --view report`); `handbook: true` adds the system handbook.
- `bc_atlas_handbook` reads the [system handbook](./handbook.md) (one page or all, in English or German): who writes a table, who subscribes to an event, what a permission set grants, which pages users can open, where the code is complex.
- `bc_atlas_setup_plan` detects the project and returns setup questions with recommendations.
- `bc_atlas_setup_apply` previews (default) or writes `.bca.json`, Git hooks, and a pipeline.
- `bc_atlas_run` runs the tasks configured for a trigger and reports sync status.
- `bc_atlas_update_check` reports whether a newer BC Atlas version exists, with release notes.
- `bc_atlas_generate_diagram` writes D2, JSON, or SVG.
- `bc_atlas_explore` writes the interactive explorer or the temporal graph document.
- `bc_atlas_graph_query` queries a saved graph as reusable JSON without analyzing AL.
- `bc_atlas_graph_render` renders a saved graph selection as SVG, HTML, DOT, or JSON.
- `bc_atlas_docs_list` lists documented scenarios.
- `bc_atlas_docs_show` reads one scenario and its source hash.
- `bc_atlas_docs_validate` validates a documentation corpus.
- `bc_atlas_docs_generate` writes Markdown from AL UI tests.
- `bc_atlas_docs_edit` previews or applies one metadata change.
- `bc_atlas_docs_glossary` reads supported documentation tags.

`bc_atlas_docs_edit` uses preview mode by default. A real write requires `dryRun: false` and the latest `expectedFileHash`.

### Saved graph tools

Separate analysis from use-case selection and rendering:

1. `bc_atlas_explore` with `path`, `format: "json"`, and `output` saves the
   native dependency graph once.
2. `bc_atlas_graph_query` reads that file (or an existing version 1
   nodes/edges snapshot), returning `bc-atlas.graph.slice` JSON with original
   IDs, directions, evidence, boundaries, and metadata.
3. `bc_atlas_graph_render` writes the same selection using the local renderer.

Both graph tools accept `path`, `root` (array of exact node IDs, labels, or
Atlas keys), `rootGroup`, `depth` (default 1), `direction` (outgoing, incoming,
both), `kind` (array), `level` (default object), and `frame` (latest by
default). Query is read-only. Render additionally requires `output` and
accepts `format` (json, dot, svg, html), `title`, `maxNodes`, and `maxEdges`.
Neither tool re-analyzes AL or requires Graphviz. They never overwrite the
input graph.

For an ORDERS snapshot with `roots.legacy`:

```json
{
  "name": "bc_atlas_graph_render",
  "arguments": {
    "path": "C:\\work\\ORDERS-Dependencies.json",
    "rootGroup": "legacy",
    "depth": 1,
    "direction": "outgoing",
    "output": "C:\\work\\orders-direct.svg"
  }
}
```

The result reports `output`, `format`, `nodes`, `edges`, and `roots`. The
equivalent CLI is `bca graph render <file> --root-group legacy -o orders-direct.svg`.
See [Saved graph queries](./dependency-explorer.md#query-and-render-saved-graphs)
for traversal and temporal-presence semantics.

## Test with MCP Inspector

Run the Inspector through `npx`:

```sh
npx @modelcontextprotocol/inspector bca-mcp
```

For a checkout, use this command:

```sh
npx @modelcontextprotocol/inspector node src/mcp.js
```
