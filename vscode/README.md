# BC Atlas for VS Code

Architecture, health, dependencies in 3D, diagrams, and documentation for
Microsoft Dynamics 365 Business Central AL apps, right in the editor.

Open a folder with an `app.json` and BC Atlas analyzes it. No other
installation is needed: the extension brings the BC Atlas engine and runs it
on the editor's own Node.js runtime.

## What you get

**The BC Atlas panel** (`BC Atlas: Open`, the BC Atlas icon in the activity
bar, or the status bar item):

| Page | What it shows |
| --- | --- |
| Overview | Objects, apps, health, the architecture at a glance, the most connected objects, and next steps. |
| Health | Every finding of `bca check`: cycles, forbidden dependencies, architecture violations, hot spots, diagnostics. |
| Architecture | The configured architecture, or a proposal: components in layers, every wrong-way dependency as a work item with the steps to resolve it, metrics per component. **Adopt this architecture** writes `.bca.json` and the baseline; **Accept current violations** updates the baseline. |
| Dependencies | The 3D dependency explorer: objects, modules, apps, and components; inside one app vs. across apps; replayed by commit, pull request, or release. |
| Diagrams | Ten diagram views (project, module, object, data, call, boundary, contracts, events, ui, workflow) with zoom and pan; save as SVG or D2. |
| Objects | Every AL object, searchable; one page per object with what it uses, what uses it, its violations, fields, procedures, and actions. Click to open the source. |
| Docs | User guides from your AL UI tests, when the project has them. |

The panel follows your color theme and updates when AL files, `app.json`,
`.bca.json`, or the baseline change.

**In the editor:**

- **Problems panel**: health and architecture findings at their file and line.
- **CodeLens** above each object: how often it is used, what it uses, its
  component, and its dependencies against the architecture. Click to open the
  object's page.
- **Right-click in an AL file**: Show This Object, Show This Object in 3D,
  Diagram of This Object.
- **Status bar**: health at a glance; click for the overview.

**Commands** (Command Palette, `BC Atlas: ...`):

| Command | Does |
| --- | --- |
| Open, Open Page… | Shows the panel. |
| Run Health Check | Analyzes again and fills the Problems panel; the same rules as `bca check` in CI. |
| Propose an Architecture, Accept Current Violations in the Baseline | Find and enforce a target architecture. |
| Export… | Writes the BC Atlas pages as one offline HTML file to share, the Markdown report, the 3D explorer, the object catalog, or a diagram. |
| Generate Documentation from UI Tests… | Markdown, HTML, DITA, Azure DevOps CSV, or BPMN from AL UI tests. |
| Set Up Automation | `.bca.json`, Git hooks, a GitHub or Azure DevOps pipeline, and a schedule, in a guided terminal session. |
| Run Tasks of a Trigger… | Runs what a hook, the pipeline, or the schedule runs. |
| Select Project… | Chooses the app, or a folder above several apps, to analyze. |
| Analyze Again, Show Output | |

**AI agents**: the extension registers the BC Atlas MCP server, so agents in
VS Code (for example GitHub Copilot in agent mode) can check the
architecture, propose one, write reports, and work with the documentation.

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `bcAtlas.project` | empty | Folder to analyze, relative to the workspace. Empty: the first app, or the workspace folder when it holds several apps. |
| `bcAtlas.paths` | `[]` | Only analyze these folders or globs (like `--paths`); speeds up large repositories such as BCApps. |
| `bcAtlas.problems` | `true` | Findings in the Problems panel. |
| `bcAtlas.codeLens` | `true` | CodeLens above AL objects. |
| `bcAtlas.nodePath` | empty | Node.js 22 or later for the engine; empty uses the runtime built into VS Code. |

## CI, pipelines, and the command line

The same engine is the `bc-atlas` npm package: `bca check` gates pull
requests, `bca export` writes reports and the offline pages, and `bca run`
runs from Git hooks and pipelines. See the
[documentation](https://schulzoli.github.io/BC-Atlas/).

## Requirements

VS Code 1.101 or later. Large projects take a while on the first analysis
(the Base Application with the System Application and Business Foundation:
about two minutes); afterwards every page opens in under a second.

## License

MIT. BC Atlas bundles `tree-sitter-al` and `web-tree-sitter` (MIT), D2
(MPL-2.0), and 3d-force-graph with three.js (MIT).
