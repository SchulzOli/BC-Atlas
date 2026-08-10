# Agent integration

Use the capability manifest before an agent constructs a BC Atlas command.

```sh
bca capabilities
```

The command writes versioned JSON to standard output. It defines command IDs, argument templates, options, output contracts, and exit codes.

## Invocation rules

1. Pass each argument as a separate array item.
2. Do not construct a shell command string.
3. Use `inspect` or `--format json` for machine reads.
4. Check for exit code `0` before you parse standard output.
5. Run `docs set` and `docs unset` with `--dry-run` first.
6. Pass `--expected-hash` when you write AL metadata.

## Source of truth

AL source is authoritative. JSON, Markdown, D2, and SVG files are generated outputs.

Read the [generated capability summary](./reference/cli-capabilities.md) for the current command list. Use `bca capabilities` for the complete machine contract.

## MCP server

BC Atlas includes a local MCP server. Install the package, then configure your MCP host to start `bca-mcp`.

### `.mcp.json` example

Copy [the MCP JSON example](./examples/mcp.json) to the configuration location for your MCP host.

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
      "args": ["C:/path/to/ALD2Tree/src/mcp.js"]
    }
  }
}
```

The server uses stdio. It writes protocol messages to standard output and logs to standard error.

### MCP tools

- `bc_atlas_capabilities` reads the command contract.
- `bc_atlas_inspect` returns an architecture model.
- `bc_atlas_generate_diagram` writes D2, JSON, or SVG.
- `bc_atlas_docs_list` lists documented scenarios.
- `bc_atlas_docs_show` reads one scenario and its source hash.
- `bc_atlas_docs_validate` validates a documentation corpus.
- `bc_atlas_docs_generate` writes Markdown from AL UI tests.
- `bc_atlas_docs_edit` previews or applies one metadata change.
- `bc_atlas_docs_glossary` reads supported documentation tags.

`bc_atlas_docs_edit` uses preview mode by default. A real write requires `dryRun: false` and the latest `expectedFileHash`.

## Test with MCP Inspector

Run the Inspector through `npx`:

```sh
npx @modelcontextprotocol/inspector bca-mcp
```

For a checkout, use this command:

```sh
npx @modelcontextprotocol/inspector node src/mcp.js
```
