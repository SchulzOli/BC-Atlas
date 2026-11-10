# Modules and bc-atlas-sync

BC Atlas analyzes the AL source. Some knowledge lives outside it: how a process
really runs in Business Central, which clicks a user makes, which code a click
executes, and which records it changes. **Modules** bring such data in without
making BC Atlas depend on it. A module is a separate package with its own
repository and release cycle; a project opts in through `.bca.json`.

```json
{
  "modules": ["bc-atlas-sync"]
}
```

| Entry | Resolved from |
| --- | --- |
| `"bc-atlas-sync"` | the project's `node_modules`, then the BC Atlas installation |
| `{ "name": "bc-atlas-sync", "path": "../bc-atlas-sync" }` | a local checkout |
| `BCA_MODULES=../bc-atlas-sync` (environment) | added for development and pipelines |

A module receives a *host* from BC Atlas instead of importing its internals:
the project root, `.bca.json`, the trigger, a log, the architecture model
(objects with their component, components with their layer), and the
documentation renderer for AL UI tests. BC Atlas checks the module API version
(`1`) when it loads a module.

## bc-atlas-sync: the sync layer

[bc-atlas-sync](https://github.com/SchulzOli/bc-atlas-sync) is the first module.
Its Business Central extension records a process (clicks from Page Scripting,
every database write with the full AL call stack, optional profiler call tree)
and condenses it into a fingerprinted **fact snapshot** with documentation from
the use case down to the single click. The module syncs these snapshots into
the project. The `sync` section of `.bca.json` says **what**, **when**, and
**how**:

```json
{
  "modules": ["bc-atlas-sync"],
  "sync": {
    "sources": {
      "bc": { "type": "fact-snapshots", "path": "bc-snapshots" },
      "atlas": { "type": "atlas-model" }
    },
    "channels": [
      {
        "id": "processes",
        "what": { "from": "bc", "processes": ["*"], "versions": "latest" },
        "when": { "triggers": ["ci", "schedule", "manual"], "condition": "drift" },
        "how": { "formats": ["documents", "architecture", "index"], "outputDir": "docs/processes" }
      },
      {
        "id": "scenarios",
        "when": { "triggers": ["schedule", "manual"], "condition": "drift" },
        "how": { "formats": ["ui-tests"], "outputDir": "test/UITest/Recorded" }
      }
    ]
  }
}
```

| | Options |
| --- | --- |
| **What** (sources) | `fact-snapshots`: JSON fact sheets or "Download All" ZIPs from Business Central in a folder. `atlas-model`: the BC Atlas model of the project (no path) or an export. `what.processes` filters by process, feature, or id; `what.versions` is `latest` or `all`. |
| **When** | `when.triggers`: the BC Atlas triggers (`pre-commit`, `pre-push`, `ci`, `schedule`, `manual`). `when.condition`: `always`, `changed` (any new snapshot content), or `drift` (the process fingerprint changed: it runs different code or touches different data). |
| **How** (formats) | `documents` (layered documentation, user guide, technical documentation, sequence diagram, object inventory, Page Script, UI test, facts), `facts`, `ui-tests` (BC Atlas UI tests for the `docs` task), `architecture` (components and layers the process crosses, checked with the layer rules), `index` (catalog of all processes with drift), `atlas-docs` (guides, test cases, BPMN rendered by BC Atlas). |

Delivering the output stays with BC Atlas: add `sync` to the tasks of a trigger
and choose its sync mode as for every other task.

```json
"automation": {
  "triggers": {
    "ci":       { "tasks": ["check", "sync", "docs"], "sync": "verify" },
    "schedule": { "cron": "0 6 * * 1", "tasks": ["sync", "docs"], "sync": "pull-request" }
  }
}
```

The `sync` task runs before `docs`, so UI tests synced from Business Central are
documented in the same run. Outputs are deterministic and a state file
(`.bca/sync-state.json`) remembers what was synced, so `verify` reports a
difference only when Business Central delivered something new.

```powershell
bca sync status            # which processes are new, changed, drifted, or removed
bca sync plan --trigger ci # what a pipeline run would write
bca sync run               # write it
```
