# bc-atlas-sync

The sync layer of [BC Atlas](https://github.com/SchulzOli/BC-Atlas). BC Atlas analyzes the AL source;
bc-atlas-sync brings in what the source cannot show: **how a process really runs in Business Central**,
every click, every database write and the full AL call stack behind it. One manifest says **what** to
sync, **when**, and **how** (which formats and data). bc-atlas-sync is a separate repository and a
**BC Atlas module**: BC Atlas loads it when `.bca.json` lists it, and works without it otherwise.

```
 Business Central (al/)                                   bc-atlas-sync (src/)                BC Atlas
 ───────────────────────                                  ────────────────────                ────────
 clicks (Page Scripting) ──┐                              WHAT  sources                       bca sync plan|run|status
 writes + AL call stacks ──┼─► Recording ─► Fact Snapshot ─► fact-snapshots (ZIP / JSON) ─┐    bca run --tasks sync
 profiler call tree ───────┘   (phases, clicks, steps,       atlas-model (from bca) ──────┤      ▲ triggers: pre-commit,
                                objects, tables,           WHEN  trigger + condition      │      │ pre-push, ci, schedule,
                                fingerprint, drift)              (always/changed/drift)   │      │ manual
                                     │                      HOW   formats ─────────────────┴─►  docs/processes, test/UITest
                                     └─ 8 documentation types      documents, facts, ui-tests,     ▼ sync modes: verify, stage,
                                        (layered L0→L6 ...)        architecture, index, atlas-docs   artifact, pull request, commit
```

## Repository

| Folder | What |
|---|---|
| `src/` | The module: manifest (`config.js`), engine (`engine.js`), sources, formats, standalone CLI `bca-sync` |
| `test/` | Node tests of the module (21) and the end-to-end test with a real BC Atlas checkout |
| `al/app` | **BC Atlas Sync** extension (BC 26, ID range 50150–50199, prefix `BAS`): recorder, fact snapshots, 8 documentation types |
| `al/test` | AL test app (36 tests) with the **Atlas Sync Self-Test** page |
| `e2e/` | Playwright run in the BC web client, recorded as video |
| `scripts/Build-AL.ps1` | Reproducible AL build and version build snapshot (`build/`) |
| `examples/` | Example manifest (`bca.json`), demo fact sheet, architecture layer against the real Base Application Atlas, BC Atlas docs from the generated UI test |
| `docs/UnitTestMapping.md` | Which test proves which claim |

## The manifest: what, when, how

The `sync` section of `.bca.json` ([full example](examples/bca.json)):

```json
{
  "modules": ["bc-atlas-sync"],
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

**What: sources and data**

| Source type | Data |
|---|---|
| `fact-snapshots` | A folder with what Business Central produced: the **Download All (ZIP)** of a snapshot (all documents) or its JSON fact sheet. `what.processes` filters by process name, feature, or id (globs); `what.versions` is `latest` (newest snapshot per process) or `all`. |
| `atlas-model` | The BC Atlas architecture model: from the running `bca` (no path), or an export (`bca export --view app` HTML, or the model JSON) for standalone use. |

**When: trigger and condition**

| | |
|---|---|
| `when.triggers` | The BC Atlas triggers the channel runs on: `pre-commit`, `pre-push`, `ci`, `schedule`, `manual`. |
| `when.condition` | `always`; `changed` (any new snapshot content); `drift` (the fingerprint changed: the process runs different code or touches different data; re-recording an unchanged process writes nothing). |

**How: formats**

| Format | Writes (per process in `<outputDir>/<process>/`, or per channel) |
|---|---|
| `documents` | The documents generated in Business Central: `layered.md` (use case → phases → steps → clicks → code → data), `user-guide.md`, `technical.md`, `sequence.mmd`, `inventory.csv`, `page-script.yml`, `ui-test.al`, `facts.json`. Option `types` limits them. |
| `facts` | `facts.json` (stable key order). |
| `ui-tests` | `<process>.Codeunit.al`: the BC Atlas UI test, for the `docs` task of BC Atlas. |
| `architecture` | `architecture.md` / `.json`: the layer above L0. Components and layers the process crosses (per phase and step), each recorded call checked with the BC Atlas layer rules (`outward-dependency`, `same-layer-dependency`). |
| `index` | `index.md` / `index.json`: all processes by feature with phases, clicks, tables, fingerprint, drift. |
| `atlas-docs` | Guides, test cases, DITA, BPMN rendered by BC Atlas from the UI tests (`export`, `as`, `language` options; needs `bca`). |

Delivery stays with BC Atlas: list `sync` in a trigger's tasks and pick its sync mode (`verify`, `stage`,
`artifact`, `pull-request`, `commit`). `sync` runs before `docs`, so UI tests synced from Business Central are
documented in the same run. Only changed files are written, files of processes that left the source are removed,
and `.bca/sync-state.json` (no timestamps) remembers what was synced, so `verify` fails only on real news.

## Use

In a BC Atlas project:

```bash
npm install --save-dev bc-atlas-sync        # or "modules": [{ "name": "bc-atlas-sync", "path": "../bc-atlas-sync" }]
bca sync status                             # new, changed, drifted, removed processes per channel
bca sync plan --trigger ci                  # what a pipeline run would write
bca sync run                                # write it
bca run --trigger schedule                  # with "sync" in the trigger's tasks
```

Standalone (no BC Atlas; `architecture` needs an `atlas-model` source with a `path`, `atlas-docs` is skipped):

```bash
npx bca-sync run . --trigger ci
npx bca-sync describe --format json
```

In Business Central: build and publish `al/` (`pwsh ./scripts/Build-AL.ps1`), assign **BAS RECORDER**, record a
process (**Atlas Sync Recordings → Start Recording**, perform it, **Stop**, optionally **Import Clicks**), **Create
Snapshot**, **Download All (ZIP)** into the source folder (`bc-snapshots/`). **Create Demo Data** creates two versions
of "Demo: Post sales order" (the second with drift) without recording.

## Module API (version 1)

`src/index.js` exports `bcaModule`: `{ apiVersion: 1, name, version, configKey: "sync", tasks.sync.run(host),
commands.plan|run|status(host, values), outputs(config) }`. BC Atlas passes a host instead of being imported:
`{ root, config, trigger, log, atlasModel(), renderDocs() }`.

## Verification

| | Status |
|---|---|
| Module tests (`npm test`) | ✅ 21 + 1 end-to-end with a real BC Atlas checkout (`BC_ATLAS_ROOT`, default `../BC-Atlas`) |
| BC Atlas (`feat/bc-atlas-sync`) | ✅ 9 new tests, full suite 286 pass / 0 fail, `docs:check` clean |
| AL build (`scripts/Build-AL.ps1`) | ✅ both apps, BC 26.5 symbols, 0 errors, 0 warnings |
| AL tests, Playwright video | ⏳ need a sandbox |

Details: [docs/UnitTestMapping.md](docs/UnitTestMapping.md).
