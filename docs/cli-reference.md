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
| Get started | `setup` | Set up a project interactively, or with `--yes`: `.bca.json`, Git hooks, pipelines, schedules. |
| Get started | `setup plan` | Detect the project and list setup questions with recommended answers. |
| Get started | `setup apply` | Write `.bca.json`, Git hooks, and a pipeline from setup answers. |
| Get started | `setup agent` | Add a `/bca-setup` command for Claude Code, Copilot, or Cursor. |
| Analyze | `check` | Score architecture health and fail CI on cycles, policy violations, architecture violations, or diagnostics. |
| Analyze | `simulate` | Battle-test the app as your company uses it: agents with roles, permission sets, and task groups perform the process tests; fails CI when a role is blocked or can do what it must not, and writes the fit-gap analysis. |
| Analyze | `graph query` | Query a saved graph as reusable JSON without analyzing AL. |
| Export | `graph render` | Render a saved graph selection as SVG, HTML, DOT, or JSON. |
| Analyze | `architecture` | Find a target architecture, list every dependency that points the wrong way with how to resolve it, and enforce it with a baseline. |
| Analyze | `refactor move` | Move an AL object to another component, with its file, namespace, and the usings of referencing files. |
| Analyze | `refactor surface` | Lock the public surface of components: `Access = Internal` for what nobody outside uses, `exposes` for what others use. |
| Export | `export` | Write files: the BC Atlas view as one offline HTML file, the Markdown report, the 3D explorer, the object catalog, the system handbook, a diagram, or the resolved model as JSON. |
| Export | `view` | The BC Atlas view without a window: any lens, story, or object of the one graph as text, JSON, CSV, Markdown, SVG, or PNG. |
| Export | `docs list` | List documented UI-test scenarios. |
| Export | `docs show` | Show one scenario, its prerequisites, and its diagnostics. |
| Export | `docs validate` | Validate IDs, tags, links, and prerequisite cycles. |
| Export | `docs generate` | Generate user guides or test cases as Markdown, HTML, DITA, Azure DevOps CSV, or BPMN. |
| Export | `docs set` | Add or replace documentation metadata in AL source. |
| Export | `docs unset` | Remove documentation metadata from AL source. |
| Export | `docs automation` | Print a CI pipeline that keeps generated guides in sync. |
| Export | `docs glossary` | List supported documentation tags and prerequisite types. |
| Integrate | `run` | Run the features configured for a trigger and sync their output. |
| Integrate | `update` | Check for a new version, show the release notes, and update BC Atlas and the generated setup files. |
| Integrate | `mcp` | Start the MCP stdio server for AI agents (also installed as `bca-mcp`). |

```text
bca setup [app-root] [--yes] [--dry-run]
bca setup plan [app-root] [options]
bca setup apply [app-root] [options]
bca setup agent [app-root] [options]
bca check [app-root] [options]
bca simulate [app-root] [--tests <path>] [--company <path>] [-o <path>] [options]
bca graph query <graph.json> [options]
bca graph render <graph.json> [-o <path>] [options]
bca architecture [app-root] [options]
bca refactor move [app-root] --object <selector> --to <component> [--apply]
bca refactor surface [app-root] [--component <component>] [--apply]
bca export [app-root] [--view <what>] [-o <path>] [options]
bca docs <command> <test-root> [options]
bca docs glossary [options]
bca run [app-root] [options]
bca update [app-root] [options]
bca mcp
bca help [<command>] [--format json]
```

### Earlier commands

Several commands are now part of `export` and the [VS Code extension](./vscode.md):

| Before | Now |
| --- | --- |
| `bca init` | `bca setup` (it writes `.bca.json`), or `bca setup apply --hooks none --ci none --editor none --schedule none` for the file alone |
| `bca report` | `bca export --view report` (`--output-dir` is now `-o`) |
| `bca graph <app-root>`, `bca <app-root>` | `bca export --view <view>`; the new `graph query` and `graph render` operate on saved JSON, not AL source |
| `bca watch` | `bca export --view <view> --watch`, or the VS Code extension, which updates itself |
| `bca explore` | `bca export --view explorer`, or the BC Atlas view in VS Code |
| `bca inspect` | `bca export --view <view> --format json` (stdout) |
| `bca codegraph` | `bca export --view catalog` (`--output-dir` is now `-o`) |
| `bca capabilities` | `bca help --format json` |

### Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Success. |
| `1` | Operation failed, or a check (`check`, `simulate`, `architecture`, `docs validate`) found blocking issues. |
| `2` | Invalid usage: unknown command, unknown option, invalid enum value, or missing required value. |

