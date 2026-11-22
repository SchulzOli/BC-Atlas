# BC Atlas CLI reference

Every command, option, default, and configuration setting of `bca`, grouped by
feature area. Run `bca --help` for the overview, `bca help <command>` or
`bca <command> --help` for one command, and `bca help --format json` for the
same information as JSON.

Command-line values override values loaded from `.bca.json`. An omitted
`[app-root]` means the current directory.

## Command overview

| Area | Command | Purpose |
| --- | --- | --- |
| Analyze | `check` | Assess the health of the code and fail CI on cycles, forbidden dependencies, or diagnostics. |
| Export | `export` | Write the BC Atlas view as one offline HTML file to share. |
| Export | `view` | The BC Atlas view without a window: any lens, story, or object of the one graph as text, JSON, CSV, Markdown, SVG, or PNG. |
| Export | `docs list` | List documented UI-test scenarios. |
| Export | `docs show` | Show one scenario, its prerequisites, and its diagnostics. |
| Export | `docs validate` | Validate IDs, tags, links, and prerequisite cycles. |
| Export | `docs generate` | Generate user guides or test cases as Markdown, HTML, DITA, Azure DevOps CSV, or BPMN. |
| Export | `docs set` | Add or replace documentation metadata in AL source. |
| Export | `docs unset` | Remove documentation metadata from AL source. |
| Export | `docs automation` | Print a CI pipeline that keeps generated guides in sync. |
| Export | `docs glossary` | List supported documentation tags and prerequisite types. |
| Export | `layers` | The layered documentation, in sync with the source: the system explained from the whole down to each procedure. |
| Integrate | `mcp` | Start the MCP stdio server for AI agents (also installed as `bca-mcp`). |

```text
bca check [app-root] [options]
bca export [app-root] [-o <path>] [options]
bca view [app-root] [options]
bca layers [app-root] [options]
bca docs <command> <test-root> [options]
bca docs glossary [options]
bca mcp
bca help [<command>] [--format json]
```

### Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Success. |
| `1` | Operation failed, or a check (`check`, `layers --check`, `docs validate`) found blocking issues. |
| `2` | Invalid usage: unknown command, unknown option, invalid enum value, or missing required value. |

Global flags: `-h`, `--help` shows help; `-V`, `--version` shows the version.

## Analyze

### `check`

```text
bca check [app-root] [options]
```

Analyzes the project and evaluates health rules: diagnostics, forbidden
dependencies, dependency cycles, fan-in/fan-out hot spots, orphan objects, and
unresolved references. Exits with `1` when a finding reaches `--fail-on`. See
[Architecture health checks](./health-checks.md).

```text
bca check ./app
bca check ./app --fail-on warning
bca check ./app --format markdown -o health.md
bca check ./app --format sarif -o bca.sarif
```

| Option | Value | Description |
| --- | --- | --- |
| `--fail-on` | level | Lowest severity that fails the check: `error`, `warning`, `info`, or `never`. Default: `error`. |
| `-f`, `--format` | format | `text`, `json`, `markdown`, or `sarif` (SARIF 2.1.0 for GitHub code scanning and Azure DevOps). Default: `text`. |
| `-o`, `--output` | path | Write the report to a file instead of stdout. |
| `--max-fan-in` | integer | Warn when an object has more distinct dependents. Default: `25`. |
| `--max-fan-out` | integer | Warn when an object has more distinct dependencies. Default: `25`. |
| `--namespace`, `--type`, `--include`, `--exclude`, `--paths` | glob | Filters, as for `export`. |
| `--project-root` | path | Analyze this app or workspace root; the positional path becomes the focus. |
| `--config` | path | Configuration file. Default: `<app-root>/.bca.json`. |
| `--strict` | flag | Fail when analysis produces warning or error diagnostics: the same as `--fail-on warning`. |

## Export

### `export`

```text
bca export [app-root] [-o <path>] [options]
```

