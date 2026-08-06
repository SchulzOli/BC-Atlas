# UI-test documentation roadmap

## Goal

Extend `bca docs generate` from a single, linear guide generator into a linked
documentation set derived from AL UI tests. The AL test remains the executable
source of truth.

The first scope includes:

- stable document IDs;
- links between scenarios;
- typed prerequisites;
- one built-in tag glossary for maintainers, documentation authors, and LLMs;
- corpus-wide validation for duplicate IDs and broken links;
- terminal commands for every documentation operation;
- an optional local web control center over the same command application layer.

Screenshots, monitoring, troubleshooting, orchestration, localization, and
other documentation types remain separate follow-up work.

## Design assumptions

- A link target is a document ID, not a procedure name or filename.
- Document IDs use lowercase kebab case and are unique within one generated
  documentation set.
- Repeated tags preserve source order.
- Existing UI tests remain valid while authors migrate to explicit IDs and
  typed prerequisites.
- Generated titles are resolved from target documents. Link tags do not carry
  duplicate display text.
- Tag rules are built into BC Atlas. Users do not create a tag configuration or
   scenario JSON file.
- AL UI-test files are the only persisted scenario source.
- Every operation works without a browser.
- The web interface has no independent business logic or document store.

## CLI-first architecture

AL UI tests remain the executable and persisted source. A headless JavaScript
application layer loads, validates, modifies, saves, and transforms that
source. Both the CLI and local HTTP server call this same layer.

```text
                         +-------------------+
Terminal -> CLI -------->|                   |
                         | Documentation     |-> AL UI-test files
Browser -> local server ->| application core |-> generated Markdown
                         |                   |-> diagnostics
                         +-------------------+
```

The CLI controls process startup, input roots, write permissions, output
locations, and shutdown. The server is started by a CLI command and binds to
loopback only by default.

| Concern | Owner | Reason |
| --- | --- | --- |
| Test discovery | AL `[Test]` attribute | The AL compiler and test framework define what is executable. |
| UI pages, fields, actions, and values | AL `TestPage` code | Object and member references stay synchronized with application code through compilation. |
| Setup and test data | AL test libraries and factories | Setup remains executable, reusable, and validated against AL types. |
| Expected behavior | AL assertions plus `[THEN]` text | Assertions verify behavior; the tag explains the observable result to a reader. |
| Controlled prerequisite and link kinds | Built-in JavaScript definitions | BC Atlas defines the supported vocabulary; users do not maintain configuration. |
| Document IDs and link targets | JavaScript corpus validator | IDs are strings in comments and require set-wide uniqueness and reference checks. |
| Bracket-tag parsing | JavaScript | Comments are not visible to AL runtime code and are not type-checked by the AL compiler. |
| Tag glossary and LLM contract | Built-in JavaScript definitions plus generated Markdown | One internal definition prevents human and LLM instructions from drifting. |
| Scenario catalog and interlinks | JavaScript | Resolution requires reading many files before any guide is rendered. |
| Markdown, indexes, navigation, and paths | JavaScript | These are deterministic documentation transformations, not application behavior. |
| Diagnostics and CI exit status | JavaScript application core | CLI and server report the same validation result. |
| Interactive editing | Local web interface | Provides forms and navigation, then delegates changes to the application core. |
| Persistence | AL source writer | Updates documentation comments in the selected test procedure; no sidecar scenario files. |

### Shared application core

JavaScript owns all creation and transformation of documentation:

1. Parse bracket tags from AL comments into the neutral documentation model.
2. Validate tag names, cardinality, ID syntax, uniqueness, links, and cycles.
3. Derive user steps from `TestPage` operations without executing or copying
   the AL test.
4. Resolve titles and links through the corpus catalog.
5. Generate Markdown guides, glossary pages, indexes, and machine-readable
   diagnostics.
6. Apply metadata edits back to the correct AL procedure without rewriting its
   executable statements.
7. Keep output deterministic and fail CI in strict mode.

The core exposes ordinary JavaScript functions. It must not depend on terminal,
HTTP, DOM, or browser APIs. The CLI and server are thin adapters.

