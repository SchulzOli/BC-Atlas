# UI documentation package plan

Use this matrix to select the scope of the UI documentation package.
Delete a row to remove it from the plan. Change `Keep` to `Change` or `Remove`
when a decision needs review.

## Target output

```text
Docu/UI/
  index.md
  metadata.yml
  <ProcedureName>.md
```

AL UI tests remain the only source. The package contains generated files only.

## Source contract

The AL procedure name is always the document name. For example,
`ConfigureTradingPartner` produces `ConfigureTradingPartner.md`. A generated
Markdown title can differ from the document name.

BC Atlas calculates the globally unique document ID. It combines the exact
`id` from the owning `app.json`, a hyphen, and the exact test procedure name:

```text
<app.json id>-<TestProcedureName>
```

For app ID `11111111-2222-3333-4444-555555555555` and procedure
`ConfigureTradingPartner`, the document ID is:

```text
11111111-2222-3333-4444-555555555555-ConfigureTradingPartner
```

BC Atlas preserves the exact ID from `app.json`. Manifest and frontmatter
values quote the document ID. Users never maintain this value manually.

XML documentation metadata is optional. It enriches the generated package but
never controls whether BC Atlas can generate a guide. A UI test with only the
existing test tags must continue to work.

```al
/// <summary>
/// Processes an inbound PRICAT message.
/// </summary>
/// <bc-atlas
///     stage="execute"
///     role="edi-administrator">
///     <requires document="ConfigureTradingPartner" />
/// </bc-atlas>
[Test]
procedure ProcessInboundPRICAT()
begin
    // [SCENARIO] Process an inbound PRICAT message.

    // [GIVEN] The partner and schema are configured.

    // [WHEN] The user processes the inbound message.

    // [THEN] Processing completes successfully.
end;
```

Shared metadata can be defined on the test codeunit and inherited by its test
procedures:

```al
/// <bc-atlas
///     process="inbound-pricat"
///     owner="edi-operations"
///     type="user-guide" />
codeunit 50100 EDIInboundPRICATUIT
```

The `<bc-atlas>` element has no `document-id` attribute. BC Atlas writes the
calculated ID to generated frontmatter and `metadata.yml`. Existing `[DOC-ID]`
comments remain readable for compatibility but never control the calculated
ID or filename. New metadata writes do not add `[DOC-ID]` or XML `document-id`.

Within one app, `<requires document="ConfigureTradingPartner" />` references a
test procedure by name. For a cross-app reference, `document` contains the
complete calculated ID. BC Atlas resolves both forms and writes complete IDs
to generated output.

Square-bracket comments are reserved for test and workflow tags such as
`[SCENARIO]`, `[GIVEN]`, `[WHEN]`, `[THEN]`, and `[TEARDOWN]`. Static document
metadata belongs in the optional `<bc-atlas>` XML documentation element.

## Generated traceability metadata

`metadata.yml` is the primary machine-readable store. It contains app-level
metadata once per app and source metadata once per guide:

```yaml
apps:
  11111111-2222-3333-4444-555555555555:
    version: 1.2.3.4
    commit: abc123
guides:
  - documentId: 11111111-2222-3333-4444-555555555555-ConfigureTradingPartner
    appId: 11111111-2222-3333-4444-555555555555
    sourceFile: test/ConfigureTradingPartner.Codeunit.al
    procedure: ConfigureTradingPartner
    sourceSha256: 0123456789abcdef
```

Each guide repeats `sourceFile`, `procedure`, and `sourceSha256` in its YAML
frontmatter so that the Markdown file remains traceable when distributed
without `metadata.yml`. `sourceFile` is relative to the input root, and
`sourceSha256` hashes the owning AL source file bytes.

The app `version` comes from the owning `app.json`. The `commit` is written
only when CI or the caller supplies it explicitly; otherwise the field is
omitted. App version and commit stay at app level in `metadata.yml` and are not
repeated in guide frontmatter.

## Plan matrix

