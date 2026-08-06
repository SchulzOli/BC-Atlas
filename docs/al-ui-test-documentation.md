# Generate documentation from AL UI tests

BC Atlas converts AL `[Test]` procedures directly into Markdown. AL UI-test
files are the only persisted source for scenarios and documentation metadata.
The CLI and local control center use the same JavaScript application functions.

```text
AL TestPage test -> BC Atlas -> Markdown
```

No browser automation, generated JavaScript test, AI agent, or YAML scenario is
involved.

## Source convention

The selected procedure must have `[Test]` and a `[SCENARIO]` comment. The
standard test comments provide the documentation:

```al
[Test]
procedure EDIPartnersList_NewPartner_PersistsGeneralFields()
var
    EDIPartner: Record EDIPartner;
    EDIPartnersList: TestPage EDIPartners;
begin
    // [DOC-ID] edi-partner-create
    // [FEATURE] edi-partner
    // [SCENARIO] Creating a new partner from the EDI Partners list persists the general fields.
    // [PERMISSIONS] EDI Partner, Edit

    // [GIVEN] No partner exists yet.
    PartnerFactory.CleanupPartnerData();

    // [WHEN] A user creates a new partner from the list page.
    EDIPartnersList.OpenNew();
    EDIPartnersList.PartnerCode.SetValue('P-UI-LIST');
    EDIPartnersList.Name.SetValue('UI List Partner');
    EDIPartnersList.Close();

    // [THEN] The partner persisted with the values entered in the list.
    EDIPartner.Get('P-UI-LIST');
    Assert.AreEqual(
        'UI List Partner',
        EDIPartner.Name,
        'Partner name should have been saved from the list.');
end;
```

| AL source | Markdown |
| --- | --- |
| `[DOC-ID]` | Stable identity and output filename |
| `[SCENARIO]` | Title and summary |
| `[PERMISSIONS]` | Required permission sets under “Before you start” |
| `[GIVEN]` | User-friendly preparation guidance |
| `TestPage` calls | Detailed page, field, action, and save steps |
| `[WHEN]` | Numbered user phase and context for derived TestPage steps |
| `[THEN]` | Expected results |
| `[TEARDOWN]` | Recognized test cleanup; omitted from the user guide |

When `[THEN]` has no text, the `[SCENARIO]` sentence is used as the expected
result. Explicit `[THEN]` text is preferred.

Each `[WHEN]` comment becomes a numbered phase. Supported `TestPage` operations
following that comment are rendered as detailed steps beneath the phase.
BC Atlas also follows reachable local procedure calls when a helper contains
`TestPage` work. Setup-only helpers are not expanded.

Within expanded UI helpers, `repeat` blocks are summarized as “for each record”
instructions and UI operations guarded by `if` are described as conditional.
Expansion is cycle-safe and limited to eight helper levels.

`[PERMISSIONS]` is optional and may be repeated for multiple permission sets.
`[PERMISSION]` is accepted as an alias. When neither tag is present, no
permission entry is generated and documentation generation continues normally.

## Metadata tags

| Tag | Value | Purpose |
| --- | --- | --- |
| `[DOC-ID]` | lowercase hyphenated ID | Stable scenario identity, independent of procedure renames. |
| `[FEATURE]` | text | Feature or domain classification. |
| `[SCENARIO]` | sentence | Scenario title and goal. |
| `[PERMISSIONS]` | text | Required permission set. `[PERMISSION]` is an alias. |
| `[GIVEN]` | sentence | General prerequisite. |
| `[GIVEN] [SETUP]` | sentence | Required application setup. |
| `[GIVEN] [MASTER-DATA]` | sentence | Required master data. |
| `[GIVEN] [ENVIRONMENT]` | sentence | Required environment condition. |
| `[GIVEN] [FEATURE-FLAG]` | sentence | Required feature state. |
| `[GIVEN] [STATE]` | sentence | Required business state. |
| `[WHEN]` | sentence | User phase or action. |
| `[THEN]` | sentence | Expected result. |
| `[TEARDOWN]` | sentence | Test cleanup that is excluded from the generated workflow. |
| `[REQUIRES]` | document ID | Hard prerequisite guide. Cycles are invalid. |
| `[NEXT]` | document ID | Recommended next guide. |
| `[RELATED]` | document ID | Related guide. |
| `[ALTERNATIVE]` | document ID | Alternative path. |

