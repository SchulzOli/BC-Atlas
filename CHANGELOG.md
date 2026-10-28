# Changelog

All notable changes to BC Atlas will be documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project
follows [Semantic Versioning](https://semver.org/).

## Unreleased

### Added

- `bca app`: BC Atlas as an app in your browser. One look and feel for
  everything the tool does: an overview, health findings, the architecture
  (layers, work items, components; adopt a proposal or accept violations with
  one click), the 3D dependency explorer, diagrams for every view with zoom
  and pan, a searchable object list with one page per object (dependencies,
  members, violations, source links), and the UI-test documentation. It
  re-analyzes when AL files change and open pages refresh. `bca <app-root>`
  opens it. The server listens on localhost only; changes need the page's
  token.
- `bca export`: one command for every file output. `--view app` (default)
  writes the app as one offline HTML file to share or publish from CI;
  `report`, `explorer`, `catalog`, and the ten diagram views write what the
  former commands wrote; `--watch` writes again on every change.
- The Git timeline can step by merged pull request (`--history-by prs`:
  GitHub, Azure DevOps, GitLab, and squash merges, with the number of commits
  each brought) or by release tag (`--history-by releases`, plus unreleased
  commits); `--last n` keeps the most recent steps. The app's Dependencies
  page has the same choice.
- Explorer: a Spacing slider (50 % to 500 %) gives crowded graphs room:
  longer links, longest between large nodes, stronger repulsion, and more
  distance between clusters and floors.
- One design system (`src/ui/theme.css`) for the app, the explorer, and the
  HTML documentation, with light and dark themes.

- `bca architecture`: clean architecture for AL apps. Define components
  (namespace, folder, app, module, type, or object selectors), layers, and
  allowed dependencies in `.bca.json`, or let BC Atlas propose them from
  today's dependencies (`--propose`, weighted feedback arc set and layering).
  Every dependency that points outward, sideways, or undeclared becomes a work
  item with a resolution strategy in AL terms: declare the dependency, move an
  extension, subscriber, permissions, or navigation, move a related field into
  a table extension, move an object, or invert the dependency with an
  interface or event. Reports instability, abstractness, and distance per
  component and which components can become apps of their own; text,
  Markdown with a Mermaid diagram, and JSON.
- `--write` saves the architecture to `.bca.json`; `--update-baseline`
  accepts today's violations. `bca check` fails on new violations, reports
  fixed ones so the baseline only shrinks, and warns about component cycles.
- The dependency explorer shows the architecture: a Components level, violating edges
  in red with their resolution, an Architecture panel with the largest work
  items, violations per commit on the timeline, and architecture layers as a
  layout. The MCP server offers `bc_atlas_architecture`.

- Dependency explorer (`bca export --view explorer`, and the app's
  Dependencies page): an interactive 3D dependency explorer in one
  self-contained, offline HTML file. Dependencies inside one app are kept apart from
  dependencies across apps, which are checked against `app.json`: `declared`,
  `implicit` (Microsoft apps), `undeclared`, and `unresolved`. Switch between
  an object level and an app level; filter by app, dependency class, object
  type, and relation kind; search, isolate neighborhoods, and inspect the
  evidence behind every edge.
- `--history` replays Git history as a fourth dimension: one frame per commit
  that changed AL files or `app.json`, with added, changed, and removed
  objects highlighted. Without Git, the timeline replays the build order.
- `--format json` writes the `bc-atlas.graph` document: a temporal graph with
  presence spans, PageRank, Louvain communities, build layers, and cycles,
  built with graphology. The MCP server offers it as `bc_atlas_explore`.
- `examples/multi-app`, a three-app workspace, and its explorer example.
- Nested `app.json` files are modules of the enclosing app, as in BCApps'
  System Application and Base Application. The explorer adds a module level,
  checks module dependencies against the module manifests, and marks
  dependencies between modules of one app as `cross-module`.
- Platform system objects (`Integer`, `Date`, `Field`, `AllObjWithCaption`,
  `Company`, ...) and `System "..."` permissions count as implicit
  dependencies instead of unresolved ones.
- `--paths` analyzes and replays only some folders of a large
  repository. Large explorer files embed their graph gzip-compressed and start
  on the module level.

- `bca docs generate` draws every scenario as a flow of its clicks in BPMN
  notation ("At a glance"): user tasks, milestones for `[THEN]` between
  `[WHEN]` phases, loop markers for repeated blocks, and wrapping rows for long
  flows.
- Every use case gets a process diagram with one lane per permission set, the
  scenarios in `[NEXT]`/`[REQUIRES]` order, and an exclusive gateway where
  `[ALTERNATIVE]` paths branch. In HTML, each scenario links to its guide.
- `--export bpmn`: `use-case-<feature>.bpmn`, a BPMN 2.0 file with diagram
  layout and colors for Camunda Modeler, bpmn.io, and Signavio. Each scenario
  is a collapsed sub-process; double-click it to see its clicks as user tasks.

### Changed

- Fewer commands: 9 instead of 15. `bca report`, `bca graph`, `bca watch`,
  `bca inspect`, and `bca codegraph` are now `bca export --view report`,
  `--view <view>`, `--watch`, `--format json`, and `--view catalog`; `-o`
  replaces `--output-dir`. `bca init` is part of `bca setup`, and
  `bca capabilities` is `bca help --format json`. `bca <app-root>` opens the
  app instead of writing a diagram. See the table in the CLI reference.
- The journey diagram shows each scenario with its permission set and number
  of steps. `[NEXT]` and `[REQUIRES]` between the same scenarios are one
  arrow in flow direction; `[ALTERNATIVE]` and `[RELATED]` are dashed lines.

### Fixed

- Namespace-qualified references such as
  `Record Microsoft.Sales.Document."Sales Header"`,
  `TableData Microsoft.Sales.Document."Sales Line" = R`, and
  `Database::Microsoft.Sales.Document."Sales Header"` resolve to their object
  instead of an unresolved object named `Microsoft`.
- The call view no longer slows down quadratically on large apps: resolving
  calls in the Base Application takes about 2.5 instead of 70 seconds.

- Steps on quoted fields and actions, such as
  `SalesOrder."Sell-to Customer No.".SetValue(...)`, are no longer dropped from
  generated documentation.

## 0.7.0 - 2026-10-04

### Added

- Documentation website on GitHub Pages
  (https://schulzoli.github.io/BC-Atlas/), built with VitePress from the
  repository Markdown, with search, a sidebar by feature area, and the
  generated examples.
- `bca setup`: guided setup of features, Git hooks (Husky or plain Git),
  pipelines (GitHub Actions or Azure Pipelines), cron schedules, and sync of
  generated files, as a terminal wizard or with `--yes`.
- `bca setup plan` and `bca setup apply`: the same setup as detectable facts,
  questions with recommendations, and a validated, idempotent apply with
  `--dry-run`.
- `bca setup --editor vscode`: VS Code tasks for the local loop: health check
  with findings in the Problems panel, report and docs builds, hook dry runs,
  a live architecture diagram, and the setup wizard. Existing tasks are kept.
- `bca setup agent --agent claude|copilot|cursor`: a `/bca-setup` command that
  lets the user's AI agent guide the setup through the CLI.
- `bca run --trigger pre-commit|pre-push|ci|schedule`: one entry point for
  every trigger, configured in the new `automation` section of `.bca.json`,
  with `verify` and `stage` sync and `docs`, `codegraph`, and `diagrams` tasks.
- A GitHub Action (`uses: SchulzOli/BC-Atlas@v0.7.0`) with `outputs` and
  `passed` outputs.
- MCP tools `bc_atlas_setup_plan`, `bc_atlas_setup_apply`, `bc_atlas_run`, and
  `bc_atlas_update_check`.
- Update cycle: interactive commands show a notice when a newer version is
  available (checked at most once a day in the background, off in CI, hooks,
  `bca run`, and JSON output, or with `BCA_NO_UPDATE_CHECK`).
- `bca update`: release notes since the installed version, a confirmed update
  of the global or project installation, and regenerated hooks, VS Code tasks,
  pipelines, and agent commands. `--check` exits with `1` when an update exists.
- `bca setup --updates dependabot`: Dependabot pull requests for new
  `bc-atlas` versions; `bca setup apply --from-config` reproduces an existing
  setup.
- With a `package.json` that declares `bc-atlas`, generated pipelines and VS
  Code tasks use that version (`npm ci`, `npx --no-install bca`).
- `bca docs generate` presents scenarios in the structure of an OASIS DITA 1.3
  task topic (prerequisites, steps, step results, result, related links).
  The AL tags are unchanged.
- `--export markdown,html,dita,ado-csv`: Markdown, one self-contained HTML
  file, DITA 1.3 task topics with a map, and an Azure DevOps Test Plans CSV.
- `--as testcase`: test case specification with preconditions, an
  action/expected result/pass-fail table, and a sign-off block.
- `--app`: real page, field, part, and action captions and tooltips from the
  app's AL source, plus page and action coverage in the index.
- `--language`: German and English wording; captions and tooltips from the
  app's XLIFF translations.
- Use-case pages per `[FEATURE]`, a journey diagram of scenario links, and
  indexes by page and permission set.
- `[THEN]` between two `[WHEN]` phases becomes the result of that phase.
- The MCP tool `bc_atlas_docs_generate` accepts formats, mode, app, and
  language.
- Generated example documentation in `examples/docs`.

### Changed

- Instructions follow Business Central help conventions ("Choose the 🔍
  icon, enter ...", "In the **Field** field, enter ...", "Choose the
  **Action** action."). Scenarios with one `[WHEN]` phase list their
  instructions as top-level steps; repeated blocks become sub-steps.
- Node.js 22 or later is required; Node.js 20 reached end of life in April 2026.
  The Docker image and generated pipelines use Node.js 24.
- CI runs once per pull request instead of twice, starts with one fast check
  job, then tests Node.js 22 and 24 on Linux and Node.js 24 on Windows.

## 0.6.0 - 2026-10-04

### Added

- `bca init` creates a `.bca.json` tailored to the project: app title, excluded
  test folders, and source links for GitHub, GitLab, or Azure DevOps remotes.
- `bca report` writes a static Markdown architecture report with an
  at-a-glance table, diagrams for six views, the health summary, and optional
  object catalog and JSON model.
- `bca check` evaluates architecture health (diagnostics, forbidden
  dependencies, cycles, fan-in/fan-out hot spots, orphans, unresolved
  references) with `--fail-on` levels and text, JSON, or Markdown output.
- `bca mcp` starts the MCP server; new MCP tools `bc_atlas_check` and
  `bc_atlas_report`.
- `bca help <command>` and per-command `--help` with grouped options and
  examples; `bca` without arguments shows all features by area.
- Feature areas and views in the `bca capabilities` contract.
- `check` and `report` sections in `.bca.json`.
- Example report in `examples/report`, regenerated by `npm run examples`.
- Public contribution, support, conduct, and security policies.
- Reproducible example project, generated diagrams, and feature screenshots.

### Changed

- Every command is defined once in `src/capabilities.js`; help, parsing, enum
  validation, the JSON contract, and generated docs derive from it.
- Commands only accept their own options and validate enum values; invalid
  usage exits with code `2`, failed operations and checks with `1`.
- `[app-root]` defaults to the current directory.
- Clearer errors for missing paths, empty results, and unknown commands.
- Several views of one project share a single parse.
- Documentation reorganized by feature area; repository URLs point to
  `SchulzOli/BC-Atlas`.
- The npm package ships only runtime files.
- Updated `@modelcontextprotocol/server`, `zod`, and `web-tree-sitter` (0.27).

### Removed

- The local web Control Center: `bca serve`, `bca docs serve`, and the
  `marked` and `dompurify` dependencies. Use `bca report` for a browsable
  overview.

### Fixed

- Rendering more than one SVG in a single process could exit early because the
  D2 worker was unreferenced between renders.
- `bca-mcp` did not start when invoked through an npm bin symlink.
- `codegraph` no longer deletes a non-empty output directory that it did not
  generate.

## 0.5.0 - 2026-07-30

### Added

- Project, module, object, data, call, boundary, contracts, events, UI, and
  workflow diagram views.
- D2, JSON, and WebAssembly-rendered SVG output.
- AL UI-test-to-Markdown documentation generation.
- Configuration, watch mode, diagnostics, dependency policies, and Docker
  support.
