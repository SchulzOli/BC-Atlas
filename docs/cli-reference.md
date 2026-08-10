# BC Atlas CLI reference

This document lists every command and command-line option exposed by
`bca`. Command-line values override values loaded from a configuration
file.

## Command overview

```text
bca [graph] [options] <file-or-directory>
bca inspect [options] <file-or-directory>
bca watch [options] <directory>
bca serve [options] <app-directory>
bca capabilities
bca docs <list|show|validate|generate|set|unset|serve> [options] <file-or-directory>
bca docs glossary [options]
```

| Command | Purpose |
| --- | --- |
| `graph` | Analyze AL source and write a diagram. This is the default command when no command is specified. |
| `inspect` | Analyze AL source and emit the selected graph as JSON. Without `--output`, JSON is written to standard output. |
| `watch` | Generate a graph, watch an AL project, and rebuild after relevant source or configuration changes. |
| `serve` | Start the combined architecture and documentation Control Center. |
| `capabilities` | Emit the versioned machine contract for LLM and tool integrations as JSON. |
| `docs` | Inspect, validate, edit, generate, and locally browse AL-backed UI-test documentation. |

Use `bca --help`, `bca --version`, or
`bca docs --help` for the built-in summaries.

### Machine contract

```text
bca capabilities
```

This command needs no project path and writes only UTF-8 JSON to standard
output. The response declares `schemaVersion`, the installed package version,
exit codes, invocation conventions, and every supported command. Each command
contains an exact `argv` template, its accepted options and CLI tokens,
required values, enumerations, output type, and conditional rules.

LLM tools must pass arguments as an array, not interpolate a shell command.
For machine-readable operations, use `inspect` or append `--format json` to a
documentation command. Parse stdout only after exit code `0`. For `docs set`
and `docs unset`, first use `--dry-run`; on the subsequent write, pass the
latest `--expected-hash` when available.

### Combined Control Center

```text
bca serve <app-directory> --tests <test-directory> --port 0
```

`--tests` is required and identifies the AL UI-test documentation source. The
application directory remains the architecture source. `--port` accepts an
integer from `0` to `65535`; `0` chooses an available loopback port. The server
exposes documentation and in-memory architecture rendering through the same
command-only HTTP API.

## Architecture commands

The `graph`, `inspect`, and `watch` commands share the following options.

| Option | Value | Description |
| --- | --- | --- |
| `-o`, `--output` | path | Output path. The graph default is `bc-atlas.d2`; `inspect` writes JSON to standard output when omitted. |
| `-f`, `--format` | format | `d2`, `json`, `svg`, `png`, or `pdf`. The output extension is used when the option is omitted. |
| `--view` | view | Selects `project`, `module`, `object`, `data`, `call`, `boundary`, `contracts`, `events`, `ui`, or `workflow`. Default: `project`. |
| `--object` | selector | Required by the `object` view. Accepts an object name, ID, key, or typed selector such as `codeunit:50100`. |
| `--scope` | selector | Boundary scope. Accepts `namespace:`, `folder:`, `app:`, or `object:` selectors. Repeatable. |
| `--focus` | text | Restricts the `contracts`, `events`, or `ui` view to matching names. |
| `--entry` | selector | Workflow entry procedure, trigger, action, or event publisher. Repeatable. |
| `--workflow-depth` | positive integer | Maximum workflow traversal depth. Default: `8`. |
| `--workflow-max-nodes` | positive integer | Maximum number of workflow nodes. Default: `100`. |
| `--workflow-edge-types` | comma-separated types | Workflow edge types: `calls`, `events`, `writes`, and/or `reads`. Default: `calls,events,writes`. |
| `--namespace` | glob | Includes matching namespaces. Repeatable. |
| `--type` | types | Includes object types. Comma-separated and repeatable. |
| `--include` | glob | Includes matching normalized file paths or object selectors. Repeatable. |
| `--exclude` | glob | Excludes matching normalized file paths or object selectors. Repeatable. |
| `--group-by` | mode | Groups by `namespace`, `folder`, `type`, or `role`. Project view defaults to `role`; other views default to `namespace`. |
| `--module-depth` | positive integer or `auto` | Namespace segments retained by the module view. Default: `auto`. |
| `--folder-depth` | positive integer | Folder segments retained by a folder-grouped module view. Default: `1`. |
| `--include-unresolved-calls` | flag | Includes unresolved calls and isolated procedures in the `call` view. |
| `--max-edges` | positive integer | Caps diagram edges. Default: `500`. For workflows this also caps projected workflow edges unless a nested workflow value is configured. |
| `--direction` | value | Diagram direction: `right`, `down`, `left`, or `up`. Default: `right`. |
| `--title` | text | Diagram title. |
| `--source-url` | template | Adds node links. Supports `{file}` and `{line}` placeholders. |
| `--details` | flag | Shows available member counts and focused-object member summaries. |
| `--no-external` | flag | Hides external and unresolved target nodes in rendered diagrams. Unresolved edges remain available in JSON. |
| `--config` | path | Explicit JSON configuration path. Without it, `<input-root>/.bca.json` is loaded when present. |
| `--strict` | flag | Fails when analysis contains warning or error diagnostics. |
| `--debounce` | positive integer | Watch rebuild debounce in milliseconds. Default: `250`. |
| `-h`, `--help` | flag | Shows command help. |
| `-V`, `--version` | flag | Shows the installed version. |