Use one fact per comment. Use exact document IDs for relationships. Do not
invent a target ID: `bca docs list <root>` shows available IDs, and
`bca docs validate <root>` reports duplicate IDs, invalid IDs, broken or
self-referencing links, and `[REQUIRES]` cycles.

## Generate Markdown

```powershell
$uiTest = "C:\Repos\App-Test\src\Partner\UITest\EDIPartnerCardUITest.Codeunit.al"

bca docs generate $uiTest `
  --procedure EDIPartnersList_NewPartner_PersistsGeneralFields
```

An AL file containing exactly one `[Test]` procedure does not require
`--procedure`. A procedure can also be selected with:

```text
path/to/UITest.Codeunit.al#ProcedureName
```

The default output directory is `docs/generated`. Override it with:

```powershell
bca docs generate $uiTest `
  --procedure EDIPartnersList_NewPartner_PersistsGeneralFields `
  --output-dir artifacts/docs
```

Generated Markdown contains only the AL file name, procedure name, and SHA-256
fingerprint; it does not expose a local repository path. It is deterministic:
generating from unchanged AL produces the same file. Literal test values are
presented as examples so readers know to choose values appropriate for their
environment.

For a directory, BC Atlas generates every documented scenario plus
`index.md`:

```powershell
bca docs validate test/UITest
bca docs generate test/UITest --output-dir docs/generated
```

## Inspect and edit metadata

All metadata operations work in a terminal and support machine-readable output:

```powershell
bca docs list test/UITest --format json
bca docs show test/UITest --id edi-partner-create --format json
bca docs glossary --format json
bca docs automation test/UITest --provider github --format json
bca docs set test/UITest --id edi-partner-create --tag RELATED --value edi-partner-edit
bca docs unset test/UITest --id edi-partner-create --tag RELATED --value edi-partner-edit
```

Add `--dry-run` to preview a mutation without writing AL. Mutations only alter
documentation comments inside the selected test procedure. The writer reparses
and validates the result before atomically replacing the source file.

Start the optional local control center with:

```powershell
bca docs serve test/UITest
```

The command prints its `127.0.0.1` URL. The browser UI reads and updates AL
through the same operations as the CLI; it has no database or independent
scenario store. The central dashboard uses `list`, `show`, `validate`,
`generate`, `set`, `unset`, `glossary`, and `automation` for its overview,
scenario workspace, quality view, automation workflow, glossary, and generation
actions. `serve` remains
terminal-controlled because it hosts the interface itself.

## Verification and CI

Run the AL UI test with the normal Business Central test framework. Then
generate its documentation and check that the repository remains clean:

```yaml
- name: Generate AL UI-test documentation
  run: >
    node src/cli.js docs generate
    ../App-Test/src/Partner/UITest/EDIPartnerCardUITest.Codeunit.al
    --procedure EDIPartnersList_NewPartner_PersistsGeneralFields

- name: Verify generated documentation is current
  run: git diff --exit-code -- docs/generated
```

The test repository should be checked out at the revision corresponding to the
application being documented.

`bca docs automation <root>` produces the same three-step workflow for GitHub
Actions or Azure Pipelines. It checks the live corpus before presenting the
pipeline and does not maintain a separate automation configuration.

## Screenshots

Screenshot generation is intentionally not part of the current workflow. A
future, opt-in capture feature is recorded in [todo.md](../todo.md). It must
consume the AL-derived contract without becoming a second authoritative test.
