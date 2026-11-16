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

## What is written, and how: the documentation profile

Without settings, `bca layers` writes every page, every section, in English,
under the names of the tables above. The profile changes that: the keys
below, under `layers` in `.bca.json`. Settings that are not valid write
nothing; the error says what is wrong and what can be chosen.

```json
{
  "layers": {
    "outputDir": "docs/layers",
    "pages": { "stories": false, "changes": false, "lenses": ["data", "events"] },
    "scope": { "apps": ["Contoso Sales"], "types": ["table", "codeunit", "page"], "exclude": ["*Test*"] },
    "sections": { "object": ["Inside", "Uses", "Used by"], "readme": ["Start here", "Apps", "Lenses"] },
    "titles": { "Used by": "Who uses it", "README": "Our system" },
    "language": "de",
    "names": { "objects": "objekte/{type}/{name}.md", "readme": "index.md" },
    "templates": "docs/templates",
    "profiles": {
      "management": { "outputDir": "docs/overview", "pages": { "objects": false, "namespaces": false } }
    }
  }
}
```

| Key | Does |
| --- | --- |
| `pages` | Which pages are written |
| `scope` | Which part of the system is documented |
| `sections` | Which sections a page has, and their order |
| `titles` | Other headings |
| `language` | `de`: the fixed headings and labels in German |
| `names` | The file name of each kind of page |
| `templates` | A folder with your own layout per kind of page |
| `profiles` | Named sets of these keys: `bca layers --profile management` |

### Pages

`pages` has one key per kind of page: `readme`, `architecture`, `changes`,
`findings`, `apps`, `components`, `namespaces`, `objects`, `lenses`,
`stories`.

- `false` leaves the kind out.
- A list keeps the pages of the kind that match one entry: by name
  (`"CON Item*"`), by ID (`"50000"`, `"data"`), or by type and name
  (`"table CON Item"`). `*` and `?` are wildcards; case does not matter.
  The four kinds with one page take only `true` or `false`.

A page that is not written is still named where it was linked, as text
without a link. A lens or a story that is left out is also left out of the
lists of the first page.

### Scope

`scope` documents a part of the system. An object is in the scope when it
matches every list that is not empty:

| List | Matches |
| --- | --- |
| `apps` | The name of its app |
| `components` | The name of its component |
| `namespaces` | Its namespace; `Contoso.Sales*` also takes the ones below |
| `types` | Its type: `table`, `codeunit`, `page`, ... |
| `exclude` | Leaves it out, by name (`*Test*`) or by type, ID, and name |

Only objects in the scope get a page. An app, a component, or a namespace
gets one when it holds such an object, and its page counts and lists only
those. An object outside the scope is still named where one inside uses it,
without a link. The first page says that the pages are about a part, and of
what.

The scope is about objects. The relations and the health in the first
sentence, `architecture.md`, `changes.md`, `findings.md`, the lenses, the
stories, and `atlas.json` are the ones of the whole system; leave them out
with `pages` when they do not fit.

### Sections

`sections` names, per kind of page, the sections (the headings of the second
level) to write, in that order. A section that is not named is left out. A
section a page does not have is skipped: a page has a section only when
there is something to say in it. A name that is not a section of the kind
is an error that lists the ones it has:

| Kind of page | Sections |
| --- | --- |
| `readme` | Start here, Layers, Apps, Components, Namespaces, Lenses, Stories, Findings, Read from, History |
| `architecture` | Apps, Components, Shared data, What to change |
| `changes` | Changes, Options |
| `findings` | Error, Warning, Info |
| `app` | Components, Namespaces, Depends on, Used by, What to change here, Objects, Findings |
| `component`, `namespace` | Depends on, Used by, What to change here, Objects, Findings |
| `object` | Inside, Uses, Used by, What to change here, Findings |
| `lens` | Findings |
| `story` | Its steps (`1. <title>`); `[]` leaves what stands above them |

