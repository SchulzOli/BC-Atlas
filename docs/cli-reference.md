# BC Atlas CLI reference

Every command, option, default, and configuration setting of `bca`, grouped by
feature area. Run `bca --help` for the overview, `bca help <command>` or
`bca <command> --help` for one command, and `bca capabilities` for the same
information as JSON.

Command-line values override values loaded from `.bca.json`. An omitted
`[app-root]` means the current directory.

## Command overview

| Area | Command | Purpose |
| --- | --- | --- |
| Get started | `init` | Create a `.bca.json` configuration tailored to an AL project. |
| Get started | `report` | Write a complete architecture report: overview, health, and diagrams. |
| Visualize | `graph` | Write a diagram (D2, SVG, PNG, PDF) or model file (JSON). Default command. |
| Visualize | `watch` | Rebuild a diagram whenever AL source, `app.json`, or `.bca.json` changes. |
| Analyze | `check` | Score architecture health and fail CI on cycles, policy violations, or diagnostics. |
| Analyze | `inspect` | Print the resolved architecture model as JSON. |
| Document | `codegraph` | Generate one linked Markdown page per AL object. |
| Document | `docs list` | List documented UI-test scenarios. |
| Document | `docs show` | Show one scenario, its prerequisites, and its diagnostics. |
| Document | `docs validate` | Validate IDs, tags, links, and prerequisite cycles. |
| Document | `docs generate` | Generate Markdown user guides and an index. |
| Document | `docs set` | Add or replace documentation metadata in AL source. |
| Document | `docs unset` | Remove documentation metadata from AL source. |
| Document | `docs automation` | Print a CI pipeline that keeps generated guides in sync. |
| Document | `docs glossary` | List supported documentation tags and prerequisite types. |
| Integrate | `capabilities` | Print the machine-readable command contract as JSON. |
| Integrate | `mcp` | Start the MCP stdio server for AI agents (also installed as `bca-mcp`). |

```text
bca init [app-root] [options]
bca report [app-root] [options]
bca graph [app-root] [options]      # or: bca <app-root> [options]
bca watch [app-root] [options]
bca check [app-root] [options]
bca inspect [app-root] [options]
bca codegraph [app-root] [options]
bca docs <command> <test-root> [options]
bca docs glossary [options]
bca capabilities
bca mcp
```

### Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Success. |
| `1` | Operation failed, or a check (`check`, `docs validate`) found blocking issues. |
| `2` | Invalid usage: unknown command, unknown option, invalid enum value, or missing required value. |

Global flags: `-h`, `--help` shows help; `-V`, `--version` shows the version.

## Get started

### `init`

```text
bca init [app-root] [--force] [--print]
```

Writes `<app-root>/.bca.json`. The file is pre-filled from what BC Atlas
detects: the app name from `app.json`, test folders (excluded from analysis),
and a source-link template for GitHub, GitLab, or Azure DevOps remotes. It also
contains `check` and `report` sections with the default thresholds.

| Option | Value | Description |
| --- | --- | --- |
| `--force` | flag | Overwrite an existing `.bca.json`. |
| `--print` | flag | Print the configuration to stdout instead of writing it. |

### `report`

```text
bca report [app-root] [options]
```

Writes a self-contained Markdown report to a directory (default
`docs/atlas`): `README.md` with an at-a-glance table, one section and diagram
per view, the architecture health summary, and a regeneration command. See
[Architecture reports](./reports.md).

| Option | Value | Description |
| --- | --- | --- |
| `--output-dir` | path | Report directory. Default: `docs/atlas`. |
| `--views` | list | Comma-separated views: `project`, `module`, `data`, `contracts`, `events`, `ui`, `call`. Default: all except `call`. |
| `--format` | `svg` or `d2` | Diagram format. `d2` skips SVG rendering. Default: `svg`. |
| `--codegraph` | flag | Also write the linked object catalog to `<output-dir>/objects`. |
| `--json` | flag | Also write the resolved project model to `model.json`. |
| `--title` | text | Report title. Default: `<app name> architecture`. |
| `--namespace`, `--type`, `--include`, `--exclude` | glob | Filters, as for `graph`. |
| `--source-url`, `--source-ref`, `--source-path-prefix` | text | Source links, as for `graph`. |
| `--project-root` | path | Analyze a wider workspace. |
| `--config` | path | Configuration file. |