### Built-in tag definitions

Bracket tags are the only metadata authoring format. BC Atlas keeps their
definitions internally in JavaScript so the parser, validator, glossary, LLM
instructions, editor forms, and Markdown renderer share one vocabulary. This
is implementation code, not a user configuration surface.

The AL test remains authoritative for executable behavior. Tags are
authoritative for editorial metadata such as document identity, prose, typed
prerequisites, and cross-document relationships.

## Terminal and web parity

Every web action must map to an application operation that is also exposed by
the CLI.

| Operation | Terminal | Web control center |
| --- | --- | --- |
| Load scenarios | `bca docs list <root>` | Scenario navigation |
| Inspect one scenario | `bca docs show <root> --id <id>` | Scenario detail view |
| Validate corpus | `bca docs validate <root>` | Diagnostics panel |
| Set metadata | `bca docs set <root> --id <id> --tag <tag> --value <value>` | Metadata form |
| Remove metadata | `bca docs unset <root> --id <id> --tag <tag> [--value <value>]` | Remove control |
| Add or remove links | `set` and `unset` with a relationship tag | Link editor |
| Save changes | Each mutation writes AL, or `--dry-run` previews a patch | Save button |
| Generate Markdown | `bca docs generate <root>` | Generate action |
| Show glossary | `bca docs glossary` | Glossary/help view |
| Start web UI | `bca docs serve <root>` | Opens through the printed local URL |

All read commands support human-readable terminal output and `--format json`
for automation. JSON is an output and HTTP transport format only; it is never
the authored or persisted scenario format. Mutation commands support
`--dry-run`, return a nonzero exit code on validation failure, and identify the
changed AL file and procedure.

### Terminal pipeline contract

- Commands are non-interactive unless the user explicitly starts `serve`.
- Data goes to standard output; diagnostics and progress go to standard error.
- `--format json` writes one complete machine-readable result and no decorative
   text to standard output.
- Exit code `0` means success, `1` means validation or requested-operation
   failure, and `2` means invalid command usage.
- Read commands never modify AL or generated documentation.
- Mutation commands accept all required values as arguments and support
   `--dry-run`; they do not open an editor or ask terminal questions.
- `generate` can write files or emit Markdown to standard output when one
   scenario is selected.
- `serve` is the only long-running command. The CLI owns its lifecycle and
   reports the selected loopback URL on startup.

The server adapter calls the shared application functions directly. It does
not spawn nested CLI processes, but its behavior and results must remain
equivalent to the corresponding terminal commands.

## Local control center

Keep the first interface deliberately small:

- left navigation for features and scenarios;
- scenario details with source file and procedure;
- editable document ID, scenario text, prerequisites, permissions, and links;
- searchable selectors for link targets;
- inline validation diagnostics;
- generated Markdown preview;
- explicit Save and Generate actions.

Use Node's built-in HTTP server and static HTML, CSS, and browser JavaScript for
the first version. Do not add a frontend framework, database, authentication,
WebSocket layer, or background daemon yet. Bind to `127.0.0.1`, choose an
available port, print the URL, and stop cleanly on process termination.

The server API mirrors application operations, for example:

```text
GET    /api/commands
POST   /api/commands
```

HTTP request bodies may use JSON as transport. The server immediately applies
approved edits to AL comments through the shared source writer; it does not
save a JSON project or scenario model.

## Proposed source convention

```al
[Test]
procedure EDIPartnersList_NewPartner_PersistsGeneralFields()
begin
    // [DOC-ID] edi-partner-create
    // [FEATURE] edi-partner
    // [SCENARIO] Create an EDI partner from the partner list.
    // [PERMISSIONS] EDI Partner, Edit

    // [GIVEN] [SETUP] EDI processing is configured.
    // [GIVEN] [MASTER-DATA] The required communication profile exists.
    // [GIVEN] [ENVIRONMENT] The external endpoint is reachable.
    // [GIVEN] [FEATURE-FLAG] EDI partner management is enabled.
    // [GIVEN] [STATE] No partner with the selected code exists.

    // [WHEN] The user creates the partner.
    // ... TestPage operations ...

    // [THEN] The partner is saved.
    // [REQUIRES] edi-setup-configure
    // [NEXT] edi-first-exchange
    // [RELATED] edi-partner-edit
    // [ALTERNATIVE] edi-partner-import
end;
```

