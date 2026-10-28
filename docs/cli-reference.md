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
| Get started | `app` | Open the BC Atlas app in the browser for one project. Default command: `bca <app-root>`. |
| Get started | `setup` | Set up a project interactively, or with `--yes`: `.bca.json`, Git hooks, pipelines, schedules. |
| Get started | `setup plan` | Detect the project and list setup questions with recommended answers. |
| Get started | `setup apply` | Write `.bca.json`, Git hooks, and a pipeline from setup answers. |
| Get started | `setup agent` | Add a `/bca-setup` command for Claude Code, Copilot, or Cursor. |
| Analyze | `check` | Score architecture health and fail CI on cycles, policy violations, architecture violations, or diagnostics. |
| Analyze | `architecture` | Find a target architecture, list every dependency that points the wrong way with how to resolve it, and enforce it with a baseline. |
| Export | `export` | Write what the app shows as files: the app as one offline HTML file, the Markdown report, the 3D explorer, the object catalog, a diagram, or the resolved model as JSON. |
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
bca app [app-root] [options]        # or: bca <app-root> [options]
bca setup [app-root] [--yes] [--dry-run]
bca setup plan [app-root] [options]
bca setup apply [app-root] [options]
bca setup agent [app-root] [options]
bca check [app-root] [options]
bca architecture [app-root] [options]
bca export [app-root] [--view <what>] [-o <path>] [options]
bca docs <command> <test-root> [options]
bca docs glossary [options]
bca run [app-root] [options]
bca update [app-root] [options]
bca mcp
bca help [<command>] [--format json]
```

### Earlier commands

Several commands are now part of `app` and `export`:

| Before | Now |
| --- | --- |
| `bca init` | `bca setup` (it writes `.bca.json`), or `bca setup apply --hooks none --ci none --editor none --schedule none` for the file alone |
| `bca report` | `bca export --view report` (`--output-dir` is now `-o`) |
| `bca graph`, `bca <app-root>` with diagram options | `bca export --view <view>`; `bca <app-root>` now opens the app |
| `bca watch` | `bca export --view <view> --watch`, or the app, which updates itself |
| `bca explore` | `bca export --view explorer`, or the app's Dependencies page |
| `bca inspect` | `bca export --view <view> --format json` (stdout) |
| `bca codegraph` | `bca export --view catalog` (`--output-dir` is now `-o`) |
| `bca capabilities` | `bca help --format json` |

### Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Success. |
| `1` | Operation failed, or a check (`check`, `architecture`, `docs validate`) found blocking issues. |
| `2` | Invalid usage: unknown command, unknown option, invalid enum value, or missing required value. |

Global flags: `-h`, `--help` shows help; `-V`, `--version` shows the version.

## Get started

### `app`

```text
bca app [app-root] [--port <port>] [--no-open]
bca <app-root>
```

Analyzes the project, starts a local web server, and opens the BC Atlas app
in the browser: overview, health, architecture, 3D dependencies, diagrams,
objects, and docs on one screen. The app re-analyzes when AL files,
`app.json`, `.bca.json`, or the architecture baseline change, and open pages
refresh. Stop it with `Ctrl+C`. See [The BC Atlas app](./app.md).

| Option | Value | Description |
| --- | --- | --- |
| `--port` | port | Port on localhost. Default: `4317`, or the next free one. |
| `--no-open` | flag | Print the URL without opening a browser. |
| `--paths` | path or glob | Only analyze AL files in these folders. Repeatable. |
| `--namespace`, `--type`, `--include`, `--exclude` | glob | Filters, as for `export`. |
| `--project-root` | path | Analyze a wider workspace; the positional path becomes the focus. |
| `--config` | path | Configuration file. |

The server listens on `127.0.0.1` only. Changes from the app (adopting an
architecture, accepting violations) need a token that only the page the
command served knows.

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
resolution strategy, plus clean-architecture metrics per component. Exits with
`1` when the configured architecture has violations that are not in the
baseline. See [Clean architecture](./clean-architecture.md).

```text
bca architecture ./app --propose --format markdown -o architecture.md
bca architecture ./app --propose --write --update-baseline
bca architecture ./app --format json
```

| Option | Value | Description |
| --- | --- | --- |
| `-f`, `--format` | format | `text`, `markdown`, or `json`. Default: `text`. |
| `-o`, `--output` | path | Write the report to a file instead of stdout. |
| `--propose` | flag | Propose an architecture even when `.bca.json` defines one. |
| `--group-by` | mode | `auto`, `namespace`, `folder`, `module`, or `app`. Default `auto`: modules (or apps), and any that is still too large split by namespace. |
| `--depth` | integer | Namespace or folder segments per component. Default: split until no component holds more than 15% of the objects. |
| `--min-objects` | integer | Merge smaller groups into the component they depend on most. Default: `1`. |
| `--write` | flag | Save the architecture to the `architecture` section of `.bca.json`. |
| `--update-baseline` | flag | Accept today's violations in `.bca-architecture-baseline.json`; only new ones fail afterwards. |
| `--paths` | path or glob | Only analyze AL files in these folders. Repeatable. |
| `--namespace`, `--type`, `--include`, `--exclude` | glob | Filters, as for `export`. |
| `--project-root` | path | Analyze a wider workspace. |
| `--config` | path | Configuration file. |

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
| `--namespace`, `--type`, `--include`, `--exclude` | glob | Filters, as for `export`. |
| `--project-root` | path | Analyze a wider workspace. |
| `--config` | path | Configuration file. |
| `--strict` | flag | Shortcut for `--fail-on warning`. |

## Export

### `export`

```text
bca export [app-root] [--view <what>] [-o <path>] [options]
```

Writes what the app shows as files. `--view` selects what:

| `--view` | Writes | Default output | Formats |
| --- | --- | --- | --- |
| `app` (default) | The app as one self-contained, offline HTML file: every page, the report diagrams, the 3D explorer, and the docs. | `bc-atlas.html` | `html` |
| `report` | Markdown report: `README.md` with an at-a-glance table, one section and diagram per view, the health summary, and a regeneration command. See [Architecture reports](./reports.md). | `docs/atlas` | `svg` or `d2` diagrams |
| `explorer` | The interactive 3D dependency explorer, or its graph document. See [Dependency explorer](./dependency-explorer.md). | `bc-atlas-explorer.html` | `html` or `json` |
| `catalog` | One linked Markdown page per AL object. See [Code Graph](./code-graph-markdown-design.md). | `docs/codegraph` | Markdown |
| `project`, `module`, `object`, `data`, `call`, `boundary`, `contracts`, `events`, `ui`, `workflow` | One diagram view, or its resolved model as JSON. See [Architecture diagrams](./architecture-diagrams.md). | `bc-atlas-<view>.svg` | `svg`, `d2`, `json`, `png`, `pdf` |

```text
bca export ./app -o atlas.html
bca export ./app --view report --codegraph
bca export ./workspace --view explorer --history -o dependencies.html
bca export ./workspace --view explorer --history-by releases -o releases.html
bca export ./app --view module -o modules.svg
bca export ./app --view workflow --entry ProcessDocument -o workflow.svg --watch
bca export ./app --view project --format json > model.json
bca export ./app --view catalog -o docs/codegraph
```

#### Output

| Option | Value | Description |
| --- | --- | --- |
| `--view` | what | `app`, `report`, `explorer`, `catalog`, or a diagram view. Default: `app`. |
| `-o`, `--output` | path | Output file or folder (defaults above). `-` writes JSON to stdout. |
| `-f`, `--format` | format | `html`, `d2`, `json`, `svg`, `png`, or `pdf`, as the view allows. Inferred from the output extension when omitted. |
| `--title` | text | Title of the report, explorer, or diagram. |
| `--watch` | flag | Write again whenever AL source, `app.json`, or `.bca.json` changes. Stop with `Ctrl+C`. |
| `--debounce` | milliseconds | Delay before writing again with `--watch`. Default: `250`. |

- A diagram view with `--format json` and no `--output` prints the resolved
  model to stdout (progress goes to stderr), for scripts.
- D2, JSON, and SVG use bundled functionality; PNG and PDF require the `d2`
  executable on `PATH`.
- If `--format` conflicts with the extension, the format wins:
  `-o calls.d2 --format svg` writes `calls.svg` and keeps `calls.d2`.
- Rendered diagrams always keep the generated `.d2` source next to them.
- The object catalog replaces its folder atomically; BC Atlas refuses to
  replace a non-empty folder that has no generated `index.md`.

#### Report

| Option | Value | Description |
| --- | --- | --- |
| `--views` | list | Comma-separated views: `project`, `module`, `data`, `contracts`, `events`, `ui`, `call`. Default: all except `call`. |
| `--codegraph` | flag | Also write the linked object catalog to `<output>/objects`. |
| `--json` | flag | Also write the resolved project model to `model.json`. |

`--format svg` (default) or `d2` selects the diagram format; `d2` skips SVG
rendering.

#### Explorer and timeline

| Option | Value | Description |
| --- | --- | --- |
| `--lens` | lens | Relationship family. Default and currently only value: `dependency`. |
| `--propose` | flag | Show a proposed target architecture (components, layers) when `.bca.json` defines none. With an `architecture` section, the explorer always shows it. |
| `--group-by` | mode | With `--propose`: how the proposal groups objects, `auto` (default), `namespace`, `folder`, `module`, or `app`. |
| `--history` | flag | Replay Git history, one frame per step that changed AL files or `app.json`. Also for `--view app`. |
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
| `--focus` | text | Restrict the `contracts`, `events`, or `ui` view to matching names. |
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
bca run [app-root] --tasks check,report [--sync verify]
```

