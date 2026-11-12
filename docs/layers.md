# Layered documentation, in sync with the source

`bca layers` writes the documentation of a system in layers: from the whole
down to each procedure, one page per part, each with a picture and a sentence
that says what it is. It is generated from the AL source alone, the same
graph the [BC Atlas view](./vscode.md#the-bc-atlas-view) shows, and it is
kept in sync: a run changes only the pages whose source changed.

It documents the source **as it is now**, and the source **as it was** at
any commit, tag, or release, for a repository with one app or with many.

It answers three questions, on three pages:

| Question | Page |
| --- | --- |
| How does it work? | `README.md`: the [overview](./vscode.md#the-overview-how-it-works) as a picture, and where to go from there |
| How is it connected? | `architecture.md` |
| What should change, and how? | `changes.md` |

```sh
bca layers                      # docs/layers: the source as it is now
bca layers --check              # in sync? fails when a run would change something
bca layers --at v1.4.0          # docs/layers/history/v1.4.0: the source as it was at that tag
bca layers --releases           # the working tree, and every release not recorded yet
```

The pages of the example with three apps are in
[examples/layers](../examples/layers/README.md).

## How it is connected

`architecture.md` is the architecture on one page.

- **Apps.** A picture and a table of the apps of the repository: what each
  depends on and what depends on it, with the number of relations, and
  whether the dependency is declared in `app.json`, undeclared (used, but
  not named there), or leads to objects that are not found.
- **Components.** A picture and a table of the components in their layers:
  what each depends on, what depends on it, how much of its coupling stays
  inside, its instability, whether it is in a cycle, and whether it can be
  an app of its own. They are the components of `architecture` in
  `.bca.json`, or, when none is configured, the ones BC Atlas
  [proposes from the code](./clean-architecture.md).
- **Shared data.** Tables that are written from outside the component they
  belong to.

## What to change, and how

`changes.md` lists every change to the architecture the analysis finds, the
most important first. Each has a title, why, the steps, the effort (small,
medium, large), the nodes it is about, and its place in the source.

| Kind | When | How it says to do it |
| --- | --- | --- |
| Architecture | No architecture is configured | Look at the proposal, change what does not fit, save it (`bca architecture --write`), accept today's state (`--update-baseline`) |
| Apps | An app uses another without naming it in `app.json`, or refers to objects that are found nowhere | Add the dependency, or remove the use; download the symbols |
| Cycle | Components depend on each other | Cut the thinnest way: move what causes it, or turn it with an event or an interface |
| Dependency the wrong way | An object depends on a component its own may not depend on | The way BC Atlas resolves it (declare, move, invert, go through a facade), with the alternatives |
| Shared data | A table is written from outside its component | Put the writes behind a codeunit of the owner, or move the table |
| Public surface | Objects are public and used by nobody outside their component | `bca refactor surface --component <name>` |
| Option | A component can be an app of its own | `bca architecture --extract <name>` writes the plan |

The last two kinds are options: not wrong as they are. When there is
nothing to change, the page says so.

The page of an app, a component, a namespace, and an object names the
changes that are about it, under **What to change here**.

The same list is `changes` in `atlas.json`, the story **What to change, and
how** of the view, `bca view --story architecture` in the terminal, and
what the MCP tool `bc_atlas_layers` returns.

## The layers

| Layer | Page | Holds |
| --- | --- | --- |
| 0 System | `README.md` | What the system is in numbers, its picture, the way to every other layer, lenses, stories, findings, and what it was read from |
| 1 Apps | `apps/<app>.md` | The objects of an app, the apps it depends on, its components and namespaces |
| 2 Components | `components/<name>.md` | The objects of a component of the architecture, its layer, what it depends on and what depends on it, allowed or the wrong way |
| 3 Namespaces | `namespaces/<name>.md` | The objects of a namespace and what it uses |
| 4 Objects | `objects/<type>-<id>-<name>.md` | What an object is, its facts, what it uses and what uses it, its findings with the fix, and its place in the source |
| 5 Procedures | inside the page of the object | Every procedure, trigger, and event with its signature, size, and what it reads, writes, and calls |

Across the layers:

| Page | Holds |
| --- | --- |
| `lenses/<lens>.md` | Each lens of the view as a page with its picture: data, calls, events, contracts, pages, permissions, visibility, findings, processes, people, requirements, and the lenses of plugins |
| `stories/<story>.md` | The generated walks through the system: what it is, each process step by step, who can do what, what to fix, and the [run](./battle-test.md#a-run-step-by-step) of each person of the simulation with the picture it built |
| `architecture.md` | [How it is connected](#how-it-is-connected): apps, components, shared data, each with a picture |
| `changes.md` | [What to change, and how](#what-to-change-and-how) |
| `findings.md` | Everything the checks found, the most severe first, each linked to the objects it is about |
| `atlas.json` | The graph itself: every node, relation, lens, finding, and story |
| `layers.json` | What the folder holds, the numbers of the system, and for a state of the past its commit |

Every page links one layer up and one layer down: an object names its app,
component, and namespace; a component lists its objects; a procedure links to
the objects it touches. Pictures are SVG diagrams, drawn by BC Atlas itself.

## In sync

The same source gives the same files, byte for byte. Nothing in them says
when they were written. So:

- A run writes only the files whose content changed, and removes the ones it
  wrote before and no longer writes (an object that is gone loses its page).
  Files of yours in the folder stay.
- `bca layers --check` writes nothing and fails (exit code 1) when a run
  would change something. Use it in a pipeline to keep the pages from
  falling behind the source.
- `layers` is a task of [`bca run`](./automation-and-ci.md): with a trigger's
  sync mode the pages are verified, staged, committed, or proposed as a pull
  request, like every other generated file.

```json
{
  "layers": { "outputDir": "docs/layers", "pictures": "auto", "history": "releases", "view": false },
  "automation": {
    "triggers": {
      "pre-push": { "tasks": ["check", "layers"], "sync": "verify" },
      "ci": { "tasks": ["check", "layers"], "sync": "verify" }
    }
  }
}
```

| Setting | Default | Does |
| --- | --- | --- |
| `layers.outputDir` | `docs/layers` | The folder of the pages |
| `layers.pictures` | `auto` | Pictures of single objects: `auto` (up to 400 objects), `all`, or `none` (no pictures at all) |
| `layers.history` | `none` | `releases`: every run also records each release (Git tag) that is not recorded yet |
| `layers.view` | `false` | Also write `view.html`, the BC Atlas view of the working tree as one offline file |

## History: a commit, a tag, a release

```sh
bca layers --at v1.4.0                # a tag or a release
bca layers --at 3f2c1ab               # a commit
bca layers --at v1.3.0,v1.4.0         # several
bca layers --releases --last 5        # the working tree and the newest five releases
```

A state of the past gets the same pages below `history/<name>`, with one
file more: `view.html`, the BC Atlas view of that state to open in a
browser. BC Atlas reads the state from a temporary checkout (`git worktree`);
your working tree is not touched. A recorded state is written once and never
changes; `--refresh` writes it again, for example after an update of
BC Atlas.

`history/README.md` lists every recorded state, the newest first, with its
commit, date, and numbers, and says what changed from each state to the
next, and from the newest state to the working tree:

```markdown
## v1.4.0, since v1.3.0

- **Objects added** (1): codeunit 50202 CON Item Audit
- **Objects changed** (2): codeunit 50201 CON Item Sync, table 50000 CON Item
- **Relations**: 4 added, 1 removed
- **Findings fixed** (1): error architecture-violation: ...
```

What is compared is what BC Atlas reads from the source: objects, what they
do with each other, components, process tests, people, requirements,
recordings, and findings. A change of a comment changes nothing.

In a pipeline, a checkout without history (`fetch-depth: 1`) has no tags:
fetch them (`fetch-depth: 0`, or `git fetch --tags`) before `bca layers
--releases`.

## Next to the other exports

| You want | Use |
| --- | --- |
| The system explained layer by layer, in sync, now and at any release | `bca layers` |
| One part of the graph as text, data, or a picture | [`bca view`](./cli-reference.md#view) |
| The view itself as one file to share | `bca export` |
| Topics across all objects: events, data, permissions, UI, code health | [`bca export --view handbook`](./handbook.md) |
| User guides from UI tests | [`bca docs`](./al-ui-test-documentation.md) |
| How the dependencies grew, as a 3D timeline | [`bca export --view explorer --history`](./dependency-explorer.md) |
