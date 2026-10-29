import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderDocumentation, writeDocumentation } from "../src/docs/markdown.js";
import { loadAlUiTest } from "../src/docs/al-ui-source.js";
import { loadCorpus } from "../src/docs/model.js";
import { documentationHtml } from "../src/docs/export.js";
import { createAutomationPlan } from "../src/docs/automation.js";
import { planMetadataEdit, writeMetadataEdit } from "../src/docs/al-ui-writer.js";

const AL_UI_TEST = `codeunit 50100 WidgetUITest
{
    Subtype = Test;

    [Test]
    procedure WidgetsList_NewWidget_PersistsGeneralFields()
    var
        Widgets: TestPage Widgets;
    begin
        // [FEATURE] [widgets]
        // [SCENARIO] Creating a widget from the Widgets list persists its general fields.
        // [PERMISSIONS] Widget, Edit

        // [GIVEN] No widget exists yet.

        // [WHEN] A user creates a widget from the list.
        Widgets.OpenNew();
        Widgets.Code.SetValue('W-UI');
        Widgets.Name.SetValue('UI Widget');
        Widgets.Close();

        // [THEN] The widget persists with its code and name.
    end;
}
`;

const HELPER_UI_TEST = `codeunit 50101 ConversionUITest
{
    Subtype = Test;

    [Test]
    procedure ResolveProviderConversions()
    var
        Exchanges: TestPage "EDI Exchanges";
    begin
        // [SCENARIO] Resolve every discovered provider conversion.

        // [WHEN] The user runs the exchange until conversions block processing.
        Exchanges.OpenView();
        Exchanges.RunAllSteps.Invoke();

        // [WHEN] The user maps every discovered provider value.
        ResolveDiscoveredConversions();

        // [WHEN] The user resumes processing.
        Exchanges.RerunCurrentStep.Invoke();

        // [THEN] Processing completes.
    end;

    local procedure ResolveDiscoveredConversions()
    var
        UnresolvedConversion: Record "Unresolved Conversion";
        ConversionGuide: TestPage "Conversion Guide";
        ResolvedValue: Text[100];
        SecondaryResolvedValue: Text[100];
    begin
        ConversionGuide.OpenEdit();
        repeat
            ConversionGuide.GoToRecord(UnresolvedConversion);
            ConversionGuide.ResolvedValue.SetValue(ResolvedValue);
            if SecondaryResolvedValue <> '' then
                ConversionGuide.SecondaryResolvedValue.SetValue(SecondaryResolvedValue);
            ConversionGuide.SaveAndNext.Invoke();
        until UnresolvedConversion.Next() = 0;
    end;
}
`;

