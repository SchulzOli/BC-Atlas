# Changelog

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
