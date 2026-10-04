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
      "Open **Widgets** and create a new record.",
      "In **Code**, enter a suitable value (for example, **W-UI**).",
      "In **Name**, enter a suitable value (for example, **UI Widget**).",
      "Finish the entry and close **Widgets**. Business Central saves the changes."
    ]);
    assert.match(source.reference, /WidgetUITest\.Codeunit\.al#WidgetsList_NewWidget/u);
    assert.match(source.value.sourceHash, /^[a-f0-9]{64}$/u);
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
    assert.match(markdown, /1\. A user creates a widget from the list\./u);
    assert.match(markdown, /   - Open \*\*Widgets\*\*/u);
    assert.match(markdown, /for example, \*\*W-UI\*\*/u);
    assert.match(markdown, /Business Central saves the changes/u);
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
      "Open **Conversion Guide** in edit mode.",
      "For each **Unresolved Conversion** record, open the record you want to work with; " +
      "enter the required value in **Resolved Value**; when applicable, enter the required " +
      "value in **Secondary Resolved Value**; then choose **Save And Next**."
    ]);

    const markdown = renderDocumentation(source);
    assert.match(markdown, /2\. The user maps every discovered provider value\./u);
    assert.match(markdown, /For each \*\*Unresolved Conversion\*\* record/u);
    assert.match(markdown, /when applicable.+\*\*Secondary Resolved Value\*\*/u);
    assert.match(markdown, /then choose \*\*Save And Next\*\*/u);
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
