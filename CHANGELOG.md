# Changelog

All notable changes to BC Atlas will be documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project
follows [Semantic Versioning](https://semver.org/).

## Unreleased

### Changed

- The architecture proposal comes from the relations, not from namespaces.
  Relations are typed (structural, data, behavioral, loose, administrative)
  and weighted; inside each app or module, the objects that are coupled more
  to each other than to the rest form a component (the best of several
  Louvain runs, refined object by object, with today's namespaces and
  folders competing as candidates). It works the same for apps without
  namespaces (type folders, ID blocks) and for a mix. `--group-by coupling`
  is now the same as `auto`; `namespace` and `folder` let the structure
  decide and place objects without one by their relations.
- A page or query and its source table are a relation of their own
  (`source`, weight 4) instead of a read.

### Added

- Shared core: objects that many components use but none owns (setup
  tables, master data) form a component of their own instead of gluing the
  others together.
- App candidates and namespaces: components that are coupled more to each
  other than to the rest could become one app together. Every proposed
  component gets a role (app, component, shared core) and a suggested
  namespace, in the JSON (`proposal.recommendations`), the reports, the
  component's description, and the Architecture page.
- `id:50100..50199` selects objects by ID range; proposals use it for code
  without namespaces or functional folders.

### Fixed

- The report no longer writes an absolute path into README.md when a view has
  too many nodes for the bundled SVG renderer: it keeps the view as D2, links
  it relative to the README, removes an SVG left by an earlier run, and the
  MCP report tool marks it `d2Only`.

## 0.8.0 - 2026-10-29

### Added

- Coupling weights: every dependency weighs what it takes to cut it
  (`writes` 5, `extends` 4, `relates`/`implements` 3, calls and reads 2,
  subscribers 1, permission grants 0.1; repeats count logarithmically;
  `architecture.couplingWeights` changes them). The proposal orders
  components, merges small groups, and finds objects that belong elsewhere
  by coupling; PageRank and communities use it too.
- `--group-by coupling`: components from namespaces that are tightly coupled
  to each other (Louvain communities on the coupling).
- Every architecture gets a score: cohesion per component, the share of the
  coupling inside components, and modularity, to compare groupings.
- Dependency explorer: in open space, what drifts together follows the
  color (apps, components, communities, types, build layers), groups are
  spread apart, and tightly coupled objects sit closer together.
- Dependency explorer: the new default layout **Open space** lets the graph
  float freely in a large space, like the large-graph example of
  3d-force-graph: small nodes, hairline links, apps or components that only
  drift together, and the camera frames the connected objects once the layout
  has settled. The filters start collapsed (☰ or `F`) so the graph has the
  whole window.
- Tools to split a monolith into apps (see the new guide
  [Split a monolith into apps](./docs/modularization.md) and the example
  `examples/monolith`):
  - **Data ownership:** for every table that other components use, who
    owns, writes, reads, relates to, and extends it; `bca check` reports
    tables other components write (`foreign-table-write`).
  - **Extraction plans:** `bca architecture --extract <component>` (and the
    MCP tool `bc_atlas_extraction_plan`, and the Architecture page) lists what
    moves, the blockers with their work items (including app cycles), the new
    app's `app.json` with a stable ID, dependencies, and `idRanges`, the tables
    whose data moves with `ObsoleteState = PendingMove`/`MovedTo`/`MovedFrom`,
    and the steps in order.
  - **Public surface:** per component, the objects other components use (its
    de facto API) and the objects that could be `Access = Internal`
    (`could-be-internal`). `bca refactor surface` (and MCP
    `bc_atlas_refactor_surface`) sets `Access = Internal` on them and writes
    the API to `exposes`. `bca architecture --update-surface` records the
    surface in `.bca-surface.json`; `bca check` then reports changes that
    break its users, like AppSourceCop for internal boundaries
    (`public-surface-change`: removed or internal objects, changed procedure
    signatures, removed events, fields, and enum values).
  - **`bca refactor move`:** moves an AL object to another component: its
    file, or the object cut out of a shared file, goes to the component's
    folder, its namespace becomes the component's, and referencing files get
    the `using` they need. Dry run by default; also the MCP tool
    `bc_atlas_refactor_move`. Work items that are moves carry the command.
- VS Code: the extension and its engine are bundled with esbuild; the
  `.vsix` holds about 50 instead of 1,200 files, and CI tests the packaged
  extension.
- More architecture rules in `bca check`, `bca architecture`, and the
  Architecture page:
  - **Public objects:** a component may use only public objects of another
    one: `internal-access` for objects with `Access = Internal` (no other app
    can see them) or outside the component's new `exposes` selectors.
  - **Strict layers:** `strictLayers` lets a component use only the layer
    directly below it (`layer-skip-dependency`).
  - **Rules of your own:** `architecture.rules` forbids dependencies by
    selectors, now also `component:` and `layer:`, with relation `kinds`
    (e.g. only `writes`), `except`, `across`, and a message and resolution
    (`dependency-rule`). Its violations are baselined like the others.
  - **Checks of the architecture:** empty components, unused selectors, unused
    or layer-contradicting `dependsOn` entries, declared cycles, components
    above `maxObjects`, and dependencies on less stable components. Checks of
    the configuration point at the component in `.bca.json`.
  - **Severities:** `architecture.severities` sets the severity of each rule
    or turns it off.
  - New strategies `use-public-api`, `go-through-layer`, and `follow-rule`;
    the report counts violations by rule.
- VS Code: the BC Atlas panel takes its design from the editor's color theme
  (background, text, borders, accent, selection, status colors, and fonts),
  for any theme including high contrast; the 3D explorer and the Docs page
  inside the panel follow too. Exported pages keep the BC Atlas design.
- VS Code: the BC Atlas side bar is the panel's navigation and marks the page
  it shows; the panel no longer repeats the pages in a navigation of its own.
- Microsoft's AL toolchain replaces BC Atlas's own analysis where it knows
  better. With the AL Language extension or the AL Development Tools
  installed (`al.compiler: auto`, the default), BC Atlas compiles a copy of the
  workspace in dependency order and:
  - resolves calls with the compiler's call graph (`al graph`): overloads,
    variables, interfaces, and built-in methods, which no longer show up as
    unresolved calls;
  - reports compiler errors and warnings and CodeCop, UICop, AppSourceCop, and
    PerTenantExtensionCop findings in `bca check`, with exact ranges and help
    links; compiler syntax errors replace tree-sitter parse errors.

  Results are cached by file content; nothing is written into the repository.
  `--compiler auto|off|<path>`, `BCA_AL_COMPILER`, and the `al` section of
  `.bca.json` choose the compiler; `--analyzers CodeCop,UICop` picks analyzers.
- `bca check --compiler-log <file|folder>` imports AL compiler error logs from
  any build (alc `/errorlog`, `al workspace compile --errorlogdirectory`,
  AL-Go, BcContainerHelper) without a compiler on the machine.
- `bca check --format sarif`: SARIF 2.1.0 with BC Atlas and AL findings for
  GitHub code scanning and Azure DevOps.
- AL settings like the AL Language extension reads them: `al.packageCachePath`
  (string or list) for symbols, `al.codeAnalyzers` with
  `al.enableCodeAnalysis`, `al.ruleSetPath`, and `al.assemblyProbingPaths`
  from `.vscode/settings.json` and `.code-workspace` files, whose `folders`
  also define the projects. The same symbol package in several caches loads
  once.
- VS Code: the extension uses the AL Language extension's compiler and the
  editor's `al.*` settings, compiles in the background after each change, and
  analyzes again after **AL: Download Symbols**, a new `.app`, or changed AL
  settings. Settings `bcAtlas.alCompiler` and `bcAtlas.alAnalyzers`. Compiler
  findings in the Problems panel are left to the AL Language extension.
- Generated GitHub Actions workflows and Azure Pipelines, and the BC Atlas
  GitHub Action (`al-compiler` input), install the AL Development Tools.
- BC Atlas for VS Code (`vscode/`, `SchulzOli.bc-atlas`): everything BC Atlas
  does, in the editor, with the engine inside. A panel with one look and feel
  for all of it: an overview, health findings, the architecture (layers, work
  items, components; adopt a proposal or accept violations with one click),
  the 3D dependency explorer, diagrams for every view with zoom and pan, a
  searchable object list with one page per object (dependencies, members,
  violations; open the source at its line), and the UI-test documentation.
  Findings in the Problems panel, CodeLens above AL objects, a status bar
  item, a side bar, commands for export, documentation, setup, and tasks,
  and the BC Atlas MCP server for agents in VS Code. The engine analyzes in
  a background process and the panel refreshes when AL files change.
  `bca setup --editor vscode` recommends the extension.
- `bca export`: one command for every file output. `--view app` (default)
  writes the BC Atlas pages as one offline HTML file to share or publish from CI;
  `report`, `explorer`, `catalog`, and the ten diagram views write what the
  former commands wrote; `--watch` writes again on every change.
- The Git timeline can step by merged pull request (`--history-by prs`:
  GitHub, Azure DevOps, GitLab, and squash merges, with the number of commits
  each brought) or by release tag (`--history-by releases`, plus unreleased
  commits); `--last n` keeps the most recent steps. The Dependencies page in
  VS Code has the same choice.
- Explorer: a Spacing slider (50 % to 500 %) gives crowded graphs room:
  longer links, longest between large nodes, stronger repulsion, and more
  distance between clusters and floors.
- One design system (`src/ui/theme.css`) for the VS Code panel, the explorer, and the
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

- Dependency explorer (`bca export --view explorer`, and the Dependencies
  page in VS Code): an interactive 3D dependency explorer in one
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

- `internal-access` is on by default: a configured architecture can report
  new violations where a component uses an `Access = Internal` object of
  another one. Accept them with `bca architecture --update-baseline`, or set
  `"severities": { "internal-access": "off" }` when components are layers of
  one app that never split.
- The *Publish VS Code extension* workflow signs in to the Marketplace with
  Microsoft Entra ID (GitHub OIDC, `vsce --azure-credential`) instead of the
  `VSCE_PAT` token, because Azure DevOps retires global personal access
  tokens on December 1, 2026. It needs the secrets `AZURE_CLIENT_ID` and
  `AZURE_TENANT_ID` and checks access to the publisher before publishing.
- A new BC Atlas icon and logo (an "A" drawn as a dependency graph with an
  orbit), used by the extension, its activity bar, and the panel. The
  extension has a Marketplace listing with screenshots, a banner, and a social
  preview image; sources and the render script are in `vscode/marketing/`.
- Fewer commands: 8 instead of 15. `bca report`, `bca graph`, `bca watch`,
  `bca inspect`, and `bca codegraph` are now `bca export --view report`,
  `--view <view>`, `--watch`, `--format json`, and `--view catalog`; `-o`
  replaces `--output-dir`. `bca init` is part of `bca setup`, and
  `bca capabilities` is `bca help --format json`. `bca <app-root>` is no
  longer a shortcut; the interactive views are in the VS Code extension. See
  the table in the CLI reference.
- The journey diagram shows each scenario with its permission set and number
  of steps. `[NEXT]` and `[REQUIRES]` between the same scenarios are one
  arrow in flow direction; `[ALTERNATIVE]` and `[RELATED]` are dashed lines.

### Fixed

- The warehouse example declares `using BCA.Example.UI;` for the page its
  permission set grants; the AL compiler reported it as missing.
- The 3D explorer inside the panel follows a dark theme: it now asks for the
  theme once its graph is unpacked, instead of missing the message sent while
  it was still loading.
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