## Visualize

### `graph`

```text
bca graph [app-root] [options]
bca <app-root> [options]
```

Analyzes the input and writes the requested diagram or JSON model. Omitting
`graph` uses this command when the first argument is an existing path.

```text
bca graph src -o architecture.svg
bca graph src --view workflow --entry ProcessDocument -o workflow.svg
bca src --view data --format json -o data.json
```

`graph`, `watch`, and `inspect` share these options.

#### Output

| Option | Value | Description |
| --- | --- | --- |
| `-o`, `--output` | path | Output path. Default: `bc-atlas.d2`. `inspect` writes to stdout when omitted. |
| `-f`, `--format` | format | `d2`, `json`, `svg`, `png`, or `pdf`. Inferred from the output extension when omitted. |

- D2, JSON, and SVG output use bundled functionality.
- PNG and PDF require the `d2` executable on `PATH`.
- If `--format` conflicts with the extension, the format wins:
  `-o calls.d2 --format svg` writes `calls.svg` and keeps `calls.d2`.
- Rendered output always keeps the generated `.d2` source next to it.

#### View selection

| Option | Value | Description |
| --- | --- | --- |
| `--view` | view | `project`, `module`, `object`, `data`, `call`, `boundary`, `contracts`, `events`, `ui`, or `workflow`. Default: `project`. |
| `--object` | selector | Required by the `object` view. Object name, ID, key, or typed selector such as `codeunit:50100`. |
| `--object-inbound-depth` | integer ≥ 0 | Incoming depth for the object view. Default: `1`. |
| `--object-outbound-depth` | integer ≥ 0 | Outgoing depth for the object view. Default: `1`. |
| `--members` | list | Focused-object members: `fields`, `actions`, `triggers`, `events`, `procedures`. |
| `--scope` | selector | Boundary scope: `namespace:`, `folder:`, `app:`, or `object:`. Repeatable; required by `boundary`. |
| `--focus` | text | Restrict the `contracts`, `events`, or `ui` view to matching names. |
| `--group-by` | mode | `namespace`, `folder`, `type`, or `role`. Project view defaults to `role`; others to `namespace`. |
| `--module-depth` | integer or `auto` | Namespace segments kept by the module view. Default: `auto`. |
| `--folder-depth` | integer | Folder segments in a folder-grouped module view. Default: `1`. |

#### Filters

| Option | Value | Description |
| --- | --- | --- |
| `--namespace` | glob | Include matching namespaces. Repeatable. |
| `--type` | types | Include object types. Comma-separated and repeatable. |
| `--include` | glob | Include matching file paths or object selectors. Repeatable. |
| `--exclude` | glob | Exclude matching file paths or object selectors. Repeatable. |

#### Call view

| Option | Value | Description |
| --- | --- | --- |
| `--include-unresolved-calls` | flag | Include unresolved calls and isolated procedures. |
| `--root-procedure` | selector | Start a focused call subgraph at a procedure name, `Owner.Procedure`, signature, or key. Repeatable. |
| `--call-depth` | integer ≥ 0 | Traversal depth from each root. Default: `3`. |
| `--call-direction` | direction | `incoming`, `outgoing`, or `both`. Default: `outgoing`. |
| `--expand-procedures` | flag | Show procedure nodes instead of owning-object aggregates. |
| `--expand-framework-calls` | flag | Show individual framework and standard-library calls. |

#### Workflow view

| Option | Value | Description |
| --- | --- | --- |
| `--entry` | selector | Entry procedure, trigger, action, or event publisher. Repeatable. |
| `--workflow-depth` | integer | Maximum traversal depth. Default: `8`. |
| `--workflow-max-nodes` | integer | Maximum workflow nodes. Default: `100`. |
| `--workflow-edge-types` | list | `calls`, `events`, `writes`, `reads`. Default: `calls,events,writes`. |

