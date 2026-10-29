# BC Atlas for VS Code

The BC Atlas extension brings everything BC Atlas does into VS Code, where
AL developers already work. Open a folder with an `app.json` and BC Atlas
analyzes it; nothing else needs to be installed. The extension contains the
BC Atlas engine and runs it on VS Code's own Node.js runtime, in a background
process, so the editor stays responsive while large apps are analyzed.

Install **BC Atlas** (`SchulzOli.bc-atlas`) from the Extensions view, or
from a `.vsix` file with **Extensions: Install from VSIX…**. `bca setup` with
VS Code tasks also recommends it in `.vscode/extensions.json`.

## The BC Atlas panel

Open it with **BC Atlas: Open**, the BC Atlas icon in the activity bar, the
status bar item, or the BC Atlas button above an AL file. The pages are listed
in the BC Atlas side bar, which marks the page the panel shows; the panel
itself has no second navigation.

| Page | Shows | Same as |
| --- | --- | --- |
| Overview | Objects, apps, health, the architecture at a glance, the most connected objects, and next steps. | |
| Health | Every finding, filterable by severity, linked to its object. | `bca check` |
| Architecture | The configured architecture or a proposal: components in layers, work items with the steps to resolve them, data ownership, checks, the plan to extract a component as an app, components with Martin metrics, and objects that belong elsewhere. | `bca architecture` |
| Dependencies | The 3D dependency explorer: objects, modules, apps, and components; inside one app vs. across apps; a timeline by commit, pull request, or release. | `bca export --view explorer` |
| Diagrams | Every diagram view with zoom and pan: hover an object to light up its relations, click it to open its page, find objects by name, and click the legend to hide a kind of relation. Large views start with every group as one box: click a box to open the group, its name to close it, or **Open groups** and **Close groups**. **SVG**, **PNG**, and **D2** save the file. | `bca export --view <view>` |
| Objects | Every AL object, searchable and sortable, filtered by type, app, component, or violations. | |
| Object | One object: what it uses and what uses it, its wrong-way dependencies with steps to resolve them, fields, procedures, actions, and properties. **Open source** opens the file at the declaration; a procedure opens at its line. | `bca export --view object --object <selector>` |
| Docs | The guides from your AL UI tests, when the project has documented UI tests: the overview, every use case with its process, and every scenario, as a user guide or a test case, in English or German. **Open test** opens the AL test; **Markdown**, **DITA**, **BPMN**, and **SVG** save the page, **All as HTML** the whole documentation. | `bca docs generate` |

Diagrams and Docs work the same way: on the left, a list of the views or of
the use cases and scenarios, with a filter and the settings below it; on the
right, the selected one with its tools. `J` and `K` (or `Alt+↓` and `Alt+↑`)
step through the list, **‹** and **›** too, and **Enter** in the filter opens
the first match. Settings apply at once; a typed value (an object, a scope, an
entry point) with **Apply** or **Enter**. The address keeps the selection and
the settings, so the back button and a copied link return to the same view.

The panel takes its design from your VS Code color theme: background,
text, borders, accent, selection, error and warning colors, and the editor's
fonts, including high contrast and custom themes, the 3D explorer and the
Docs page included. It changes with the theme and refreshes when AL files,
`app.json`, `.bca.json`, or the architecture baseline change. An exported
page (`bca export`) keeps the BC Atlas design with its light and dark mode.

### Change the architecture from the panel

On the Architecture page:

- **Adopt this architecture** saves the proposal (components, layers, allowed
  dependencies) to `.bca.json` and accepts today's wrong-way dependencies in
  `.bca-architecture-baseline.json`, like
  `bca architecture --propose --write --update-baseline`.
- **Propose again** with a different grouping (`auto`, `module`, `app`,
  `namespace`, `folder`), namespace depth, or minimum component size shows a
  new proposal; nothing is written until you adopt it.
- **Accept current violations** updates the baseline, like
  `bca architecture --update-baseline`. Afterwards `bca check` fails only on
  new violations.

**Dependencies between components** shows where dependencies should be and
where they are, in two colors: green for dependencies the rules allow, red for
dependencies that point against the architecture today. **Map** draws the
components in their layers with an arrow per dependency (hover a component to
see only its arrows); **Matrix** tints every pair of components by the rules
and counts today's object links in it.

Click a component for its own page:

- what it is: role (app of its own, component, shared core), layer, which
  components it may use, the suggested namespace, its app candidate, and the
  selectors that pick its objects
- **groups inside** (sub-domains): its objects clustered by how tightly they
  are coupled, named after their namespace, folder, or the words their names
  share; objects without links inside follow their folder
- a graph of its objects, one island per group; **With dependencies** adds
  the other components around it with green and red links
- per other component: may it be used (should) and how often it is used,
  allowed and wrong way (is)
- every object with its group and its links, and the work items that
  involve the component

See [Clean architecture](./clean-architecture.md) for the rules behind it.

## In the editor

- **Problems panel**: every health and architecture finding with a location,
  at its file and line. AL compiler and analyzer findings are left to the AL
  Language extension, which reports them itself.
- **CodeLens** above each object declaration: how often it is used, what it
  uses, its component, and its dependencies against the architecture. Click
  it to open the object's page.
- **Context menu in AL files**: **Show This Object**, **Show This Object in
  3D**, **Diagram of This Object**.
