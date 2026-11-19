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
| Analyze | `check` | Score architecture health and fail CI on cycles, policy violations, architecture violations, or diagnostics. |
| Analyze | `architecture` | Find a target architecture, list every dependency that points the wrong way with how to resolve it, and enforce it with a baseline. |
| Export | `export` | Write files: the BC Atlas view as one offline HTML file, the Markdown report, the object catalog, the knowledge graph, a diagram, or the resolved model as JSON. |
| Export | `view` | The BC Atlas view without a window: any lens, story, or object of the one graph as text, JSON, CSV, Markdown, SVG, or PNG. |
| Export | `docs list` | List documented UI-test scenarios. |
| Export | `docs show` | Show one scenario, its prerequisites, and its diagnostics. |
| Export | `docs validate` | Validate IDs, tags, links, and prerequisite cycles. |
| Export | `docs generate` | Generate user guides or test cases as Markdown, HTML, DITA, Azure DevOps CSV, or BPMN. |
| Export | `docs set` | Add or replace documentation metadata in AL source. |
| Export | `docs unset` | Remove documentation metadata from AL source. |
| Export | `docs automation` | Print a CI pipeline that keeps generated guides in sync. |
| Export | `docs glossary` | List supported documentation tags and prerequisite types. |
| Export | `layers` | The layered documentation, in sync with the source, for now and for any commit, tag, or release. |
| Integrate | `mcp` | Start the MCP stdio server for AI agents (also installed as `bca-mcp`). |

