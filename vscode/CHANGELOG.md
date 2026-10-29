# Changelog

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
