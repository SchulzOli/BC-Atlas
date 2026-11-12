# Changelog

## 0.22.0

- The engine is BC Atlas 0.22.0.
- The view opens on the new **Overview**: how the app works in five
  columns (people, processes, screens, logic, data), with quiet lines. A
  click lights the way of what is selected through the columns; a large
  project shows areas that open with a double click.
- The lens menu is grouped by what a lens answers, one line each, and a
  lens opens in the form it reads best in.
- The story **What to change, and how** walks through every change to the
  architecture on the graph, the most important first, each with why and
  how. It replaces "Dependencies the wrong way".

## 0.21.0

- The engine is BC Atlas 0.21.0.
- **Simulate › Run, step by step** plays the simulation of one person on
  the graph: each step shows where the person is, what the step needs, and
  where it stops, and the picture is built step by step. The new lens
  **Run** shows all runs together.
- **Simulate › Build the bundle** writes validation, the simulation with
  its runs and snapshots, the documentation, and the view as one folder
  and one ZIP file next to the project.
- **Simulate** lists what stops the simulation at the top of its menu, each
  finding one click from the person it is about, and **Start from the
  process tests** writes the company the tests describe as the start of
  your own.

## 0.20.0

- The engine is BC Atlas 0.20.0.
- **Simulate**, next to Story: define who uses the app (agents, roles, task
  groups, requirements) in a form; a change is written to `.bca.json` and
  the simulation runs again. The new lens **Simulation** shows the company
  as one picture, with the recordings each process test stands on.
- **3D is in space.** What is in front is larger, what is behind fades;
  nodes are balls, the graph stands over a floor and turns slowly until you
  turn it, point at it, or select a node.

## 0.19.0

- The engine is BC Atlas 0.19.0.
- **One view: a toolbar and the graph.** The pages, the list of contents,
  and the tabs are gone. Everything BC Atlas reads from the AL source is one
  graph; a lens shows a part of it (system, components, apps, data, calls,
  events, contracts, pages, permissions, visibility, findings, processes,
  people, requirements) as a 2D graph, a diagram, or a 3D graph.
- Double-click an object to open it: its procedures and events as nodes,
  and what each does with other objects.
- **Navigation without a jump.** A double click goes into an app, a
  component, or a namespace too; a trail next to the lens says where the
  view is, and every part of it is one click back; **See in** on the card of
  a node changes the lens around it. Nodes that stay in the picture stay
  where they are, and between 2D, Diagram, and 3D they glide. Keys: `[` `]`
  the lens before and after, `Backspace` one step up.
- **Recordings**, a lens of the built-in sync plugin: what was recorded in
  Business Central, whether it is synced, and the objects it runs through.
  Plugins can add lenses, findings, and stories of their own.
- **Check** puts the findings on the nodes they are about; the card of a
  node lists them with the fix.
- **Stories** walk through the graph step by step: what the system is, each
  process test by test, who can do what, what to fix. Play one, or save it
  as Markdown.
- **Export** saves what you see: PNG, SVG, JSON, CSV, Markdown, and a link
  to the view as it is.
- The graph follows the editor: the object of the active file is the
  selected node (`bcAtlas.followEditor`). **Go to source** opens a node at
  its line.
- Commands: **Open a Lens…** (was Open Page…), **Show This Object from the
  Inside** (was Diagram of This Object), **Show the Components** (was
  Propose an Architecture). The side bar opens the view and has no list.
- Removed from the panel: the 3D explorer with its timeline, the handbook
  pages, and the user guides. **Export…** still writes them as files.

## 0.18.0

- The engine is BC Atlas 0.18.0.
- **Dashboard**, the page the panel now opens with: pick a content (a diagram
  view, the components, the objects, the apps, the findings) and a form (2D
  graph, 3D graph, table, diagram). The same filter and tools for all, and
  **New view from this** keeps what you see under a name.
- One list on the left of the panel instead of tabs: every content and page
  by topic, with a filter and the sources of what is shown. The side bar
  lists the same pages as shortcuts.
- **Visibility view**: every object, procedure, event, and field in the
  color of its level (public, internal, local), as a canvas of graphs inside
  graphs or as a diagram.
- **Docs** and **Handbook** are one page: the system handbook first, then
  the user guides and test cases from UI tests. It is there without UI tests
  too.
- **Battle test** in Docs: which roles of your company can perform the
  process tests of the app, and which permissions each step needs.
- Objects, fields, and procedures whose header or body is split by `#if`
  are in the model, an object's properties are its own, and a wildcard
  permission (`tabledata * = RIMD`) is no longer an unresolved reference.

## 0.17.0

- The engine is BC Atlas 0.17.0.
- Far fewer "references ambiguous" warnings: only the newest version of an
  app in the package caches loads, and the source of a workspace app wins
  over its own `.app`. A warning that remains names the objects it matches.
- `Access = Internal` objects used by another component of the same app are
  no longer reported; set `architecture.internalAccess` to `"component"` for
  components you plan to split into apps.
- Findings the AL analyzers already report (DataClassification, ToolTips,
  ObsoleteTag and ObsoleteReason, complexity) are no longer repeated.

## 0.16.0

- The engine is BC Atlas 0.16.0.
- **Handbook** page: what the app consists of, its events, data,
  permissions, interfaces, user interface, and code health, across all
  objects, in English or German; object names open their object page.
- Object pages show **About** (documentation, caption, access, obsolete
  state, kind, size, complexity) and **Why in …** (the selector that assigns
  the object and its coupling to each component).
- Proposals: choose the structures to start from, the granularity, and the
  shared core; **Keep component** and **Exclude from shaping** save your
  choices in `.bca.json`; **What was considered** shows how a proposal was
  made.