Options described as repeatable can be supplied more than once:

```text
bca graph src \
  --namespace "Contoso.Sales.**" \
  --type table,codeunit \
  --type page \
  --exclude "**/test/**"
```

### Formats and output paths

- D2, JSON, and SVG output use bundled functionality.
- PNG and PDF require the `d2` executable on `PATH`.
- If `--format` conflicts with the requested extension, the format wins.
  For example, `-o calls.d2 --format svg` writes `calls.svg` and keeps the
  intermediate D2 source at `calls.d2`.
- Non-D2 rendering retains the generated `.d2` source next to the final output.

## Views

| View | Contents | View-specific selection |
| --- | --- | --- |
| `project` | AL objects and resolved or unresolved architectural relations. | General filters and grouping options. |
| `module` | Aggregated namespace or folder dependencies. | `--group-by namespace\|folder`, `--module-depth`, and `--folder-depth`. |
| `object` | One object and its incoming and outgoing neighbors. | Requires `--object`. |
| `data` | Tables and table-oriented reads, writes, relations, and extensions. | General filters. |
| `call` | Procedures, triggers, resolved calls, and event subscriptions. | `--include-unresolved-calls`. |
| `boundary` | Dependencies crossing one or more selected boundaries. | Requires repeatable `--scope`. |
| `contracts` | Interfaces, direct implementations, and enum-mediated implementations. | Optional `--focus`. |
| `events` | Event publishers and subscriber procedures. | Optional `--focus`. |
| `ui` | Pages, source tables, parts, actions, and navigation targets. | Optional `--focus`. |
| `workflow` | Trace-oriented calls, events, data mutations, cycles, and unresolved branches. | `--entry` and workflow limits, or workflow configuration. |

## Workflow selectors and configuration

Workflow entry, phase, stop, and collapse selectors accept:

- an exact member name such as `ProcessDocument`;
- an owner-qualified name such as `Posting.ProcessDocument`;
- `*` and `?` globs;
- an optional `procedure:`, `trigger:`, `action:`, or `event:` prefix.

With no explicit entries, workflow roots are inferred from actions, triggers,
event publishers, and procedures without inbound calls. Direct call and
mutation order is labelled `definite`. Event dispatch and paths created by
collapsing utility nodes are labelled `inferred`. Cycles, shared convergence
nodes, unresolved branches, and limit truncation are annotated in D2 and JSON.

The configuration file can define workflow behavior that has no dedicated CLI
switch:

```json
{
  "view": "workflow",
  "workflow": {
    "entries": ["ProcessDocument", "action:Release"],
    "depth": 8,
    "maxNodes": 100,
    "maxEdges": 250,
    "edgeTypes": ["calls", "events", "writes"],
    "phases": {
      "Validation": ["Validate*", "*.Check*"],
      "Posting": ["Post*", "Finalize*"]
    },
    "stop": ["FinalizeDocument", "event:OnCompleted"],
    "collapse": ["*Telemetry*", "*FeatureFlag*"]
  }
}
```

| Workflow property | Description |
| --- | --- |
| `entries` | Entry selectors. `entry` is also accepted for one or more selectors. |
| `depth` | Maximum traversal depth. |
| `maxNodes` | Maximum projected nodes. |
| `maxEdges` | Maximum projected edges. |
| `edgeTypes` | Allowed `calls`, `events`, `writes`, and `reads` edges. |
| `phases` | Maps phase labels to selectors. Matching nodes are grouped under that label. |
| `stop` | Selectors that remain visible but are not expanded. `stopConditions` is also accepted. |
| `collapse` | Utility selectors to remove and bypass with explicitly inferred edges. `collapseUtilities` is also accepted. |

Repeated infrastructure nodes are represented once. A node reached by multiple
branches is annotated with its inbound branch count.

## Configuration file

Use `.bca.json` at the input root or pass another file explicitly:

```text
bca graph src --config bca.workflow.json
```

The configuration root accepts the long-form equivalents of the architecture
options, normally in camel case: `view`, `output`, `format`, `object`, `scope`,
`focus`, `namespaces`, `types`, `include`, `exclude`, `groupBy`,
`moduleDepth`, `folderDepth`, `includeUnresolvedCalls`, `maxEdges`,
`direction`, `title`, `sourceUrl`, `details`, `noExternal`, `strict`, and
`debounce`.

These renderer and policy settings are configuration-only:

| Property | Description |
| --- | --- |
| `layout` | D2 layout engine passed to the external renderer for PNG or PDF. |
| `theme` | D2 theme passed to the external renderer for PNG or PDF. |
| `forbiddenDependencies` | Dependency policy rules evaluated during analysis. |
| `workflow` | Nested workflow configuration described above. |

See [`.bca.example.json`](../.bca.example.json) for a complete
configuration example.