| ID | Priority | Area | Item | Result | Depends on | Decision | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| P01 | Must | Command | Add `bca docs package <root> --output-dir <dir>` | One command validates and writes the complete package. | Existing corpus loader | Keep | |
| P02 | Must | Command | Add `bca docs metadata <root> --output <file>` | Other tools can consume the documentation metadata without parsing Markdown. | P05 | Keep | |
| P03 | Must | Build | Use the AL procedure name as the document name and filename | `ConfigureTradingPartner` always produces `ConfigureTradingPartner.md`. | Test procedure | Keep | The filename does not contain the app ID or document ID. |
| P04 | Must | Build | Remove stale generated files | Deleted or renamed scenarios do not remain in the package. | P01 | Keep | Only remove files owned by the generator. |
| P05 | Must | Metadata | Generate one `metadata.yml` manifest | The package has one machine-readable catalog. | Existing corpus model | Keep | Add `schemaVersion`. |
| P06 | Must | Metadata | Add YAML frontmatter to each guide | Each Markdown file is independently machine-readable. | P05 | Keep | Use the Code Graph scalar format. |
| P07 | Must | Metadata | Read optional XML `role` metadata | The index can group guides by user role. | XML documentation parser and writer | Keep | Procedure value overrides the inherited object value. |
| P08 | Must | Metadata | Read optional XML `process` metadata | The index can group guides by business process. | XML documentation parser and writer | Keep | Prefer one process on the test codeunit. |
| P09 | Must | Metadata | Read optional XML `stage` metadata | A process can show setup, execution, monitoring, and recovery. | P08 | Keep | One value per procedure. |
| P10 | Should | Metadata | Read optional XML `owner` metadata | Users know which team owns the process or guide. | XML documentation parser and writer | Keep | Prefer one owner on the test codeunit. |
| P11 | Should | Metadata | Read optional XML `type` metadata | The package can distinguish user guides, admin guides, and support guides. | XML documentation parser and writer | Keep | Prefer one type on the test codeunit. |
| P11A | Must | Identity | Calculate `document-id` as `<app.json id>-<TestProcedureName>` | Every document has a stable cross-app identity without manual metadata. | Owning `app.json` and test procedure | Keep | Preserve the exact app ID and procedure name. |
| P12 | Must | Index | Link every generated guide | `index.md` remains the package entry point. | Existing index writer | Keep | Preserve the alphabetical list. |
| P13 | Must | Index | Add a process-by-role matrix | Users find a guide by business process and role. | P07, P08 | Keep | Each cell contains guide links. |
| P14 | Should | Index | Add ordered process journeys | Users can follow prerequisite links in sequence. | Optional XML `<requires>` elements | Keep | Resolve local procedure names or complete cross-app IDs. Store complete `requires` IDs and derive `next`. |
| P15 | Should | Command | Add `bca docs validate <root>` | Maintainers can list guides with missing role, process, or stage metadata without generating files. | P07, P08, P09 | Keep | `package` reports the same warnings; `--strict` makes warnings fail with a nonzero exit code. |
| P16 | Should | Navigation | Add Back, Index, and Next links to each guide | Users can move through a process without returning manually. | P14 | Keep | Use explicit `requires` and derived `next` relations only. |
| P17 | Must | Validation | Reject duplicate calculated IDs, filename collisions, and broken document references | Generated links remain valid. | P03, P11A | Keep | Procedure names may repeat across apps, but one output directory cannot contain duplicate filenames. |
| P18 | Must | Validation | Detect duplicate user-facing titles | The index does not show ambiguous links. | Corpus validation | Keep | Warning first. |
| P19 | Must | Validation | Validate optional XML metadata | Invalid roles, processes, stages, owners, types, and references fail early. | P07-P11A | Keep | Missing XML metadata is valid. |
| P20 | Should | Validation | Add `bca docs package --check` | CI detects stale package files without changing them. | P01 | Keep | Compare generated bytes. |
| P21 | Should | Traceability | Store app ID, calculated document ID, source file, procedure, and SHA-256 | Each guide identifies its exact AL source and app. | P11A and existing source metadata | Keep | Store per-guide values in `metadata.yml`; repeat relative `sourceFile`, `procedure`, and source-file `sourceSha256` in guide frontmatter. |
| P22 | Could | Traceability | Store app version and commit | Auditors can identify the documented build. | CI input | Change | Store once per app in `metadata.yml`. Read version from `app.json`; omit commit unless supplied explicitly. Do not repeat either value in guide frontmatter. |
| P27 | Could | Output | Generate a deterministic ZIP file | A complete package can be attached to a release. | P01-P06 | Change | Fix file order and archive timestamps. |

