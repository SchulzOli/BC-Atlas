# Agent integration

Use the capability manifest before an agent constructs a BC Atlas command.

```sh
bca help --format json
```

The command writes versioned JSON to standard output. It defines command IDs, argument templates, options, output contracts, and exit codes.

## Invocation rules

1. Pass each argument as a separate array item.
2. Do not construct a shell command string.
3. Use `view --format json`, `export --view <view> --format json`, `check --format json`, `architecture --format json`, or `docs ... --format json` for machine reads.
4. Check for exit code `0` before you parse standard output.
5. Run `docs set` and `docs unset` with `--dry-run` first.
6. Pass `--expected-hash` when you write AL metadata.

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
- `bc_atlas_layers` writes the [documentation of a repository](./layers.md),
  in sync with the source, for one app or many: how it works, how its apps
  and components are connected, and what to change in the architecture and
  how. It returns where the pages are, whether they were in sync, and the
  changes (title, kind, why, how, effort). With `check` it writes nothing
  and says whether the pages match the source. For the changes alone,
  `bc_atlas_view` with `story: "architecture"`.
- `bc_atlas_view` is the [BC Atlas view](./vscode.md#the-bc-atlas-view) without a window: without arguments it returns the lenses and stories of the project; `lens` returns that part of the one graph (nodes with their facts and findings, and relations), `inside` an object's procedures and what each does, `focus` a node and what is near it, `story` a generated walk through the graph (what the system is, what to fix, what to change in the architecture). `format` `text`, `md`, or `csv` returns that text; `output` writes a file, also a picture (`svg`, `png`) in a `form`. The same as `bca view`.
- `bc_atlas_architecture` returns the target architecture with work items, data ownership, and checks.
- `bc_atlas_architecture_explain` says why the architecture is what it is: for an object, the step that placed it in its component with its numbers; for a component, what it is named after, how its objects came to it, what they agree on, and the thresholds that applied.
- `bc_atlas_architecture_compare` returns the [current and the target state](./target-architecture.md) side by side: both scored with the same weighted goals, how the components map, the objects that have to move, and the steps in order. `to: "best"` scores several proposals and lists them all.
- `bc_atlas_architecture_templates` lists the presets and the project's templates with the goals and their weights, and saves, uses, or removes a template; `bc_atlas_architecture_adopt` writes a target to `.bca.json`. Both are `dryRun` by default.
- `bc_atlas_app` shows the BC Atlas view itself inside the chat, in clients that render MCP Apps; see [The view in the chat](#the-view-in-the-chat-mcp-app).
- `bc_atlas_extraction_plan` plans extracting one component as an app: blockers, `app.json`, data moves, and steps.
- `bc_atlas_report` writes the Markdown architecture report (`bca export --view report`).
- `bc_atlas_generate_diagram` writes D2, JSON, or SVG.
- `bc_atlas_docs_list` lists documented scenarios.
- `bc_atlas_docs_show` reads one scenario and its source hash.
- `bc_atlas_docs_validate` validates a documentation corpus.
- `bc_atlas_docs_generate` writes Markdown from AL UI tests.
- `bc_atlas_docs_edit` previews or applies one metadata change.
- `bc_atlas_docs_glossary` reads supported documentation tags.

`bc_atlas_docs_edit` uses preview mode by default. A real write requires `dryRun: false` and the latest `expectedFileHash`.

### The view in the chat: MCP App

The MCP server also brings the [BC Atlas view](./vscode.md#the-bc-atlas-view)
itself: in a chat client that renders
[MCP Apps](https://github.com/modelcontextprotocol/ext-apps) (Claude,
ChatGPT, VS Code, Goose, and others) the tool `bc_atlas_app` shows the
interactive graph inside the conversation. It is the same page the VS Code
extension shows: every lens, the findings, the stories, and the
Architecture menu.

- `bc_atlas_app` takes the project and what to open on: `lens`, `story`,
  `inside` (an object, an app, `component::Sales`, a namespace), `select`.
  The model gets a summary of the project back, and is told which lens or
  story the user looks at when the client supports that.
- The page asks the MCP server for everything else through
  `bc_atlas_app_call`, a tool only the page can call. It answers with the
  service the VS Code extension uses, on one analysis per project, so the
  view can also change things: the architecture and its templates. They
  are written to `.bca.json`, as in VS Code.
- Two things differ from the editor: what the view exports is saved to
  `.bca/exports/` in the project, because a chat client has no save dialog;
  and **Source** shows the file and line instead of opening it.
- The page is one HTML resource, `ui://bc-atlas/view.html`, about 850 kB,
  with everything inside: it loads nothing from the internet and needs no
  extra allowance from the client.

A client without MCP Apps ignores the page and shows the summary;
`bc_atlas_view` gives the same content there as text, data, or a picture.

The view is released for both hosts together: a version of BC Atlas has one
page, shown by the VS Code extension and by the MCP server. A test keeps
them in step: every request the page makes is answered by both.

## Test with MCP Inspector

Run the Inspector through `npx`:

```sh
npx @modelcontextprotocol/inspector bca-mcp
```

For a checkout, use this command:

```sh
npx @modelcontextprotocol/inspector node src/mcp.js
```