Writes the BC Atlas view as one self-contained, offline HTML file to share: a
toolbar and the graph, with every lens, finding, and story. A picture or a list
of one lens, story, or object is what [`bca view`](#view) writes; Markdown
pages of the project are what [`bca layers`](#layers) writes.

```text
bca export ./app -o atlas.html
bca export ./app -o atlas.html --watch
```

#### Output

| Option | Value | Description |
| --- | --- | --- |
| `-o`, `--output` | path | Output file. Default: `bc-atlas.html`. |
| `--title` | text | Title of the view. |
| `--watch` | flag | Write again whenever AL source, `app.json`, or `.bca.json` changes. Stop with `Ctrl+C`. |
| `--debounce` | milliseconds | Delay before writing again with `--watch`. Default: `250`. |

#### Filters

| Option | Value | Description |
| --- | --- | --- |
| `--namespace` | glob | Include matching namespaces. Repeatable. |
| `--type` | types | Include object types. Comma-separated and repeatable. |
| `--include` | glob | Include matching file paths or object selectors. Repeatable. |
| `--exclude` | glob | Exclude matching file paths or object selectors. Repeatable. |
| `--paths` | path or glob | Only analyze AL files in these folders (or matching these globs), relative to the project root. Repeatable. Speeds up large repositories such as BCApps. |

#### General

| Option | Value | Description |
| --- | --- | --- |
| `--project-root` | path | Analyze this app or multi-app workspace; the positional path becomes the focus. |
| `--config` | path | Configuration file. Default: `<app-root>/.bca.json` when present. |
| `--strict` | flag | Fail when analysis produces warning or error diagnostics. |

### `view`

```text
bca view [app-root] [--lens <id> | --story <id> | --inside <node>] [--form <form>] [-f <format>] [-o <path>] [options]
```

The BC Atlas view without a window. Everything BC Atlas reads from the AL
source is one graph, and the app shows it with a toolbar
([The BC Atlas view](./vscode.md#the-bc-atlas-view)). `bca view` does what
that toolbar does, from a terminal, a pipeline, or an agent: one
implementation draws the page and writes these files, so they always agree.

```sh
bca view ./app                                            # what there is to see: lenses and stories
bca view ./app --lens overview                            # how it works: screens, logic, data
bca view ./app --lens overview -o overview.svg            # the same as a picture, in columns
bca view ./app --lens data                                # the Data lens as text: nodes by group, what each does
bca view ./app --lens health --check                      # the findings with their fixes, on the objects they are about
bca view ./app --lens data --form diagram -o data.svg     # the same lens as a picture
bca view ./app --inside codeunit:50100 --form diagram -o posting.png
bca view ./app --inside "Contoso Core"                    # how an app or a namespace works: its screens, logic, data
bca view ./app --lens system --inside "Contoso Core"      # its objects, and everything they do with each other
bca view ./app --focus "table:Sales Header" --depth 2 --format json
bca view ./app --story fix                                # a story, step by step
bca view ./app --stories -o docs/system.md                # every story as one document
bca view ./app --lens system --rows relations -o relations.csv
bca view ./app --format json > atlas.json                 # the whole graph
```

Every JSON document names its shape and version in `schema` (`bc-atlas.atlas/1`
for the whole graph, `bc-atlas.view/1` for a lens or a node,
`bc-atlas.story/1`, `bc-atlas.stories/1`), as published in
[`schemas/output.schema.json`](../schemas/output.schema.json).

| In the app | `bca view` |
| --- | --- |
| Lens | `--lens` |
| 2D, Diagram, 3D | `--form 2d`, `diagram`, `3d` (for `svg` and `png`) |
| Find | `--find` |
| Check | `--check` |
| Story, and a step of it | `--story`, `--step`; `--stories` for all |
| Double-click an object, an app, or a namespace | `--inside` |
| Neighbors on a node | `--focus`, `--depth` |
| The legend: hide a kind of node or relation | `--hide`, `--off` |
| View: color, size, group | `--color`, `--size`, `--group` |
| Click a node | `--select` (in a picture), or `--focus` |
| Export: Picture, Drawing | `--format png`, `svg` |
| Export: Graph | `--format json` |
| Export: Nodes, Relations | `--format csv`, `--rows nodes` or `relations` |
| Export: This lens, Documentation | `--format md`; with `--stories` |
| Export: Link | `--format link`: the address that opens this view in the app |

| Option | Value | Description |
| --- | --- | --- |
| `--lens` | id | What the graph shows: `overview` (default: how it works, in columns from the screens to the data), `system`, `apps`, `modules`, `data`, `calls`, `events`, `contracts`, `pages`, `security`, `visibility`, and `health`. A lens with nothing in it does not exist for a project; `bca view` without options lists the lenses a project has. |
| `--inside` | node | Go into one node. An object opens to its procedures, triggers, and events, and what each does with other objects; an app or a namespace opens to how it works (its screens, logic, and data), or with `--lens system` to its objects and everything they do with each other. A name, an ID, or a selector such as `codeunit:50100`. |
| `--focus` | node | Only this node and what is near it. A name, an ID, or a selector such as `table:Customer`. |
| `--depth` | n | How many steps from the `--focus` node. Default: `1`. |
| `--find` | text | In a picture, the nodes whose name, type, namespace, or ID match stand out; a list holds only them. |
| `--hide` | kinds | Kinds of node to leave out, as the legend names them (`codeunit`, `table`, `other apps`), comma-separated or repeated. |
| `--off` | kinds | Kinds of relation to leave out (`uses`, `reads`, `permits`), comma-separated or repeated. |
| `--check` | flag | In a picture, a ring on every node with a finding; in text, the findings with their fixes below each node. |
| `--story` | id | A story instead of a lens: its steps with their texts. `bca view` without options lists the stories of the project. |
| `--step` | n | One step of the `--story`, from 1: its nodes, in its lens. |
| `--stories` | flag | Every story of the system as one document (`text`, `md`, or `json`). |
| `--form` | form | The form of a picture: `2d`, `diagram`, or `3d`. Without it, the form the lens reads best in: `diagram` for the overview and the apps, `2d` for the rest. |
| `--color` | by | Color the nodes by `type`, `namespace`, `app`, `level`, or `findings` instead of what the lens does. |
| `--size` | by | Size the nodes by `relations`, `usedBy`, `uses`, `lines`, `complexity`, `objects`, or `findings`. |
| `--group` | by | Hold the nodes together by `namespace`, `app`, `kind`, or `none`. |
| `--select` | node | The selected node of a picture: it and its relations stand out. |
| `--theme` | theme | Colors of a picture: `light` (default) or `dark`. |
| `--width`, `--height` | px | Size of a picture. Default: 1440 × 900. |
| `-f`, `--format` | format | `text` (default), `json`, `md`, `csv`, `svg`, `png`, or `link`. Inferred from the extension of `--output`. |
| `--rows` | rows | `csv`: one row per node (`nodes`, default) or per relation (`relations`). |
| `-o`, `--output` | path | Write to this file instead of stdout. A PNG needs it. |
| `--project-root` | path | Analyze this app or multi-app workspace; the positional path becomes the focus. |
| `--config` | path | Configuration file. Default: `<app-root>/.bca.json` when present. |
| `--paths` | glob | Only analyze AL files below these project-relative folders or globs. |

- Without a lens, a story, or an object, `text` prints the overview and
  `json` the whole atlas: every node, relation, lens, finding, and story.
- The same options give the same output every time, also for pictures. SVG
  and PNG are drawn by BC Atlas itself, without a browser.
- Text, JSON, CSV, and Markdown hold what shows: what `--hide`, `--off`,
  `--find`, and `--focus` leave.

### `layers`

```text
bca layers [app-root] [-o <folder>] [--check] [options]
```

The layered documentation, in sync with the source: the system explained
from the whole down to each procedure, one page per app, namespace, and
object, each with a picture. See [Layered documentation](./layers.md).

```sh
bca layers ./app                       # docs/layers: the source as it is now
bca layers ./app --profile management  # the pages of one documentation profile
bca layers ./app -o docs/system        # another folder
bca layers ./app --check               # fails when the pages are behind the source
```

| Option | Value | Meaning |
| --- | --- | --- |
| `-o`, `--output` | path | The folder of the pages (default: `layers.outputDir` in `.bca.json`, else `docs/layers`). |
| `--check` | | Write nothing; fail (exit code 1) when the pages are not in sync with the source. |
| `--pictures` | `auto`, `all`, `none` | Pictures of single objects: `auto` (up to 400 objects), `all`, or `none` (no pictures at all). The system, apps, namespaces, and lenses always get one unless `none`. |
| `--profile` | name | A [documentation profile](./layers.md#what-is-written-and-how-the-documentation-profile) of `layers.profiles` in `.bca.json`: which pages and sections are written, for which part of the system, in which language, under which file names, and from which templates. Each profile writes to a folder of its own. |
| `--view` | | Also write `view.html`: the BC Atlas view as one offline file, next to the pages. |
| `-f`, `--format` | `text`, `json` | What the command reports. Default: `text`. |
| `--project-root` | path | Analyze this app or workspace root; the positional path becomes the focus. |
| `--config` | path | Configuration file. Default: `<app-root>/.bca.json`. |
| `--paths` | glob | Only analyze AL files below these project-relative folders or globs. Repeatable. |

The same source gives the same files, byte for byte: a run changes only what
changed and removes what it wrote before and no longer writes.

### `docs` commands

AL UI-test files are the only persisted scenario source. See
[Documentation from AL UI tests](./al-ui-test-documentation.md).

| Option | Commands | Value | Description |
| --- | --- | --- | --- |
| `--format` | all | `text` or `json` | Human-readable or pipe-safe output. Default: `text`. |
| `--id` | `show`, `generate`, `set`, `unset` | document ID | Selects a scenario by stable `[DOC-ID]`. Required for `show`, `set`, `unset`. With `generate`, writes one Markdown file. |
| `--export` | `generate` | formats | Comma-separated `markdown`, `html`, `dita`, `ado-csv`, `bpmn`. Default: `markdown`. |
| `--as` | `generate` | `guide` or `testcase` | User guide or test case with an action/expected-result table. Default: `guide`. |
| `--app` | `generate` | path | AL app source for real captions, tooltips, and page coverage. |
| `--language` | `generate` | tag | Wording and captions in this language, e.g. `de-DE`; captions come from the app's `.xlf` files. Default: `en-US`. |
| `--title` | `generate` | text | Title of the index, HTML page, and DITA map. Default: the app name. |
| `--procedure` | `generate` | name | Test procedure; required when a file contains several tests. |
| `--output-dir` | `generate`, `automation` | path | Markdown directory. Default: `docs/generated`. |
| `--layers` | `generate` | path | Folder of `bca layers`: each guide links to the pages of the system it uses, when the folder holds `layers.json`. Default: `docs/layers`. |
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
bca docs generate test/UITest --app app --export markdown,html,dita,ado-csv,bpmn
bca docs generate test/UITest --app app --as testcase --language de-DE --export html
```

`[WHEN]` comments become numbered phases. Reachable local helpers containing
`TestPage` operations are expanded with cycle and depth protection. Directory
generation writes, per format:

| Format | Files |
| --- | --- |
| `markdown` | `<document-id>.md`, `use-case-<feature>.md`, `journey-<name>.md` (one per `[JOURNEY]`), `runbook.md` (when a scenario has `[MONITOR]`, `[RECOVERY]`, or `[TROUBLESHOOT]`), `index.md`, `link-map.svg`, `diagrams/<id>.svg` (scenario flows, use-case and journey processes) |
| `html` | `index.html` with every diagram inlined |
| `dita` | `<document-id>.dita`, `documentation.ditamap` |
| `ado-csv` | `test-cases.csv` |
| `bpmn` | `use-case-<feature>.bpmn`, `journey-<name>.bpmn` (BPMN 2.0 with diagram layout; scenarios are sub-processes) |

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

### `help`

```text
bca help [<command>]
bca help --format json
```

`--format json` writes only UTF-8 JSON: `schemaVersion` (`2`), version, exit
codes, invocation conventions, feature `areas`, what `export` writes
(`exports`), and every command with its `argv` template, `area`, options (CLI
token, type, enum, default, `required`, `repeatable`), output contract, rules,
and examples. Agents must pass arguments as an array, parse stdout only after
exit code `0`, and run `docs set` or `docs unset` with `--dry-run` before
writing.

### `mcp`

```text
bca mcp
bca-mcp
```

Starts the Model Context Protocol server on stdio. See
[Agent integration](./agent-integration.md).

## Configuration file

`.bca.json` at the input root is loaded automatically; `--config` selects
another file. Command-line values go over it.

| Property | Description |
| --- | --- |
| `projectRoot` | Root of the AL project, relative to the file. |
| `paths` | Analyze only these folders (globs allowed). |
| `namespaces`, `include`, `exclude` | The filters of `export` and `check`. |
| `title` | Title of the view or the report. |
| `sourceUrl` | Link template for source locations, with `{file}`, `{line}`, and `{ref}`. `{file}` is project-root-relative. |
| `sourceRef` | Commit, tag, or branch for `{ref}`. |
| `sourcePathPrefix` | Repository path prepended to `{file}` when the project root is below the repository root. |
| `forbiddenDependencies` | Dependency policy rules; see [Configuration](./configuration.md#check-dependency-rules). |
| `check` | Health-check defaults: `failOn`, `cycles` (`error`, `warning`, `info`, `off`), `maxFanIn`, `maxFanOut`, `severities`, `contexts`, `contractExpectations`. |
| `docs` | `tests`: the folder with the AL UI tests, when BC Atlas should not find it itself. |
| `layers` | The layered documentation: `outputDir`, `pictures`, `view`, and the [documentation profile](./layers.md#what-is-written-and-how-the-documentation-profile). |
| `report` | Report defaults: `outputDir`, `lenses`, `title`, `json`. |
| `al` | `workspaceFile`: the `.code-workspace` file whose folders and `al.packageCachePath` apply, relative to the project root. Default: the one in the root, when there is exactly one. |

BC Atlas resolves the complete `projectRoot` before it applies a folder,
namespace, or include focus. References that cross the focus become aggregated
boundary nodes with a `boundaryCategory` of `microsoft-base-app`,
`declared-dependency`, `same-app-outside-focus`, or `unknown`. Dependency
symbols are loaded from `.app` files under `.alpackages` and in every
`al.packageCachePath` of `.vscode/settings.json` or the `.code-workspace` file;
an unreadable package produces a `symbol-package-error` diagnostic.

See [`.bca.example.json`](../.bca.example.json) for a complete example.