- **Status bar**: health at a glance; click it for the overview.
- **Side bar** (BC Atlas icon): the pages of the panel with their numbers,
  the page it shows marked, and buttons to analyze again, run the health
  check, export, and more.

## Commands

| Command | Does |
| --- | --- |
| BC Atlas: Open, Open Page… | Shows the panel. |
| BC Atlas: Run Health Check | Analyzes again and fills the Problems panel. |
| BC Atlas: Propose an Architecture | Opens a fresh proposal. |
| BC Atlas: Accept Current Violations in the Baseline | Like `bca architecture --update-baseline`. |
| BC Atlas: Export… | Writes the BC Atlas pages as one offline HTML file, the Markdown report, the 3D explorer, the object catalog, or a diagram (`bca export`). |
| BC Atlas: Generate Documentation from UI Tests… | Markdown, HTML, DITA, Azure DevOps CSV, or BPMN (`bca docs generate`). |
| BC Atlas: Set Up Automation | `.bca.json`, Git hooks, pipeline, and schedule, in a terminal (`bca setup`). |
| BC Atlas: Run Tasks of a Trigger… | What a hook, the pipeline, or the schedule runs (`bca run`). |
| BC Atlas: Select Project… | The app, or a folder above several apps, to analyze. |
| BC Atlas: Analyze Again, Show Output | |

## AI agents

The extension registers the BC Atlas MCP server with VS Code, so agents in
the editor (for example GitHub Copilot in agent mode) can use the BC Atlas
tools: check the health and the architecture, propose one, write reports and
diagrams, and work with the UI-test documentation. See
[Agent integration](./agent-integration.md).

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `bcAtlas.project` | empty | Folder to analyze, relative to the workspace. Empty: the first app, or the workspace folder when it holds several apps. |
| `bcAtlas.paths` | `[]` | Only analyze these folders or globs, like `--paths`. Speeds up large repositories such as BCApps. |
| `bcAtlas.problems` | `true` | Findings in the Problems panel. |
| `bcAtlas.codeLens` | `true` | CodeLens above AL objects. |
| `bcAtlas.nodePath` | empty | Node.js 22 or later for the engine. Empty uses the runtime built into VS Code (1.101 or later). |
| `bcAtlas.alCompiler` | `auto` | Microsoft's AL compiler: `auto` uses the AL Language extension's (or the AL Development Tools), `off` only BC Atlas's own analysis, or a path. |
| `bcAtlas.alAnalyzers` | `[]` | Code analyzers for that compile, e.g. `CodeCop`. Empty: `al.codeAnalyzers` when `al.enableCodeAnalysis` is on. |

## With the AL Language extension

BC Atlas works next to Microsoft's AL Language extension and uses it:

- the AL compiler of the extension resolves every call and reports compiler
  and code-analyzer findings on the Health page. It runs in the background
  after each change; the panel shows the last results at once and refreshes
  when the compiler is done;
- BC Atlas reads the editor's `al.*` settings: `al.packageCachePath` for
  symbols, `al.codeAnalyzers` with `al.enableCodeAnalysis`, `al.ruleSetPath`,
  and `al.assemblyProbingPaths`;
- **AL: Download Symbols**, a new `.app`, or changed `al.*` settings start a
  new analysis, so BC Atlas stays in step with the code and its symbols.

See [AL toolchain](./al-toolchain.md).

## Share it without VS Code

```sh
bca export ./app -o atlas.html
```

writes the same pages as one self-contained HTML file that works offline:
publish it from CI, attach it to a pull request, or send it to people who do
not use VS Code. The file contains the diagrams of the report views with their
default settings, the explorer, every object page, and the docs. It cannot
change files. Add `--history` (or `--history-by prs` or
`--history-by releases`) to include the Git timeline in the explorer.

## Large projects

The first analysis of the Base Application with the System Application and
Business Foundation (about 9,500 objects) takes about two minutes; afterwards
every page opens in under a second. BC Atlas keeps the parse results of every
file on disk (in `BCA_CACHE_DIR`, default `<temp>/bc-atlas`, next to the AL
compiler's results), so reopening a project or saving a file parses only the
files that changed. The first rendering of a large diagram
view can take 20 seconds; it is cached until the source changes. Views with
more than 120 objects start as an overview of their groups (click a group to
open it); open groups with more than 1,500 objects in all are not drawn:
close some, filter by namespace, or pick a focused view. Use `bcAtlas.paths` to analyze only some folders of a large
repository.

## Build the extension from source

```sh
cd vscode
npm ci
npm test
npm run package      # bc-atlas-<version>.vsix with the engine inside
```

`npm run package` packs the BC Atlas engine with `npm pack`, adds it to the
extension, and bundles both with esbuild: the extension becomes
`dist/extension.js`, and each engine entry it starts (the analysis worker, the
panel page, the CLI, the MCP server) becomes one file with its dependencies.
Only resvg and web-tree-sitter stay packages, because they load their
WebAssembly from next to themselves; the 3D explorer's browser bundle and the
diagram font are in the engine's `vendor/` folder. The `.vsix` holds about 45
files.

```sh
unzip -q bc-atlas-<version>.vsix -d .packaged
BCA_EXTENSION_MAIN=.packaged/extension/dist/extension.js npm test   # the tests against the package
```