## Canonical tag glossary

The glossary covers documentation comment tags. `[Test]` is an AL attribute
and remains the marker used to discover executable test procedures.

| Tag | Cardinality | Value | Meaning and generated behavior |
| --- | --- | --- | --- |
| `[DOC-ID]` | Exactly one after migration | Lowercase kebab-case ID | Stable document identity and output filename. Must not change when a procedure is renamed. |
| `[FEATURE]` | Zero or more | Stable feature name or ID | Classifies the guide for indexes and future feature pages. Canonical syntax omits brackets around the value. |
| `[SCENARIO]` | Exactly one | User-oriented sentence | Defines the guide goal and fallback title or expected result. |
| `[PERMISSIONS]` | Zero or more | Permission-set display name | Adds a permission prerequisite. Repeat the tag for multiple permission sets. |
| `[PERMISSION]` | Zero or more | Permission-set display name | Backward-compatible alias for `[PERMISSIONS]`; new sources use `[PERMISSIONS]`. |
| `[GIVEN]` | Zero or more | Optional type qualifier followed by a sentence | Defines a prerequisite. Untyped entries remain valid and render as general prerequisites. |
| `[SETUP]` | At most one qualifier per `[GIVEN]` | Prerequisite qualifier | Marks required Business Central or extension setup. |
| `[MASTER-DATA]` | At most one qualifier per `[GIVEN]` | Prerequisite qualifier | Marks required master or reference data. |
| `[ENVIRONMENT]` | At most one qualifier per `[GIVEN]` | Prerequisite qualifier | Marks company, tenant, service, endpoint, or environment conditions. Never include secrets. |
| `[FEATURE-FLAG]` | At most one qualifier per `[GIVEN]` | Prerequisite qualifier | Marks a feature, capability, or configuration switch that must be enabled. |
| `[STATE]` | At most one qualifier per `[GIVEN]` | Prerequisite qualifier | Marks required process or record state, including completion of earlier work. |
| `[WHEN]` | One or more for procedural guides | User-oriented phase sentence | Creates an ordered phase and contains derived `TestPage` steps until the next phase or outcome. |
| `[THEN]` | Zero or more | Observable outcome sentence | Defines expected results. When absent, `[SCENARIO]` remains the fallback. |
| `[WHEN]/[THEN]` | Compatibility form | Optional sentence | Represents a combined action and outcome marker already accepted by the parser. Do not use it when separate user steps and outcomes can be stated. |
| `[REQUIRES]` | Zero or more | Target `[DOC-ID]` | Adds a hard prerequisite link. The target guide should be completed first. |
| `[NEXT]` | Zero or more | Target `[DOC-ID]` | Adds a recommended next guide after successful completion. |
| `[RELATED]` | Zero or more | Target `[DOC-ID]` | Adds a non-sequential related guide. |
| `[ALTERNATIVE]` | Zero or more | Target `[DOC-ID]` | Adds another guide that achieves a comparable goal or follows a mutually exclusive path. |

Unknown uppercase documentation tags are errors in strict corpus validation
and warnings during single-document generation. Lowercase bracketed feature
values used by existing sources, such as `[FEATURE] [edi-partner]`, remain
accepted during migration but are normalized to `edi-partner`.

## LLM authoring contract

An LLM that writes or updates AL UI tests must use the glossary above as a
closed vocabulary.

1. Preserve existing `[DOC-ID]` values during renames and wording changes.
2. Create IDs from the business goal, not the procedure or file name.
3. Reference only known document IDs in link tags. Do not invent targets.
4. Put one link target or permission value on each comment line.
5. Use `[REQUIRES]` only when the target must be completed first; use
   `[RELATED]` when the relationship is informational.