## Roadmap

The roadmap implements every matrix item once and follows dependency order.
Items with decision `Change` require explicit approval before implementation.

| Order | Phase | ID | Implementation step | Verification | Decision |
| --- | --- | --- | --- | --- | --- |
| 1 | Deterministic package | P03 | Use the exact AL test procedure name for each guide name and Markdown filename. | A mixed-case procedure produces a filename with identical casing. | Keep |
| 2 | Deterministic package | P11A | Find the owning `app.json` and calculate each document ID from its exact app ID and procedure name. | Changing the app ID changes all calculated document IDs together. | Keep |
| 3 | Deterministic package | P17 | Extend corpus validation for duplicate calculated IDs, filename collisions, and broken references. | Each collision or unresolved reference fails before files are written. | Keep |
| 4 | Deterministic package | P05 | Define the versioned `metadata.yml` schema and deterministic manifest writer. | Repeated writes of the same corpus are byte-identical. | Keep |
| 5 | Deterministic package | P06 | Render the agreed metadata subset as YAML frontmatter in every guide. | Each generated guide parses as valid frontmatter and matches its manifest entry. | Keep |
| 6 | Deterministic package | P21 | Add relative source file, procedure, source SHA-256, app ID, and calculated document ID to generated metadata. | Manifest and guide frontmatter contain matching per-guide traceability values. | Keep |
| 7 | Deterministic package | P12 | Generate `index.md` with an alphabetical link to every guide. | Every guide appears once and every index link resolves. | Keep |
| 8 | Deterministic package | P01 | Add `bca docs package <root> --output-dir <dir>` around validation and all package writers. | One command writes the complete validated package. | Keep |
| 9 | Deterministic package | P04 | Track generator-owned files and remove stale output during package generation. | Removing or renaming a source procedure removes only its stale generated guide. | Keep |
| 10 | Deterministic package | P02 | Add `bca docs metadata <root> --output <file>` using the same manifest model and writer. | The command output equals the package `metadata.yml` bytes. | Keep |
| 11 | Matrix metadata | P07 | Parse optional procedure- and codeunit-level XML `role` metadata with procedure override. | Inheritance and override fixtures produce the expected role. | Keep |
| 12 | Matrix metadata | P08 | Parse optional XML `process` metadata with the same inheritance rules. | Guides retain the expected process with and without procedure overrides. | Keep |
| 13 | Matrix metadata | P09 | Parse optional XML `stage` metadata. | Supported stages round-trip to the corpus, manifest, and frontmatter. | Keep |
| 14 | Matrix metadata | P10 | Parse optional XML `owner` metadata. | Owner inheritance and procedure override are covered by tests. | Keep |
| 15 | Matrix metadata | P11 | Parse optional XML `type` metadata. | Type inheritance and procedure override are covered by tests. | Keep |
| 16 | Matrix metadata | P19 | Validate optional XML values, inheritance, and references while accepting missing XML metadata. | Invalid metadata fails; a tag-only UI test remains valid. | Keep |
| 17 | Matrix metadata | P13 | Render the process-by-role matrix in `index.md`. | Every populated cell links to an existing guide and unclassified guides do not disappear. | Keep |
| 18 | Matrix metadata | P15 | Add `bca docs validate <root>` and share its diagnostics with `package`. | Missing classifications warn normally and fail both commands with `--strict`. | Keep |
| 19 | Guided navigation | P18 | Detect duplicate user-facing guide titles. | Duplicate titles produce a deterministic warning and remain distinguishable by document ID. | Keep |
| 20 | Guided navigation | P14 | Resolve XML `requires`, store complete IDs, derive inverse `next`, and render ordered journeys. | Local and cross-app references resolve; broken links and cycles fail validation. | Keep |
| 21 | Guided navigation | P16 | Render Back, Index, and Next links from the resolved journey graph. | First, middle, and last guides receive the correct navigation links. | Keep |
| 22 | Guided navigation | P20 | Add `bca docs package --check` as a write-free byte comparison. | Clean output exits zero; stale, missing, or extra generated files exit nonzero without modification. | Keep |
| 23 | Optional output | P22 | Read app version from `app.json` and accept an optional caller-supplied commit for app-level manifest metadata. | Version is always present; commit is present only when explicitly supplied. | Change |
| 24 | Optional output | P27 | Create a deterministic ZIP from the completed package. | Repeated archives have identical file order, timestamps, and bytes. | Change |

