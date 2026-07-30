# Generate documentation from AL UI tests

`bca docs generate` converts one AL `[Test]` procedure directly into
Markdown. The AL UI test remains the only executable implementation.

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
    // [FEATURE] [edi-partner]
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
| Procedure name | Stable output filename |
| `[SCENARIO]` | Title and summary |
| `[PERMISSIONS]` | Required permission sets under “Before you start” |
| `[GIVEN]` | User-friendly preparation guidance |
| `TestPage` calls | Detailed page, field, action, and save steps |
| `[WHEN]` | Numbered user phase and context for derived TestPage steps |
| `[THEN]` | Expected results |

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

## Screenshots

Screenshot generation is intentionally not part of the current workflow. A
future, opt-in capture feature is recorded in [todo.md](../todo.md). It must
consume the AL-derived contract without becoming a second authoritative test.
