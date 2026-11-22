# BC Atlas for VS Code

The BC Atlas extension brings everything BC Atlas does into VS Code, where
AL developers already work. Open a folder with an `app.json` and BC Atlas
analyzes it; nothing else needs to be installed. The extension contains the
BC Atlas engine and runs it on VS Code's own Node.js runtime, in a background
process, so the editor stays responsive while large apps are analyzed.

Install **BC Atlas** (`SchulzOli.bc-atlas`) from the Extensions view, or
from a `.vsix` file with **Extensions: Install from VSIX…**.

## The BC Atlas view

Open it with **BC Atlas: Open**, the BC Atlas icon in the activity bar, the
status bar item, or the BC Atlas button above an AL file.

The view is one thing: **a toolbar and the graph.** There are no pages, no
tabs, and no list of contents. The AL source is the only fact; everything
BC Atlas reads from it is one graph, and the toolbar decides which part of
it you see, in which form, and what stands out.

### The overview: how it works

The view opens on the **Overview**. It is not every object and every
relation; it is how the app works, read from left to right, in columns
with their titles:

| Column | Holds |
| --- | --- |
| **Screens** | What people work with: pages and reports. |
| **Logic** | What runs behind the screens: codeunits, queries, XMLports, interfaces. |
| **Data** | Where it ends up: tables. |

- **Lines are quiet.** A line leads from what uses to what is used, each
  pair once, with no arrow and no color, because every line runs from a
  column on the left to one on the right.
- **Click anything to see its way.** An object lights what uses it and
  what it uses, all the way. Everything else steps back.
- **What is not part of how it works is not in it:** permission sets,
  enums, and test codeunits. They are in the lenses made for them.
- **A large project shows areas.** Above 48 objects a box is an area (a
  namespace or an app) with the number of screens, logic objects, or tables
  it holds, the largest first, and a line carries how
  many relations it stands for. Double-click an area for how it works
  inside, object by object.

`bca view --lens overview` writes the same as text, in the order of the
columns, and `-o overview.svg` draws it.