Selectors accept an exact name such as `ProcessDocument`, an owner-qualified
name such as `Posting.ProcessDocument`, `*` and `?` globs, and an optional
`procedure:`, `trigger:`, `action:`, or `event:` prefix. Without entries, roots
are inferred from actions, triggers, event publishers, and procedures without
inbound calls. Direct call and mutation order is labelled `definite`; event
dispatch and collapsed paths are labelled `inferred`.

#### Rendering

| Option | Value | Description |
| --- | --- | --- |
| `--max-edges` | integer | Diagram edge cap. Default: `500`. Also caps workflow edges unless `workflow.maxEdges` is configured. |
| `--direction` | value | `right`, `down`, `left`, or `up`. Default: `right`. |
| `--title` | text | Diagram title. |
| `--no-legend` | flag | Hide edge-kind and confidence legends. |
| `--details` | flag | Show member counts in nodes. |
| `--no-external` | flag | Hide external and unresolved nodes. Unresolved edges remain in JSON. |

#### Source links

| Option | Value | Description |
| --- | --- | --- |
| `--source-url` | template | Node-link template with `{file}`, `{line}`, and `{ref}`. `{file}` is project-root-relative. |
| `--source-ref` | text | Commit, tag, or branch for `{ref}`. Default: `main`. |
| `--source-path-prefix` | path | Repository path prepended to `{file}` when the project root is below the repository root. |

#### General

| Option | Value | Description |
| --- | --- | --- |
| `--project-root` | path | Analyze this app or multi-app workspace; the positional path becomes the rendered focus. |
| `--config` | path | Configuration file. Default: `<app-root>/.bca.json` when present. |
| `--strict` | flag | Fail when analysis produces warning or error diagnostics. |

### `watch`

```text
bca watch [app-root] [options]
```

Builds once, then watches recursively for AL files, `app.json`, and
`.bca.json`. Accepts every `graph` option plus:

| Option | Value | Description |
| --- | --- | --- |
| `--debounce` | milliseconds | Rebuild debounce. Default: `250`. |

Stop with `Ctrl+C`.

## Analyze

### `check`

```text
bca check [app-root] [options]
```

Analyzes the project view and evaluates health rules: diagnostics, forbidden
dependencies, dependency cycles, fan-in/fan-out hot spots, orphan objects, and
unresolved references. Exits with `1` when a finding reaches `--fail-on`. See
[Architecture health checks](./health-checks.md).

| Option | Value | Description |
| --- | --- | --- |
| `--fail-on` | level | `error`, `warning`, `info`, or `never`. Default: `error`. |
| `-f`, `--format` | format | `text`, `json`, or `markdown`. Default: `text`. |
| `-o`, `--output` | path | Write the report to a file; the result line goes to stderr. |
| `--max-fan-in` | integer | Warn when more distinct objects depend on one object. Default: `25`. |
| `--max-fan-out` | integer | Warn when one object depends on more distinct objects. Default: `25`. |
| `--namespace`, `--type`, `--include`, `--exclude` | glob | Filters, as for `graph`. |
| `--project-root` | path | Analyze a wider workspace. |
| `--config` | path | Configuration file. |
| `--strict` | flag | Shortcut for `--fail-on warning`. |

### `inspect`

```text
bca inspect [app-root] [options]
```

Runs the same analysis, filtering, and view projection as `graph` and prints
JSON to stdout. With `--output`, JSON is written to that file. `--format`
accepts only `json`.

```text
bca inspect src --view workflow --entry ProcessDocument
bca inspect src --strict -o model.json
```

## Document

### `codegraph`

```text
bca codegraph [app-root] --output-dir docs/codegraph
```

