# BC Atlas Sync (built-in plugin `sync`)

BC Atlas analyzes the AL source; this plugin brings in what the source cannot show: **how a process really
runs in Business Central**, every click, every database write and the full AL call stack behind it. One
manifest says **what** to sync, **when**, and **how** (which formats and data). It ships with BC Atlas and
is the reference implementation of the [plugin system](../../docs/plugins.md).

```
 Business Central (al/)                                   plugin sync (src/)                  BC Atlas
 ───────────────────────                                  ──────────────────                  ────────
 clicks (Page Scripting) ──┐                              WHAT  sources                       bca sync plan|run|status|describe
 writes + AL call stacks ──┼─► Recording ─► Fact Snapshot ─► fact-snapshots (ZIP / JSON) ─┐    bca run --tasks sync (before docs)
 profiler call tree ───────┘   (phases, clicks, steps,       atlas-model (from bca) ──────┤    bca check: sync-outdated
                                objects, tables,           WHEN  trigger + condition      │    bca mcp: bc_atlas_sync_status
                                fingerprint, drift)              (always/changed/drift)   │
                                     │                      HOW   formats ─────────────────┴─►  docs/processes, test/UITest
                                     └─ 8 documentation types      documents, facts, ui-tests,     ▼ sync modes: verify, stage,
                                        (layered L0→L6 ...)        architecture, index, atlas-docs   artifact, pull request, commit
```

| Contributes (plugin.json) | |
|---|---|
| Commands | `bca sync plan`, `run`, `status`, `describe` |
| Task | `sync` for `bca run`, runs before `docs`; outputs: every channel folder and the state file |
| Health rule | `sync-outdated` (warning): a process changed in Business Central but is not synced yet |
| MCP tool | `bc_atlas_sync_status` |
| Atlas | The lens **Recordings** and the story "What runs in Business Central" in the BC Atlas view and in `bca view`; `sync-outdated` on the node of the recording |
| Extension points | `sync.sources` (source types: what), `sync.formats` (formats: how) for other plugins |

## Folder

| Folder | What |
|---|---|
| `plugin.json` | The manifest BC Atlas reads |
| `src/` | `activate(context)`, manifest validation (`config.js`), engine, sources, formats |
| `test/` | Plugin tests, run with the BC Atlas suite (`npm test` in the repository root) |
| `al/app`, `al/test` | **BC Atlas Sync** AL extension (BC 26, ID range 50150–50199, prefix `BAS`) and its tests (self-test page) |
| `e2e/` | Playwright run in the BC web client, recorded as video |
| `scripts/Build-AL.ps1` | Reproducible AL build and version build snapshot (`build/`) |
| `examples/` | Example manifest, demo fact sheet, architecture layer against the real Base Application Atlas |
| `docs/UnitTestMapping.md` | Which test proves which claim |

## The manifest: what, when, how

The `sync` section of `.bca.json` ([full example](examples/bca.json)):

```json
{
  "sync": {
    "sources": {
      "bc":    { "type": "fact-snapshots", "path": "bc-snapshots" },
      "atlas": { "type": "atlas-model" }
    },
    "channels": [{
      "id": "processes",
      "what": { "from": "bc", "processes": ["*"], "versions": "latest" },
      "when": { "triggers": ["ci", "schedule", "manual"], "condition": "drift" },
      "how":  { "formats": ["documents", "architecture", "index"], "outputDir": "docs/processes" }
    }]
  }
}
```

**What: sources and data** — `fact-snapshots`: the **Download All (ZIP)** of a snapshot or its JSON fact sheet in a
folder; `what.processes` filters by process, feature, or id (globs); `what.versions` is `latest` or `all`.
`atlas-model`: the BC Atlas model of the project (no path) or an export. Other plugins add source types through
`sync.sources`.

**When: trigger and condition** — `when.triggers` are the BC Atlas triggers (`pre-commit`, `pre-push`, `ci`,
`schedule`, `manual`); `when.condition` is `always`, `changed` (any new snapshot content), or `drift` (the
fingerprint changed: the process runs different code or touches different data).

**How: formats** — `documents` (layered documentation L0→L6, user guide, technical documentation, sequence diagram,
inventory, Page Script, UI test, facts), `facts`, `ui-tests` (for the `docs` task), `architecture` (components and
layers the process crosses, checked with the layer rules), `index` (catalog with drift), `atlas-docs` (guides, test
cases, BPMN rendered by BC Atlas). Other plugins add formats through `sync.formats`; `bca sync describe` lists all.

Delivery stays with BC Atlas: list `sync` in a trigger's tasks and pick its sync mode. Only changed files are
written, files of processes that left the source are removed, and `.bca/sync-state.json` (no timestamps)
remembers what was synced, so `verify` fails only on real news.

## Use

```bash
bca sync status            # new, changed, drifted, removed processes per channel
bca sync plan --trigger ci # what a pipeline run would write
bca sync run               # write it
bca run --trigger schedule # with "sync" in the trigger's tasks
```

Switch it off for a project with `"plugins": { "sync": false }`.

### In the view

What was recorded is part of the one graph of BC Atlas. The lens **Recordings** shows every channel, every
recorded process, and the AL objects it runs through (`runs through`) and changes (`changes`): the same nodes
every other lens shows, so a table leads from its recordings to its code and back. A recording is colored by
its state, in sync or waiting; one that waits has the finding `sync-outdated` with the command that syncs it.
The story **What runs in Business Central** walks through every recording phase by phase, each phase on the
objects of its call stacks.

```bash
bca view --lens sync                         # as text; --format json, md, csv, svg, png
bca view --lens sync --form diagram -o recordings.svg
bca view --story sync --format md            # the story as a document
```

Nothing is written for this: the state is read from the sources and the state file, as `bca sync status` does.
[examples/purchasing-app](../../examples/purchasing-app) has two recordings to look at.

In Business Central: build and publish `al/` (`pwsh ./scripts/Build-AL.ps1`), assign **BAS RECORDER**, record a
process (**Atlas Sync Recordings → Start Recording**, perform it, **Stop**, optionally **Import Clicks**), **Create
Snapshot**, **Download All (ZIP)** into the source folder. **Create Demo Data** creates two versions of
"Demo: Post sales order" (the second with drift) without recording.

## Verification

| | Status |
|---|---|
| Plugin tests (BC Atlas `npm test`) | ✅ unit, engine, plugin API, extension points, and end to end through the BC Atlas CLI |
| AL build (`scripts/Build-AL.ps1`) | ✅ both apps, BC 26.5 symbols, 0 errors, 0 warnings |
| AL tests, Playwright video | ⏳ need a sandbox |

Details: [docs/UnitTestMapping.md](docs/UnitTestMapping.md).