- `.bca.json` gets completion and checks from the BC Atlas schema.
- Findings for missing DataClassification and ToolTips, obsolete markings
  without a tag, complex procedures, and undocumented public API.
- Objects from symbol packages are read completely, enums and nested
  namespaces of the Base Application included.

## 0.15.0

- The engine is BC Atlas 0.15.0: saved graph queries and rendering are
  available through the extension's MCP server as `bc_atlas_graph_query`
  and `bc_atlas_graph_render`.
- Reuse an analyzed graph for message migrations, impact analysis, and
  focused diagrams without analyzing AL again. Select roots, depth,
  direction, relation kinds, and temporal presence; retain IDs and evidence.
- Render selections as SVG, static HTML, DOT, or JSON locally, without
  Graphviz, with highlighted roots and explicit size limits.

## 0.14.0

- A root `.mcp.json` registers BC Atlas for direct MCP tool calls in
  Copilot-compatible workspaces; run `npm ci` and approve the server when
  prompted.

## 0.13.0

- The engine is BC Atlas 0.13.0: health checks find interface methods that
  fall back silently, summarize the responsibilities of selected objects, and
  show the evidence and limitations behind every finding.
- Component cycles show the path and the dependencies behind each step.

## 0.12.0

- Diagrams are drawn by BC Atlas itself instead of D2, with a cleaner layout,
  right-angled routes, and a legend. **SVG**, **PNG**, and **D2** save the
  diagram; the extension is half the size (about 4.5 instead of 9 MB).
- Diagrams and Docs work the same way: a filterable list with the settings on
  the left, the selected view, use case, or scenario on the right. `J`/`K`
  step through the list, and the address keeps the selection.
- Diagrams page: hover an object to light up its relations, click it to open
  its page, find objects by name, and click the legend to hide a kind of
  relation. On a dark theme the diagrams are dark too.
- Large views start as an overview of their groups: click a group to open it,
  its name to close it. The Base Application's project view has a diagram now.
- Docs page: the guides are part of the panel, one overview, use case, or
  scenario at a time, as a user guide or a test case, in English or German.
- **Export…** writes the project as a knowledge graph in RDF with the BC
  Atlas OWL ontology (Turtle, RDF/XML, OWL, N-Triples, JSON-LD), for triple
  stores, graph databases, and Protégé.

## 0.11.0

- 3D explorer: objects are grouped and colored by their relation clusters,
  which float like galaxies around their app candidate and app, each with its
  name at its center; on a dark theme the graph glows.
- 3D explorer: a **Clusters** filter, and a click on a cluster name in the
  graph or the legend shows only that cluster; a second click or `Esc`
  shows all again.
- Faster: clustering is about twice as fast (4.5 instead of 9 seconds for
  the Base Application), and after a saved file only the changed apps and
  modules are clustered again.
- Docs: guides and test cases show tag text such as `<Posted>` or `*now*`
  as written instead of turning it into formatting.

## 0.10.0

The extension and the BC Atlas npm package now share one version number;
this release follows 0.9.0 of the extension and 0.8.0 of the package.

- Faster: parse results stay on disk and across changes, so reopening a
  project or saving a file parses only what changed. On a 2,931-object app
  the overview opens in about 8 seconds instead of 15, and the Docs page in
  about 11 instead of 25.
- Architecture: the proposal comes from the relations between the objects,
  so apps without namespaces (type folders, ID blocks) and apps with a mix get
  real components too. It shows a shared core, app candidates (components
  that could become one app together), and a suggested namespace per
  component.
- Architecture: click a component for a page of its own, with its groups,
  a graph of its objects, its links to other components (green allowed, red
  wrong way), should vs. is per other component, and its work items. A map
  and a matrix show the dependencies between all components.
- Docs: guides come from AL tests written the way Microsoft writes the
  Business Central tests too (`[SCENARIO 218101]`, `[FEATURE] [A] [B]`,
  handlers, `Page.Trap()`, `asserterror`, filters, lookups, and more), and
  tests without UI steps are left out.
- Docs: opening a scenario or use case no longer leaves the page blank.

## 0.9.0

- Smaller and faster to load: the extension and the BC Atlas engine are
  bundled with esbuild, so the package holds about 50 files instead of 1,200
  (9 MB instead of 12 MB).
- The panel inherits your color theme: colors, accents, selection, and
  fonts, for any theme including high contrast; the 3D explorer and the Docs
  page follow too.
- The BC Atlas side bar is the panel's navigation and marks the page the
  panel shows; the panel no longer repeats the pages next to it.
- Works with Microsoft's AL Language extension: its AL compiler resolves every
  call and reports compiler and code-analyzer findings on the Health page, in
  the background after each change. BC Atlas reads the editor's `al.*`
  settings (`al.packageCachePath`, `al.codeAnalyzers`, `al.ruleSetPath`) and
  analyzes again after **AL: Download Symbols**, a new `.app`, or changed AL
  settings. New settings `bcAtlas.alCompiler` and `bcAtlas.alAnalyzers`.
- Problems: exact ranges and help links for findings; compiler findings are
  left to the AL Language extension.

## 0.8.0

- First release: the BC Atlas panel (overview, health, architecture,
  dependencies in 3D, diagrams, objects, docs), findings in the Problems panel,
  CodeLens above AL objects, a status bar item, a side bar, commands for
  export, documentation, setup, and tasks, and the BC Atlas MCP server for
  agents in VS Code.
- The BC Atlas icon, and a Marketplace listing with screenshots of
  Microsoft's Shopify Connector.
