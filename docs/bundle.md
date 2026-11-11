# The bundle: everything as one artifact

`bca bundle` takes a project from the source to one artifact. It runs every
step BC Atlas has, takes in what ran outside it, and writes one folder and
one ZIP file with a manifest that says what happened, for which commit.

```sh
bca bundle                                        # bc-atlas-bundle/ and bc-atlas-bundle.zip
bca bundle -o out/atlas --test-results TestResults.xml --include output/MyApp.app
bca bundle --no-zip --format json                 # the folder only; the manifest on stdout
```

| Step | Does | In the bundle |
| --- | --- | --- |
| **Validation** | The [health check](./health-checks.md) of the source: architecture, rules, AL compiler findings. | `check/` |
| **Simulation** | The [battle test](./battle-test.md): the people of your company perform the process tests, and the recordings of Business Central. | `simulation/` |
| **Snapshots from the source** | One fact snapshot per process test: its steps, what each needs, who performs it. | `snapshots/` |
| **Runs, step by step** | The [run](./battle-test.md#a-run-step-by-step) of every person: each step of the assigned process tests, where it goes and where it stops, with the picture the run built. | `docs/stories/run-<person>.md` |
| **Documentation** | The [layered documentation](./layers.md), from the system down to each procedure, with the BC Atlas view of it as `view.html`. | `docs/` |
| **Narrative** | Pages a model writes from the facts, when the [AI plugin](../plugins/ai/README.md) is set up. Skipped otherwise; it never fails the bundle. | `narrative/` |
| **Tests that ran** | The results of tests that really ran, counted: JUnit or xUnit XML, as AL-Go and the AL test runner write them (`--test-results`). | `tests/` |
| **Build outputs** | What else belongs to it: the `.app` file, compiler output, logs (`--include`). | `build/` |

`README.md` of the bundle is one page with every step, its result, and where
to read on. `bundle.json` is the manifest:

```json
{
  "schema": "bc-atlas.bundle/1",
  "title": "BC Atlas Purchasing Example",
  "createdAt": "2026-11-11T12:00:00.000Z",
  "bcAtlas": "0.20.0",
  "source": { "commit": "243e787e7992...", "branch": "main", "dirty": false },
  "passed": false,
  "steps": [
    { "id": "check", "title": "Validation", "status": "passed", "summary": "0 error(s), 0 warning(s), 0 info" },
    { "id": "simulate", "title": "Simulation", "status": "failed", "summary": "FAILED - 6 completed, 1 blocked; ..." }
  ],
  "files": [{ "path": "check/README.md", "bytes": 412, "sha256": "..." }]
}
```

- **A step that does not apply is skipped** and says why: no process tests,
  no model set up, no test results given.
- **Exit code 1 means a step failed**: the health check, the simulation, or
  a test that ran. The bundle is written all the same, so a pipeline keeps
  the evidence of a failed run.
- **The folder is replaced** by every run; it holds exactly the bundle.

## Tests: what runs where

BC Atlas reads the source. It does not start Business Central and runs no
test itself. The three ways a process gets checked meet in the bundle:

| | Runs | Comes in as |
| --- | --- | --- |
| A **unit or UI test** | In Business Central, in your pipeline (AL-Go, a container). | Its result file: `--test-results`. A UI test with `[SCENARIO]` is also a process test of the simulation. |
| A **recording** | In Business Central, by a person, with the [sync plugin](../plugins/sync/README.md). | A fact snapshot in `simulation.recordings`: the agents perform what really ran. |
| The **simulation** | In BC Atlas, from the source, in seconds: by `bca simulate`, or by an AI agent through `bc_atlas_simulate` and `bc_atlas_simulation_define`. | The report, and a fact snapshot of each process test. |

## In a pipeline

```yaml
- run: npx bca bundle -o atlas --test-results TestResults.xml --include output
  continue-on-error: true
- uses: actions/upload-artifact@v4
  with:
    name: bc-atlas
    path: atlas.zip
```

An agent builds the same with the MCP tool `bc_atlas_bundle` and gets the
manifest back.