```text
bca check [app-root] [options]
bca architecture [app-root] [options]
bca architecture compare [app-root] [options]
bca architecture templates [app-root] [options]
bca export [app-root] [--view <what>] [-o <path>] [options]
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
| `1` | Operation failed, or a check (`check`, `architecture`, `layers --check`, `docs validate`) found blocking issues. |
| `2` | Invalid usage: unknown command, unknown option, invalid enum value, or missing required value. |

Global flags: `-h`, `--help` shows help; `-V`, `--version` shows the version.

## Analyze

### `architecture`

```text
bca architecture [app-root] [options]
```

Checks the target architecture in the `architecture` section of `.bca.json`,
or proposes one from today's dependencies when there is none. Lists every
dependency that points the wrong way, grouped into work items with a
resolution strategy, plus data ownership, checks of the architecture, and
clean-architecture metrics per component. Exits with `1` when the configured
architecture has violations that are not in the baseline. `--extract` plans
moving one component into an app of its own instead. See
[Clean architecture](./clean-architecture.md).

```text
bca architecture ./app --propose --format markdown -o architecture.md
bca architecture ./app --propose --write --update-baseline
bca architecture ./app --format json
bca architecture ./app --extract Sales --format markdown -o extract-sales.md
```

| Option | Value | Description |
| --- | --- | --- |
| `-f`, `--format` | format | `text`, `markdown`, or `json`. Default: `text`. |
| `-o`, `--output` | path | Write the report to a file instead of stdout. |
| `--propose` | flag | Propose an architecture even when `.bca.json` defines one. |
| `--group-by` | mode | `auto`, `coupling`, `namespace`, `folder`, `module`, or `app`. Default `auto`: the typed, weighted relations decide the components, the shared core, and the app candidates, with or without namespaces (`coupling` is the same). `namespace`, `folder`: the code structure decides; objects without it follow their relations. `module`, `app`: one component each. |
| `--depth` | integer | With `--group-by namespace` or `folder`: segments per component. Default: split until no component holds more than 15% of the objects. |
| `--min-objects` | integer | Merge smaller groups into the component they depend on most. Default: `1`. |
| `--start-from` | list | Existing structures that compete with the relations as a starting point: `namespace`, `folder`, both (comma-separated), or `none` for relations only. Default: `namespace,folder`. |
| `--ignore` | kinds | Relation kinds that never shape a component, comma-separated (for example `permits,includes,uses`). Default: `permits,includes`. |
| `--granularity` | number | Above 1: more, smaller components; below 1: fewer, larger ones. Default: `1`. |
| `--shared-core` | `true` or `false` | Pull objects that many components use into a shared core. Default: `true`. |

These options override `architecture.proposal` in `.bca.json`, which also takes components you define yourself (`keep`), objects that do not shape components (`exclude`), `appGranularity`, and `moves`; see [Decide what the proposal considers](./clean-architecture.md#decide-what-the-proposal-considers).

| Option | Value | Description |
| --- | --- | --- |
| `--explain` | object or component | With an object (name, ID, or `type:name`): why it is in its component: the step of the proposal that placed it, with its numbers, the selector that assigns it, and its coupling to each component. With the name of a component: what it is named after, how its objects came to it, what they agree on, the thresholds that applied, its members, and its neighbours. See [Why an object is where it is](./clean-architecture.md#why-an-object-is-where-it-is). |
| `--template` | name | The [template](./target-architecture.md) that says what a good architecture is here: a preset (`balanced`, `follow-structure`, `by-coupling`, `layered`, `modular-monolith`, `small-steps`) or one of your own. `architecture.template` in `.bca.json`. |
| `--weight` | goal=n | How much a goal weighs; `0` leaves it out. Repeatable. `architecture.goals.weights` in `.bca.json`. |
| `--size` | min..max | The size a component should have, in objects. Default `3..200`. |
| `--extract` | component | Plan extracting this component as an app: blockers, dependencies, `app.json`, tables whose data moves, and steps. Never fails the command. |
| `--write` | flag | Save the architecture to the `architecture` section of `.bca.json`. |
| `--update-baseline` | flag | Accept today's violations in `.bca-architecture-baseline.json`; only new ones fail afterwards. |
| `--update-surface` | flag | Record each component's public surface in `.bca-surface.json` (`architecture.surface` names another file); `bca check` then reports changes that break the components that use it. |
| `--paths` | path or glob | Only analyze AL files in these folders. Repeatable. |
| `--namespace`, `--type`, `--include`, `--exclude` | glob | Filters, as for `export`. |
| `--project-root` | path | Analyze a wider workspace. |
| `--config` | path | Configuration file. |
| `--compiler` | mode | `auto`, `off`, or a path; see [AL toolchain](./al-toolchain.md). Default: `auto`. |

### `architecture compare`

```text
bca architecture compare [app-root] [--from <state>] [--to <state>] [--template <name>] [--weight <goal>=<n>] [options]
```

The architecture as it is and as it should be, side by side: both scored with
the same weighted goals, how the components of one become those of the other,
the objects that have to move, and the steps with their commands. See
[Current and target architecture](./target-architecture.md).

| Option | Value | Description |
| --- | --- | --- |
| `--from` | `structure`, `configured`, `proposal`, `best` | The current state. `structure` (default) is the namespaces, folders, and apps the source has today. |
| `--to` | `structure`, `configured`, `proposal`, `best` | The target state. Default: `configured` when `.bca.json` has components, else `best`: several proposals scored with the goals; all are listed and the best wins. |
| `--template` | name | The template that says what is preferred. |
| `--weight` | goal=n | How much a goal weighs, on top of the template. Repeatable. |
| `--size` | min..max | The size a component should have. |
| `--group-by`, `--depth`, `--min-objects`, `--start-from`, `--ignore`, `--granularity`, `--shared-core` | | The settings of the proposal, as for `bca architecture`. |
| `--limit` | n | Most objects to list as moves; `0` for all. Default: `50`. |
| `--save-template` | name | Save the settings of this call as a template of this name. |
| `--write` | flag | Save the target as the architecture of the project: what `bca check` enforces from then on. |
| `--format` | `text`, `markdown`, `json` | Output format. Default: `text`. |
| `-o`, `--output` | path | Write the comparison to a file. |
| `--paths` | globs | Only these files. |
| `--project-root` | path | Project root. |
| `--config` | path | Configuration file. |
| `--compiler` | mode | AL compiler use. |

### `architecture templates`

```text
bca architecture templates [app-root]
bca architecture templates [app-root] --use <name>
bca architecture templates [app-root] --save <name> [--from <name>] [--title <text>] [--summary <text>] [--template-file <path>]
bca architecture templates [app-root] --remove <name>
```

Lists the presets and your own templates with the weight of every goal, takes
one into use, saves the settings as they are as a new template, or removes
one.

| Option | Value | Description |
| --- | --- | --- |
| `--use` | name | Take this template into use (`architecture.template`); an empty value goes back to the defaults. |
| `--save` | name | Save the settings as they are now (the template in use, `.bca.json`, and the options of this call) as a template. A preset cannot be replaced. |
| `--from` | name | With `--save`: copy this template instead. Default: `current`. |
| `--title`, `--summary` | text | With `--save`: what it is, and when to use it. |
| `--template-file` | path | With `--save`: write the template to this JSON file, so that several repositories share it; `.bca.json` keeps the path. |
| `--remove` | name | Remove a template of your own. |
| `--show` | name | Print one template with everything it inherits, as JSON. |
| `--template`, `--weight`, `--size`, `--group-by`, `--depth`, `--min-objects`, `--start-from`, `--ignore`, `--granularity`, `--shared-core` | | With `--save`: settings on top of those in use. |
| `--dry-run` | flag | Check the change and show the result; write nothing. |
| `--format` | `text` or `json` | `json`: the templates, the goals with what each means, and the default weights. |
| `--project-root` | path | Project root. |
| `--config` | path | Configuration file. |

### `check`

```text
bca check [app-root] [options]
```

Analyzes the project view and evaluates health rules: diagnostics, forbidden
dependencies, dependency cycles, fan-in/fan-out hot spots, orphan objects, and
unresolved references. With Microsoft's AL toolchain installed, the AL compiler
and code analyzers (CodeCop, UICop, AppSourceCop, PerTenantExtensionCop) add
their findings. Exits with `1` when a finding reaches `--fail-on`. See
[Architecture health checks](./health-checks.md) and
[AL toolchain](./al-toolchain.md).

```text
bca check ./app
bca check ./app --analyzers CodeCop,UICop --fail-on warning
bca check ./app --format sarif -o bca.sarif
bca check ./app --compiler off --compiler-log .output/errorlogs
```

| Option | Value | Description |
| --- | --- | --- |
| `--fail-on` | level | `error`, `warning`, `info`, or `never`. Default: `error`. |
| `-f`, `--format` | format | `text`, `json`, `markdown`, or `sarif` (SARIF 2.1.0 for GitHub code scanning and Azure DevOps). Default: `text`. |
| `-o`, `--output` | path | Write the report to a file; the result line goes to stderr. |
| `--max-fan-in` | integer | Warn when more distinct objects depend on one object. Default: `25`. |
| `--max-fan-out` | integer | Warn when one object depends on more distinct objects. Default: `25`. |
| `--analyzers` | list | Code analyzers for the AL compile: `CodeCop`, `UICop`, `AppSourceCop`, `PerTenantExtensionCop`, or DLL paths. Default: `al.codeAnalyzers` when `al.enableCodeAnalysis` is on. |
| `--compiler` | mode | `auto` (the AL Language extension's compiler or the AL Development Tools when installed), `off`, or a path to `alc`, `al`, or an AL extension folder. Default: `auto`. |
| `--compiler-log` | path | Import diagnostics from an AL compiler error log file or folder (`alc /errorlog`, `al workspace compile --errorlogdirectory`, AL-Go, BcContainerHelper). |
| `--namespace`, `--type`, `--include`, `--exclude` | glob | Filters, as for `export`. |
| `--project-root` | path | Analyze a wider workspace. |
| `--config` | path | Configuration file. |
| `--strict` | flag | Shortcut for `--fail-on warning`. |

## Export

### `export`

```text
bca export [app-root] [--view <what>] [-o <path>] [options]
```

Writes what the VS Code extension shows as files. `--view` selects what:

| `--view` | Writes | Default output | Formats |
| --- | --- | --- | --- |
| `app` (default) | The BC Atlas view as one self-contained, offline HTML file to share: a toolbar and the graph, with every lens, finding, and story. | `bc-atlas.html` | `html` |
| `report` | Markdown report: `README.md` with an at-a-glance table, one section and diagram per view, the health summary, and a regeneration command. See [Architecture reports](./reports.md). | `docs/atlas` | `svg` or `d2` diagrams |
| `catalog` | One linked Markdown page per AL object. See [Code Graph](./code-graph-markdown-design.md). | `docs/codegraph` | Markdown |
| `knowledge-graph` | The project as RDF with the BC Atlas OWL ontology, for triple stores, graph databases, and ontology editors. See [Knowledge graph](./knowledge-graph.md). | `bc-atlas.ttl` | `ttl`, `rdf`, `owl` (RDF/XML), `nt`, `jsonld` |
| `project`, `module`, `object`, `data`, `call`, `boundary`, `contracts`, `events`, `ui`, `workflow`, `visibility` | One diagram view, or its resolved model as JSON. See [Architecture diagrams](./architecture-diagrams.md). | `bc-atlas-<view>.svg` | `svg`, `d2`, `json`, `png`, `pdf` |

```text
bca export ./app -o atlas.html
bca export ./app --view report --codegraph
bca export ./app --view module -o modules.svg
bca export ./app --view workflow --entry ProcessDocument -o workflow.svg --watch
bca export ./app --view project --format json > model.json
bca export ./app --view catalog -o docs/codegraph
bca export ./app --view knowledge-graph -o atlas.owl
```

#### Output

| Option | Value | Description |
| --- | --- | --- |
| `--view` | what | `app`, `report`, `catalog`, `knowledge-graph`, or a diagram view. Default: `app`. |
| `-o`, `--output` | path | Output file or folder (defaults above). `-` writes JSON to stdout. |
| `-f`, `--format` | format | `html`, `d2`, `json`, `svg`, `png`, or `pdf`, as the view allows; `ttl`, `rdf`, `owl`, `nt`, or `jsonld` for the knowledge graph. Inferred from the output extension when omitted. |
| `--base-iri` | IRI | Knowledge graph: base IRI of the exported resources. Default: `urn:bc-atlas:`. |
| `--no-evidence` | flag | Knowledge graph: leave out the `bca:Relation` resources with each relation's file, line, and operations; the direct relation triples stay. |
| `--title` | text | Title of the report or diagram. |
| `--watch` | flag | Write again whenever AL source, `app.json`, or `.bca.json` changes. Stop with `Ctrl+C`. |
| `--debounce` | milliseconds | Delay before writing again with `--watch`. Default: `250`. |

- A diagram view with `--format json` and no `--output` prints the resolved
  model to stdout (progress goes to stderr), for scripts.
- BC Atlas draws SVG, PNG, and PDF itself (ELK layout; no browser and no `d2`
  executable). A view with more than 1,500 objects is drawn as an overview:
  every group is one box, and the relations between them are bundled with a
  count. The `.d2` file next to it always has every object.
- If `--format` conflicts with the extension, the format wins:
  `-o calls.d2 --format svg` writes `calls.svg` and keeps `calls.d2`.
- Rendered diagrams always keep the generated `.d2` source next to them.
- The object catalog replaces its folder atomically; BC Atlas refuses to
  replace a non-empty folder that has no generated `index.md`.

#### Report

| Option | Value | Description |
| --- | --- | --- |
| `--views` | list | Comma-separated views: `project`, `module`, `data`, `contracts`, `events`, `ui`, `call`, `visibility`. Default: all except `call` and `visibility`. |
| `--codegraph` | flag | Also write the linked object catalog to `<output>/objects`. |
| `--json` | flag | Also write the resolved project model to `model.json`. |

`--format svg` (default) or `d2` selects the diagram format; `d2` skips SVG
rendering.

#### View selection

| Option | Value | Description |
| --- | --- | --- |
| `--object` | selector | Required by the `object` view. Object name, ID, key, or typed selector such as `codeunit:50100`. |
| `--object-inbound-depth` | integer ≥ 0 | Incoming depth for the object view. Default: `1`. |
| `--object-outbound-depth` | integer ≥ 0 | Outgoing depth for the object view. Default: `1`. |
| `--members` | list | Focused-object members: `fields`, `actions`, `triggers`, `events`, `procedures`. |
| `--scope` | selector | Boundary scope: `namespace:`, `folder:`, `app:`, or `object:`. Repeatable; required by `boundary`. |
| `--focus` | text | Restrict the `contracts`, `events`, `ui`, or `visibility` view to matching names. |
| `--group-by` | mode | Diagram views: `namespace`, `folder`, `type`, or `role`. Project view defaults to `role`; others to `namespace`. |
| `--module-depth` | integer or `auto` | Namespace segments kept by the module view. Default: `auto`. |
| `--folder-depth` | integer | Folder segments in a folder-grouped module view. Default: `1`. |

#### Filters

| Option | Value | Description |
| --- | --- | --- |
| `--namespace` | glob | Include matching namespaces. Repeatable. |
| `--type` | types | Include object types. Comma-separated and repeatable. |
| `--include` | glob | Include matching file paths or object selectors. Repeatable. |
| `--exclude` | glob | Exclude matching file paths or object selectors. Repeatable. |
| `--paths` | path or glob | Only analyze AL files in these folders (or matching these globs), relative to the project root. Repeatable. Speeds up large repositories such as BCApps. |

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
| `--project-root` | path | Analyze this app or multi-app workspace; the positional path becomes the focus. |
| `--config` | path | Configuration file. Default: `<app-root>/.bca.json` when present. |
| `--strict` | flag | Fail when analysis produces warning or error diagnostics. |
| `--compiler` | mode | `auto`, `off`, or a path: the AL compiler resolves calls for the call and workflow views. See [AL toolchain](./al-toolchain.md). Default: `auto`. |
| `--compiler-log` | path | Import diagnostics from an AL compiler error log file or folder. |

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
bca view ./app --inside component:Core                    # how a component, an app, or a namespace works: its screens, logic, data
bca view ./app --lens system --inside component:Core      # its objects, and everything they do with each other
bca view ./app --focus "table:Sales Header" --depth 2 --format json
bca view ./app --story fix                                # a story, step by step
bca view ./app --stories -o docs/system.md                # every story as one document
bca view ./app --lens system --rows relations -o relations.csv
bca view ./app --format json > atlas.json                 # the whole graph
```

