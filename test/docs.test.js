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

test("derives documentation from a selected AL UI test", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "ald2tree-docs-"));
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

test("requires a procedure when an AL file contains multiple tests", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "ald2tree-docs-"));
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
  const directory = mkdtempSync(path.join(os.tmpdir(), "ald2tree-docs-"));
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

test("renders and writes deterministic Markdown directly from AL", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "ald2tree-docs-"));
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
    assert.match(markdown, /1\. Open \*\*Widgets\*\*/u);
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

test("omits permissions when the UI test does not specify them", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "ald2tree-docs-"));
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
  const directory = mkdtempSync(path.join(os.tmpdir(), "ald2tree-docs-"));
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
    assert.match(result.stdout, /wrote/u);
    assert.ok(existsSync(path.join(
      output,
      "widgets-list-new-widget-persists-general-fields.md"
    )));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
