# Flows: your own workflows

A **flow** says three things: **what** to make from the source, **when**, and
**where** to save it. You build flows in the BC Atlas view, from the terminal,
or through an AI agent; they are stored in `.bca.json`, and `bca run` runs
them.

```json
{
  "flows": [
    {
      "id": "docs",
      "title": "Documentation in the repository",
      "when": ["pre-push", "ci"],
      "steps": [
        { "what": "layers", "to": "docs/system" },
        { "what": "view", "lens": "data", "form": "diagram", "to": "docs/pictures/data.svg" },
        { "what": "handbook", "to": "wiki/handbook", "language": "de" },
        { "what": "check", "to": "docs/health.md" }
      ]
    }
  ]
}
```

| Part | Meaning |
| --- | --- |
| `id` | The name of the flow: lowercase letters, digits, `.`, `_`, `-`. |
| `title` | What the view and the terminal call it. |
| `when` | The triggers it runs on: `pre-commit`, `pre-push`, `ci`, `schedule`, `manual`. Without one, the flow runs only by name. |
| `steps` | One artifact each: `what` to make, `to` where to save it (a folder or a file, relative to the project), and the options of that artifact as further properties. A step can [come after others](#steps-that-come-after-others) (`id`, `after`). |

The tasks of a trigger (`automation.triggers`, see
[Automation](./automation-and-ci.md)) make each feature once, in the place its
section of `.bca.json` names. A flow is for everything beyond that: the same
artifact more than once, with other options, in other places, grouped the way
your team works.

## Steps that come after others

The steps of a flow are a graph. A step with an `id` can be waited for, and
`after` names the steps a step comes after, each with a condition:

```json
"steps": [
  { "id": "gate", "what": "check" },
  { "id": "pages", "what": "layers", "to": "docs/system", "after": ["gate"] },
  { "what": "view", "lens": "data", "to": "docs/pictures/data.svg", "after": ["gate"] },
  { "what": "handbook", "after": ["pages"] },
  { "what": "check", "to": "docs/health.md", "after": [{ "step": "gate", "if": "failed" }] }
]
```

| `if` | The step runs |
| --- | --- |
| `passed` (the default) | when the step it comes after passed |
| `failed` | when it failed: for what should happen then, such as saving the report |
| `always` | whatever became of it, also when it was skipped |

- A step without `after` starts with the flow. A flow written as a plain list
  is what it always was: every step starts with the flow, and none waits.
- A step with several entries in `after` runs when every one of them holds;
  else it is **skipped**. A skipped step fails nothing, and what waits for it
  to pass is skipped too.
- `bca run` runs every step after those it waits for, and otherwise in the
  order they are written. Steps do not hand anything to each other: each
  reads the source. Use `after` for conditions ("only when the health check
  passed") and for order ("the handbook after the catalog it links to").
- Steps that wait for each other in a circle are not valid, and neither is an
  `after` that names no step of the flow.

### Removing a step

Removing a step is the same wherever it is done (the canvas, a form,
`--unstep`, an agent), and the same as for [a step of a process](./processes.md):
**the way closes around it.**

- What came after the step comes after what the step came after, on the
  condition it had: with `pages` after `gate` and `handbook` after `pages`,
  removing `pages` leaves `handbook` after `gate`.
- A step that came after nothing but a step that started the flow starts the
  flow itself. That step is no longer held back, and BC Atlas says so: the
  terminal and the view name every step that lost what it waited for.
- Nothing else leaves the flow, and nothing is lost.

Taking a **wire** away is something else: a step no wire leads to is in no
flow. It leaves the flow together with the steps that run only through it;
they stay on the canvas, in no flow, with the wires among them, and one wire
brings them back.

On the canvas a wire is an `after`; from the terminal it is `--id` and
`--after`:

```sh
bca flow define --flow docs --step check --id gate
bca flow define --flow docs --step layers --to docs/system --after gate
bca flow define --flow docs --step check --to docs/health.md --after gate:failed
bca flow define --flow docs --at 2 --after ""        # it starts with the flow again
```

## Build a flow in the view

In VS Code, the **Flow** menu of the [BC Atlas view](./vscode.md) is the
builder:

1. **New flow…**: give it a title and tick the triggers it runs on.
2. **Add a step…**: choose what to make, where to save it, and its options.
   The form shows the options of the chosen artifact; an empty field is the
   default.
3. Order the steps with the arrows, and choose under **Delivery** what each
   trigger does with what was saved (its sync mode).
4. **Run now** runs the flow at once.

### The canvas: place and wire

**Open the builder** in the Flow menu opens the builder on **Flows**: a
canvas. (Its other side, **Processes**, builds [how the company works with
the app](./processes.md) in lanes.) Every trigger, flow, and step is a node you place where you want
it, and wires say what belongs together:

| Wire from | into | It means |
| --- | --- | --- |
| a trigger | a flow | the flow runs on that trigger |
| a flow | a step | that step starts with the flow |
| a step | a step | the second comes after the first |

To build a flow: drag **New flow** from the left onto the canvas (type its
title first, or rename it later), drag the artifacts you want onto the canvas,
and pull a wire from the dot on the right of the flow into every artifact it
should start with, and from a step into those that come after it. Drag a
trigger onto the canvas and pull its wire into the flow.

- **Branch and join.** Pull as many wires out of a node as you like, and as
  many into a step as it should wait for. A wire that would close a circle is
  refused.
- **Say when a wire holds.** Click a wire between two steps and choose
  **Runs if it passed**, **Runs if it fails**, or **Runs in any case**. A wire
  for a failure is red and dashed, one for any case grey and dotted.
- **A node that no wire leads to is in no flow.** It stays on the canvas,
  dashed, until you wire it. Removing the only wire into a step takes it out
  of the flow, together with the steps that run only through it: they keep
  their wires among each other, and one wire from a flow or a step brings them
  all back. Removing one of several wires into a step only makes it wait for
  one step less. [Removing a step](#removing-a-step) closes the way around
  it instead.
- **Wire a step of another flow** and it moves, with its place and options;
  what waited for it there no longer does.
- **Select and remove.** Click a node or a wire and press **Delete**, or use
  **Remove**. A flow goes with its steps and asks twice.
- **Double-click** a flow or a step for its form (title, triggers, delivery;
  place and options). **Enter** opens the selected node.
- **Undo** (or Ctrl+Z) takes the last change back, on both sides of the
  builder: the flows, or the processes, as they were.
- **Move around.** Drag the ground to pan, turn the wheel to zoom; **Fit**
  shows everything, **Tidy up** lays the nodes out again.
- **Run now** and **GitHub Actions** are on every flow node.

Where the nodes are, and the nodes that are in no flow yet, is kept in
`.bca/flow-canvas.json` next to `.bca.json`. Commit it and the canvas looks
the same for everyone; delete it and the builder lays the flows out itself.
The flows themselves are only in `.bca.json`, so `bca run` never reads the
canvas.

Every change is written to `.bca.json`. The lens **Flows** shows the result as
a diagram from left to right: the trigger that starts a flow, the artifacts it
makes, and where each is saved. **Change…** on the card of a flow or an
artifact opens its form.

An exported view (`bca export`) is a snapshot: its Flow menu and its builder
show each change and keep it until the page is closed (the canvas remembers
where you put the nodes in that browser), and save the changes as
`flow-changes.json`, which
`bca flow define --from flow-changes.json` applies to the project.

## From the terminal

```sh
bca flow                                   # the flows of the project
bca flow --artifacts                       # what a step can make, with its options
bca flow define --flow docs --title "Documentation in the repository" --when pre-push,ci
bca flow define --flow docs --step layers --to docs/system
bca flow define --flow docs --step view --to docs/pictures/data.svg --set lens=data --set form=diagram
bca flow define --flow docs --at 2 --set theme=dark     # change step 2
bca flow define --flow docs --up 2                      # move step 2 one up
bca flow define --flow docs --unstep 2                  # remove step 2
bca flow define --deliver ci=verify --deliver pre-push=stage
bca flow define --remove docs
bca run --flow docs                        # run it now
bca run --trigger ci                       # the tasks of the trigger, then its flows
```

A change names what it changes and keeps the rest. A flow that is not valid is
never written: an unknown artifact or option, a place outside the project, the
wrong kind of file, or two steps that save to the same place. `--dry-run`
checks a change without writing it, and `--format json` returns the flows, the
triggers with their sync modes, and the catalog of artifacts.

An AI agent uses the MCP tool `bc_atlas_flow_define` with the same operations,
and `bc_atlas_run` with `flows` to run one; see
[Agent integration](./agent-integration.md).

## What a step can make

| `what` | Makes | Saves | Options |
| --- | --- | --- | --- |
| `layers` | The [layered documentation](./layers.md): how it works, how it is connected, what to change, down to each procedure | a folder (`docs/layers`) | `pictures` |
| `report` | The [architecture report](./reports.md) with its diagrams | a folder (`docs/atlas`) | `views`, `format` |
| `handbook` | The [system handbook](./handbook.md) | a folder (`docs/handbook`) | `language`, `title`, `catalog` |
| `catalog` | One Markdown page per AL object | a folder (`docs/codegraph`) | |
| `docs` | [User guides or test cases](./al-ui-test-documentation.md) from the AL UI tests | a folder (`docs/guides`) | `tests`, `as`, `export`, `language`, `title` |
| `simulate` | The [battle test](./battle-test.md); a gate | a folder (`docs/simulation`) | `tests`, `language` |
| `check` | The [health check](./health-checks.md); a gate | optionally one file: `.md`, `.json`, `.sarif`, `.txt` | `failOn` |
| `view` | Any lens or story of the view as a picture, a page, or data (`bca view`) | one file: `.svg`, `.png`, `.md`, `.csv`, `.json`, `.txt` | `lens`, `story`, `step`, `form`, `focus`, `depth`, `inside`, `find`, `hide`, `off`, `check`, `theme`, `color`, `size`, `group`, `rows`, `width`, `height` |
| `diagram` | One of the [diagram views](./architecture-diagrams.md) | one file: `.svg`, `.png`, `.pdf`, `.d2`, `.json` | `view`, and every option of `bca export` |
| `app` | The view as one offline HTML file | one file: `.html` | `title` |
| `knowledge-graph` | The project as [RDF](./knowledge-graph.md) | one file: `.ttl`, `.rdf`, `.owl`, `.nt`, `.jsonld` | `baseIri`, `title` |
| a task of a plugin, such as `sync` or `ai` | What the plugin makes | where its own section of `.bca.json` says | |

A **gate** can fail the run: `check` on findings, `simulate` when a role is
blocked or can do what it must not. A step that fails does not stop the steps
that do not wait for it, so one run says everything that is wrong; to hold
steps back until a gate passed, let them [come after it](#steps-that-come-after-others).

A drawing that is not D2 or JSON keeps its D2 source next to it. `app` and
`knowledge-graph` hold the time they were made and so differ on every run:
deliver them as a pipeline artifact, not with `verify`. The view marks a flow
that does otherwise with the finding `flow-never-in-sync`.

## When it runs, and what happens to what was saved

`bca run --trigger <name>` runs the tasks of that trigger and then every flow
whose `when` names it. What both save is delivered with the **sync mode** of
the trigger: `verify` fails when the files differ from the commit, `stage`
adds them to the commit, and a pipeline publishes them as an artifact, opens a
pull request, or commits them. `bca flow define --deliver <trigger>=<mode>`,
or **Delivery** in the Flow menu, sets it; see
[Sync modes](./automation-and-ci.md#sync-modes).

A trigger needs something that calls it. [`bca setup`](./setup.md) installs
the Git hooks and writes the pipeline, which call `bca run --trigger <name>`;
the pipeline it writes delivers what the flows of `ci` and `schedule` save
together with the output of the tasks. After adding a flow to a pipeline
trigger, run `bca setup apply --from-config` so the pipeline knows the new
places.

`bca run --flow <id>` runs flows by name, whatever their triggers, and leaves
the tasks of the trigger out.

## Export a flow for GitHub Actions or Azure Pipelines

A flow can be a workflow of its own on GitHub, or a pipeline of its own in
Azure Pipelines:

```sh
bca flow export --flow docs                    # writes .github/workflows/bc-atlas-docs.yml
bca flow export --flow docs --to azure-devops  # writes azure-pipelines.bc-atlas-docs.yml
bca flow export --flow docs --dry-run          # says what it would write
bca flow export --flow docs -o -               # prints it
```

In the view, **Export → For GitHub Actions** and **For Azure Pipelines** in
the form of a flow write the same files. Commit the file; GitHub runs it from
the next push, and in Azure DevOps you create a pipeline from it once. Azure
Pipelines has no step that opens a pull request: a schedule that would open
one publishes what the flow saved as an artifact instead.

| The flow runs on | The workflow starts on |
| --- | --- |
| `ci` | pull requests and pushes to `main` |
| `schedule` | the cron of `automation.triggers.schedule` (default `0 6 * * 1`, Mondays at 06:00 UTC) |
| any, or none | by hand (**Run workflow** on GitHub) |

The workflow checks out the repository, sets up Node.js and the BC Atlas
cache, installs the AL compiler unless `.bca.json` turns it off, and runs
`bca run --flow <id>`. What the flow saves is delivered with the sync mode of
the trigger:

| Sync mode | The workflow |
| --- | --- |
| `verify` | fails when what the flow saves differs from the commit |
| `artifact`, or none | uploads what the flow saves as the artifact `bc-atlas-<flow>` |
| `pull-request` (schedule) | opens or updates the pull request `bc-atlas/<flow>` |
| `commit` (schedule) | commits what the flow saves to the branch |

The workflow only calls the flow, so the flow stays in `.bca.json`: change a
step's options there and the workflow follows. Export again when the triggers,
the places, or the delivery change. A file that `bca flow export` did not
write is not replaced without `--force`.

The pipeline `bca setup` writes runs every flow of `ci` and `schedule` too. A
flow that has a workflow of its own would then run twice: take the trigger out
of its `when` (the exported workflow keeps its events until you export
again), or do not use the pipeline of `bca setup`.
