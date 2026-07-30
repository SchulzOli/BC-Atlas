# BC Atlas CLI reference

This document lists every command and command-line option exposed by
`bca`. Command-line values override values loaded from a configuration
file.

## Command overview

```text
bca [graph] [options] <file-or-directory>
bca inspect [options] <file-or-directory>
bca watch [options] <directory>
bca docs generate [options] <ui-test.al>
```

| Command | Purpose |
| --- | --- |
| `graph` | Analyze AL source and write a diagram. This is the default command when no command is specified. |
| `inspect` | Analyze AL source and emit the selected graph as JSON. Without `--output`, JSON is written to standard output. |
| `watch` | Generate a graph, watch an AL project, and rebuild after relevant source or configuration changes. |
| `docs generate` | Generate Markdown documentation from one `[Test]` procedure in an AL UI-test file. |

Use `bca --help`, `bca --version`, or
`bca docs --help` for the built-in summaries.

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

## `docs generate`

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
| `--output-dir` | path | Markdown output directory. Default: `docs/generated`. |
| `-h`, `--help` | flag | Shows docs command help. |

```text
bca docs generate test/PartnerUITest.Codeunit.al \
  --procedure PartnersList_NewPartner_PersistsGeneralFields \
  --output-dir docs/generated
```