| In the app | `bca view` |
| --- | --- |
| Lens | `--lens` |
| 2D, Diagram, 3D | `--form 2d`, `diagram`, `3d` (for `svg` and `png`) |
| Find | `--find` |
| Check | `--check` |
| Story, and a step of it | `--story`, `--step`; `--stories` for all |
| Double-click an object, an app, a component, or a namespace | `--inside` |
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
| `--lens` | id | What the graph shows: `overview` (default: how it works, in columns from the screens to the data), `system`, `components`, `apps`, `modules`, `data`, `calls`, `events`, `contracts`, `pages`, `security`, `visibility`, and `health`. A lens with nothing in it does not exist for a project; `bca view` without options lists the lenses a project has. |
| `--inside` | node | Go into one node. An object opens to its procedures, triggers, and events, and what each does with other objects; an app, a component, or a namespace opens to how it works (its screens, logic, and data), or with `--lens system` to its objects and everything they do with each other. A name, an ID, or a selector such as `codeunit:50100` or `component:Core`. |
| `--focus` | node | Only this node and what is near it. A name, an ID, or a selector such as `table:Customer` or `component:Core`. |
| `--depth` | n | How many steps from the `--focus` node. Default: `1`. |
| `--find` | text | In a picture, the nodes whose name, type, component, namespace, or ID match stand out; a list holds only them. |
| `--hide` | kinds | Kinds of node to leave out, as the legend names them (`codeunit`, `table`, `other apps`), comma-separated or repeated. |
| `--off` | kinds | Kinds of relation to leave out (`uses`, `reads`, `permits`), comma-separated or repeated. |
| `--check` | flag | In a picture, a ring on every node with a finding; in text, the findings with their fixes below each node. |
| `--story` | id | A story instead of a lens: its steps with their texts. `bca view` without options lists the stories of the project. |
| `--step` | n | One step of the `--story`, from 1: its nodes, in its lens. |
| `--stories` | flag | Every story of the system as one document (`text`, `md`, or `json`). |
| `--form` | form | The form of a picture: `2d`, `diagram`, or `3d`. Without it, the form the lens reads best in: `diagram` for the overview and components, `2d` for the rest. |
| `--color` | by | Color the nodes by `type`, `component`, `namespace`, `app`, `level`, or `findings` instead of what the lens does. |
| `--size` | by | Size the nodes by `relations`, `usedBy`, `uses`, `lines`, `complexity`, `objects`, or `findings`. |
| `--group` | by | Hold the nodes together by `component`, `namespace`, `app`, `kind`, or `none`. |
| `--select` | node | The selected node of a picture: it and its relations stand out. |
| `--theme` | theme | Colors of a picture: `light` (default) or `dark`. |
| `--width`, `--height` | px | Size of a picture. Default: 1440 × 900. |
| `-f`, `--format` | format | `text` (default), `json`, `md`, `csv`, `svg`, `png`, or `link`. Inferred from the extension of `--output`. |
| `--rows` | rows | `csv`: one row per node (`nodes`, default) or per relation (`relations`). |
| `-o`, `--output` | path | Write to this file instead of stdout. A PNG needs it. |
| `--project-root` | path | Analyze this app or multi-app workspace; the positional path becomes the focus. |
| `--config` | path | Configuration file. Default: `<app-root>/.bca.json` when present. |
| `--compiler` | mode | `auto`, `off`, or a path. See [AL toolchain](./al-toolchain.md). |
| `--compiler-log` | path | Import diagnostics from an AL compiler error log file or folder. |
| `--paths` | glob | Only analyze AL files below these project-relative folders or globs. |

