# Generate documentation from AL UI tests

BC Atlas converts AL `[Test]` procedures directly into Markdown. AL UI-test
files are the only persisted source for scenarios and documentation metadata.
The CLI and the MCP server use the same JavaScript application functions.

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

The tags stay exactly as they are in your tests. BC Atlas arranges them in the
structure of an [OASIS DITA 1.3 task topic](https://docs.oasis-open.org/dita/dita/v1.3/dita-v1.3-part0-overview.html),
the open standard for step-by-step procedures:

| AL source | Generated output | DITA task element |
| --- | --- | --- |
| `[DOC-ID]` | Stable identity and output filename | `task/@id` |
| `[SCENARIO]` | Title and summary | `title`, `shortdesc` |
| `[FEATURE]` | Use case that groups scenarios | `keywords`, map `topichead` |
| `[PERMISSIONS]`, `[GIVEN]`, `[REQUIRES]` | “Before you start” | `prereq` |
| `[WHEN]` | Numbered user phase | `step` |
| `TestPage` calls | Page, field, action, and save instructions | `cmd` / `substep` |
| Field and action `ToolTip` (with `--app`) | Explanation below the instruction | `info` |
| `[THEN]` between two `[WHEN]` phases | Result of that phase | `stepresult` |
| `[THEN]` after the last `[WHEN]` | “What should happen” | `result` |
| `[NEXT]`, `[RELATED]`, `[ALTERNATIVE]` | Links to other guides | `related-links` |
| `[TEARDOWN]` | Recognized test cleanup; omitted from the user guide | - |

When `[THEN]` has no text, the `[SCENARIO]` sentence is used as the expected
result. Explicit `[THEN]` text is preferred.

Each `[WHEN]` comment becomes a numbered phase. A scenario with only one
`[WHEN]` phase lists its instructions directly as numbered steps. Supported `TestPage` operations
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

## Presentation and export

One run produces any combination of formats from the same AL source:

```powershell
bca docs generate test/UITest --app app --export markdown,html,dita,ado-csv
```

| `--export` | Files | Use it for |
| --- | --- | --- |
| `markdown` (default) | `<id>.md`, `use-case-<feature>.md`, `index.md`, `journey.d2`/`.svg` | Repository docs, GitHub/Azure DevOps wikis, DocFX |
| `html` | `index.html` (one self-contained file) | Sharing, printing to PDF, pipeline artifacts |
| `dita` | `<id>.dita`, `documentation.ditamap` | DITA Open Toolkit, CCMS and help-authoring tools |
| `ado-csv` | `test-cases.csv` | Azure DevOps Test Plans: grid view → Import test cases |

### User guide or test case

`--as guide` (default) writes task-oriented instructions. `--as testcase`
writes the same scenario as a test case specification: ID, objective,
preconditions, a numbered table with action, expected result, pass/fail, and
actual result, and a sign-off block for UAT. Steps without an explicit
`[THEN]` get a neutral expected result such as “The page opens”.

```powershell
bca docs generate test/UITest --app app --as testcase --export markdown,html,ado-csv
```

### Real captions with `--app`

Without `--app`, BC Atlas derives labels from control names (`PartnerCode`
becomes “Partner Code”). With `--app <app-root>`, it reads the app's AL source
and uses what the user actually sees:

- page captions, field captions (falling back to the source table field), and
  action captions, with access-key markers such as `&Post` removed;
- part captions for nested controls such as `Lines.Quantity`;
- field and action tooltips as explanations below each step;
- page and action coverage in the index: which app pages and actions no
  documented scenario touches.

### Languages

`--language de-DE` translates the generated wording (headings, instructions,
test-case columns) and takes captions and tooltips from the app's XLIFF file
for that language (for example `Translations/MyApp.de-DE.xlf`). Built-in
wording exists for English and German; other languages use English wording with
translated captions, and BC Atlas prints a warning. Texts you wrote in the tags
(`[SCENARIO]`, `[GIVEN]`, `[THEN]`) appear as written.

### Index, use cases, and journey

`index.md` (and the overview of `index.html`) contains:

- one use case per `[FEATURE]`, listing its main scenarios in prerequisite
  order and the `[ALTERNATIVE]` scenarios separately;
- a journey diagram of `[REQUIRES]`, `[NEXT]`, `[RELATED]`, and
  `[ALTERNATIVE]` links;
- scenarios by page and by permission set;
- coverage of app pages and actions (with `--app`).

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
future, opt-in capture feature is recorded in the [roadmap](../ROADMAP.md). It must
consume the AL-derived contract without becoming a second authoritative test.