### Phase gates

| Phase | Exit gate |
| --- | --- |
| Deterministic package | P01-P06, P11A, P12, P17, and P21 pass focused tests; two package runs are byte-identical. |
| Matrix metadata | P07-P11, P13, P15, and P19 pass XML inheritance, validation, and matrix-link tests. |
| Guided navigation | P14, P16, P18, and P20 pass journey, navigation, title, and stale-output checks. |
| Optional output | P22 and P27 are implemented only after approval and preserve deterministic core output. |

## Decisions to resolve

| ID | Question | Default |
| --- | --- | --- |
| D01 | Should `metadata.yml` contain all guide content or metadata only? | Metadata only |
| D02 | Can one guide belong to multiple processes? | No. Use one inherited or procedure-level process. |
| D03 | Can one guide have multiple roles? | No in the first version. Use one inherited or procedure-level role. |
| D04 | Is XML `stage` a controlled list? | Yes: `setup`, `execute`, `monitor`, `recover` |
| D05 | Does `package` replace `generate`? | No. Keep `generate` compatible. |
| D06 | Should validation warnings fail `validate` or the package build? | Only with `--strict`; errors always fail. |
| D07 | What is the document name and filename? | The case-sensitive AL procedure name. |
| D08 | What is the document ID? | Exact `app.json` ID, hyphen, and exact test procedure name. |
| D09 | Is XML metadata required? | No. Existing test tags are sufficient. |
| D10 | Where are ordered links stored? | Store XML `requires`; derive `next`. |
| D11 | Is `document-id` manually configurable? | No. BC Atlas always calculates it. |

## Acceptance checks

- Run the package command twice and compare all bytes.
- Verify that every manifest file link exists.
- Verify that every generated guide appears in `index.md`.
- Verify that each filename exactly matches its case-sensitive procedure name.
- Verify that each document ID equals `<app.json id>-<TestProcedureName>`.
- Change the app ID and verify that all calculated IDs and resolved links change together.
- Verify that no writer adds XML `document-id` or `[DOC-ID]` metadata.
- Generate a complete package from tests that contain no `<bc-atlas>` XML.
- Verify that legacy `[DOC-ID]` input cannot change the calculated ID or filename.
- Verify that each matrix cell links to an existing guide.
- Run `bca docs validate <root>` and verify that it lists each guide and its missing `role`, `process`, or `stage` values without writing files.
- Run the package command for the same input and verify that it reports the same classification warnings.
- Run validation and package generation with `--strict` and verify that classification warnings produce a nonzero exit code.
- Verify that `metadata.yml` stores app version and an explicitly supplied commit once per app.
- Verify that each manifest guide entry and guide frontmatter contain the same relative source file, procedure, and source-file SHA-256.
- Generate without a supplied commit and verify that `metadata.yml` omits the commit field.
- Delete one source scenario and verify that its generated guide is removed.
- Change optional XML metadata and verify that the manifest, frontmatter, and matrix change together.
- Add one XML `requires` relation and verify that the inverse `next` link is generated.