6. Use `[NEXT]` for a recommended continuation, not for every related guide.
7. Use `[ALTERNATIVE]` only for comparable or mutually exclusive paths.
8. Write prerequisites as observable user conditions. Do not describe test
   fixture implementation.
9. Apply at most one typed qualifier to each `[GIVEN]` line.
10. Never place credentials, tokens, connection strings, personal data, or
    customer-specific values in documentation tags.
11. Keep `[WHEN]` and `[THEN]` text user-oriented and leave detailed UI actions
    to the derived `TestPage` guidance.
12. Preserve tags that the LLM does not need to change.

The implementation should expose this contract through `bca docs glossary`
and the web help view instead of duplicating rules in prompts. Built-in tag
definitions should generate or validate both the Markdown glossary and compact
LLM reference.

## Target documentation model

Each parsed scenario should add these fields to the existing documentation
value:

```json
{
  "id": "edi-partner-create",
  "idSource": "explicit",
  "prerequisites": [
    { "type": "setup", "text": "EDI processing is configured." }
  ],
  "links": {
    "requires": ["edi-setup-configure"],
    "next": ["edi-first-exchange"],
    "related": ["edi-partner-edit"],
    "alternative": ["edi-partner-import"]
  }
}
```

The existing string prerequisite fields can remain temporarily for renderer
compatibility, but new code should consume the structured collection.

## Implementation milestones

### Milestone 0: Headless application core

1. Extract loading, parsing, validation, and rendering behind ordinary
   JavaScript functions independent of CLI and HTTP.
2. Add built-in tag definitions with names, cardinality, value shape, aliases,
   qualifier rules, and relationship behavior.
3. Add corpus loading for an AL file or directory without creating a scenario
   manifest.
4. Define stable diagnostics and operation result objects shared by CLI and
   server.

Acceptance criteria:

- Every supported bracket tag has exactly one built-in definition.
- Unknown uppercase tags produce a diagnostic with source context.
- Core functions run in Node tests without starting a CLI or HTTP server.
- No JavaScript module reimplements Business Central UI behavior.

### Milestone 1: Tag contract and stable IDs

1. Parse `[DOC-ID]` through the built-in definition and validate lowercase
   kebab case.
2. Use the explicit ID for the generated filename.
3. Fall back to the procedure-derived ID with a migration warning when
   `[DOC-ID]` is absent.
4. Reject duplicate `[DOC-ID]` tags within one scenario.
5. Document the source convention and LLM authoring contract.

Acceptance criteria:

- Renaming a procedure does not rename its generated document when `[DOC-ID]`
  is present.
- Invalid and repeated IDs produce actionable diagnostics.
- Existing tests without `[DOC-ID]` still generate the same filenames.
- Parser and renderer tests cover explicit and fallback IDs.

### Milestone 2: Typed prerequisites

1. Parse an optional supported qualifier immediately after `[GIVEN]`.
2. Store prerequisites as `{ type, text }` values.
3. Render grouped prerequisite sections for permissions, setup, master data,
   environment, feature flags, process state, and general conditions.
4. Preserve source order inside each group.
5. Warn for unknown or multiple qualifiers.

Acceptance criteria:

- Untyped `[GIVEN]` comments retain their current output.
- Every supported qualifier renders under the correct heading.
- Empty prerequisite groups are omitted.
- Secrets are not inferred or copied from executable setup code.

### Milestone 3: Link parsing and rendering

1. Parse `[REQUIRES]`, `[NEXT]`, `[RELATED]`, and `[ALTERNATIVE]` as repeated
   target-ID lists.
2. Render links only after targets have been resolved through a documentation
   catalog.
3. Use the target title as link text and the target ID as the Markdown path.
4. Render separate sections for prerequisites, next steps, related guides, and
   alternatives; omit empty sections.
5. Keep single-document generation deterministic when unresolved targets are
   not available locally.

Acceptance criteria:

- Every relationship kind has a focused parser and Markdown test.
- Repeated targets are deduplicated without changing first-seen order.
- Self-links and malformed target IDs produce diagnostics.
- Markdown links remain valid after source file or procedure renames.

### Milestone 4: Corpus generation and validation

