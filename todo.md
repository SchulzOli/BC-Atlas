
ince it maps Microsoft Dynamics 365 Business Central AL code into architecture diagrams, I’d lean toward names that foreground clarity and visualization:
AL Atlas — my favorite; a map of your AL architecture.
AL Scope — concise, technical, good for a CLI.
AL Blueprint — communicates architecture/design immediately.
Business Central Atlas — clearer for non-AL audiences.
AL Graph — direct and developer-friendly.
NavMap — short, memorable nod to the NAV/Business Central lineage.
AL Lens — emphasizes inspection and insight.
CodeCanvas AL — more visual/product-oriented.
BC ArchMap — explicit and practical.
Object Orchard — more distinctive, but less immediately descriptive.
My top three: AL Atlas, AL Blueprint, and AL Scope.

# Engineering TODO and investigation notes

This file records deferred work discovered while reviewing the
`BE-terna Fashion EDI` app. It does not introduce additional view types; those
are planned in [plan.md](./plan.md).

## Evidence from the Partner module

The reviewed module contains:

- 25 AL objects across 25 files.
- 7 tables, 9 pages, 4 codeunits, 3 enums, and 2 permission sets.
- 7 meaningful namespaces/folders below `BeTerna.Fashion.EDI.Partner`.
- 158 extracted relationships after semantic and permission improvements.
- `EDIPartnerService` and `EDIPartnerSetupValidation` as the main dependency
  hubs.

The isolated Partner analysis cannot resolve objects outside the folder. A
whole-app analysis is therefore necessary for accurate boundary diagrams.

## Completed current-view corrections

- [x] Search upward for the nearest `app.json` when analyzing a subfolder.
- [x] Automatically select the first meaningful namespace segment in module
  view.
- [x] Support folder-based module grouping.
- [x] Use role lanes in project view.
- [x] Aggregate repeated rendered edges and show counts.
- [x] Hide unresolved calls by default with an opt-in flag.
- [x] Show focused-object field, action, and procedure names.
- [x] Extract page fields and actions.
- [x] Parse `TableRelation = Table.Field` as a relationship to `Table`.
- [x] Avoid the false external table named `if` in conditional table relations.
- [x] Separate table relations from `Record` declarations in data view.
- [x] Detect common `Record.Get/Find/Count/Calc*` reads.
- [x] Detect common `Record.Insert/Modify/Delete/Rename` writes.
- [x] Extract tabledata permissions and included permission sets.

## Whole-app context and focus

- [ ] Add an explicit project/app root separate from the selected focus path.
- [ ] Analyze all app symbols while rendering only a selected folder or
  namespace.
- [ ] Preserve adjacent objects as aggregated boundary nodes instead of
  discarding them through `--include`.
- [ ] Resolve symbols from `.alpackages` for Microsoft and dependent apps.
- [ ] Classify unresolved targets as Microsoft base app, declared dependency,
  same app outside focus, or genuinely unknown.
- [ ] Support multi-app workspaces with duplicate object names and IDs.

Partner boundary measurements from whole-app analysis:

- Partner → Platform: 49 relationships.
- Platform → Partner: 159 relationships.
- Migration → Partner: 41 relationships.
- RoleCenter → Partner: 7 relationships.
- Message modules → Partner: 6 relationships.

## AL semantic extraction

- [ ] Replace heuristic table-relation parsing with tree-sitter queries over
  every conditional branch.
- [ ] Capture relation conditions and related fields, not only table targets.
- [ ] Resolve implicit `Rec`, `xRec`, `CurrPage`, `Report`, and `Database`
  receivers.
- [ ] Track lexical variable scope. The current object-level variable index can
  confuse local variables with the same name.
- [ ] Resolve procedure overloads and parameters by signature.
- [ ] Resolve qualified calls, chained member calls, and interface dispatch.
- [ ] Detect temporary records and label them separately from persisted access.
- [ ] Detect writes performed through helper procedures and `ModifyAll`.
- [ ] Distinguish filter construction from actual reads.
- [ ] Extract query data items, report data items, XMLport table elements, and
  CalcFormula dependencies.
- [ ] Extract page parts, subpages, views, and action references.
- [ ] Extract execute permissions and non-table permission targets.
- [ ] Handle all `EventSubscriber` argument forms and namespace-qualified
  publisher objects.
- [ ] Evaluate conditional compilation symbols or annotate conditional edges.

## Call-view precision and scale

Partner currently contains 79 procedures/triggers/events and 241 syntactic
calls. The resolved-only default retains 72 nodes and 66 calls; unresolved calls
remain available through `--include-unresolved-calls`.

Whole-app call analysis is much larger:

- 1,933 procedures/triggers/events.
- 7,626 syntactic call edges.
- 2,902 resolved calls.
- 4,724 unresolved calls.

Tasks:

- [ ] Add root-procedure and depth filters.
- [ ] Add incoming/outgoing direction filters.
- [ ] Collapse framework and standard-library calls by default.
- [ ] Aggregate calls between owning objects before expanding procedures.
- [ ] Add confidence and ambiguity styling to call edges.
- [ ] Detect recursion and strongly connected components per focused subgraph.

## Module and grouping behavior

- [ ] Detect namespace/folder disagreement and surface it as a diagnostic.
- [ ] Allow configurable folder aliases and ignored structural folders such as
  `Contract`, `PageExt`, or `Substeps`.
- [ ] Add app-level grouping for multi-app workspaces.
- [ ] Preserve stable module IDs when namespace depth changes.
- [ ] Add a maximum member/edge threshold with automatic aggregation.

For Partner, automatic namespace grouping produces seven modules. Numeric
`--module-depth 5` produces the same result. The former default of 2 collapsed
the entire module to `BeTerna.Fashion`.

## Project and object readability

- [ ] Allow custom role mappings in `.ald2tree.json`.
- [ ] Add optional source-code hyperlinks using repository-relative paths and
  commit/ref templates.
- [ ] Show edge legends and confidence legends.
- [ ] Allow the focused object to choose inbound depth and outbound depth
  independently.
- [ ] Add member visibility filters for fields, actions, triggers, events, and
  procedures.
- [ ] Show public/internal/local visibility when available.
- [ ] Add object-level call aggregation as an intermediate scale between
  project and procedure call views.

## Data accuracy

- [ ] Preserve operation names and source procedures in JSON and tooltips.
- [ ] Aggregate read/write counts separately.
- [ ] Show schema relations with a different style from runtime access.
- [ ] Infer cardinality only when the AL relation provides enough evidence.
- [ ] Identify tables that are only read, only written, or never accessed.
- [ ] Detect transaction boundaries and commits.

## Permissions

- [ ] Parse permissions on reports, pages, codeunits, queries, and XMLports.
- [ ] Interpret `X`/execute access separately from tabledata rights.
- [ ] Resolve included permission sets across dependent apps.
- [ ] Detect permission gaps against resolved runtime access.
- [ ] Distinguish assignable, included, and internal permission sets.

## Performance and packaging

- [ ] Cache parsed files by content hash for watch mode.
- [ ] Reparse only changed files and re-resolve affected symbols.
- [ ] Add a 300+ file EDI performance benchmark.
- [ ] Record peak memory for both AL and D2 WASM workers.
- [ ] Add output snapshots for every grouping mode.
- [ ] Add deterministic whole-app stress tests with edge-density limits.

## Documentation screenshots

- [ ] Add optional screenshot generation for AL UI-test documentation without
  introducing a second authoritative test implementation. Screenshot capture
  must remain opt-in and must consume the AL-derived documentation contract.
