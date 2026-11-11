# BC Atlas for VS Code

The BC Atlas extension brings everything BC Atlas does into VS Code, where
AL developers already work. Open a folder with an `app.json` and BC Atlas
analyzes it; nothing else needs to be installed. The extension contains the
BC Atlas engine and runs it on VS Code's own Node.js runtime, in a background
process, so the editor stays responsive while large apps are analyzed.

Install **BC Atlas** (`SchulzOli.bc-atlas`) from the Extensions view, or
from a `.vsix` file with **Extensions: Install from VSIX…**. `bca setup` with
VS Code tasks also recommends it in `.vscode/extensions.json`.

## The BC Atlas view

Open it with **BC Atlas: Open**, the BC Atlas icon in the activity bar, the
status bar item, or the BC Atlas button above an AL file.

The view is one thing: **a toolbar and the graph.** There are no pages, no
tabs, and no list of contents. The AL source is the only fact; everything
BC Atlas reads from it is one graph, and the toolbar decides which part of
it you see, in which form, and what stands out.

| In the toolbar | Does |
| --- | --- |
| **Lens** (the name next to the project) | What the graph shows: a part of the one graph. See [Lenses](#lenses). |
| The **trail** next to it | Where you are once you went into something: `Components › Core › CON Item`. Every part of the way is one click back, and **‹** goes one step up. |
| **2D**, **Diagram**, **3D** | The form. The same nodes as a graph in a plane, as boxes in layers in the direction of their relations, or as a graph in space. Any lens in any form. |
| **Find** | Lights up the nodes whose name, type, component, namespace, or ID matches. **Enter** goes to the next match, **Shift+Enter** to the one before. |
| **Check** | Puts a ring on every node with a finding, in the color of the worst one. The number is the errors and warnings. |
| **Story** | Walks through the graph step by step. See [Stories](#stories). |
| **View** | Color, size, and grouping of the nodes; arrange again; reset. |
| **Export** | Saves what you see. See [Export](#export). |
| **Live** | What the graph is read from, and reading it again. See [In step with the source](#in-step-with-the-source). |

On the graph:

- **Click** a node to select it. A card says what it is, its facts, its
  findings with how to fix them, and its relations in this lens; click a
  relation to go to the node at its other end.
- **Double-click** a node to go into it. An app, a component, or a namespace
  opens to its objects and what they do with each other. An object opens to
  its procedures, triggers, and events, and what each of them does with
  other objects. A procedure goes to its line in the source. Anything else
  (a person, a process test, a requirement, a recording, an object of
  another app) goes to the lens it lives in and shows it with what is next
  to it.
- **See in** on the card lists the other lenses a node is in. Choose one and
  the lens changes around the node: it stays selected and in the middle.
- **Drag** a node to put it where you want it, the background to move the
  picture (in 3D: to turn it, Shift-drag to move), and **scroll** to zoom.
- The **legend** at the bottom left names what shows and counts it. Click a
  kind of node or of relation to hide it.

Keys: `/` find, `1` `2` `3` the form, `[` `]` the lens before and after,
`C` check, `+` `-` `0` zoom and fit, `Backspace` one step up the trail,
`Esc` back (closes the card, ends a story, then goes one step up).

Nothing jumps. A node that is in the picture before and after a step stays
where it is, and the rest comes and goes around it: when the lens changes,
when you go into a component or come back, when the source changes. Between
2D, Diagram, and 3D the nodes glide to their new places and the camera
turns. The picture fits next to the card of the selected node, not under
it. Every step to another place (a lens, something you went into, a
story) is one the **Back** and **Forward** keys of a browser take back and
forth; in an exported file the address changes with it. With "reduce
motion" set in the operating system, the next picture stands at once.

### Lenses

A lens is a part of the one graph. Nodes keep their identity across lenses:
select an object in one, switch, and it is still selected.

| Lens | Nodes | Relations | Same as |
| --- | --- | --- | --- |
| System | every AL object | everything objects do with each other | `bca export --view project` |
| Components | the components of the architecture, by layer | dependencies between them: allowed, not declared, or the wrong way | `bca architecture` |
| Apps | the apps of the workspace and the apps they depend on | declared, implicit, and undeclared dependencies | |
| Modules | namespaces | what they use of each other | `bca export --view module` |
| Data | tables and the code that touches them | reads, writes, relates, extends | `bca export --view data` |
| Calls | objects | calls and runs | `bca export --view call` |
| Events | publishers and subscribers | publishes, subscribes | `bca export --view events` |
| Contracts | interfaces and what implements them | implements, selects | `bca export --view contracts` |
| Pages | pages, reports, and what they show | source tables, parts, actions | `bca export --view ui` |
| Permissions | permission sets and what they cover | permits, includes | |
| Visibility | every object, colored public, internal, or local | everything | `bca export --view visibility` |
| Findings | the rules of the health check and the objects they found | one per finding, in its severity | `bca check` |
| Processes | the process tests, in order, and the objects each touches | step, next, touches | `bca docs generate` |
| People | who performs which process test with which permission sets | performs, blocked, must not, holds | `bca simulate` |
| Requirements | what the company needs and the process tests that prove it | proven by | `bca simulate` |

| Recordings | what was recorded in Business Central, the channels that sync it, and the objects each recording runs through | syncs, not synced, runs through, changes | `bca sync status` |

A lens with nothing in it is left out: Processes, People, and Requirements
need documented UI tests ([Battle test](./battle-test.md)), Findings needs a
finding, Recordings needs a `sync` section in `.bca.json`
([BC Atlas Sync](../plugins/sync/README.md)).

Recordings is the lens of the built-in plugin `sync`. Lenses, nodes,
findings, and stories of plugins come after those of BC Atlas and behave
the same, in the view and in `bca view`; see
[Plugins](./plugins.md#what-a-plugin-adds-to-the-graph).

### Stories

A story is generated from the source, like everything else. It walks
through the graph: each step has a text, the lens it is told in, and the
nodes it is about, which stand out while the rest steps back. **←** and
**→** move, **Play** runs it by itself, **Markdown** saves it as a document.

| Story | Tells | Use it to |
| --- | --- | --- |
| What the system is | Apps, components, what everything depends on, the data, events, contracts, the user interface, permissions, health | explain and demonstrate the system |
| One per process | The process tests in order, step by step, each on the objects it touches and with the permissions it needs | document a process, and test it: a blocked step says so |
| Who can do what | Every agent of the company with roles, permission sets, what they can do, and what blocks them | review roles and permissions |
| What to fix | Every finding, the most severe first, on the nodes it is about, with the fix | work through the health check |
| Dependencies the wrong way | Every work item of the architecture with the steps to resolve it | reach the target architecture |

So the same graph is the documentation, the test, and the demonstration:
**Export › Documentation** writes every story as one Markdown document.

### Export

Everything that shows can be saved, as it shows:

| Export | Writes |
| --- | --- |
| Picture, Drawing | PNG and SVG of the graph as you see it |
| Graph | JSON: the nodes of the lens with their facts and findings, and the relations |
| Nodes, Relations | CSV, one row each |
| This lens | Markdown: what shows, what it is read from, and its findings |
| Documentation | Markdown: every story of the system |
| Link | the address of this view |

The whole state of the view (lens, form, selection, search, what is hidden,
the step of a story) is in its address, so a link opens the same picture.

### In step with the source

- **The graph follows the source.** Save an AL file, `app.json`,
  `.bca.json`, or the baseline, and the source is read again; the view keeps
  its lens, form, and selection.
- **The graph follows the editor.** The object of the file that comes to the
  front is the selected node (`bcAtlas.followEditor`).
- **The editor follows the graph.** **Go to source** on the card of a node
  opens its file at its line.
- **Live** in the toolbar says what the graph is read from: the AL files and
  objects, the apps, the symbol packages, the AL compiler, and `.bca.json`,
  and what the lens reads of them. **Read the source again** analyzes at
  once.

The view takes its design from your VS Code color theme: background, text,
borders, accent, selection, error and warning colors, and the editor's
fonts, including high contrast and custom themes. An exported file
(`bca export`) keeps the BC Atlas design with its light and dark mode.

### Change the architecture from the view

**Live** also holds what the view may write back:

- **Keep these components**, when no architecture is configured: saves the
  proposal the Components lens shows (components, layers, allowed
  dependencies) to `.bca.json` and accepts today's wrong-way dependencies in
  `.bca-architecture-baseline.json`, like
  `bca architecture --propose --write --update-baseline`.
- **Accept the wrong-way dependencies**, when one is configured: updates the
  baseline, like `bca architecture --update-baseline`. Afterwards
  `bca check` fails only on new ones.

Both ask twice before anything is written. Another grouping, depth, or
granularity of the proposal is set with `architecture.proposal` in
`.bca.json` or with `bca architecture --propose`; see
[Clean architecture](./clean-architecture.md) for the rules behind it.

## In the editor

- **Problems panel**: every health and architecture finding with a location,
  at its file and line. AL compiler and analyzer findings are left to the AL
  Language extension, which reports them itself.
- **CodeLens** above each object declaration: how often it is used, what it
  uses, its component, and its dependencies against the architecture. Click
  it to select the object in the view.
- **Context menu in AL files**: **Show This Object** (selected in the
  graph), **Show This Object in 3D** (it and its neighbors), **Show This
  Object from the Inside** (its procedures, as a diagram).
- **Status bar**: health at a glance; click it to open the view.
- **Side bar** (BC Atlas icon): opens the view, and holds the buttons to
  analyze again, run the health check, export, and more. It has no list of
  pages, because there are none.

## Commands

| Command | Does |
| --- | --- |
| BC Atlas: Open, Open a Lens… | Shows the view, or the view with one lens. |
| BC Atlas: Run Health Check | Analyzes again and fills the Problems panel. |
| BC Atlas: Show the Components | The Components lens as a diagram: the configured architecture, or a proposal when there is none. |
| BC Atlas: Accept Current Violations in the Baseline | Like `bca architecture --update-baseline`. |
| BC Atlas: Export… | Writes the view as one offline HTML file, the Markdown report, the 3D explorer, the object catalog, the system handbook, a diagram, or the knowledge graph in RDF and OWL (`bca export`). |
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
| `bcAtlas.followEditor` | `true` | Select the object of the active editor in the graph. |
| `bcAtlas.nodePath` | empty | Node.js 22 or later for the engine. Empty uses the runtime built into VS Code (1.101 or later). |
| `bcAtlas.alCompiler` | `auto` | Microsoft's AL compiler: `auto` uses the AL Language extension's (or the AL Development Tools), `off` only BC Atlas's own analysis, or a path. |
| `bcAtlas.alAnalyzers` | `[]` | Code analyzers for that compile, e.g. `CodeCop`. Empty: `al.codeAnalyzers` when `al.enableCodeAnalysis` is on. |

## With the AL Language extension

BC Atlas works next to Microsoft's AL Language extension and uses it:

- the AL compiler of the extension resolves every call and reports compiler
  and code-analyzer findings, which the Findings lens and **Check** show. It
  runs in the background after each change; the view shows the last results
  at once and refreshes when the compiler is done;
- BC Atlas reads the editor's `al.*` settings: `al.packageCachePath` for
  symbols, `al.codeAnalyzers` with `al.enableCodeAnalysis`, `al.ruleSetPath`,
  and `al.assemblyProbingPaths`. Only values someone set count, with VS Code's
  precedence: user, workspace, workspace folder, then each project's own
  `.vscode/settings.json`;
- **AL: Download Symbols**, a new `.app`, or changed `al.*` settings start a
  new analysis, so BC Atlas stays in step with the code and its symbols.

See [AL toolchain](./al-toolchain.md).

## Without VS Code, and without a window

Nothing in the view needs a window. `bca view` does what the toolbar does,
from a terminal, a pipeline, or an agent, with the same code that draws the
page:

```sh
bca view ./app                                         # the lenses and stories of the app
bca view ./app --lens data --form diagram -o data.svg  # a lens as a picture
bca view ./app --lens health --check                   # the findings on the objects, as text
bca view ./app --inside codeunit:50100                 # an object from the inside
bca view ./app --story fix                             # a story, step by step
bca view ./app --stories -o docs/system.md             # every story as one document
bca view ./app --format json > atlas.json              # the whole graph
```

Every control of the toolbar has an option, and every export a format; see
[`bca view`](./cli-reference.md#view). Agents use the same through the MCP
tool `bc_atlas_view` ([Agent integration](./agent-integration.md)).

To hand the view itself to someone:

```sh
bca export ./app -o atlas.html
```

writes the same view as one self-contained HTML file that works offline:
publish it from CI, attach it to a pull request, or send it to people who do
not use VS Code. The file holds the whole graph with every lens, finding,
and story, and what is inside each object (for projects of up to 2,500
objects). It is small, a few hundred kilobytes for thousands of objects,
and it cannot change files. A link with its address opens the same picture
for everyone who has the file.

The timeline of the dependencies over Git history is the 3D explorer's:
`bca export --view explorer --history` ([Dependency explorer](./dependency-explorer.md)).

## Large projects

The first analysis of the Base Application with the System Application and
Business Foundation (about 9,500 objects) takes about two minutes; afterwards
the view opens in about a second. BC Atlas keeps the parse results of every
file on disk (in `BCA_CACHE_DIR`, default `<temp>/bc-atlas`, next to the AL
compiler's results), so reopening a project or saving a file parses only the
files that changed.

The graph draws thousands of nodes: a synthetic app of 3,150 objects with
11,000 relations opens in half a second and stays fluid in every form. With
that many nodes, names show where there is room, and a diagram breaks its
layers into lines; use a lens, **Find**, the legend, or **Neighbors** on a
node to get to a part you can read. Use `bcAtlas.paths` to analyze only some
folders of a large repository.

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
view, the CLI, the MCP server) becomes one file with its dependencies.
Only resvg and web-tree-sitter stay packages, because they load their
WebAssembly from next to themselves; the 3D explorer's browser bundle and the
diagram font are in the engine's `vendor/` folder. The `.vsix` holds about 45
files.

```sh
unzip -q bc-atlas-<version>.vsix -d .packaged
BCA_EXTENSION_MAIN=.packaged/extension/dist/extension.js npm test   # the tests against the package
```