| In the toolbar | Does |
| --- | --- |
| **Lens** (the name next to the project) | What the graph shows: a part of the one graph. The menu lists the lenses by what they answer: how it works, structure, parts, quality. See [Lenses](#lenses). |
| The **trail** next to it | Where you are once you went into something: `Apps › Contoso Core › CON Item`. Every part of the way is one click back, and **‹** goes one step up. |
| **2D**, **Diagram**, **3D** | The form. The same nodes as a graph in a plane, as boxes in layers in the direction of their relations, or as a graph in space. Any lens in any form; a lens opens in the form it reads best in (the overview and the apps as a diagram). |
| **Find** | Lights up the nodes whose name, type, namespace, or ID matches. **Enter** goes to the next match, **Shift+Enter** to the one before. |
| **Check** | Puts a ring on every node with a finding, in the color of the worst one. The number is the errors and warnings. |
| **Story** | Walks through the graph step by step. See [Stories](#stories). |
| **View** | Color, size, and grouping of the nodes; arrange again; reset. |
| **Export** | Saves what you see. See [Export](#export). |
| **Live** | What the graph is read from, and reading it again. See [In step with the source](#in-step-with-the-source). |

On the graph:

- **Click** a node to select it. A card says what it is, its facts, its
  findings with how to fix them, and its relations in this lens; click a
  relation to go to the node at its other end.
- **Double-click** a node to go into it. An app or a namespace opens to
  its objects and what they do with each other. An object opens to
  its procedures, triggers, and events, and what each of them does with
  other objects. A procedure goes to its line in the source. Anything else
  (an object of another app, a rule of the health check) goes to the lens
  it lives in and shows it with what is next to it.
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
when you go into an app or come back, when the source changes. Between
2D, Diagram, and 3D the nodes glide to their new places and the camera
turns. The picture fits next to the card of the selected node, not under
it. Every step to another place (a lens, something you went into, a
story) is one the **Back** and **Forward** keys of a browser take back and
forth; in an exported file the address changes with it. With "reduce
motion" set in the operating system, the next picture stands at once.

### Lenses

A lens is a part of the one graph. Nodes keep their identity across lenses:
select an object in one, switch, and it is still selected.

| Lens | Nodes | Relations | `bca view --lens` |
| --- | --- | --- | --- |
| Overview | screens, logic, and data, in columns | uses | `overview` |
| System | every AL object | everything objects do with each other | `system` |
| Apps | the apps of the workspace and the apps they depend on | declared, implicit, and undeclared dependencies | `apps` |
| Modules | namespaces | what they use of each other | `modules` |
| Data | tables and the code that touches them | reads, writes, relates, extends | `data` |
| Calls | objects | calls and runs | `calls` |
| Events | publishers and subscribers | publishes, subscribes | `events` |
| Contracts | interfaces and what implements them | implements, selects | `contracts` |
| Pages | pages, reports, and what they show; the user guides from the AL UI tests | source tables, parts, actions; documents (a guide and the pages its steps use) | `pages` |
| Permissions | permission sets and what they cover | permits, includes | `security` |
| Visibility | every object, colored public, internal, or local | everything | `visibility` |
| Findings | the rules of the health check and the objects they found | one per finding, in its severity | `health` |

A lens with nothing in it is left out: Findings needs a finding.

**User guides.** When the project has documented AL UI tests
([Documentation from AL UI tests](./al-ui-test-documentation.md)), every
scenario is a node of the Pages lens, a *user guide*, with a `documents`
relation to each page its steps use. Select a page to see its guides and how
many steps of each happen there; select a guide for its goal, roles,
permission sets, journeys, and actions, and **Go to source** opens its test.
The tests are found in `docs.tests` of `.bca.json`, or in the folder with the
most scenarios.

### Stories

A story is generated from the source, like everything else. It walks
through the graph: each step has a text, the lens it is told in, and the
nodes it is about, which stand out while the rest steps back. **←** and
**→** move, **Play** runs it by itself, **Markdown** saves it as a document.

| Story | Tells | Use it to |
| --- | --- | --- |
| What the system is | How it works, the apps, what everything depends on, the data, events, contracts, the user interface, permissions, health | explain and demonstrate the system |
| What to fix | Every finding, the most severe first, on the nodes it is about, with the fix | work through the health check |
| An end-to-end journey | One story per `[JOURNEY]` of the UI tests: every stage on its user guide and the pages it uses, with who performs it | show how a business process runs through the app |

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
  or `.bca.json`, and the source is read again; the view keeps its lens,
  form, and selection.
- **The graph follows the editor.** The object of the file that comes to the
  front is the selected node (`bcAtlas.followEditor`).
- **The editor follows the graph.** **Go to source** on the card of a node
  opens its file at its line.
- **Live** in the toolbar says what the graph is read from: the AL files and
  objects, the apps, the symbol packages, and `.bca.json`, and what the lens
  reads of them. **Read the source again** analyzes at
  once.

The view takes its design from your VS Code color theme: background, text,
borders, accent, selection, error and warning colors, and the editor's
fonts, including high contrast and custom themes. An exported file
(`bca export`) keeps the BC Atlas design with its light and dark mode.

## In the editor

- **Problems panel**: every health finding with a location, at its file and
  line.
- **CodeLens** above each object declaration: how often it is used and how
  much it uses (`used by 3 · uses 5`). Click it to select the object in the
  view.
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
| BC Atlas: Export… | Writes the view as one offline HTML file to share (`bca export`). |
| BC Atlas: Generate Documentation from UI Tests… | Markdown, HTML, DITA, Azure DevOps CSV, or BPMN (`bca docs generate`). |
| BC Atlas: Select Project… | The app, or a folder above several apps, to analyze. |
| BC Atlas: Analyze Again, Show Output | |

## AI agents

The extension registers the BC Atlas MCP server with VS Code, so agents in
the editor (for example GitHub Copilot in agent mode) can use the BC Atlas
tools: check the health, read any lens or story of the view, write the report
and the layered documentation, and work with the UI-test documentation. See
[Agent integration](./agent-integration.md).

### The same view in the chat

The MCP server the extension registers also shows this view inside the chat,
as an [MCP App](./agent-integration.md#the-view-in-the-chat-mcp-app): ask the
agent to show a lens, an object, or a story, and the graph
appears in the conversation, in VS Code and in every other client that
renders MCP Apps. Both are released together and are one page.

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `bcAtlas.project` | empty | Folder to analyze, relative to the workspace. Empty: the first app, or the workspace folder when it holds several apps. |
| `bcAtlas.paths` | `[]` | Only analyze these folders or globs, like `--paths`. Speeds up large repositories such as BCApps. |
| `bcAtlas.problems` | `true` | Findings in the Problems panel. |
| `bcAtlas.codeLens` | `true` | CodeLens above AL objects. |
| `bcAtlas.followEditor` | `true` | Select the object of the active editor in the graph. |
| `bcAtlas.nodePath` | empty | Node.js 22 or later for the engine. Empty uses the runtime built into VS Code (1.101 or later). |

## With the AL Language extension

BC Atlas works next to Microsoft's AL Language extension:

- BC Atlas reads the editor's `al.packageCachePath` to find the symbol
  packages. Only a value someone set counts, with VS Code's precedence: user,
  workspace, workspace folder, then each project's own
  `.vscode/settings.json`;
- **AL: Download Symbols**, a new `.app`, or a changed `al.packageCachePath`
  starts a new analysis, so BC Atlas stays in step with the code and its
  symbols.

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

## Large projects

The first analysis of the Base Application with the System Application and
Business Foundation (about 9,500 objects) takes about two minutes; afterwards
the view opens in about a second. BC Atlas keeps the parse results of every
file on disk (in `BCA_CACHE_DIR`, default `<temp>/bc-atlas`), so reopening a project or saving a file parses only the
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
WebAssembly from next to themselves; the diagram font is in the engine's
`vendor/` folder. The `.vsix` holds about 45
files.

```sh
unzip -q bc-atlas-<version>.vsix -d .packaged
BCA_EXTENSION_MAIN=.packaged/extension/dist/extension.js npm test   # the tests against the package
```