Sections are always named in English, as in this table, whatever `language`
and `titles` say. What stands above the first section (the way up, the
sentence, the facts, the picture) and the footer are not sections: a
[template](#templates) moves or drops them.

### Titles and language

`titles` gives a heading another text: the key is the heading as BC Atlas
writes it in English, the value is what to call it.

- `"Used by": "Who uses it"` renames the section on every kind of page.
- `"object.Used by": "Callers"` renames it on the pages of objects only.
- `"How it is connected"`, `"What to change, and how"`, and `"Findings"` are
  also the titles of their pages; `"README"` is the title of the first
  page, which is the name of the system otherwise.

Links that name a renamed page, and links to a renamed section, follow.

`"language": "de"` writes what BC Atlas itself says in the same way on every
page in German. `titles` goes over it.

| In German | Stays as it is |
| --- | --- |
| The titles of `architecture.md`, `changes.md`, `findings.md`, and every section heading | The sentences made from the source: what a part is and holds, the numbers of the first page, the list under **Start here** |
| Table headers, the names of the facts, the table of the layers | The title, why, and steps of a change; the message and fix of a finding |
| The way up at the top of a page (`Ebene 2: Komponenten`) | The pages of lenses and stories, except their table headers and section headings |
| The fixed sentences that explain a section, and the footer | Names from the source and its words: object types, relation kinds (`reads`, `writes`), `Layer 0`, severities |
| The labels `Why`, `How`, `Effort`, `Fix`, `On`, `Source` | `history/README.md` |

### Names

`names` gives each kind of page its file, relative to the folder of the
pages. A pattern ends with `.md` and can hold folders.

| Kind | Default | Placeholders |
| --- | --- | --- |
| `readme`, `architecture`, `changes`, `findings` | `README.md`, `architecture.md`, ... | none |
| `apps`, `components` | `apps/{name}.md`, `components/{name}.md` | `{name}` |
| `namespaces` | `namespaces/{name}.md` | `{name}`, `{app}` |
| `objects` | `objects/{type}-{id}-{name}.md` | `{name}`, `{type}`, `{id}`, `{app}`, `{component}`, `{namespace}` |
| `lenses`, `stories` | `lenses/{id}.md`, `stories/{id}.md` | `{id}`, `{name}` (the title) |

A value is written in lower case, with `-` for everything that is not a
letter or a digit; a part that is empty (an object without a namespace) is
`unnamed`. Every link follows, and so do the pictures: the picture of a page
has the name of the page with `.svg`, the one of the first page is
`system.svg` next to it. `layers.json` lists the files as they are written,
and names the first page as `start` when it is not `README.md`.

Two pages that would get one file are an error that names both; add
`{id}` or `{type}`. A name below `history/` is not allowed.

### Templates

`templates` is a folder, relative to the project, with a Markdown file per
kind of page you want to lay out yourself: `readme.md`, `architecture.md`,
`changes.md`, `findings.md`, `app.md`, `component.md`, `namespace.md`,
`object.md`, `lens.md`, `story.md`. A kind without a file is written as
always; other files in the folder are ignored.

```markdown
# {{title}}

> {{type}} {{id}} of the app {{app}}

{{picture}}

{{summary}}

{{section "Used by"}}

## Needs

{{body "Uses"}}

{{sections}}

Ask the team before you change it.

{{footer}}
```

| Placeholder | Becomes |
| --- | --- |
| `{{title}}` | The title of the page, without the `#` |
| `{{summary}}` | What stands between the title and the first section: the way up, the sentence, the facts, and the picture, unless the template has `{{picture}}` |
| `{{picture}}` | The picture of the page |
| `{{section "Uses"}}` | A section with its heading; nothing when the page does not have it |
| `{{body "Uses"}}` | The same without the heading |
| `{{sections}}` | Every section the template does not place by name, in the order of `sections` |
| `{{footer}}` | The line that says the page is generated; on the first page also where the graph is |
| `{{name}}`, `{{type}}`, `{{id}}`, `{{app}}`, `{{component}}`, `{{namespace}}`, `{{system}}` | Facts about what the page is of; empty when it has none |

A line that holds only placeholders with nothing to say is left out. A
section that `sections` leaves out is empty in a template too. A placeholder
that is not known, or a section the kind does not have, is an error that
names the template and the placeholder. Links you write in a template are
written as they are.

A template is part of the sync: change it, and the next run writes the pages
of its kind again; `--check` fails until then.

### Profiles

A profile is a named set of the same keys, for another reader of the same
system.

```sh
bca layers --profile management
bca layers --profile management --check
```

- A key of the profile replaces the key of `layers` as a whole: a profile
  with `pages` does not inherit single entries of `layers.pages`. A key it
  does not set is the one of `layers`.
- Every profile has a folder of its own: its `outputDir`, or
  `<outputDir>-<name>` (here `docs/layers-management`) without one. Two
  profiles with one folder are an error, because a run removes the pages it
  wrote before and no longer writes.
- `layers.json` records the profile of its folder. A run with another
  profile into that folder (`-o`) stops with an error; delete `layers.json`
  to give the folder to the other profile.
- A name that is not a profile is an error that lists the profiles.

States of the past (`--at`, `--releases`) are written with the same profile
as the working tree.

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

What is written, and how, is [the documentation profile](#what-is-written-and-how-the-documentation-profile).

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
