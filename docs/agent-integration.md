# Agent integration

Use the capability manifest before an agent constructs a BC Atlas command.

```sh
bca help --format json
```

The command writes versioned JSON to standard output. It defines command IDs, argument templates, options, output contracts, and exit codes.

## Invocation rules

1. Pass each argument as a separate array item.
2. Do not construct a shell command string.
3. Use `view --format json`, `check --format json`, or `docs ... --format json` for machine reads.
4. Check for exit code `0` before you parse standard output.
5. Run `docs set` and `docs unset` with `--dry-run` first.
6. Pass `--expected-hash` when you write AL metadata.

## Source of truth

AL source is authoritative. JSON, Markdown, HTML, SVG, and PNG files are generated outputs.

Read the [generated capability summary](./reference/cli-capabilities.md) for the current command list. Use `bca help --format json` for the complete machine contract.

## MCP server

BC Atlas includes a local MCP server. Install the package, then configure your MCP host to start `bca-mcp` (or `bca mcp`; both start the same server).

In VS Code, the [BC Atlas extension](./vscode.md) registers the server for you: agents in the editor (for example GitHub Copilot in agent mode) list **BC Atlas** among their MCP servers without any configuration.

### `.mcp.json` example

Copy [the MCP JSON example](./examples/mcp.json) to the configuration location for your MCP host.

When you open this repository in a Copilot-compatible host, its root `.mcp.json`
starts the local checkout with `node src/mcp.js`. Run `npm ci` first so the
server dependencies are available, then approve the server when prompted.

The tools that analyze a project accept `projectRoot` separately from `path`.
Set `path` to the folder that the agent should look at and `projectRoot` to
the app or multi-app workspace that it should analyze.

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
- `bc_atlas_inspect` returns a part of the resolved model, sized for a context: the objects that `select` names (selectors as in `.bca.json`: `object:codeunit:50100`, `type:table`, `namespace:Contoso.Sales`, `app:Contoso Core`, ...), at most `limit` of them (default 50) with `next` for the following page, the relations that touch them, and a summary of the whole project. `detail: "summary"` (default) gives each object in a line and the relations counted by kind; `detail: "full"` gives every member and every relation with its evidence: ask for it for a few objects. On a workspace of 1,400 files a page of 50 is about 200 KB, where the whole model is over 50 MB.

Every JSON document BC Atlas writes for agents names its shape and version in `schema`: `bc-atlas.atlas/1`, `bc-atlas.view/1`, `bc-atlas.overview/1`, `bc-atlas.story/1`, `bc-atlas.stories/1`, and `bc-atlas.inspect/1`. They are published in [`schemas/output.schema.json`](../schemas/output.schema.json); a field is not removed or renamed within a version.
- `bc_atlas_check` returns the health report used by `bca check`.
- `bc_atlas_layers` writes the [documentation of a repository](./layers.md),
  in sync with the source, for one app or many: how it works, how its apps
  and namespaces are connected, the findings, and one page per app,
  namespace, and object. It returns where the pages are and whether they
  were in sync. With `check` it writes nothing and says whether the pages
  match the source.
- `bc_atlas_view` is the [BC Atlas view](./vscode.md#the-bc-atlas-view) without a window: without arguments it returns the lenses and stories of the project; `lens` returns that part of the one graph (nodes with their facts and findings, and relations), `inside` an object's procedures and what each does, `focus` a node and what is near it, `story` a generated walk through the graph (`system`: what the system is; `fix`: what to fix). `format` `text`, `md`, or `csv` returns that text; `output` writes a file, also a picture (`svg`, `png`) in a `form`. The same as `bca view`.
- `bc_atlas_app` shows the BC Atlas view itself inside the chat, in clients that render MCP Apps; see [The view in the chat](#the-view-in-the-chat-mcp-app).
- `bc_atlas_report` writes the Markdown report with a picture of each lens and the health summary (`bca export --view report`).
- `bc_atlas_docs_list` lists documented scenarios.
- `bc_atlas_docs_show` reads one scenario and its source hash.
- `bc_atlas_docs_validate` validates a documentation corpus.
- `bc_atlas_docs_generate` writes user guides or test cases from AL UI tests as Markdown, HTML, DITA, Azure DevOps CSV, or BPMN.
- `bc_atlas_docs_edit` previews or applies one metadata change.
- `bc_atlas_docs_glossary` reads supported documentation tags.

`bc_atlas_docs_edit` uses preview mode by default. A real write requires `dryRun: false` and the latest `expectedFileHash`.

### The view in the chat: MCP App

The MCP server also brings the [BC Atlas view](./vscode.md#the-bc-atlas-view)
itself: in a chat client that renders
[MCP Apps](https://github.com/modelcontextprotocol/ext-apps) (Claude,
ChatGPT, VS Code, Goose, and others) the tool `bc_atlas_app` shows the
interactive graph inside the conversation. It is the same page the VS Code
extension shows: every lens, the findings, and the stories.

- `bc_atlas_app` takes the project and what to open on: `lens`, `story`,
  `inside` (an object, an app, or a namespace), `select`.
  The model gets a summary of the project back, and is told which lens or
  story the user looks at when the client supports that.
- The page asks the MCP server for everything else through
  `bc_atlas_app_call`, a tool only the page can call. It answers with the
  service the VS Code extension uses, on one analysis per project.
- Two things differ from the editor: what the view exports is saved to
  `.bca/exports/` in the project, because a chat client has no save dialog;
  and **Source** shows the file and line instead of opening it.
- The page is one HTML resource, `ui://bc-atlas/view.html`, about 830 kB,
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