Mirrors source directories below the output directory. Objects declared at the
input root use an object-type folder such as `table` or `codeunit`. Each page
contains metadata, members, dependencies, backlinks, and a source location.
The output directory is replaced atomically; BC Atlas refuses to replace a
non-empty directory that has no generated `index.md`.

| Option | Value | Description |
| --- | --- | --- |
| `--output-dir` | path | Markdown directory. Default: `docs/codegraph`. |
| `--include` | glob | Include matching paths or object selectors. Repeatable. |
| `--exclude` | glob | Exclude matching paths or object selectors. Repeatable. |
| `--source-url` | template | Repository source links with `{file}`, `{line}`, and `{ref}`. |
| `--source-ref` | text | Commit, tag, or branch for `{ref}`. |
| `--source-path-prefix` | path | Repository path prepended to `{file}`. |
| `--project-root` | path | Analyze a wider workspace before restricting output. |
| `--config` | path | Configuration file. |
| `--strict` | flag | Fail on warning or error diagnostics. |

### `docs` commands

AL UI-test files are the only persisted scenario source. See
[Documentation from AL UI tests](./al-ui-test-documentation.md).

| Option | Commands | Value | Description |
| --- | --- | --- | --- |
| `--format` | all | `text` or `json` | Human-readable or pipe-safe output. Default: `text`. |
| `--id` | `show`, `generate`, `set`, `unset` | document ID | Selects a scenario by stable `[DOC-ID]`. Required for `show`, `set`, `unset`. With `generate`, writes one Markdown file. |
| `--export` | `generate` | formats | Comma-separated `markdown`, `html`, `dita`, `ado-csv`. Default: `markdown`. |
| `--as` | `generate` | `guide` or `testcase` | User guide or test case with an action/expected-result table. Default: `guide`. |
| `--app` | `generate` | path | AL app source for real captions, tooltips, and page coverage. |
| `--language` | `generate` | tag | Wording and captions in this language, e.g. `de-DE`; captions come from the app's `.xlf` files. Default: `en-US`. |
| `--title` | `generate` | text | Title of the index, HTML page, and DITA map. Default: the app name. |
| `--procedure` | `generate` | name | Test procedure; required when a file contains several tests. |
| `--output-dir` | `generate`, `automation` | path | Markdown directory. Default: `docs/generated`. |
| `--strict` | `validate` | flag | Treat warnings as failures. |
| `--tag` | `set`, `unset` | tag | Metadata tag. Required. |
| `--value` | `set`, `unset` | text | Tag value (required for `set`); matching value for `unset`. |
| `--qualifier` | `set`, `unset` | type | Typed `[GIVEN]` qualifier. |
| `--expected-hash` | `set`, `unset` | SHA-256 | Reject the write when the AL file changed after reading. |
| `--dry-run` | `set`, `unset` | flag | Preview without writing AL. |
| `--provider` | `automation` | `github` or `azure-devops` | Pipeline format. Default: `github`. |

#### `docs list`, `docs show`, `docs glossary`

```text
bca docs list test/UITest --format json
bca docs show test/UITest --id partner-create
bca docs glossary
```

#### `docs validate`

```text
bca docs validate test/UITest --strict
```

Exits with `1` on errors, or on warnings with `--strict`.

#### `docs generate`

```text
bca docs generate test/UITest --output-dir docs/generated
bca docs generate test/PartnerUITest.Codeunit.al --procedure PartnersList_NewPartner_PersistsGeneralFields
```

```text
bca docs generate test/UITest --app app --export markdown,html,dita,ado-csv
bca docs generate test/UITest --app app --as testcase --language de-DE --export html
```

`[WHEN]` comments become numbered phases. Reachable local helpers containing
`TestPage` operations are expanded with cycle and depth protection. Directory
generation writes, per format:

| Format | Files |
| --- | --- |
| `markdown` | `<document-id>.md`, `use-case-<feature>.md`, `index.md`, `journey.d2`, `journey.svg` |
| `html` | `index.html` |
| `dita` | `<document-id>.dita`, `documentation.ditamap` |
| `ado-csv` | `test-cases.csv` |