test("derives documentation from a selected AL UI test", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "bc-atlas-docs-"));
  const filename = path.join(directory, "WidgetUITest.Codeunit.al");
  try {
    writeFileSync(filename, AL_UI_TEST);
    const source = await loadAlUiTest(filename, {
      procedure: "WidgetsList_NewWidget_PersistsGeneralFields"
    });

    assert.equal(source.value.id, "widgets-list-new-widget-persists-general-fields");
    assert.equal(source.value.title, "Create a new Widget");
    assert.equal(source.value.guideGoal, "Create a new Widget.");
    assert.deepEqual(source.value.permissions, ["Widget, Edit"]);
    assert.deepEqual(source.value.prerequisites, ["No widget exists yet."]);
    assert.deepEqual(source.value.guidePrerequisites, [
      "Make sure the Widget you want to create does not already exist."
    ]);
    assert.deepEqual(source.value.actions, ["A user creates a widget from the list."]);
    assert.deepEqual(source.value.expected, ["The widget persists with its code and name."]);
    assert.deepEqual(source.value.guideExpected, ["The widget persists with its code and name."]);
    assert.deepEqual(source.value.guideSteps, [
      "Choose the 🔍 icon, enter **Widgets**, and then choose the related link. Choose **New** to create a record.",
      "In the **Code** field, enter a value, for example **W-UI**.",
      "In the **Name** field, enter a value, for example **UI Widget**.",
      "Close the **Widgets** page. Business Central saves your changes."
    ]);
    assert.deepEqual(source.value.guideOperations.map(({ kind }) => kind), ["open", "set", "set", "close"]);
    assert.match(source.reference, /WidgetUITest\.Codeunit\.al#WidgetsList_NewWidget/u);
    assert.match(source.value.sourceHash, /^[a-f0-9]{64}$/u);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("the HTML guide scrolls to a scenario in place when it is embedded through srcdoc", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "bc-atlas-docs-"));
  try {
    writeFileSync(path.join(directory, "WidgetUITest.Codeunit.al"), AL_UI_TEST);
    const page = await documentationHtml(await loadCorpus(directory));
    const id = "widgets-list-new-widget-persists-general-fields";
    assert.match(page, new RegExp(`<a href="#${id}">`, "u"));
    // The renderer writes exactly one inline script; take its body as written.
    const start = page.indexOf("<script>") + "<script>".length;
    const script = page.slice(start, page.indexOf("</script>", start));

    // A srcdoc document resolves #links against the host page: the click must not navigate.
    const run = (protocol) => {
      const scrolled = [];
      const listeners = [];
      const document = {
        getElementById: (name) => (name === id ? { scrollIntoView: () => scrolled.push(name) } : null),
        querySelectorAll: () => [],
        addEventListener: (type, listener) => listeners.push(listener)
      };
      new Function("document", "location", script)(document, { protocol });
      let prevented = false;
      const link = { getAttribute: () => `#${id}` };
      const event = { target: { closest: () => link }, preventDefault: () => { prevented = true; } };
      for (const listener of listeners) listener(event);
      return { prevented, scrolled };
    };
    assert.deepEqual(run("about:"), { prevented: true, scrolled: [id] });
    // Opened as a file of its own, the browser follows the link (and keeps the address).
    assert.deepEqual(run("file:"), { prevented: false, scrolled: [] });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("keeps the scenario title when the workflow creates different record types", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "bc-atlas-docs-"));
  const filename = path.join(directory, "OnboardingUITest.Codeunit.al");
  try {
    writeFileSync(filename, AL_UI_TEST
      .replace("        Widgets: TestPage Widgets;", [
        "        Widgets: TestPage Widgets;",
        "        Categories: TestPage Categories;"
      ].join("\n"))
      .replace("Creating a widget from the Widgets list persists its general fields.",
        "Process an uploaded catalog and create its master data.")
      .replace("        Widgets.Close();", [
        "        Widgets.Close();",
        "        Categories.OpenNew();"
      ].join("\n")));

    const source = await loadAlUiTest(filename);

    assert.equal(source.value.title, "Process an uploaded catalog and create its master data");
    assert.equal(source.value.guideGoal, "Process an uploaded catalog and create its master data.");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("requires a procedure when an AL file contains multiple tests", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "bc-atlas-docs-"));
  const filename = path.join(directory, "WidgetUITest.Codeunit.al");
  try {
    writeFileSync(filename, AL_UI_TEST.replace(
      "\n}\n",
      `\n    [Test]\n    procedure OtherScenario()\n    begin\n        // [SCENARIO] Another scenario.\n        // [THEN] Another outcome.\n    end;\n}\n`
    ));
    await assert.rejects(loadAlUiTest(filename), /select one with --procedure/u);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("uses SCENARIO as the expected result when THEN has no text", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "bc-atlas-docs-"));
  const filename = path.join(directory, "WidgetUITest.Codeunit.al");
  try {
    writeFileSync(filename, AL_UI_TEST.replace(
      "// [THEN] The widget persists with its code and name.",
      "// [WHEN]/[THEN]"
    ));
    const source = await loadAlUiTest(filename);
    assert.deepEqual(source.value.expected, [
      "Creating a widget from the Widgets list persists its general fields."
    ]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("accepts teardown metadata without publishing it as a user action", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "bc-atlas-docs-"));
  const filename = path.join(directory, "WidgetUITest.Codeunit.al");
  try {
    writeFileSync(filename, AL_UI_TEST.replace(
      "        // [THEN] The widget persists with its code and name.",
      "        // [THEN] The widget persists with its code and name.\n" +
      "        // [TEARDOWN] Close the page and remove the fixture."
    ));

    const source = await loadAlUiTest(filename);

    assert.equal(source.value.diagnostics.length, 0);
    assert.deepEqual(source.value.actions, ["A user creates a widget from the list."]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("renders and writes deterministic Markdown directly from AL", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "bc-atlas-docs-"));
  const sourceFile = path.join(directory, "WidgetUITest.Codeunit.al");
  const output = path.join(directory, "output");
  try {
    writeFileSync(sourceFile, AL_UI_TEST);
    const source = await loadAlUiTest(sourceFile);
    const markdown = renderDocumentation(source);
    assert.match(markdown, /# Create a new Widget/u);
    assert.match(markdown, /## Before you start/u);
    assert.match(markdown, /Required permission: \*\*Widget, Edit\*\*/u);
    assert.match(markdown, /## Steps/u);
    assert.match(markdown, /^1\. Choose the 🔍 icon, enter \*\*Widgets\*\*/mu, "one [WHEN] phase is flattened into steps");
    assert.match(markdown, /for example \*\*W-UI\*\*/u);
    assert.match(markdown, /Business Central saves your changes/u);
    assert.match(markdown, /The widget persists with its code and name\./u);
    assert.match(markdown, /File: `WidgetUITest\.Codeunit\.al`/u);
    assert.match(markdown, /Function: `WidgetsList_NewWidget_PersistsGeneralFields`/u);
    assert.doesNotMatch(markdown, new RegExp(directory.replaceAll("\\", "\\\\"), "u"));
    assert.match(markdown, /Source SHA-256: [a-f0-9]{64}/u);

    const filename = await writeDocumentation(source, output);
    assert.ok(existsSync(filename));
    assert.equal(readFileSync(filename, "utf8"), markdown);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("expands reachable UI helpers and summarizes loops under WHEN phases", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "bc-atlas-docs-"));
  const filename = path.join(directory, "ConversionUITest.Codeunit.al");
  try {
    writeFileSync(filename, HELPER_UI_TEST);
    const source = await loadAlUiTest(filename);

    assert.deepEqual(source.value.expandedHelpers, ["ResolveDiscoveredConversions"]);
    assert.equal(source.value.guideSections.length, 3);
    assert.deepEqual(source.value.guideSections[1].expandedHelpers, [
      "ResolveDiscoveredConversions"
    ]);
    assert.deepEqual(source.value.guideSections[1].steps, [
      "Choose the 🔍 icon, enter **Conversion Guide**, and then choose the related link.",
      "For each **Unresolved Conversion** record, select the record you want to work with; " +
      "in the **Resolved Value** field, enter the required value; if applicable, in the " +
      "**Secondary Resolved Value** field, enter the required value; then choose the " +
      "**Save And Next** action."
    ]);

    const markdown = renderDocumentation(source);
    assert.match(markdown, /^2\. The user maps every discovered provider value\.$/mu);
    assert.match(markdown, /^ {3}- For each \*\*Unresolved Conversion\*\* record, do the following:$/mu);
    assert.match(markdown, /^ {5}- If applicable, in the \*\*Secondary Resolved Value\*\* field/mu);
    assert.match(markdown, /^ {5}- Choose the \*\*Save And Next\*\* action\.$/mu);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("omits permissions when the UI test does not specify them", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "bc-atlas-docs-"));
  const filename = path.join(directory, "WidgetUITest.Codeunit.al");
  try {
    writeFileSync(filename, AL_UI_TEST.replace(
      "        // [PERMISSIONS] Widget, Edit\n",
      ""
    ));
    const source = await loadAlUiTest(filename);
    assert.deepEqual(source.value.permissions, []);
    assert.doesNotMatch(renderDocumentation(source), /Required permission/u);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("docs generate writes Markdown without a browser or agent", () => {
  const cli = fileURLToPath(new URL("../src/cli.js", import.meta.url));
  const directory = mkdtempSync(path.join(os.tmpdir(), "bc-atlas-docs-"));
  const source = path.join(directory, "WidgetUITest.Codeunit.al");
  const output = path.join(directory, "output");
  try {
    writeFileSync(source, AL_UI_TEST);
    const result = spawnSync(process.execPath, [
      cli,
      "docs",
      "generate",
      source,
      "--output-dir",
      output
    ], { encoding: "utf8" });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /^Wrote /mu);
    assert.ok(existsSync(path.join(
      output,
      "widgets-list-new-widget-persists-general-fields.md"
    )));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("parses stable IDs, typed prerequisites, and document links", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "bc-atlas-docs-"));
  const filename = path.join(directory, "WidgetUITest.Codeunit.al");
  try {
    writeFileSync(filename, AL_UI_TEST
      .replace(
        "        // [FEATURE] [widgets]",
        "        // [DOC-ID] widget-create\n        // [FEATURE] widgets"
      )
      .replace(
        "        // [GIVEN] No widget exists yet.",
        "        // [GIVEN] [MASTER-DATA] No widget exists yet."
      )
      .replace(
        "        // [THEN] The widget persists with its code and name.",
        "        // [THEN] The widget persists with its code and name.\n" +
        "        // [RELATED] widget-edit"
      ));
    const source = await loadAlUiTest(filename);

    assert.equal(source.value.id, "widget-create");
    assert.equal(source.value.idSource, "explicit");
    assert.deepEqual(source.value.typedPrerequisites, [
      { type: "master-data", text: "No widget exists yet." }
    ]);
    assert.deepEqual(source.value.links.related, ["widget-edit"]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("loads and validates a linked documentation corpus", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "bc-atlas-docs-"));
  try {
    writeFileSync(path.join(directory, "Create.al"), AL_UI_TEST
      .replace("[FEATURE] [widgets]", "[DOC-ID] widget-create\n        // [FEATURE] widgets")
      .replace("[THEN] The widget persists with its code and name.",
        "[THEN] The widget persists with its code and name.\n        // [NEXT] widget-edit"));
    writeFileSync(path.join(directory, "Edit.al"), AL_UI_TEST
      .replace("WidgetsList_NewWidget_PersistsGeneralFields", "WidgetsList_EditWidget")
      .replace("[FEATURE] [widgets]", "[DOC-ID] widget-edit\n        // [FEATURE] widgets"));

    const corpus = await loadCorpus(directory);
    assert.equal(corpus.scenarios.length, 2);
    assert.equal(corpus.diagnostics.length, 0);
    const markdown = renderDocumentation(corpus.byId.get("widget-create"), {
      catalog: corpus.byId
    });
    assert.match(markdown, /\[Create a new Widget\]\(\.\/widget-edit\.md\)/u);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("loads only documented UI tests into the corpus", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "bc-atlas-docs-"));
  try {
    writeFileSync(path.join(directory, "WidgetUITest.al"), AL_UI_TEST);
    writeFileSync(path.join(directory, "WidgetUnitTest.al"), AL_UI_TEST
      .replace("WidgetsList_NewWidget_PersistsGeneralFields", "WidgetProcessor_CreatesWidget")
      .replace("        Widgets: TestPage Widgets;\n", "")
      .replace("        Widgets.OpenNew();", "        WidgetProcessor.Create();"));

    const corpus = await loadCorpus(directory);

    assert.equal(corpus.scenarios.length, 1);
    assert.equal(corpus.scenarios[0].value.procedure, "WidgetsList_NewWidget_PersistsGeneralFields");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("reports broken links and duplicate document IDs", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "bc-atlas-docs-"));
  try {
    const source = AL_UI_TEST
      .replace("[FEATURE] [widgets]", "[DOC-ID] widget-create\n        // [FEATURE] widgets")
      .replace("[THEN] The widget persists with its code and name.",
        "[THEN] The widget persists with its code and name.\n        // [REQUIRES] missing-guide");
    writeFileSync(path.join(directory, "One.al"), source);
    writeFileSync(path.join(directory, "Two.al"), source.replace(
      "WidgetsList_NewWidget_PersistsGeneralFields",
      "WidgetsList_NewWidgetAgain"
    ));

    const corpus = await loadCorpus(directory);
    assert.ok(corpus.diagnostics.some(({ code }) => code === "duplicate-document-id"));
    assert.ok(corpus.diagnostics.some(({ code }) => code === "broken-document-link"));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("sets and unsets metadata without changing executable AL", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "bc-atlas-docs-"));
  const filename = path.join(directory, "WidgetUITest.Codeunit.al");
  try {
    writeFileSync(filename, AL_UI_TEST);
    const corpus = await loadCorpus(directory);
    const documentId = corpus.scenarios[0].value.id;
    const setPlan = await planMetadataEdit(directory, documentId, {
      tag: "DOC-ID",
      value: "widget-create"
    });
    assert.match(setPlan.after, /\/\/ \[DOC-ID\] widget-create/u);
    assert.match(setPlan.after, /Widgets\.OpenNew\(\);/u);
    await writeMetadataEdit(setPlan);

    const unsetPlan = await planMetadataEdit(directory, "widget-create", {
      tag: "PERMISSIONS",
      value: "Widget, Edit",
      remove: true
    });
    await writeMetadataEdit(unsetPlan);
    const updated = readFileSync(filename, "utf8");
    assert.doesNotMatch(updated, /\[PERMISSIONS\]/u);
    assert.match(updated, /Widgets\.Code\.SetValue\('W-UI'\);/u);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("docs CLI exposes pipe-safe JSON reads and dry-run mutations", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "bc-atlas-docs-"));
  const cli = fileURLToPath(new URL("../src/cli.js", import.meta.url));
  try {
    writeFileSync(path.join(directory, "WidgetUITest.Codeunit.al"), AL_UI_TEST);
    const listed = spawnSync(process.execPath, [cli, "docs", "list", directory, "--format", "json"], {
      encoding: "utf8"
    });
    assert.equal(listed.status, 0, listed.stderr);
    const scenarios = JSON.parse(listed.stdout);
    assert.equal(scenarios.length, 1);

    const glossary = spawnSync(process.execPath, [cli, "docs", "glossary", "--format", "json"], {
      encoding: "utf8"
    });
    assert.equal(glossary.status, 0, glossary.stderr);
    const glossaryItems = JSON.parse(glossary.stdout);
    assert.ok(glossaryItems.some(({ tag }) => tag === "REQUIRES"));
    assert.ok(glossaryItems.every(({ description }) => description.length > 0));

    const automation = spawnSync(process.execPath, [
      cli,
      "docs",
      "automation",
      directory,
      "--provider",
      "azure-devops",
      "--format",
      "json"
    ], { encoding: "utf8" });
    assert.equal(automation.status, 0, automation.stderr);
    const plan = JSON.parse(automation.stdout);
    assert.equal(plan.provider, "azure-devops");
    assert.match(plan.pipeline.content, /NodeTool@0/u);
    assert.equal(plan.checks.scenarios, 1);

    const dryRun = spawnSync(process.execPath, [
      cli, "docs", "set", directory,
      "--id", scenarios[0].id,
      "--tag", "DOC-ID",
      "--value", "widget-create",
      "--dry-run",
      "--format", "json"
    ], { encoding: "utf8" });
    assert.equal(dryRun.status, 0, dryRun.stderr);
    assert.equal(JSON.parse(dryRun.stdout).written, false);
    assert.doesNotMatch(readFileSync(path.join(directory, "WidgetUITest.Codeunit.al"), "utf8"), /widget-create/u);

    const invalid = spawnSync(process.execPath, [cli, "docs", "set", directory], {
      encoding: "utf8"
    });
    assert.equal(invalid.status, 2);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("builds a CI automation plan from the real documentation corpus", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "bc-atlas-docs-"));
  try {
    writeFileSync(path.join(directory, "WidgetUITest.Codeunit.al"), AL_UI_TEST);
    const plan = await createAutomationPlan(await loadCorpus(directory), {
      provider: "github",
      inputPath: directory
    });
    assert.equal(plan.provider, "github");
    assert.equal(plan.ready, false, "scenarios without explicit DOC-IDs are not CI-ready");
    assert.ok(plan.commands[0].includes(`'${directory}'`));
    assert.match(plan.pipeline.content, /bca docs validate '\.' --strict/u);
    assert.ok(!plan.pipeline.content.includes(directory));
    assert.match(plan.pipeline.content, /git diff --exit-code/u);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("docs validate fails with exit code 1 on broken links", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "bc-atlas-docs-"));
  const cli = fileURLToPath(new URL("../src/cli.js", import.meta.url));
  try {
    writeFileSync(
      path.join(directory, "WidgetUITest.Codeunit.al"),
      AL_UI_TEST.replace("// [FEATURE] [widgets]", "// [FEATURE] [widgets]\n        // [REQUIRES] missing-guide")
    );
    const result = spawnSync(process.execPath, [cli, "docs", "validate", directory], { encoding: "utf8" });
    assert.equal(result.status, 1, result.stdout);
    assert.match(result.stderr, /missing-guide/u);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

// Microsoft's convention: [FEATURE] list in OnRun, work item numbers in
// [SCENARIO], [VERIFY], handlers, traps, asserterror, and helpers after the test.
const MICROSOFT_UI_TEST = `codeunit 139768 "UT Page Deposit"
{
    Subtype = Test;

    trigger OnRun()
    begin
        // [FEATURE] [Bank Deposit] [UI]
    end;

    [Test]
    [HandlerFunctions('BatchesPageHandler,ConfirmYesHandler')]
    procedure PostDepositOpensPostedDeposit()
    var
        Deposit: TestPage "Bank Deposit";
        PostedDeposit: TestPage "Posted Bank Deposit";
        Deposits: TestPage "Bank Deposits";
    begin
        // [FEATURE] [Posting]
        // [SCENARIO 218101] Posting a deposit opens the posted deposit
        // [SCENARIO 218101] with its lines
        Initialize();

        // [GIVEN] An open deposit
        Deposits.OpenView();
        Deposits.Filter.SetFilter("No.", 'D-001');
        Deposits.First();

        // [WHEN] Post the deposit
        Deposit.OpenEdit();
        Deposit.Subform."Credit Amount".SetValue(
            100);
        Deposit."Posting Date".Value := '';
        asserterror Deposit."Document Date".SetValue('');
        Deposit."Bank Account No.".Lookup();
        PostedDeposit.Trap();
        Deposit.Post.Invoke();

        // [VERIFY] The posted deposit shows the lines
        PostedDeposit.Subform.First();
    end;

    local procedure Initialize()
    var
        Leaked: TestPage "Leaked Page";
    begin
        // [THEN] This tag belongs to a helper, not to the test.
        Leaked.OpenView();
        Leaked.Close();
    end;

    [ModalPageHandler]
    procedure BatchesPageHandler(var Batches: TestPage "General Journal Batches")
    begin
        Batches.OK().Invoke();
    end;

    [ConfirmHandler]
    procedure ConfirmYesHandler(Question: Text; var Reply: Boolean)
    begin
        Reply := true;
    end;

    [Test]
    procedure PostingDateIsRequired()
    begin
        // [SCENARIO 317751] A deposit cannot be posted without a posting date
        // [THEN] An error is shown
        Assert.ExpectedError('Posting Date must have a value.');
    end;
}
`;

test("reads Microsoft's test convention: work items, feature lists, handlers, traps, and attempts", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "bc-atlas-docs-"));
  const filename = path.join(directory, "UTPageDeposit.Codeunit.al");
  try {
    writeFileSync(filename, MICROSOFT_UI_TEST);
    const corpus = await loadCorpus(directory);
    // The test without UI steps is not a user guide.
    assert.deepEqual(corpus.scenarios.map(({ value }) => value.procedure), ["PostDepositOpensPostedDeposit"]);
    assert.deepEqual(corpus.skipped.map(({ procedure }) => procedure), ["PostingDateIsRequired"]);

    const { value } = corpus.scenarios[0];
    assert.equal(value.goal, "Posting a deposit opens the posted deposit with its lines");
    assert.deepEqual(value.references, ["218101"]);
    assert.deepEqual(value.features, ["Bank Deposit", "Posting"], "[UI] marks the test kind, not a feature");
    assert.deepEqual(value.expected, ["The posted deposit shows the lines"], "[VERIFY] is an expected result");
    // The helper after the test neither adds steps nor tags.
    assert.ok(!value.sourceText.includes("Leaked"));
    assert.ok(!value.expected.some((item) => item.includes("helper")));

    const [section] = value.guideSections;
    // Dialogs follow the action that opens a page (posting asks, then shows the posted document).
    assert.deepEqual(section.operations.map((op) => op.kind), ["open", "set", "set", "set", "lookup", "invoke", "dialog", "confirm"]);
    const [, amount, posting, documentDate, , post, dialog] = section.operations;
    assert.equal(amount.value.value, "100", "a call spread over two lines");
    assert.deepEqual(posting.value, { kind: "text", value: "" }, "Field.Value := sets a field");
    assert.equal(documentDate.attempt, true, "asserterror marks an attempt that fails");
    assert.equal(post.opens.name, "Posted Bank Deposit", "the trapped page opens after the action");
    assert.equal(dialog.page.name, "General Journal Batches");
    assert.deepEqual(dialog.steps.map((op) => op.kind), ["button"]);

    // [GIVEN] stays a prerequisite; its filter and navigation are understood.
    const markdown = renderDocumentation(corpus.scenarios[0]);
    assert.match(markdown, /Posting a deposit opens the posted deposit with its lines\./u);
    assert.doesNotMatch(markdown, /Use this guide to posting/u);
    assert.match(markdown, /If the \*\*General Journal Batches\*\* page opens, do the following:\n {3}- Choose \*\*OK\*\*\./u);
    assert.match(markdown, /If Business Central asks you to confirm, choose \*\*Yes\*\*\./u);
    assert.match(markdown, /Clear the \*\*Posting Date\*\* field\./u);
    assert.match(markdown, /Clear the \*\*Document Date\*\* field\. Business Central shows an error message\./u);
    assert.match(markdown, /In the \*\*Bank Account No\.\*\* field, choose the lookup button/u);
    assert.match(markdown, /Choose the \*\*Post\*\* action\. The \*\*Posted Bank Deposit\*\* page opens\./u);
    assert.doesNotMatch(markdown, /\*\*\*\*/u, "no empty example values");

    const testcase = renderDocumentation(corpus.scenarios[0], { mode: "testcase" });
    assert.match(testcase, /\| If the \*\*General Journal Batches\*\* page opens, choose \*\*OK\*\*\. \|/u, "a dialog keeps its context in one row");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("filters, navigation, drill-downs, and pages opened by code become steps", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "bc-atlas-docs-"));
  const filename = path.join(directory, "Entries.Codeunit.al");
  try {
    writeFileSync(filename, `codeunit 50110 EntriesUITest
{
    Subtype = Test;

    [Test]
    procedure ReviewEntries()
    var
        Entries: TestPage "Ledger Entries";
        Card: TestPage "Customer Card";
    begin
        // [SCENARIO] Review the ledger entries of a customer.
        // [WHEN] The user filters and opens the entries.
        Entries.Trap();
        Page.Run(Page::"Ledger Entries");
        Entries.Filter.SetFilter("Customer No.", 'C-10000');
        Entries.Last();
        Entries.Amount.Drilldown();
        Card.OpenView();
        Card."Search Name".AssistEdit();
        Card.Cancel().Invoke();
    end;
}
`);
    const source = await loadAlUiTest(filename);
    assert.deepEqual(source.value.guideOperations.map((op) => op.kind), ["opened", "filter", "navigate", "drilldown", "open", "assist-edit", "button"]);
    const markdown = renderDocumentation(source);
    assert.match(markdown, /1\. The \*\*Ledger Entries\*\* page opens\./u);
    assert.match(markdown, /Filter the list: in the \*\*Customer No\.\*\* column, enter \*\*C-10000\*\*\./u);
    assert.match(markdown, /Select the last line\./u);
    assert.match(markdown, /Choose the value in the \*\*Amount\*\* field to see the underlying entries\./u);
    assert.match(markdown, /Choose \*\*Cancel\*\*\./u);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("edits Microsoft-style metadata in place: work items, feature lists, and single lines", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "bc-atlas-docs-"));
  const filename = path.join(directory, "UTPageDeposit.Codeunit.al");
  try {
    writeFileSync(filename, MICROSOFT_UI_TEST);
    const id = (await loadCorpus(directory)).scenarios[0].value.id;

    // SCENARIO is one value: it replaces both lines and keeps the work item.
    const scenario = await planMetadataEdit(directory, id, { tag: "SCENARIO", value: "Post a deposit" });
    assert.match(scenario.after, /\/\/ \[SCENARIO 218101\] Post a deposit\r?\n/u);
    assert.doesNotMatch(scenario.after, /with its lines/u);
    assert.equal(scenario.after.match(/\[SCENARIO/gu).length, 1, "one line, no duplicate");

    // One feature of a [FEATURE] [A] [B] list goes, the others stay.
    writeFileSync(filename, MICROSOFT_UI_TEST.replace("// [FEATURE] [Posting]", "// [FEATURE] [Posting] [Deposits]"));
    const feature = await planMetadataEdit(directory, id, { tag: "FEATURE", value: "Posting", remove: true });
    assert.match(feature.after, /\/\/ \[FEATURE\] \[Deposits\]\r?\n/u);
    assert.match(feature.content, /\/\/ \[FEATURE\] \[Bank Deposit\] \[UI\]/u, "the codeunit features are untouched");

    // A feature of the whole codeunit is changed in OnRun, not in the test.
    await assert.rejects(planMetadataEdit(directory, id, { tag: "FEATURE", value: "Bank Deposit", remove: true }),
      /whole codeunit in its OnRun trigger/u);
    // A line break would turn the rest of the value into AL code.
    await assert.rejects(planMetadataEdit(directory, id, { tag: "PERMISSIONS", value: "D365 BASIC\nError('x');" }),
      /must be a single line/u);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Markdown keeps the author's text literal", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "bc-atlas-docs-"));
  const filename = path.join(directory, "Deposit.Codeunit.al");
  try {
    writeFileSync(filename, `codeunit 50100 "Deposit UI"
{
    Subtype = Test;

    [Test]
    procedure PostDeposit()
    var
        Deposit: TestPage "Bank Deposit";
    begin
        // [SCENARIO] Post a <b>deposit</b> *now*
        // [WHEN] Post it
        Deposit.OpenEdit();
        Deposit.Post.Invoke();
        // [THEN] Status is <Posted> | _done_
    end;
}
`);
    const corpus = await loadCorpus(directory);
    const guide = renderDocumentation(corpus.scenarios[0]);
    assert.match(guide, /^# Post a \\<b\\>deposit\\<\/b\\> \\\*now\\\*$/mu);
    assert.match(guide, /^- Status is \\<Posted\\> \\\| \\_done\\_$/mu);
    assert.match(guide, /Choose the \*\*Post\*\* action\./u, "UI names stay bold");

    const testcase = renderDocumentation(corpus.scenarios[0], { mode: "testcase" });
    assert.match(testcase, /\| Status is \\<Posted\\> \\\| \\_done\\_ \| ☐ \| \|/u, "one escaped pipe inside a table cell");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