1. Complete directory input to build a catalog of UI-test scenarios before
   rendering.
2. Index scenarios by explicit document ID.
3. Detect duplicate IDs and broken targets.
4. Validate relationship rules: self-links, optional reciprocal alternatives,
   and cycles in hard `[REQUIRES]` dependencies.
5. Add strict mode so CI fails on duplicate IDs, broken links, invalid tags,
   and hard prerequisite cycles.
6. Generate all Markdown files only after catalog validation succeeds.

Acceptance criteria:

- A corpus with valid cross-file links generates deterministic Markdown.
- Duplicate IDs, missing targets, and `[REQUIRES]` cycles fail strict mode with
  source file and procedure context.
- Single-file generation remains supported for local authoring.
- CI can regenerate a documentation directory and verify a clean worktree.

### Milestone 5: Safe AL metadata editing

1. Locate the exact tagged-comment regions in a selected test procedure.
2. Add, update, reorder, and remove supported tags while preserving executable
    AL statements and unrelated comments byte-for-byte where practical.
3. Add CLI `set` and `unset` commands with `--dry-run` patch previews.
4. Reparse and validate the affected corpus before committing the file write.
5. Reject stale edits when the source changed after it was loaded.

Acceptance criteria:

- CLI edits change only the selected procedure's documentation comments.
- Invalid edits never write a partial AL file.
- `--dry-run` shows the intended change without modifying disk.
- Reparse-after-write returns the requested metadata and clean diagnostics.

### Milestone 6: Local server and control center

1. Add `bca docs serve <root>` using Node's built-in HTTP server.
2. Expose thin API routes over the shared application operations.
3. Add the static control-center shell and scenario navigation.
4. Add metadata forms, link selection, diagnostics, preview, Save, and Generate.
5. Add browser smoke tests for load, edit, save-back, validation, and generation.

Acceptance criteria:

- Every web mutation has an equivalent documented CLI command.
- Server and CLI produce equivalent models and diagnostics for the same root.
- Reloading after Save reads the changed values from AL, not server memory.
- Closing the server loses no authored state because AL files are the store.
- The server listens on loopback and never opens a network interface by
   default.

### Milestone 7: Indexes and migration completion

1. Generate a documentation index grouped by feature.
2. Include orphan guides that have no incoming or outgoing links.
3. Provide a validation report for missing explicit IDs and untyped
   prerequisites.
4. Migrate checked-in examples to canonical tags.
5. After a documented deprecation period, allow strict mode to require
   `[DOC-ID]` for corpus generation.

Acceptance criteria:

- Users can enter the documentation set through a generated index.
- Every generated link resolves to a generated file.
- Migration diagnostics identify the exact source procedure to update.
- The existing example demonstrates IDs, typed prerequisites, and all four
  relationship kinds without customer-specific data.

## Suggested implementation order by file

1. `src/docs/model.js`: shared corpus operations and result model.
2. `src/docs/tags.js`: built-in tag definitions and validation rules.
3. `src/docs/al-ui-source.js`: parse IDs, qualifiers, and relationship tags.
4. `src/docs/al-ui-writer.js`: make focused, validated comment edits.
5. `test/docs.test.js`: lock down parsing, editing, validation, and rendering.
6. `src/docs/markdown.js`: render grouped prerequisites and resolved links.
7. `src/docs/cli.js`: expose every headless operation as a terminal command.
8. `src/docs/server.js`: adapt HTTP requests to shared operations.
9. `src/docs/web/`: static control-center HTML, CSS, and browser JavaScript.
10. `docs/al-ui-test-documentation.md`: publish the authoring convention.
11. `docs/cli-reference.md`: document commands, output formats, and exit codes.

## Deferred decisions

- Whether corpus input additionally needs repeatable files after directory and
   single-file inputs are implemented. Do not add a manifest initially.
- Whether reciprocal `[ALTERNATIVE]` links are required or only recommended.
- Whether indexes should be one file or split by feature.
- Whether mutation commands write immediately by default or require an
   explicit `--write`. Prefer immediate writes with `--dry-run`, matching common
   formatting tools.