Global flags: `-h`, `--help` shows help; `-V`, `--version` shows the version.

## Saved graph platform

`graph query` and `graph render` share the same selection and work without AL
source, symbol packages, or a compiler. First save the dependency graph with
`bca export ./workspace --view explorer --format json -o graph.json`, then
reuse it for message migrations, impact analysis, or custom visualizations.
Version 1 Atlas graph documents and flat `nodes`/`edges` snapshots (including
named `roots` groups) are accepted. See [Dependency explorer](./dependency-explorer.md#query-and-render-saved-graphs).

| Option | Value | Description |
| --- | --- | --- |
| `--root` | repeatable selector | Exact node ID, label, or Atlas key. Ambiguous labels fail; use IDs. |
| `--root-group` | name | Named root group, such as `legacy`. Can be combined with explicit roots. |
| `--depth` | nonnegative integer | Default 1; 0 keeps only roots. Without roots, selects the entire graph. |
| `--direction` | outgoing, incoming, both | Default outgoing; original edge directions are never reversed. |
| `--kind` | repeatable kind | Traverse only edges containing this kind; all evidence on selected aggregates is preserved. |
| `--level` | name | Temporal level: object (default), app, module, or component. |
| `--frame` | nonnegative integer | Temporal presence frame; default latest. Labels and evidence are the saved document's, not reconstructed historical values. |
| `--output` (`-o`) | path | Query: write JSON instead of stdout. Render: output file, default `bc-atlas-graph.svg`. Never overwrites the input. |
| `--format` (`-f`) | json, dot, svg, html | Render only; inferred from the output extension when omitted. |
| `--title` | text | Render only; diagram title. |
| `--max-nodes` | nonnegative integer | Render only; SVG/HTML limit, default 1500. Oversized selections fail instead of being truncated. |
| `--max-edges` | nonnegative integer | Render only; SVG/HTML edge limit, default 5000. |

```sh
bca graph query graph.json --root-group legacy --depth 2 -o orders.json
bca graph render graph.json --root-group legacy --direction incoming -o callers.svg
bca graph render orders.json -o orders.html
```

## Get started

### `setup`

```text
bca setup [app-root] [--yes] [--dry-run]
```

Asks which features to automate, which Git hooks and pipeline to use, when to
run on a schedule, and how generated files stay in sync. It then shows the
planned changes and applies them after confirmation. Needs an interactive
terminal; use `--yes` to accept the recommendations. See
[Guided setup](./setup.md).

The `.bca.json` it writes is pre-filled from what BC Atlas detects: the app
name from `app.json`, test folders (excluded from analysis), a source-link
template for GitHub, GitLab, or Azure DevOps remotes, and `check` and `report`
sections with the default thresholds.

| Option | Value | Description |
| --- | --- | --- |
| `--yes` | flag | Accept every recommendation without asking. |
| `--dry-run` | flag | Show the planned files without writing them. |

### `setup plan`

```text
bca setup plan [app-root] --format json
```

Prints detected facts (app, Git host, UI tests, translations, existing hooks
and pipelines), every question with its flag, options, and recommendation, and
a ready `apply` command.

| Option | Value | Description |
| --- | --- | --- |
| `--format` | `text` or `json` | Output mode. Default: `text`. |

### `setup apply`

```text
bca setup apply [app-root] [answers] [--dry-run] [--force] [--format json]
```

Omitted answers use the recommendation. Lists are comma-separated; `none`
means empty.

| Option | Value | Description |
| --- | --- | --- |
| `--features` | list | Features to automate: `check`, `report`, `docs`, `codegraph`. |
| `--tests` | path | Folder with AL UI tests for the `docs` feature, relative to the app. |
| `--docs-export` | list | `markdown`, `html`, `dita`, `ado-csv`, `bpmn`. |
| `--docs-as` | `guide` or `testcase` | Documentation type. |
| `--language` | tag | Documentation language, e.g. `de-DE`. |
| `--hooks` | `husky`, `git`, `none` | Git hook manager. |
| `--pre-commit` | list | Features before each commit, or `none`. |
| `--pre-push` | list | Features before each push, or `none`. |
| `--hook-sync` | `verify`, `stage`, `none` | How hooks keep generated files in sync. |
| `--editor` | `vscode`, `none` | Add `BC Atlas:` tasks to `.vscode/tasks.json` for the local development loop. |
| `--updates` | `dependabot`, `none` | Propose new BC Atlas versions as Dependabot pull requests. Needs `--hooks husky`, which keeps the version in `package.json`. |
| `--from-config` | flag | Start from the answers in the existing `.bca.json` instead of the recommendations. `bca update` uses it to regenerate files for a new version. |
| `--ci` | `github`, `azure-devops`, `none` | Pipeline provider. |
| `--ci-sync` | `verify`, `artifact`, `none` | What pull requests and pushes do with generated files. |
| `--schedule` | cron | Five-field cron expression in UTC, or `none`. |
| `--schedule-sync` | `pull-request`, `commit`, `artifact`, `verify`, `none` | What scheduled runs do with generated files. `pull-request` needs GitHub. |
| `--dry-run` | flag | List planned files without writing them. |
| `--force` | flag | Replace pipeline files that were not generated by `bca setup`. |
| `--format` | `text` or `json` | Output mode. Default: `text`. |

### `setup agent`

```text
bca setup agent [app-root] --agent claude|copilot|cursor|generic
```

Writes a `/bca-setup` command that lets your AI agent run the guided setup
through the CLI: `.claude/commands/bca-setup.md`,
`.github/prompts/bca-setup.prompt.md`, or `.cursor/commands/bca-setup.md`.
`generic` prints the prompt.

| Option | Value | Description |
| --- | --- | --- |
| `--agent` | `claude`, `copilot`, `cursor`, `generic` | Agent to prepare. Default: `generic`. |
| `--print` | flag | Print the instructions instead of writing a file. |
| `--force` | flag | Replace an existing command file. |

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
[Clean architecture](./clean-architecture.md) and
[Split a monolith](./modularization.md).

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
| `--explain` | object | Explain why an object is in its component: the selector that assigns it, and its coupling to each component by relation kind. Accepts a name, an ID, or `type:name`. |
| `--extract` | component | Plan extracting this component as an app: blockers, dependencies, `app.json`, tables whose data moves, and steps. Never fails the command. |
| `--write` | flag | Save the architecture to the `architecture` section of `.bca.json`. |
| `--update-baseline` | flag | Accept today's violations in `.bca-architecture-baseline.json`; only new ones fail afterwards. |
| `--update-surface` | flag | Record each component's public surface in `.bca-surface.json` (`architecture.surface` names another file); `bca check` then reports changes that break the components that use it. |
| `--paths` | path or glob | Only analyze AL files in these folders. Repeatable. |
| `--namespace`, `--type`, `--include`, `--exclude` | glob | Filters, as for `export`. |
| `--project-root` | path | Analyze a wider workspace. |
| `--config` | path | Configuration file. |
| `--compiler` | mode | `auto`, `off`, or a path; see [AL toolchain](./al-toolchain.md). Default: `auto`. |

### `refactor move`

```text
bca refactor move [app-root] --object <selector> --to <component> [options]
```

Moves an AL object to another component of the architecture (from `.bca.json`,
or the proposal): its file goes to the component's folder, or the object is cut
out of a file it shares into `<Name>.<Type>.al`; its namespace becomes the
component's, and files that reference it get the `using` they need. Without
`--apply` it prints the diff and writes nothing. Warns when the object changes
apps (dependencies, ID ranges, table data). Work items of
`bca architecture --format json` carry the command for the moves they suggest.

```text
bca refactor move ./app --object codeunit:50100 --to Sales
bca refactor move ./app --object tableextension:50001 --to Sales --apply
```

| Option | Value | Description |
| --- | --- | --- |
| `--object` | selector | Required. `codeunit:50100`, `table:"Sales Doc"`, or a name. |
| `--to` | component | Target component. |
| `--folder` | path | Target folder relative to the project root. Default: the component's `folder:` selector, else the common parent folder of its objects. |
| `--namespace` | namespace | Target namespace. Default: the component's `namespace:` selector, else the namespace most of its objects use. |
| `--apply` | flag | Write the changes. Refuses when a file changed since the analysis. |
| `--format` | format | `text` or `json`. Default: `text`. |
| `--paths` | path or glob | Only analyze AL files in these folders. Repeatable. |
| `--project-root` | path | Analyze a wider workspace. |
| `--config` | path | Configuration file. |

### `refactor surface`

```text
bca refactor surface [app-root] [--component <component>] [options]
```

Locks the public surface of every component (or one): codeunits without
events, queries, and enums that are not extensible, which no other component
uses, get `Access = Internal`; the objects other components use go into the
component's `exposes` in `.bca.json`, so `bca check` reports any new use of
something else (`internal-access`). Tables, interfaces, extensible enums, and
codeunits that publish events stay public. Without `--apply` it prints the
diff.

```text
bca refactor surface ./app --component Core
bca refactor surface ./app --apply
```

| Option | Value | Description |
| --- | --- | --- |
| `--component` | component | Only this component. Default: every component. |
| `--internal` | `true`, `false` | Set `Access = Internal`. Default: `true`. |
| `--exposes` | `true`, `false` | Write `exposes` to `.bca.json`. Default: `true`. |
| `--apply` | flag | Write the changes. |
| `--format` | format | `text` or `json`. Default: `text`. |
| `--paths` | path or glob | Only analyze AL files in these folders. Repeatable. |
| `--project-root` | path | Analyze a wider workspace. |
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

### `simulate`

```text
bca simulate [app-root] [options]
```

The battle test: agents with the roles, permission sets, and task groups of
your company perform the process tests of the app (AL UI tests with
`[SCENARIO]`) step by step. Every step is checked against what the code behind
it needs: Execute on the page and on every object its code runs, and the
table-data rights for what that code reads and writes. The report says who
completes which task, who is blocked at which step and by which missing
permission, who can do what they must not, whether each process runs end to
end, and how the company's requirements fit the app (fit-gap analysis). Exits
with `1` when a finding reaches `--fail-on`. See
[Battle test](./battle-test.md).

```text
bca simulate ./app --tests ./test
bca simulate ./app --format markdown -o docs/simulation/README.md
bca simulate ./app --company company.json --language de
bca simulate ./app --format json
```

| Option | Value | Description |
| --- | --- | --- |
| `--tests` | path | Folder with the process tests. Default: `simulation.tests`, then `docs.tests` in `.bca.json`, then the app itself. |
| `--company` | path | JSON file with the company (`roles`, `agents`, `taskGroups`, `requirements`) instead of the `simulation` section of `.bca.json`. |
| `--recordings` | path | Folder with recordings of Business Central (fact snapshots as JSON) the agents perform as well. A recording with the title of a process test adds what really ran to that test; any other is a process of its own. Default: `simulation.recordings`. |
| `--snapshots` | path | Also write one fact snapshot per process test into this folder, from the source. Default: `simulation.snapshotDir`, when set. |
| `--fail-on` | level | `error`, `warning`, `info`, or `never`. Default: `error`. |
| `-f`, `--format` | format | `text`, `markdown`, or `json`. Default: `text`, or the extension of `--output` (`.md`, `.json`). |
| `-o`, `--output` | path | Write the report to a file; the result line goes to stderr. |
| `--language` | tag | Language of the report and the steps: `en` (default) or `de`. |
| `--title` | text | Title of the report. |
| `--compiler` | mode | As for `check`. |
| `--compiler-log` | path | As for `check`. |
| `--project-root` | path | Analyze a wider workspace. |
| `--config` | path | Configuration file. |

Without roles in `.bca.json`, every combination of `[PERMISSIONS]` in the
tests is a role that performs the tests naming it.

### `simulate define`

```text
bca simulate define [app-root] [--agent <name> | --role <name> | --task-group <name> | --requirement <id>] [options]
```

Define the simulation: the company of the battle test. Without options it
shows the simulation as it is, defined in `.bca.json` or as the process
tests describe it. With options it changes the `simulation` section and
runs the changed simulation at once. See
[Define the simulation](./battle-test.md#define-the-simulation).

```sh
bca simulate define ./app                                   # the simulation as it is
bca simulate define ./app --init                            # write the company the process tests describe
bca simulate define ./app --role "Team lead" --permission-sets "PR - REQUEST,PR - APPROVE" --task-groups Requesting,Approval
bca simulate define ./app --agent Ben --roles "Team lead"
bca simulate define ./app --agent Dana --roles Purchaser --must-not Approval --dry-run
bca simulate define ./app --requirement REQ-7 --title "Orders come from approved requests" --tasks purchase-request-order
bca simulate define ./app --ground purchase-request-approve=approve-a-released-purchase-request
bca simulate define ./app --remove agent:Dana
bca simulate define ./app --from simulation-changes.json --format json
```

| Option | Value | Meaning |
| --- | --- | --- |
| `--agent` | name | Add or change this agent, a person who uses the app: `--roles`, `--permission-sets`, `--task-groups`, `--tasks`, `--must-not`. |
| `--role` | name | Add or change this role: `--permission-sets`, `--task-groups`, `--tasks`, `--features`, `--must-not`, `--description`. |
| `--task-group` | name | Add or change this task group, what there is to do: `--tasks`, `--features`, `--description`. |
| `--requirement` | id | Add or change this requirement of the company: `--title`, `--tasks`, `--features`, `--objects`, `--description`. |
| `--roles` | list | The roles of an agent, comma-separated. An empty value takes them away. |
| `--permission-sets` | list | The permission sets of a role or an agent. |
| `--task-groups` | list | The task groups a role or an agent does. |
| `--tasks` | list | Process tests by document ID: what a role, an agent, or a task group does, or what proves a requirement. |
| `--features` | list | Process tests by `[FEATURE]`. |
| `--must-not` | list | What a role or an agent must not be able to do: process tests, features, or task groups. |
| `--objects` | list | Objects that should cover a requirement: `page:Name`, `codeunit:Name`. |
| `--title` | text | The title of a requirement. |
| `--description` | text | What a role, a task group, or a requirement is. |
| `--remove` | kind:name | Remove something: `agent:Anna`, `role:Team lead`, `taskGroup:Approval`, `requirement:REQ-2`. Repeatable. |
| `--ground` | task=recording | Ground a process test on a recording of Business Central (a fact snapshot of the sync plugin). Repeatable. |
| `--unground` | task | Take the recording of a process test away. Repeatable. |
| `--company-name` | text | The name of the company. |
| `--init` | | Write the company the process tests describe (a role per combination of `[PERMISSIONS]`) into `.bca.json`, as the start of a definition. |
| `--from` | path | Apply the operations of a JSON file: a list of `{ op, kind, name, ... }`. What the Simulate menu of the view saves. |
| `--dry-run` | | Run the changed simulation and report it; write nothing. |
| `-f`, `--format` | `text`, `json` | The definition and the result of the run. |
| `--tests` | path | Folder with the process tests. |

A change names what it changes and keeps the rest. The first change of a
project that defines nothing yet starts from the company the process tests
describe. The changed simulation runs before anything is written, so a
definition that is not valid never reaches `.bca.json`. The exit code is 0
when the definition was applied, whatever the simulation finds;
[`simulate`](#simulate) is the gate.

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
| `explorer` | The interactive 3D dependency explorer, or its graph document. See [Dependency explorer](./dependency-explorer.md). | `bc-atlas-explorer.html` | `html` or `json` |
| `catalog` | One linked Markdown page per AL object. See [Code Graph](./code-graph-markdown-design.md). | `docs/codegraph` | Markdown |
| `handbook` | System handbook: pages that explain the system across all objects (events, data, permissions, interfaces, user interface, code health). See [System handbook](./handbook.md). | `docs/handbook` | Markdown |
| `knowledge-graph` | The project as RDF with the BC Atlas OWL ontology, for triple stores, graph databases, and ontology editors. See [Knowledge graph](./knowledge-graph.md). | `bc-atlas.ttl` | `ttl`, `rdf`, `owl` (RDF/XML), `nt`, `jsonld` |
| `project`, `module`, `object`, `data`, `call`, `boundary`, `contracts`, `events`, `ui`, `workflow`, `visibility` | One diagram view, or its resolved model as JSON. See [Architecture diagrams](./architecture-diagrams.md). | `bc-atlas-<view>.svg` | `svg`, `d2`, `json`, `png`, `pdf` |

```text
bca export ./app -o atlas.html
bca export ./app --view report --codegraph
bca export ./workspace --view explorer --history -o dependencies.html
bca export ./workspace --view explorer --history-by releases -o releases.html
bca export ./app --view module -o modules.svg
bca export ./app --view workflow --entry ProcessDocument -o workflow.svg --watch
bca export ./app --view project --format json > model.json
bca export ./app --view catalog -o docs/codegraph
bca export ./app --view handbook -o docs/handbook
bca export ./app --view knowledge-graph -o atlas.owl
```

#### Output

| Option | Value | Description |
| --- | --- | --- |
| `--view` | what | `app`, `report`, `explorer`, `catalog`, `handbook`, `knowledge-graph`, or a diagram view. Default: `app`. |
| `-o`, `--output` | path | Output file or folder (defaults above). `-` writes JSON to stdout. |
| `-f`, `--format` | format | `html`, `d2`, `json`, `svg`, `png`, or `pdf`, as the view allows; `ttl`, `rdf`, `owl`, `nt`, or `jsonld` for the knowledge graph. Inferred from the output extension when omitted. |
| `--catalog` | folder | Handbook: link object names to the object catalog in this folder, as `bca export --view catalog` (or `--view report --codegraph`, in `objects/`) writes it. |
| `--language` | tag | Handbook: language of the pages, `en` (default) or `de` (`de-DE`). |
| `--base-iri` | IRI | Knowledge graph: base IRI of the exported resources. Default: `urn:bc-atlas:`. |
| `--no-evidence` | flag | Knowledge graph: leave out the `bca:Relation` resources with each relation's file, line, and operations; the direct relation triples stay. |
| `--title` | text | Title of the report, explorer, or diagram. |
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
| `--handbook` | flag | Also write the [system handbook](./handbook.md) to `<output>/handbook`; with `--codegraph`, its object names link to the catalog. |
| `--json` | flag | Also write the resolved project model to `model.json`. |

`--format svg` (default) or `d2` selects the diagram format; `d2` skips SVG
rendering.

#### Explorer and timeline

| Option | Value | Description |
| --- | --- | --- |
| `--lens` | lens | Relationship family. Default and currently only value: `dependency`. |
| `--propose` | flag | Show a proposed target architecture (components, layers) when `.bca.json` defines none. With an `architecture` section, the explorer always shows it. |
| `--group-by` | mode | With `--propose`: how the proposal groups objects, `auto` (default), `namespace`, `folder`, `module`, or `app`. |
| `--history` | flag | Replay Git history, one frame per step that changed AL files or `app.json`. |
| `--history-by` | mode | `commits` (default), `prs` (one frame per merged pull request), or `releases` (one frame per release tag, plus unreleased commits). Implies `--history`. |
| `--last` | integer | Only the last n steps. |
| `--max-commits` | integer | Most frames to replay; older steps are sampled evenly. Default: `60`. |
| `--since` | date | Only replay commits after this date (`git log --since` syntax). |

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
| `--compiler` | mode | `auto`, `off`, or a path: the AL compiler resolves calls for the call and workflow views and the explorer. See [AL toolchain](./al-toolchain.md). Default: `auto`. |
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
bca view ./app                                            # what there is to see: lenses, stories, sources
bca view ./app --lens data                                # the Data lens as text: nodes by group, what each does
bca view ./app --lens health --check                      # the findings with their fixes, on the objects they are about
bca view ./app --lens data --form diagram -o data.svg     # the same lens as a picture
bca view ./app --inside codeunit:50100 --form diagram -o posting.png
bca view ./app --inside component:Core                    # a component, an app, or a namespace: its objects
bca view ./app --lens sync                                # a lens of a plugin: the recordings of Business Central
bca view ./app --focus "table:Sales Header" --depth 2 --format json
bca view ./app --story fix                                # a story, step by step
bca view ./app --story run:Ben --step 13 --form diagram -o stopped.svg   # a run of the simulation, as that step built it
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
| `--lens` | id | What the graph shows: `system` (default), `components`, `apps`, `modules`, `data`, `calls`, `events`, `contracts`, `pages`, `security`, `visibility`, `health`, `processes`, `people`, `requirements`, `simulation`, `run`, and the lenses of plugins, such as `sync` (the recordings of Business Central). A lens with nothing in it does not exist for a project; `bca view` without options lists the lenses a project has. |
| `--inside` | node | Go into one node. An object opens to its procedures, triggers, and events, and what each does with other objects; an app, a component, or a namespace opens to its objects and what they do with each other. A name, an ID, or a selector such as `codeunit:50100` or `component:Core`. |
| `--focus` | node | Only this node and what is near it. A name, an ID, or a selector such as `table:Customer`, `component:Core`, or `person:Anna`. |
| `--depth` | n | How many steps from the `--focus` node. Default: `1`. |
| `--find` | text | In a picture, the nodes whose name, type, component, namespace, or ID match stand out; a list holds only them. |
| `--hide` | kinds | Kinds of node to leave out, as the legend names them (`codeunit`, `table`, `other apps`), comma-separated or repeated. |
| `--off` | kinds | Kinds of relation to leave out (`uses`, `reads`, `permits`), comma-separated or repeated. |
| `--check` | flag | In a picture, a ring on every node with a finding; in text, the findings with their fixes below each node. |
| `--story` | id | A story instead of a lens: its steps with their texts. The overview lists the stories of the project. `run:<agent>` is the [run](./battle-test.md#a-run-step-by-step) of the simulation of one person. |
| `--step` | n | One step of the `--story`, from 1: its nodes, in its lens. For a run, the picture holds what the run reached at that step. |
| `--stories` | flag | Every story of the system as one document (`text`, `md`, or `json`). |
| `--form` | form | The form of a picture: `2d` (default), `diagram`, or `3d`. |
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
| `--view` | | Also write `view.html`, the BC Atlas view of the working tree as one offline file. A state of the past always has it. |
| `-f`, `--format` | `text`, `json` | What the command reports. |

The same source gives the same files, byte for byte: a run changes only what
changed and removes what it wrote before and no longer writes. A state of
the past is read from a temporary checkout (`git worktree`); the working
tree is not touched. `layers` is also a task of [`run`](#run).

### `bundle`

```text
bca bundle [app-root] [-o <folder>] [--test-results <path>]... [--include <path>]... [options]
```

Everything BC Atlas makes of a project, end to end, as one artifact: one
folder and one ZIP file with a manifest. See
[The bundle](./bundle.md).

```sh
bca bundle ./app                                  # bc-atlas-bundle/ and bc-atlas-bundle.zip
bca bundle ./app -o out/atlas --test-results TestResults.xml --include output/MyApp.app
bca bundle ./app --no-zip --format json
```

| Option | Value | Meaning |
| --- | --- | --- |
| `-o`, `--output` | path | The folder of the bundle; the ZIP file gets the same name with `.zip`. The folder is replaced. Default: `bc-atlas-bundle`. |
| `--test-results` | path | Results of tests that really ran (JUnit or xUnit XML): a file or a folder. They are counted, and a failed test fails the bundle. Repeatable. |
| `--include` | path | Files or folders that belong to the bundle: the `.app` file, compiler output, logs. Repeatable. |
| `--no-zip` | | Write the folder only. |
| `--no-narrative` | | Do not ask the model of the ai plugin for narrative pages, even when one is set up. |
| `--pictures` | `auto`, `all`, `none` | Pictures of single objects in the documentation. |
| `--title` | text | Title of the bundle. Default: the name of the app. |
| `-f`, `--format` | `text`, `json` | What the command reports; `json` is the manifest. |

Steps: validation, simulation, snapshots from the source, documentation,
narrative, tests that ran, build outputs. A step that does not apply is
skipped and says why. Exit code 1 means a step failed; the bundle is written
all the same.

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

### `run`

```text
bca run [app-root] --trigger pre-commit|pre-push|ci|schedule|manual
bca run [app-root] --tasks check,simulate,report [--sync verify]
```

Runs the tasks configured for a trigger in `.bca.json` and syncs their output.
Git hooks, schedules, pipelines, and the GitHub Action all call this command.
See [Automation](./automation-and-ci.md).

| Option | Value | Description |
| --- | --- | --- |
| `--trigger` | `pre-commit`, `pre-push`, `ci`, `schedule`, `manual` | Trigger whose tasks and sync mode are used. Default: `manual`. |
| `--tasks` | list | Run these tasks instead: `check`, `simulate`, `report`, `docs`, `codegraph`, `handbook`, `diagrams`, `sync`. |
| `--sync` | `none`, `verify`, `stage`, `artifact`, `pull-request`, `commit` | Override the sync mode. |
| `--config` | path | Configuration file. |
| `--format` | `text` or `json` | Output mode. Default: `text`. |

Exits with `1` when a task fails, `check` or `simulate` finds blocking issues,
or `verify` finds outdated generated files.

### `plugins list`, `plugins show`, `plugins doctor`, `plugins new`

```text
bca plugins list [app-root]
bca plugins show <plugin-id> [--project-root <path>]
bca plugins doctor [app-root]
bca plugins new <plugin-id> [-o <folder>] [--dry-run]
```

Manage [plugins](./plugins.md): `list` shows every plugin of the project
(built-in, npm `bc-atlas-plugin-*`, `.bca.json`, `BCA_PLUGINS`) and what it
contributes; `show` shows one plugin's manifest; `doctor` loads and activates
every plugin and checks each declared contribution and its `.bca.json` section;
`new` creates a working plugin from the template.

| Option | Value | Description |
| --- | --- | --- |
| `--project-root` | path | Project whose plugins are listed (`show`). Default: `.`. |
| `--output`, `-o` | path | Folder of the new plugin (`new`). Default: `plugins/<plugin-id>`. |
| `--dry-run` | flag | List the files without writing them (`new`). |
| `--config` | path | Configuration file. |
| `--format` | `text` or `json` | Output mode. Default: `text`. |

`doctor` exits with `1` when a plugin cannot be loaded or activated, or a
declared contribution is not implemented.

### `sync plan`, `sync run`, `sync status`, `sync describe`

```text
bca sync plan [app-root] [--trigger ci] [--channel <id>]
bca sync run [app-root] [--trigger ci] [--channel <id>] [--force]
bca sync status [app-root] [--channel <id>]
bca sync describe
```

Commands of the built-in [sync plugin](../plugins/sync/README.md): Business
Central process recordings (fact snapshots) into documents, BC Atlas UI tests,
the architecture layer, and a process index. What, when, and how is the `sync`
section of `.bca.json`; the `sync` task of `bca run` uses the same channels, so
hooks, pipelines, and schedules deliver the output with their sync mode. `plan`
and `status` write nothing; `status` looks at every channel regardless of the
trigger; `describe` lists the sources, triggers, conditions, and formats a
manifest can use, including those of other plugins.

| Option | Value | Description |
| --- | --- | --- |
| `--trigger` | `pre-commit`, `pre-push`, `ci`, `schedule`, `manual` | Trigger whose channels run (`plan`, `run`). Default: `manual`. |
| `--channel` | id | Only this channel, ignoring the trigger. Repeatable. |
| `--force` | flag | Rewrite every process, whatever the channel condition says (`run`). |
| `--config` | path | Configuration file. |
| `--format` | `text` or `json` | Output mode. Default: `text`. |

### `ai status`, `ai context`, `ai write`

```text
bca ai status [app-root]
bca ai context [app-root] [--subject <id>]
bca ai write [app-root] [--subject <id>] [--output <folder>] [--force] [--dry-run]
```

Commands of the built-in [AI plugin](../plugins/ai/README.md): narrative
documentation written by a language model from the facts BC Atlas reads from
the source. BC Atlas itself calls no model; this plugin is the one place one
is called, through one OpenAI-compatible endpoint, so a gateway can route to
any model of any provider. `status` shows the endpoint, the model, whether a
key is set, and the subjects; `context` prints the grounding of a subject
and calls no model; `write` writes one page per subject next to the
grounding it was written from, and again only when the grounding, the
model, or the language changed. The `ai` task of `bca run` writes the same
pages.

| Option | Value | Description |
| --- | --- | --- |
| `--subject` | id | What to write about: `system`, or `process:<id>` (see `bca ai status`). Default: every subject. Repeatable. |
| `--output` | path | Folder of the pages (`write`). Default: `ai.outputDir`, else `docs/narrative`. |
| `--force` | flag | Write a page again although its grounding and model did not change (`write`). |
| `--dry-run` | flag | Call no model and write nothing; say which pages would be written (`write`). |
| `--config` | path | Configuration file. |
| `--format` | `text` or `json` | Output mode. Default: `text`. |

The endpoint, the model, and the key come from the `ai` section of
`.bca.json` or from `BCA_AI_ENDPOINT`, `BCA_AI_MODEL`, and `BCA_AI_API_KEY`.
The key is never read from `.bca.json`.

### `update`

```text
bca update [app-root] [--check] [--yes] [--dry-run] [--format json]
```

Asks the npm registry for the latest version and shows the release notes
between the installed and the latest version. After confirmation it:

1. updates the installation: the `bc-atlas` dependency in the project's
   `package.json` when it declares one (`npm install --save-dev bc-atlas@^x`),
   otherwise the global installation (`npm install --global bc-atlas@x`);
2. runs `bca setup apply --from-config` with the new version, so hooks, VS Code
   tasks, pipelines, and agent commands reference it.

A source checkout is not changed; update it with `git pull` and `npm ci`.

| Option | Value | Description |
| --- | --- | --- |
| `--check` | flag | Only report; exit code `1` when an update is available. |
| `--yes` | flag | Update without asking. Without a terminal and without `--yes`, nothing is installed. |
| `--dry-run` | flag | Show the commands an update would run. |
| `--format` | `text` or `json` | Output mode. Default: `text`. |

Other commands print a one-line notice in interactive terminals when a newer
version exists. The check runs at most once a day in the background. It is off
in CI, Git hooks, `bca run`, `--format json`, and when `BCA_NO_UPDATE_CHECK`
or `NO_UPDATE_NOTIFIER` is set.

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
another file. `bca setup` creates a starter file. The root accepts the camelCase
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
| `automation` | `hooks`, `ci`, and `triggers` (`pre-commit`, `pre-push`, `ci`, `schedule`), each with `tasks`, `sync`, and for `schedule` a `cron`. Written by `bca setup`. |
| `docs` | Settings for the `docs` task of `bca run`: `tests`, `app`, `export`, `as`, `language`, `title`, `outputDir`. |
| `simulation` | The company for `bca simulate`: `company`, `tests`, `taskGroups`, `roles`, `agents`, `requirements`, `fullAccess`, `otherApps`, `failOn`, `language`, `outputDir`. See [Battle test](./battle-test.md#describe-your-company). |
| `codegraph` | `outputDir` for the `codegraph` task. |
| `diagrams` | List of `export` diagram option objects with a `view` and an `output`, rendered by the `diagrams` task. |
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