`--id` and `--procedure` write a single Markdown file and cannot be combined
with other formats.

#### `docs set` and `docs unset`

```text
bca docs set test/UITest --id partner-create --tag GIVEN \
  --qualifier MASTER-DATA --value "A posting group exists." --dry-run
bca docs unset test/UITest --id partner-create --tag RELATED --value partner-edit
```

#### `docs automation`

```text
bca docs automation test/UITest --provider github --output-dir docs/generated
```

Prints a pipeline that validates in strict mode, regenerates the Markdown, and
fails when the committed output differs. `--format json` returns checks,
commands, target filename, and pipeline content.

## Integrate

### `capabilities`

```text
bca capabilities
```

Writes only UTF-8 JSON: `schemaVersion`, version, exit codes, invocation
conventions, feature `areas`, `views`, and every command with its `argv`
template, `area`, options (CLI token, type, enum, default, `required`,
`repeatable`), output contract, rules, and examples. Agents must pass
arguments as an array, parse stdout only after exit code `0`, and run `docs set`
or `docs unset` with `--dry-run` before writing.

### `mcp`

```text
bca mcp
bca-mcp
```

Starts the Model Context Protocol server on stdio. See
[Agent integration](./agent-integration.md).

## Configuration file

`.bca.json` at the input root is loaded automatically; `--config` selects
another file. `bca init` creates a starter file. The root accepts the camelCase
form of every architecture option: `view`, `output`, `format`, `object`,
`scope`, `focus`, `projectRoot`, `namespaces`, `types`, `include`, `exclude`,
`groupBy`, `moduleDepth`, `folderDepth`, `includeUnresolvedCalls`,
`rootProcedure`, `callDepth`, `callDirection`, `expandProcedures`,
`expandFrameworkCalls`, `maxEdges`, `objectInboundDepth`,
`objectOutboundDepth`, `members`, `direction`, `title`, `sourceUrl`,
`sourceRef`, `sourcePathPrefix`, `noLegend`, `details`, `noExternal`, `strict`,
and `debounce`.

Configuration-only settings:

| Property | Description |
| --- | --- |
| `roleMappings` | Maps a role label to object globs (type, `type:name`, `namespace:type:name`, or file path). First match wins. |
| `layout` | D2 layout engine: `dagre` or `elk` for SVG; any D2 layout for PNG/PDF. |
| `theme` | D2 theme ID. |
| `forbiddenDependencies` | Dependency policy rules; see [Configuration](./configuration.md#check-dependency-rules). |
| `workflow` | Workflow defaults: `entries`, `depth`, `maxNodes`, `maxEdges`, `edgeTypes`, `phases`, `stop`, `collapse`. |
| `check` | Health-check defaults: `failOn`, `cycles` (`error`, `warning`, `info`, `off`), `maxFanIn`, `maxFanOut`. |
| `report` | Report defaults: `outputDir`, `views`, `format`, `codegraph`, `json`, `title`. |

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
| `entries` | Entry selectors. `entry` is also accepted. |
| `depth` | Maximum traversal depth. |
| `maxNodes` | Maximum projected nodes. |
| `maxEdges` | Maximum projected edges. |
| `edgeTypes` | Allowed `calls`, `events`, `writes`, and `reads` edges. |
| `phases` | Maps phase labels to selectors; matching nodes are grouped under that label. |
| `stop` | Selectors that stay visible but are not expanded. `stopConditions` is also accepted. |
| `collapse` | Utility selectors bypassed with inferred edges. `collapseUtilities` is also accepted. |

BC Atlas resolves the complete `projectRoot` before it applies a folder,
namespace, or include focus. References that cross the focus become aggregated
boundary nodes with a `boundaryCategory` of `microsoft-base-app`,
`declared-dependency`, `same-app-outside-focus`, or `unknown`. Dependency
symbols are loaded from `.app` files under `.alpackages`; an unreadable package
produces a `symbol-package-error` diagnostic.

See [`.bca.example.json`](../.bca.example.json) for a complete example.