Runs the tasks configured for a trigger in `.bca.json` and syncs their output.
Git hooks, schedules, pipelines, and the GitHub Action all call this command.
See [Automation](./automation-and-ci.md).

| Option | Value | Description |
| --- | --- | --- |
| `--trigger` | `pre-commit`, `pre-push`, `ci`, `schedule`, `manual` | Trigger whose tasks and sync mode are used. Default: `manual`. |
| `--tasks` | list | Run these tasks instead: `check`, `report`, `docs`, `codegraph`, `diagrams`. |
| `--sync` | `none`, `verify`, `stage`, `artifact`, `pull-request`, `commit` | Override the sync mode. |
| `--config` | path | Configuration file. |
| `--format` | `text` or `json` | Output mode. Default: `text`. |

Exits with `1` when a task fails, `check` finds blocking issues, or `verify`
finds outdated generated files.

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
| `layout` | D2 layout engine: `dagre` or `elk` for SVG; any D2 layout for PNG/PDF. |
| `theme` | D2 theme ID. |
| `forbiddenDependencies` | Dependency policy rules; see [Configuration](./configuration.md#check-dependency-rules). |
| `workflow` | Workflow defaults: `entries`, `depth`, `maxNodes`, `maxEdges`, `edgeTypes`, `phases`, `stop`, `collapse`. |
| `check` | Health-check defaults: `failOn`, `cycles` (`error`, `warning`, `info`, `off`), `maxFanIn`, `maxFanOut`. |
| `automation` | `hooks`, `ci`, and `triggers` (`pre-commit`, `pre-push`, `ci`, `schedule`), each with `tasks`, `sync`, and for `schedule` a `cron`. Written by `bca setup`. |
| `docs` | Settings for the `docs` task of `bca run`: `tests`, `app`, `export`, `as`, `language`, `title`, `outputDir`. |
| `codegraph` | `outputDir` for the `codegraph` task. |
| `diagrams` | List of `export` diagram option objects with a `view` and an `output`, rendered by the `diagrams` task. |
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