- Without a lens, a story, or an object, `text` prints the overview and
  `json` the whole atlas: every node, relation, lens, finding, and story.
- The same options give the same output every time, also for pictures. SVG
  and PNG are drawn by BC Atlas itself, without a browser.
- Text, JSON, CSV, and Markdown hold what shows: what `--hide`, `--off`,
  `--find`, and `--focus` leave.

### `layers`

```text
bca layers [app-root] [-o <folder>] [--at <ref>]... [--releases [--last <n>]] [--check] [options]
```

The layered documentation, in sync with the source: the system explained
from the whole down to each procedure, one page per app, component,
namespace, and object, each with a picture. For the source as it is now, and
for any commit, tag, or release. See [Layered documentation](./layers.md).

```sh
bca layers ./app                       # docs/layers: the source as it is now
bca layers ./app --check               # fails when the pages are behind the source
bca layers ./app --at v1.4.0           # docs/layers/history/v1.4.0: the source as it was
bca layers ./app --releases --last 5   # the working tree, and the newest five releases
```

| Option | Value | Meaning |
| --- | --- | --- |
| `-o`, `--output` | path | The folder of the pages (default: `layers.outputDir` in `.bca.json`, else `docs/layers`). States of the past go below `history/` in it. |
| `--at` | ref | Record the source as it was at a commit, a tag, or a release, below `history/<name>`. Repeatable, or comma-separated. Only these states are written, not the working tree. |
| `--releases` | | Also record every release (Git tag) the current commit descends from that is not recorded yet. |
| `--last` | n | With `--releases`: only the newest n releases. |
| `--refresh` | | Write a state that is already recorded again, for example after an update of BC Atlas. |
| `--check` | | Write nothing; fail (exit code 1) when the pages are not in sync with the source, or an asked state is not recorded. |
| `--pictures` | `auto`, `all`, `none` | Pictures of single objects: `auto` (up to 400 objects), `all`, or `none` (no pictures at all). |
| `--profile` | name | A [documentation profile](./layers.md#what-is-written-and-how-the-documentation-profile) of `layers.profiles` in `.bca.json`: which pages and sections are written, for which part of the system, in which language, under which file names, and from which templates. Each profile writes to a folder of its own. |
| `--view` | | Also write `view.html`, the BC Atlas view of the working tree as one offline file. A state of the past always has it. |
| `-f`, `--format` | `text`, `json` | What the command reports. |

The same source gives the same files, byte for byte: a run changes only what
changed and removes what it wrote before and no longer writes. A state of
the past is read from a temporary checkout (`git worktree`); the working
tree is not touched.

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
| `markdown` | `<document-id>.md`, `use-case-<feature>.md`, `index.md`, `journey.d2`, `journey.svg`, `diagrams/<id>.svg` (scenario flows and use-case processes) |
| `html` | `index.html` with every diagram inlined |
| `dita` | `<document-id>.dita`, `documentation.ditamap` |
| `ado-csv` | `test-cases.csv` |
| `bpmn` | `use-case-<feature>.bpmn` (BPMN 2.0 with diagram layout; scenarios are sub-processes) |

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

`--format json` writes only UTF-8 JSON: `schemaVersion`, version, exit codes,
invocation conventions, feature `areas`, `views`, and every command with its
`argv` template, `area`, options (CLI token, type, enum, default, `required`,
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
another file. The root accepts the camelCase
form of every `export` diagram option: `view`, `output`, `format`, `object`,
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
| `forbiddenDependencies` | Dependency policy rules; see [Configuration](./configuration.md#check-dependency-rules). |
| `workflow` | Workflow defaults: `entries`, `depth`, `maxNodes`, `maxEdges`, `edgeTypes`, `phases`, `stop`, `collapse`. |
| `check` | Health-check defaults: `failOn`, `cycles` (`error`, `warning`, `info`, `off`), `maxFanIn`, `maxFanOut`. |
| `docs` | `tests`: the folder with the AL UI tests, when BC Atlas should not find it itself. |
| `layers` | The layered documentation: `outputDir` and the [documentation profile](./layers.md#what-is-written-and-how-the-documentation-profile). |
| `report` | Report defaults: `outputDir`, `views`, `format`, `codegraph`, `json`, `title`. |
| `al` | Microsoft's AL toolchain: `compiler` (`auto`, `off`, or a path), `analyzers`, `errorLog`, `callGraph` (`false` keeps calls source-level), `workspaceFile`. See [AL toolchain](./al-toolchain.md). |

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
symbols are loaded from `.app` files under `.alpackages` and in every
`al.packageCachePath` of `.vscode/settings.json` or the `.code-workspace` file;
an unreadable package produces a `symbol-package-error` diagnostic.

See [`.bca.example.json`](../.bca.example.json) for a complete example.
