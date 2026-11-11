# Plugins

BC Atlas analyzes the AL source. Some knowledge lives elsewhere: how a process really runs in
Business Central, what telemetry says about it, which work item a change belongs to. **Plugins**
bring such knowledge in. A plugin declares in `plugin.json` what it contributes; BC Atlas builds
help, the command catalog, task validation, and MCP tool lists from that declaration and runs the
plugin's code only when one of its contributions is used.

```text
plugin.json (static)                         activate(context) (runs on first use)
─────────────────────                         ─────────────────────────────────────
commands        bca <plugin> <command>         commands.<name>({ root, input, values })
tasks           bca run --tasks <task>         tasks.<id>.run({ trigger }), tasks.<id>.outputs(config)
healthRules     findings in bca check          healthRules.<id>({ model, report }) -> [{ message, object, file, line }]
mcpTools        tools of bca mcp               mcpTools.<name>(args)
atlas           nodes, relations, lenses,      atlas({ atlas, object }) -> { nodes, relations, styles,
                findings, and stories of         lenses, findings, stories }
                the view and of bca view
hooks           run:before, task:after,        hooks.<event>(payload)
                run:after, check:after
extensionPoints points other plugins fill      (declared only)
extends         points of other plugins        extensions.<point>: [items]
configKey       its section of .bca.json       context.settings; validateConfig(settings) for doctor
```

## Where plugins come from

| Source | How | Example |
|---|---|---|
| Built-in | `plugins/<id>` in BC Atlas, enabled unless switched off | `sync` |
| npm | A dependency of the project named `bc-atlas-plugin-*` or `@scope/bc-atlas-plugin-*`; no configuration needed | `npm install --save-dev bc-atlas-plugin-telemetry` |
| `.bca.json` | `"plugins"`: names, paths, or switches | `["bc-atlas-plugin-x", { "path": "../my-plugin" }]` or `{ "sync": false }` |
| Environment | `BCA_PLUGINS` (comma-separated names or paths) | development, pipelines |

A plugin from the project with the id of a built-in one replaces it (with a warning), so a newer
checkout of a built-in plugin can be tried in one project. Plugins must not reuse tasks, MCP tools,
or `.bca.json` keys of BC Atlas or of each other; `bca plugins doctor` checks that.

## What a plugin receives

`activate(context)` gets everything it may use; plugins never import BC Atlas internals:

| | |
|---|---|
| `context.root`, `context.config`, `context.settings` | Project, `.bca.json`, and the plugin's own section (`configKey`) |
| `context.trigger`, `context.log(line)` | The trigger of `bca run` and a log that BC Atlas prints |
| `context.services.atlasModel()` | The architecture model: objects with their component, components with their layer |
| `context.services.renderDocs({ testsDir, outputDir, formats, mode })` | The documentation pipeline for AL UI tests |
| `context.services.cacheDir` | `.bca/cache/<plugin>` for data that is not committed |
| `context.extensions.get("<plugin>.<point>")` | What other plugins contribute to an extension point |
| `context.plugins.list()` | Which plugins are there |

The plugin API has a version (`apiVersion` in `plugin.json`, currently `1`). BC Atlas refuses a
plugin for another version with a clear message instead of failing later.

## Rules BC Atlas keeps

- **Tasks** are placed by `before`/`after` (for example `sync` before `docs`), take part in every
  trigger and sync mode, and report the paths they write, so `verify`, `stage`, artifacts, pull
  requests, and commits include them. `bca setup` keeps plugin tasks it does not manage.
- **Health rules** use the severity of the manifest; `check.severities` changes or switches it off
  like a built-in rule. A rule that throws becomes a `plugin-rule-failed` finding, never a crash.
  Inside a rule, a nested health check (for example through `atlasModel()`) skips plugin rules.
- **Commands** get `--config` and a project path automatically, appear in `bca --help`,
  `bca help --format json`, and the generated CLI reference (built-in plugins).
- A broken project plugin never blocks BC Atlas: the command catalog falls back to the built-in
  plugins, and `bca plugins doctor` explains the problem.

## Manage plugins

```powershell
bca plugins list            # every plugin, its source, and what it contributes
bca plugins show sync       # one plugin in detail
bca plugins doctor          # load, activate, and check every contribution and config section
bca plugins new telemetry   # a working plugin from the template (command, task, rule, hook, test)
```

## Write a plugin

`bca plugins new <id>` creates `plugins/<id>` with `plugin.json`, `src/index.js`, a test, a README,
and a `package.json` that publishes it as `bc-atlas-plugin-<id>`. The template passes
`bca plugins doctor` and its own tests; replace the TODOs. Point a project at it with
`"plugins": [{ "path": "plugins/<id>" }]` while developing, and publish it to npm when it is ready:
projects that install it get it without configuration.