## `graph`

```text
bca graph [options] <file-or-directory>
bca [options] <file-or-directory>
```

Analyzes the input and writes the requested diagram or JSON. Omitting `graph`
uses this command automatically.

Examples:

```text
bca graph src --view project -o architecture.d2
bca graph src --view workflow --entry ProcessDocument -o workflow.svg
bca src --view data --format json -o data.json
```

## `inspect`

```text
bca inspect [options] <file-or-directory>
```

Runs the same analysis, filtering, and view projection as `graph`. The default
format is JSON, and output is written to standard output when `--output` is
omitted.

```text
bca inspect src --view workflow --entry ProcessDocument
bca inspect src --strict -o model.json
```

## `watch`

```text
bca watch [options] <directory>
```

Builds once, then watches recursively for AL files, `app.json`, and
`.bca.json`. Relevant changes trigger another build after the configured
debounce interval.

```text
bca watch src --view module --debounce 500 -o modules.svg
```

## Documentation commands

AL UI-test files are the only persisted scenario source. JSON is available as
terminal output and HTTP transport; BC Atlas does not create scenario JSON.

| Command | Purpose |
| --- | --- |
| `docs list` | List documented scenarios under a file or directory. |
| `docs show` | Show one scenario selected by `--id`. |
| `docs validate` | Validate IDs, tags, links, and prerequisite cycles. |
| `docs generate` | Generate one scenario or a complete Markdown catalog. |
| `docs automation` | Generate a checked CLI workflow for GitHub Actions or Azure Pipelines. |
| `docs set` | Add or replace AL documentation metadata. |
| `docs unset` | Remove matching AL documentation metadata. |
| `docs glossary` | Print the built-in tag vocabulary, descriptions, value types, and cardinality. |
| `docs serve` | Start the local control center on `127.0.0.1`. |

Common documentation options:

| Option | Value | Description |
| --- | --- | --- |
| `--id` | document ID | Selects a scenario by stable `[DOC-ID]`. |
| `--format` | `text` or `json` | Selects human-readable or pipe-safe output. |
| `--strict` | flag | Treats validation warnings as failures. |
| `--tag` | tag | Tag used by `set` or `unset`. |
| `--value` | text | Tag value used by `set`, or matching value for `unset`. |
| `--qualifier` | type | Typed `[GIVEN]` qualifier. |
| `--expected-hash` | SHA-256 | Rejects a mutation when the AL file changed after reading. |
| `--dry-run` | flag | Plans a mutation without writing AL. |
| `--port` | integer | Port for `serve`; the default chooses an available port. |
| `--provider` | `github` or `azure-devops` | Selects the pipeline format for `automation`. |

Successful commands exit with `0`. Validation or operation failures exit with
`1`; invalid command usage exits with `2`. Data is written to standard output.

### `docs generate`

```text
bca docs generate [options] <ui-test.al>
```

Generates Markdown directly from a selected AL `[Test]` procedure.
`[WHEN]` comments become numbered phases. Reachable local helpers containing
`TestPage` operations are expanded with cycle and depth protection; repeated
and conditional UI work is summarized as user-facing instructions.

| Option | Value | Description |
| --- | --- | --- |
| `--procedure` | name | Selects the `[Test]` procedure to document. Required when the file contains multiple test procedures. |
| `--id` | document ID | Generates one scenario from a corpus. |
| `--output-dir` | path | Markdown output directory. Default: `docs/generated`. |
| `-h`, `--help` | flag | Shows docs command help. |

```text
bca docs generate test/PartnerUITest.Codeunit.al \
  --procedure PartnersList_NewPartner_PersistsGeneralFields \
  --output-dir docs/generated
```

Directory generation writes one `<document-id>.md` file per scenario and a
generated `index.md`. Use `docs validate` before generation in CI.

### `docs automation`

```text
bca docs automation test/UITest --provider github --output-dir docs/generated
```

This command loads the real AL documentation corpus. Readiness requires at
least one scenario, explicit stable IDs for every scenario, and no diagnostics.
The generated pipeline validates in strict mode, regenerates the Markdown, and
fails when the committed output differs:

```text
bca docs validate 'test/UITest' --strict
bca docs generate 'test/UITest' --output-dir 'docs/generated'
git diff --exit-code -- 'docs/generated'
```

Use `--format json` to receive the checks, local commands, target filename, and
pipeline content as structured output. The Automation view consumes the same
command result.

### `docs set` and `docs unset`

```text
bca docs set test/UITest --id partner-create --tag GIVEN \
  --qualifier MASTER-DATA --value "A posting group exists."
bca docs unset test/UITest --id partner-create --tag RELATED --value partner-edit
```

### `docs serve`

```text
bca docs serve test/UITest --port 0
```

The server prints its loopback URL and remains attached to the terminal. Its
web UI has no independent storage; each read reloads AL and each mutation uses
the same validated writer as `docs set` and `docs unset`. The dashboard maps
its overview, scenario workspace, quality view, automation workflow, glossary,
and generation action to docs commands. `serve` hosts the interface and remains
terminal-controlled.
