# Architecture diagrams

Use a view that answers one question. Large all-purpose diagrams become difficult to read.

The fastest way to look at them is the BC Atlas view in
[VS Code](./vscode.md): every view below that shows the whole app is a lens
of its one graph, as a 2D graph, a diagram, or a 3D graph; click an object
to select it, and save what you see as SVG, PNG, JSON, or CSV. The commands
below write the diagrams as files, with their own settings. For a first overview in your
repository, `bca export --view report` renders the project, module, data,
contracts, events, and UI views into one Markdown page. See
[Architecture reports](./reports.md).

## Select a view

| Question | View | Example |
| --- | --- | --- |
| What does the application contain? | `project` | `bca export ./app --view project -o project.svg` |
| How do modules depend on each other? | `module` | `bca export ./app --view module -o modules.svg` |
| What depends on one AL object? | `object` | `bca export ./app --view object --object codeunit:50100 -o object.svg` |
| Which tables does code read or write? | `data` | `bca export ./app --view data -o data.svg` |
| Which procedures call each other? | `call` | `bca export ./app --view call -o calls.svg` |
| Which dependencies cross a boundary? | `boundary` | `bca export ./app --view boundary --scope namespace:Contoso.Sales -o boundary.svg` |
| Which types implement a contract? | `contracts` | `bca export ./app --view contracts -o contracts.svg` |
| Which publishers connect to subscribers? | `events` | `bca export ./app --view events -o events.svg` |
| How do pages connect to data and actions? | `ui` | `bca export ./app --view ui -o ui.svg` |
| What happens after an entry point? | `workflow` | `bca export ./app --view workflow --entry ProcessDocument -o workflow.svg` |
| What is public, internal, or local? | `visibility` | `bca export ./app --view visibility -o visibility.svg` |

## Read a data view

Data views keep schema relationships separate from runtime access. Dashed
`relates` edges come from AL schema declarations such as `TableRelation`;
solid `reads` and `writes` edges come from detected record operations.

Repeated runtime access is aggregated without losing evidence. JSON edges
include separate read or write `weight` values, `operations`,
`sourceProcedures`, and per-occurrence locations and transaction segments.
Table nodes include `readCount`, `writeCount`, and a `dataAccess` value of
`read-only`, `write-only`, `read-write`, or `never-accessed`. The top-level
`dataSummary` counts tables in each state.

BC Atlas adds cardinality only when a `TableRelation` explicitly names the
target field and that field is the target table's single-field primary key.
Otherwise it leaves cardinality unspecified instead of guessing.

Explicit `Commit()` and `Database.Commit()` calls are preserved as transaction
boundaries on procedures and owning objects. Runtime access occurrences include
their transaction segment. This is static evidence about explicit commits; it
does not claim to model implicit runtime transaction starts, ends, or rollbacks.

In SVG output, hover an access edge to see its operation names, source
procedures, relation class, transaction segments, and cardinality evidence.

## Read a visibility view

The visibility view answers who may use what, in three levels:

| Level | Usable by | In AL | Color |
| --- | --- | --- | --- |
| public | other apps | no `Access` property, `Access = Public`, `procedure`, `protected procedure` | orange |
| internal | this app | `Access = Internal`, `internal procedure`, `[InternalEvent]` | blue |
| local | this object | `local procedure`, `Access = Local` on a table field | green |

Every app, object, procedure, event, and table field is a data point with one
level. A member is never wider than its object: a public procedure of an
`Access = Internal` codeunit is internal. An event is as wide as who may
subscribe, so a `local procedure` with `[IntegrationEvent]` is public.
Triggers have no level; the platform runs them.

A relation is as wide as the border it crosses: a use inside one object is
local, between objects of one app internal, between apps public. The three
relation colors are the three level colors.

**What it can be.** Where the uses found in the analyzed source need less
than the level a data point has, the view says what it can be, with a dashed
border:

- a procedure nobody calls from outside its object can be `local`, one nobody
  calls from another app can be `internal`;
- an event subscriber can be `local`, because only the platform calls it;
- a codeunit, query, or enum no other app uses can be `Access = Internal`.

This is a reading of the source, not a finding: an app you publish for others
has callers BC Atlas cannot see. It never suggests a level for interface
methods and their implementations, events, `[Test]` and handler procedures,
codeunits that publish events, extensible enums, tables, and pages. A call it
cannot resolve counts as a use of every procedure of that name.

```sh
bca export ./app --view visibility -o visibility.svg                      # one box per object
bca export ./app --view visibility --expand-procedures -o members.svg    # every procedure, event, and field inside its object
bca export ./app --view visibility --focus Pricing -o pricing.svg         # objects that match, and what is connected
bca export ./app --view visibility --format json                          # the data points and uses
```

JSON output has a `visibility` object: `points` (each with `kind`, `level`,
`declared`, and, where it applies, `canBe` and `why`), `uses` (each with
`from`, `to`, `level`, and `kinds`), and a `summary` with counts per level.

In the BC Atlas view ([VS Code](./vscode.md) and `bca export --view app`),
the **Visibility** lens colors every object by its level. The card of an
object says what it is, what it can be, and why. Double-click an object to
open it: its procedures and events with their own levels, and what each of
them uses. **View › Color › Visibility** colors any other lens the same way.

## Read permissions

Permission edges keep table-data rights separate from execute access. JSON
uses `permissionKind: "tabledata"` with expanded `tableDataRights` for `RIMD`
grants, and `permissionKind: "execute"` with `execute: true` for `X` grants on
reports, pages, codeunits, queries, and XMLports. Diagrams label these edges as
`tabledata` and `executes`.

Permission-set nodes expose `assignable`, `objectAccess`, `included`,
`includedBy`, and `permissionSetRoles`. Included permission sets resolve against
workspace apps and symbols loaded from dependent `.app` packages. This keeps
assignable sets, internal building blocks, and sets included by other sets
visible as separate facts.

## Reduce a large diagram

Apply filters before you increase the edge limit:

```sh
bca export ./app \
  --namespace "Contoso.Sales.**" \
  --type table,codeunit,page \
  --exclude "**/test/**" \
  --max-edges 300 \
  -o sales.svg
```

Repeat `--namespace`, `--type`, `--include`, `--exclude`, `--scope`, and `--entry` when you need multiple values.

## Select an output format

- Use D2 to edit diagram source.
- Use JSON for scripts and integrations.
- Use SVG for documents and web pages.
- Use PNG or PDF when another tool requires those formats.

PNG and PDF output require the D2 executable on `PATH`. BC Atlas keeps the intermediate D2 file beside rendered output.

## Add source links

Use a repository URL template:

```sh
bca export ./app --source-url "https://github.com/example/repo/blob/main/{file}#L{line}" -o architecture.svg
```

For detailed selectors and view behavior, read the [CLI reference](./cli-reference.md).