## What a plugin adds to the graph

Everything BC Atlas shows is one graph ([The BC Atlas view](./vscode.md#the-bc-atlas-view)). A
plugin that knows something the AL source cannot show puts it into that graph instead of next to
it: it declares `"atlas": { "summary": "..." }` under `contributes` and implements `atlas`.

```js
atlas: async ({ atlas, object }) => ({
  // Nodes of its own kinds. Besides id, kind, and label, every fact shows on the card of the node.
  nodes: [{ id: "owners::team::stock", kind: "team", label: "Team Stock", color: "#7C3AED", members: 3 }],
  // Relations by node id, also to nodes of BC Atlas: object(type, idOrName) is the id of an AL object.
  relations: [{ from: "owners::team::stock", to: object("table", 50100), kind: "owns" }],
  styles: { owns: { color: "#7C3AED", dash: true } },
  // A lens is a part of the graph: kinds of node and kinds of relation.
  lenses: [{ id: "owners", title: "Owners", summary: "Who owns what.", kinds: ["team", "object"], relations: ["owns"], connected: true }],
  // A finding is on its nodes: Check rings them, and the card says how to fix it.
  findings: [{ severity: "warning", rule: "owner-missing", message: "...", fix: "...", nodes: ["owners::team::stock"] }],
  // A story walks through the graph: each step a text, a lens, and the nodes it is about.
  stories: [{ id: "owners", title: "Who owns what", summary: "...", steps: [{ title: "Team Stock", text: "...", lens: "owners", nodes: ["owners::team::stock"] }] }]
})
```

`atlas` is the graph so far (`nodes`, `relations`, `edges`). The lenses of plugins come after those
of BC Atlas and cannot replace one; a relation to a node that is not there is left out; a finding
with the rule and message of one of the plugin's health rules is that finding, now on its nodes. A
plugin that throws becomes the finding `plugin-atlas-failed`, and the view still shows. Nothing
else is needed: the lens is in the menu of the view, in `bca view --lens`, in the MCP tool
`bc_atlas_view`, and in every export.

## Built-in: sync

[BC Atlas Sync](../plugins/sync/README.md) records how a process runs in Business Central (clicks,
writes, AL call stacks) and syncs the fact snapshots into the project. It is the reference plugin:
commands (`bca sync plan|run|status|describe`), the `sync` task, the `sync-outdated` health rule, the
`bc_atlas_sync_status` MCP tool, the lens **Recordings** with the story "What runs in Business
Central" in the view, and two extension points of its own, `sync.sources` (what) and `sync.formats`
(how), so other plugins can feed it.

## Plugins we expect to need

These are assumptions about where BC Atlas goes next; each uses the contribution points above.
None of them exists yet.

| Plugin | Brings in | Contributes |
|---|---|---|
| **telemetry** | Business Central telemetry (Application Insights): long-running AL methods, errors, deprecated calls per object | `sync.sources` (telemetry export as processes), health rules (hot objects, failing procedures), MCP tool, `check:after` hook |
| **openbridge** | Live data through the OpenBridge gateway: record counts per table, objects never written, real setup values | `sync.sources` (`bc-live`), health rule (unused objects), `bca openbridge status`, MCP tools |
| **devops** | Azure DevOps and GitHub: work items linked to objects and scenarios; guides to the wiki, test cases to Test Plans | `sync.formats` (`ado-test-plan`, `wiki`), task `publish`, `run:after` hook (pull request comment) |
| **compat** | Compatibility between releases: removed or obsolete procedures, events, fields against the previous app symbols (AppSource rules) | health rules (`breaking-change`), `bca compat diff`, task |
| **translation** | XLIFF coverage and terminology per language | health rules (missing translations, inconsistent terms), `bca translation report` |
| **performance** | Profiles (`.alcpuprofile`) and SQL statistics from Business Central | `sync.sources` (profiles), health rule (hotspots on the architecture) |
| **ai** | Explanations and summaries by a language model for handbook and guides | `bca ai explain`, MCP tools; needs the planned `export:page` hook |

## Planned contribution points

What the expected plugins will need beyond plugin API 1, added in a compatible way:

| Point | For |
|---|---|
| `views` | Diagram views and dashboard boards in the app and the VS Code extension (telemetry heat map, process overlay) |
| `export:page` hook | Adding sections to report, handbook, and code graph pages (ai, telemetry) |
| `setup` questions | Offering plugin tasks in `bca setup` (today they are kept, not offered) |
| `simulation` agents | Roles and data from outside the AL source for the battle test (openbridge) |
