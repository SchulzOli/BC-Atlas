# Architecture diagrams

Use a view that answers one question. Large all-purpose diagrams become difficult to read.

## Select a view

| Question | View | Example |
| --- | --- | --- |
| What does the application contain? | `project` | `bca graph ./app --view project -o project.svg` |
| How do modules depend on each other? | `module` | `bca graph ./app --view module -o modules.svg` |
| What depends on one AL object? | `object` | `bca graph ./app --view object --object codeunit:50100 -o object.svg` |
| Which tables does code read or write? | `data` | `bca graph ./app --view data -o data.svg` |
| Which procedures call each other? | `call` | `bca graph ./app --view call -o calls.svg` |
| Which dependencies cross a boundary? | `boundary` | `bca graph ./app --view boundary --scope namespace:Contoso.Sales -o boundary.svg` |
| Which types implement a contract? | `contracts` | `bca graph ./app --view contracts -o contracts.svg` |
| Which publishers connect to subscribers? | `events` | `bca graph ./app --view events -o events.svg` |
| How do pages connect to data and actions? | `ui` | `bca graph ./app --view ui -o ui.svg` |
| What happens after an entry point? | `workflow` | `bca graph ./app --view workflow --entry ProcessDocument -o workflow.svg` |

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

In D2 and SVG output, hover an access edge to see its operation names, source
procedures, relation class, transaction segments, and cardinality evidence.

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
bca graph ./app \
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
bca graph ./app --source-url "https://github.com/example/repo/blob/main/{file}#L{line}" -o architecture.svg
```

For detailed selectors and view behavior, read the [CLI reference](./cli-reference.md).
