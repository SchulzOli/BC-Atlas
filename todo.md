
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

- [ ] Allow custom role mappings in `.bca.json`.
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


---

**Architecture Topics**
Beyond dependencies, monitoring, and orchestration:

1. **Multi-app architecture**  
   Separate Foundation, Warehouse, Integration, UI, and Operations apps.

2. **Allowed dependency direction**  
   Show valid dependencies and one intentional violation detected through `forbiddenDependencies`.

3. **External integrations**  
   Demonstrate APIs, `HttpClient`, webhooks, file exchange, and external systems.

4. **Asynchronous processing**  
   Include Job Queue entries, background sessions, inbox/outbox tables, and event-driven processing.

5. **Failure handling**  
   Model retry, timeout, dead-letter, manual recovery, and escalation paths.

6. **Idempotency**  
   Show duplicate-message protection and safe operation retries.

7. **Transaction boundaries**  
   Expose commits, rollback expectations, and partial-processing risks.

8. **Data ownership**  
   Identify which module owns each table and which modules may only read it.

9. **Data lifecycle**  
   Cover archive, retention, cleanup, and audit requirements.

10. **Security architecture**  
    Include permission sets, indirect access, least privilege, and separation of duties.

11. **Trust boundaries**  
    Distinguish user input, internal modules, dependent apps, and external services.

12. **Extensibility**  
    Demonstrate interfaces, enum implementations, events, and extension objects as intentional extension points.

13. **Configuration architecture**  
    Include setup tables, feature flags, tenant configuration, and environment-specific endpoints.

14. **Upgrade and migration**  
    Show install/upgrade codeunits, schema migration, compatibility, and obsolete interfaces.

15. **Performance risks**  
    Demonstrate batch processing, high-coupling hubs, repeated writes, and potential large-table reads.

16. **Architecture health**  
    Include cycles, orphan modules, excessive fan-in/fan-out, unresolved dependencies, and unused contracts.

17. **Operational ownership**  
    Associate workflows and failures with the responsible operational module or team.

18. **Business continuity**  
    Demonstrate resume-after-failure, reconciliation, replay, and manual intervention.

19. **Compliance and privacy**  
    Mark sensitive data, audit access, retention rules, and external data movement.

20. **Environment topology**  
    Represent development, test, production, external endpoints, and dependency-version compatibility.

---

Updated todo list

Got it: the target is the UI-test-to-Markdown documentation pipeline, not the architecture diagram demo. I’ll inspect its source contract, generated example, and tests, then collect enterprise-documentation improvements such as linked journeys, prerequisites, orchestration, monitoring, ownership, and traceability without changing code.

Read [](file:///c%3A/Users/Oliver.Schulz/Desktop/ALD2Tree/docs/al-ui-test-documentation.md)

Read [](file:///c%3A/Users/Oliver.Schulz/Desktop/ALD2Tree/docs/generated/edi-partners-list-new-partner-persists-general-fields.md)

Read [](file:///c%3A/Users/Oliver.Schulz/Desktop/ALD2Tree/src/docs/al-ui-source.js#1-1), lines 1 to 420

Read [](file:///c%3A/Users/Oliver.Schulz/Desktop/ALD2Tree/src/docs/markdown.js)

Read [](file:///c%3A/Users/Oliver.Schulz/Desktop/ALD2Tree/src/docs/cli.js)

The current output is deliberately a single-procedure, linear task guide. The main enterprise gap is that it documents actions well but not how documents relate across a business journey, who owns them, what automated processing happens afterward, or how support verifies and recovers the process; I’ll inspect the remaining metadata model to identify exactly where richer concepts could fit.

Read [](file:///c%3A/Users/Oliver.Schulz/Desktop/ALD2Tree/src/docs/al-ui-source.js#420-420), lines 420 to 485

No matches found. Your search pattern might be excluded completely by either the search.exclude settings or .*ignore files.
If you believe that it should have results, you can check into the .*ignore files and the exclude setting (here are some excluded patterns for reference:[**/node_modules,**/bower_components,**/*.code-search]).
Then if you want to include those files you can call the tool again by setting "includeIgnoredFiles" to true.

Searched for regex `guideSections|guidePrerequisites|guideExpected|permissions|actions|expandedHelpers|sourceHash` (`**/src/docs/**`), 21 results

Read [](file:///c%3A/Users/Oliver.Schulz/Desktop/ALD2Tree/test/docs.test.js)

Understood. The improvement target is **enterprise-grade documentation generated from AL UI tests**.

**Key Ideas**
1. **Document interlinks**  
   Add `[REQUIRES]`, `[NEXT]`, `[RELATED]`, and `[ALTERNATIVE]` links between scenarios.
3. **Stable document IDs**  
   Use explicit `[DOC-ID]` values so links survive procedure renames.
17. **Prerequisite types**  
    Separate permissions, setup, master data, environment, feature flags, and previous process state.




2. **End-to-end journeys**  
   Combine multiple UI tests into one business process, such as setup → create → approve → post → monitor.
5. **Automatic indexes**  
   Generate indexes by feature, role, module, page, business process, and permission.
6. **Navigation graph**  
   Generate a Mermaid diagram showing prerequisites, branches, and subsequent guides.
18. **Postconditions**  
    Describe records created, statuses changed, integrations invoked, and follow-up work triggered.
27. **Glossary links**  
    Link Business Central and domain terminology to a generated glossary.


4. **Part dependencies**  
   Express that one guide requires another guide, setup task, master data, extension, or external service.
7. **Process orchestration**  
   Group scenarios into ordered stages with parallel paths, decisions, waiting states, and human approvals.
8. **Background processing**  
   Explain what continues after the UI interaction: Job Queue, events, scheduled tasks, APIs, or workflows.
12. **Troubleshooting**  
    Add `[TROUBLESHOOT]` entries connecting symptoms to checks and recovery actions.
28. **Screenshots**  
    Attach optional screenshots to AL-derived steps without making screenshot automation authoritative.

9. **Monitoring instructions**  
   Add `[MONITOR]` steps describing where users or support teams verify processing.
11. **Failure documentation**  
    Generate guides from negative UI tests: validation errors, permission failures, unavailable services, and rejected approvals.
14. **Escalation paths**  
    Identify when users should stop and contact support or an administrator.
16. **Separation of duties**  
    Show when different roles must execute different stages.
21. **Integration dependencies**  
    Document required endpoints, credentials, companies, external systems, and connection health.
25. **Version applicability**  
    Add minimum app/runtime version, deprecated workflows, and replacement guides.
23. **Decision branches**  
    Represent conditional paths such as approval required/not required or mapping found/not found.
29. **Traceability**  
    Include app version, commit, test procedure, source hash, and latest successful test execution.
30. **Coverage reporting**  
    Report UI tests without documentation and pages/actions without documented workflows.
31. **Documentation linting**  
    Detect missing outcomes, vague prerequisites, broken links, circular dependencies, and empty process stages.
32. **Multiple output levels**  
    Generate concise user guides, administrator guides, support runbooks, and audit evidence from the same source.

**Possible Tag Vocabulary**
```al
// [DOC-ID] edi-partner-onboarding
// [ROLE] EDI Administrator
// [OWNER] Integration Operations
// [REQUIRES] edi-provider-setup
// [NEXT] edi-first-exchange
// [RELATED] edi-partner-troubleshooting
// [MONITOR] Verify the exchange status on the EDI Exchanges page.
// [RECOVERY] Correct unresolved mappings and rerun the current step.
// [CLEANUP] Remove incomplete exchange records when processing is cancelled.
```
