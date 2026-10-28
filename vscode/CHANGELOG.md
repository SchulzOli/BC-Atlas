# Changelog

## Unreleased

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
