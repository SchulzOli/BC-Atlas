# Layered documentation, in sync with the source

`bca layers` writes the documentation of a system in layers: from the whole
down to each procedure, one page per part, each with a picture and a sentence
that says what it is. It is generated from the AL source alone, the same
graph the [BC Atlas view](./vscode.md#the-bc-atlas-view) shows, and it is
kept in sync: a run changes only the pages whose source changed.

It documents the source as it is now, for a repository with one app or with
many.

It answers two questions, on two pages:

| Question | Page |
| --- | --- |
| How does it work? | `README.md`: the [overview](./vscode.md#the-overview-how-it-works) as a picture, and where to go from there |
| How is it connected? | `architecture.md` |

```sh
bca layers                      # docs/layers: the source as it is now
bca layers --check              # in sync? fails when a run would change something
```

The pages of the example with three apps are in
[examples/layers](../examples/layers/README.md).

## How it is connected

`architecture.md` is the architecture on one page.

- **Apps.** A picture and a table of the apps of the repository: what each
  depends on and what depends on it, with the number of relations, and
  whether the dependency is declared in `app.json`, undeclared (used, but
  not named there), or leads to objects that are not found.
- **Namespaces.** A picture and a table of the namespaces, the way the
  source itself groups its objects: the app of each, what it depends on, and
  what depends on it, with the number of relations.

## The layers

| Layer | Page | Holds |
| --- | --- | --- |
| 0 System | `README.md` | What the system is in numbers, its picture, the way to every other layer, lenses, stories, findings, and what it was read from |
| 1 Apps | `apps/<app>.md` | The objects of an app, the apps it depends on, and its namespaces |
| 2 Namespaces | `namespaces/<name>.md` | The objects of a namespace and what it uses |
| 3 Objects | `objects/<type>-<id>-<name>.md` | What an object is, its facts, what it uses and what uses it, the user guides that show a page, its findings with the fix, and its place in the source |
| 4 Procedures | inside the page of the object | Every procedure, trigger, and event with its signature, size, and what it reads, writes, and calls |

Across the layers:

| Page | Holds |
| --- | --- |
| `lenses/<lens>.md` | Each lens of the view as a page with its picture: data, calls, events, contracts, pages, permissions, visibility, findings |
| `stories/<story>.md` | The generated walks through the system: what it is, and what to fix when there are findings |
| `architecture.md` | [How it is connected](#how-it-is-connected): apps and namespaces, each with a picture |
| `findings.md` | Everything the checks found, the most severe first, each linked to the objects it is about |
| `atlas.json` | The graph itself: every node, relation, lens, finding, and story |
| `layers.json` | What the folder holds, the numbers of the system, and the page of every object |

Every page links one layer up and one layer down: an object names its app
and namespace; an app and a namespace list their objects; a procedure links
to the objects it touches. Pictures are SVG diagrams, drawn by BC Atlas itself.

**User guides.** The page of a page lists the user guides from the AL UI
tests that show it, with the steps that happen there and who performs them.
Once `bca docs generate` has written the guides (to `docs.outputDir`,
default `docs/generated`), each is a link; and `bca docs generate --layers
<folder>` (default `docs/layers`) links every guide back to the pages of the
system it uses, through `layers.json`. Write the layers first, then the
guides, then the layers again, and both sides link.

## What is written, and how: the documentation profile

Without settings, `bca layers` writes every page, every section, in English,
under the names of the tables above. The profile changes that: the keys
below, under `layers` in `.bca.json`. Settings that are not valid write
nothing; the error says what is wrong and what can be chosen.

```json
{
  "layers": {
    "outputDir": "docs/layers",
    "pages": { "stories": false, "lenses": ["data", "events"] },
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

`pages` has one key per kind of page: `readme`, `architecture`, `findings`,
`apps`, `namespaces`, `objects`, `lenses`, `stories`.

- `false` leaves the kind out.
- A list keeps the pages of the kind that match one entry: by name
  (`"CON Item*"`), by ID (`"50000"`, `"data"`), or by type and name
  (`"table CON Item"`). `*` and `?` are wildcards; case does not matter.
  The three kinds with one page take only `true` or `false`.

A page that is not written is still named where it was linked, as text
without a link. A lens or a story that is left out is also left out of the
lists of the first page.

### Scope

`scope` documents a part of the system. An object is in the scope when it
matches every list that is not empty:

| List | Matches |
| --- | --- |
| `apps` | The name of its app |
| `namespaces` | Its namespace; `Contoso.Sales*` also takes the ones below |
| `types` | Its type: `table`, `codeunit`, `page`, ... |
| `exclude` | Leaves it out, by name (`*Test*`) or by type, ID, and name |

Only objects in the scope get a page. An app or a namespace gets one when
it holds such an object, and its page counts and lists only those. An object outside the scope is still named where one inside uses it,
without a link. The first page says that the pages are about a part, and of
what.

The scope is about objects. The relations and the health in the first
sentence, `findings.md`, the lenses, the stories, and `atlas.json` are the
ones of the whole system; leave them out with `pages` when they do not fit.

### Sections

`sections` names, per kind of page, the sections (the headings of the second
level) to write, in that order. A section that is not named is left out. A
section a page does not have is skipped: a page has a section only when
there is something to say in it. A name that is not a section of the kind
is an error that lists the ones it has:

| Kind of page | Sections |
| --- | --- |
| `readme` | Start here, Layers, Apps, Namespaces, Lenses, Stories, Findings, Read from |
| `architecture` | Apps, Namespaces |
| `findings` | Error, Warning, Info |
| `app` | Namespaces, Depends on, Used by, Objects, Findings |
| `namespace` | Depends on, Used by, Objects, Findings |
| `object` | Inside, Uses, Used by, Findings |
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
- `"How it is connected"` and `"Findings"` are also the titles of their
  pages; `"README"` is the title of the first page, which is the name of the
  system otherwise.

Links that name a renamed page, and links to a renamed section, follow.

`"language": "de"` writes what BC Atlas itself says in the same way on every
page in German. `titles` goes over it.

| In German | Stays as it is |
| --- | --- |
| The titles of `architecture.md`, `findings.md`, and every section heading | The sentences made from the source: what a part is and holds, the numbers of the first page, the list under **Start here** |
| Table headers, the names of the facts, the table of the layers | The message and fix of a finding |
| The way up at the top of a page (`Ebene 2: Namespaces`) | The pages of lenses and stories, except their table headers and section headings |
| The fixed sentences that explain a section, and the footer | Names from the source and its words: object types, relation kinds (`reads`, `writes`), severities |
| The labels `Fix`, `On`, `Source` | |

### Names

`names` gives each kind of page its file, relative to the folder of the
pages. A pattern ends with `.md` and can hold folders.

| Kind | Default | Placeholders |
| --- | --- | --- |
| `readme`, `architecture`, `findings` | `README.md`, `architecture.md`, `findings.md` | none |
| `apps` | `apps/{name}.md` | `{name}` |
| `namespaces` | `namespaces/{name}.md` | `{name}`, `{app}` |
| `objects` | `objects/{type}-{id}-{name}.md` | `{name}`, `{type}`, `{id}`, `{app}`, `{namespace}` |
| `lenses`, `stories` | `lenses/{id}.md`, `stories/{id}.md` | `{id}`, `{name}` (the title) |

A value is written in lower case, with `-` for everything that is not a
letter or a digit; a part that is empty (an object without a namespace) is
`unnamed`. Every link follows, and so do the pictures: the picture of a page
has the name of the page with `.svg`, the one of the first page is
`system.svg` next to it. `layers.json` lists the files as they are written,
and names the first page as `start` when it is not `README.md`.

Two pages that would get one file are an error that names both; add
`{id}` or `{type}`.

### Templates

`templates` is a folder, relative to the project, with a Markdown file per
kind of page you want to lay out yourself: `readme.md`, `architecture.md`,
`findings.md`, `app.md`, `namespace.md`, `object.md`, `lens.md`, `story.md`. A kind without a file is written as
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
| <code v-pre>{{title}}</code> | The title of the page, without the `#` |
| <code v-pre>{{summary}}</code> | What stands between the title and the first section: the way up, the sentence, the facts, and the picture, unless the template has <code v-pre>{{picture}}</code> |
| <code v-pre>{{picture}}</code> | The picture of the page |
| <code v-pre>{{section "Uses"}}</code> | A section with its heading; nothing when the page does not have it |
| <code v-pre>{{body "Uses"}}</code> | The same without the heading |
| <code v-pre>{{sections}}</code> | Every section the template does not place by name, in the order of `sections` |
| <code v-pre>{{footer}}</code> | The line that says the page is generated; on the first page also where the graph is |
| <code v-pre>{{name}}</code>, <code v-pre>{{type}}</code>, <code v-pre>{{id}}</code>, <code v-pre>{{app}}</code>, <code v-pre>{{namespace}}</code>, <code v-pre>{{system}}</code> | Facts about what the page is of; empty when it has none |

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

## In sync

The same source gives the same files, byte for byte. Nothing in them says
when they were written. So:

- A run writes only the files whose content changed, and removes the ones it
  wrote before and no longer writes (an object that is gone loses its page).
  Files of yours in the folder stay.
- `bca layers --check` writes nothing and fails (exit code 1) when a run
  would change something. Use it in a pipeline to keep the pages from
  falling behind the source.

```json
{
  "layers": { "outputDir": "docs/layers", "pictures": "auto", "view": false }
}
```

| Setting | Default | Does |
| --- | --- | --- |
| `layers.outputDir` | `docs/layers` | The folder of the pages |
| `layers.pictures` | `auto` | Pictures of single objects: `auto` (up to 400 objects), `all`, or `none` (no pictures at all) |
| `layers.view` | `false` | Also write `view.html`, the BC Atlas view as one offline file |

What is written, and how, is [the documentation profile](#what-is-written-and-how-the-documentation-profile).

## Next to the other exports

| You want | Use |
| --- | --- |
| The system explained layer by layer, in sync with the source | `bca layers` |
| One part of the graph as text, data, or a picture | [`bca view`](./cli-reference.md#view) |
| The view itself as one file to share | `bca export` |
| User guides from UI tests | [`bca docs`](./al-ui-test-documentation.md) |
