import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadCaptionIndex, parseXliff } from "../src/docs/captions.js";
import { exportDocumentation } from "../src/docs/export.js";
import { loadCorpus } from "../src/docs/model.js";

const cli = fileURLToPath(new URL("../src/cli.js", import.meta.url));

const APP = {
  "app.json": JSON.stringify({
    id: "22222222-2222-2222-2222-222222222222",
    name: "Widget App",
    publisher: "Test",
    version: "1.0.0.0"
  }),
  "Widget.Table.al": `
table 50100 Widget
{
    fields
    {
        field(1; Code; Code[20]) { }
        field(2; Name; Text[100]) { Caption = 'Widget Name'; ToolTip = 'Specifies the widget name.'; }
    }
}`,
  "Widgets.Page.al": `
page 50100 Widgets
{
    Caption = 'Widget List';
    PageType = List;
    SourceTable = Widget;

    layout
    {
        area(Content)
        {
            field(Code; Rec.Code) { Caption = 'Widget Code'; ToolTip = 'Specifies the unique widget code.'; }
            field(Name; Rec.Name) { }
            part(Lines; "Widget Lines") { Caption = 'Components'; }
        }
    }
    actions
    {
        area(Processing)
        {
            action(Release) { Caption = '&Release'; ToolTip = 'Release the widget for production.'; }
            action(Archive) { Caption = 'Archive'; }
        }
    }
}

page 50101 "Widget Lines"
{
    PageType = ListPart;
    layout
    {
        area(Content)
        {
            field(Quantity; Rec.Quantity) { Caption = 'Qty.'; }
        }
    }
}

page 50102 "Widget Setup"
{
    Caption = 'Widget Setup';
}`,
  "Translations/Widget App.de-DE.xlf": `<?xml version="1.0" encoding="utf-8"?>
<xliff version="1.2"><file source-language="en-US" target-language="de-DE" original="Widget App"><body><group id="body">
<trans-unit id="a"><source>Widget List</source><target>Widget-Liste</target><note from="Xliff Generator" annotates="general" priority="3">Page Widgets - Property Caption</note></trans-unit>
<trans-unit id="b"><source>Widget Code</source><target>Widget-Code</target><note from="Xliff Generator" annotates="general" priority="3">Page Widgets - Control Code - Property Caption</note></trans-unit>
<trans-unit id="c"><source>Widget Name</source><target>Widget-Name &amp; Titel</target><note from="Xliff Generator" annotates="general" priority="3">Table Widget - Field Name - Property Caption</note></trans-unit>
<trans-unit id="d"><source>&amp;Release</source><target>&amp;Freigeben</target><note from="Xliff Generator" annotates="general" priority="3">Page Widgets - Action Release - Property Caption</note></trans-unit>
</group></body></file></xliff>`
};

const TESTS = `codeunit 50150 WidgetUITests
{
    Subtype = Test;

    [Test]
    procedure CreateWidget()
    var
        Widgets: TestPage Widgets;
    begin
        // [DOC-ID] widget-create
        // [FEATURE] widget-lifecycle
        // [SCENARIO] Create and release a widget.
        // [PERMISSIONS] WIDGET EDIT
        // [GIVEN] [SETUP] Widget numbering is set up.

        // [WHEN] The user enters the widget.
        Widgets.OpenNew();
        Widgets.Code.SetValue('W-1');
        Widgets.Name.SetValue('Bolt');
        Widgets.Lines.Quantity.SetValue(5);

        // [THEN] The widget can be released.

        // [WHEN] The user releases the widget.
        Widgets.Release.Invoke();
        Widgets.Close();

        // [THEN] The widget is released.
        // [NEXT] widget-archive
    end;

    [Test]
    procedure ArchiveWidget()
    var
        Widgets: TestPage Widgets;
    begin
        // [DOC-ID] widget-archive
        // [FEATURE] widget-lifecycle
        // [SCENARIO] Archive a released widget.
        // [REQUIRES] widget-create

        // [WHEN] The user archives the widget.
        Widgets.OpenEdit();
        Widgets.Archive.Invoke();

        // [THEN] The widget is archived.
    end;
}
`;

function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "bc-atlas-docs-export-"));
  const app = path.join(root, "app");
  const tests = path.join(root, "test");
  mkdirSync(path.join(app, "Translations"), { recursive: true });
  mkdirSync(tests);
  for (const [name, content] of Object.entries(APP)) writeFileSync(path.join(app, name), content);
  writeFileSync(path.join(tests, "WidgetUITests.Codeunit.al"), TESTS);
  return { root, app, tests, output: path.join(root, "out") };
}

test("parses XLIFF notes and resolves captions from pages, tables, parts, and actions", async () => {
  const { root, app } = fixture();
  try {
    const xliff = parseXliff(APP["Translations/Widget App.de-DE.xlf"]);
    assert.equal(xliff.language, "de-DE");
    assert.equal(xliff.entries.size, 4);
    const encoded = parseXliff(`<xliff><file target-language="de-DE"><trans-unit id="x"><target>&amp;lt;b&amp;gt; &lt;script&gt; &#252;</target>
<note from="Xliff Generator">Page P - Property Caption</note></trans-unit></file></xliff>`);
    assert.deepEqual([...encoded.entries.values()], ["&lt;b&gt; <script> ü"], "entities decode once, as plain text");

    const { root: htmlRoot, tests: htmlTests, output: htmlOutput } = fixture();
    try {
      writeFileSync(path.join(htmlTests, "WidgetUITests.Codeunit.al"), TESTS.replace("Widget numbering is set up.", "<script>alert(1)</script> exists."));
      await exportDocumentation(await loadCorpus(htmlTests), { outputDirectory: htmlOutput, formats: ["html", "dita"] });
      for (const file of ["index.html", "widget-create.dita"]) {
        const content = readFileSync(path.join(htmlOutput, file), "utf8");
        assert.doesNotMatch(content, /<script>alert/u, `${file} escapes source text`);
        assert.match(content, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/u);
      }
    } finally {
      rmSync(htmlRoot, { recursive: true, force: true });
    }

    const captions = await loadCaptionIndex(app);
    assert.equal(captions.appName, "Widget App");
    assert.equal(captions.page("Widgets").caption, "Widget List");
    assert.equal(captions.member("Widgets", [], "Code", "field").caption, "Widget Code");
    assert.equal(captions.member("Widgets", [], "Name", "field").caption, "Widget Name", "falls back to the table field");
    assert.equal(captions.member("Widgets", [], "Name", "field").tooltip, "Specifies the widget name.");
    assert.equal(captions.member("Widgets", [], "Release", "action").caption, "Release", "access key is removed");
    const part = captions.member("Widgets", ["Lines"], "Quantity", "field");
    assert.equal(part.caption, "Qty.");
    assert.deepEqual(part.sectionCaptions, ["Components"]);

    const german = await loadCaptionIndex(app, { language: "de-DE" });
    assert.equal(german.page("Widgets").caption, "Widget-Liste");
    assert.equal(german.member("Widgets", [], "Name", "field").caption, "Widget-Name & Titel");
    assert.equal(german.member("Widgets", [], "Release", "action").caption, "Freigeben");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("exports guides with captions, step results, use cases, journey, and coverage", async () => {
  const { root, app, tests, output } = fixture();
  try {
    const result = await exportDocumentation(await loadCorpus(tests), {
      appRoot: app,
      outputDirectory: output,
      formats: ["markdown"]
    });
    const names = result.files.map((file) => path.basename(file)).sort();
    assert.deepEqual(names, [
      "index.md", "journey.d2", "journey.svg", "use-case-widget-lifecycle.md", "use-case-widget-lifecycle.svg",
      "widget-archive.md", "widget-archive.svg", "widget-create.md", "widget-create.svg"
    ]);

    const guide = readFileSync(path.join(output, "widget-create.md"), "utf8");
    assert.match(guide, /^# Create a new Widget List$/mu);
    assert.match(guide, /^- Setup: Widget numbering is set up\.$/mu);
    assert.match(guide, /^1\. The user enters the widget\.$/mu);
    assert.match(guide, /In the \*\*Widget Code\*\* field, enter a value, for example \*\*W-1\*\*\. _Specifies the unique widget code\._/u);
    assert.match(guide, /In the \*\*Components\*\* section, in the \*\*Qty\.\*\* field/u);
    assert.match(guide, /^ {3}Result: The widget can be released\.$/mu, "intermediate [THEN] becomes a step result");
    assert.match(guide, /Choose the \*\*Release\*\* action\. _Release the widget for production\._/u);
    assert.match(guide, /## What should happen\n\n- The widget is released\.\n/u);
    assert.match(guide, /\[Archive a released widget\]\(\.\/widget-archive\.md\)/u);

    const archive = readFileSync(path.join(output, "widget-archive.md"), "utf8");
    assert.match(archive, /Complete \[Create a new Widget List\]\(\.\/widget-create\.md\) first\./u);

    const index = readFileSync(path.join(output, "index.md"), "utf8");
    assert.match(index, /^# Widget App$/mu);
    assert.match(index, /\[Widget lifecycle\]\(\.\/use-case-widget-lifecycle\.md\) \(2\)/u);
    assert.match(index, /^## Coverage\n\n1 of 3 pages are covered/mu);
    assert.match(index, /- Widget Setup \(50102\)/u);
    assert.doesNotMatch(index, /Actions not used/u, "every action on a covered page is used by a scenario");

    const useCase = readFileSync(path.join(output, "use-case-widget-lifecycle.md"), "utf8");
    assert.match(useCase, /1\. \[Create a new Widget List\]\(\.\/widget-create\.md\)[\s\S]*2\. \[Archive a released widget\]/u,
      "prerequisites come first");
    assert.match(useCase, /!\[Widget lifecycle\]\(\.\/diagrams\/use-case-widget-lifecycle\.svg\)/u);
    assert.doesNotMatch(useCase, /\.bpmn/u, "BPMN is linked only when exported");
    assert.match(guide, /## At a glance\n\n!\[Create a new Widget List\]\(\.\/diagrams\/widget-create\.svg\)/u);
    const journey = readFileSync(path.join(output, "journey.d2"), "utf8");
    assert.match(journey, /"widget-create" -> .*"widget-archive" \{ class: flow \}/u);
    assert.equal(journey.match(/ -> /gu).length, 1, "[NEXT] and [REQUIRES] between the same scenarios are one arrow");
    assert.match(journey, /"Create a new Widget List\\nWIDGET EDIT · 6 steps"/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("exports test cases as Markdown, HTML, DITA, and Azure DevOps CSV", async () => {
  const { root, app, tests, output } = fixture();
  try {
    await exportDocumentation(await loadCorpus(tests), {
      appRoot: app,
      outputDirectory: output,
      formats: ["markdown", "html", "dita", "ado-csv"],
      mode: "testcase"
    });

    const testCase = readFileSync(path.join(output, "widget-create.md"), "utf8");
    assert.match(testCase, /^# Test case widget-create: Create a new Widget List$/mu);
    assert.match(testCase, /^\| # \| Action \| Expected result \| Pass\/Fail \| Actual result \|$/mu);
    assert.match(testCase, /^\| 1 \| Verify that the preconditions are met\. \| All preconditions are met\. \| ☐ \| \|$/mu);
    assert.match(testCase, /\| The widget can be released\. \| ☐ \|/u);
    assert.match(testCase, /^## Sign-off$/mu);

    const html = readFileSync(path.join(output, "index.html"), "utf8");
    assert.match(html, /^<!doctype html>/u);
    assert.equal((html.match(/<article /gu) ?? []).length, 2);
    assert.match(html, /<b class="ui">Widget Code<\/b>/u);
    assert.match(html, /<svg/u, "journey diagram is inlined");
    assert.doesNotMatch(html, /<(?:script|link|img)[^>]+(?:src|href)="https?:/u, "no external assets");

    const dita = readFileSync(path.join(output, "widget-create.dita"), "utf8");
    assert.match(dita, /<!DOCTYPE task PUBLIC "-\/\/OASIS\/\/DTD DITA Task\/\/EN" "task.dtd">/u);
    assert.match(dita, /<prereq>[\s\S]*<\/prereq>\s*<context>[\s\S]*<steps>[\s\S]*<\/steps>\s*<result>/u);
    assert.match(dita, /<cmd>In the <uicontrol>Widget Code<\/uicontrol> field, enter a value, for example <userinput>W-1<\/userinput>\.<\/cmd><info><p>Specifies the unique widget code\.<\/p><\/info>/u);
    assert.match(dita, /<stepresult><p>The widget can be released\.<\/p><\/stepresult>/u);
    assert.match(dita, /<link href="widget-archive.dita" type="task" role="next">/u);
    const map = readFileSync(path.join(output, "documentation.ditamap"), "utf8");
    assert.match(map, /<topichead navtitle="Widget lifecycle">\s*<topicref href="widget-create.dita"/u);

    const csv = readFileSync(path.join(output, "test-cases.csv"), "utf8");
    const lines = csv.replace(/^﻿/u, "").trim().split("\r\n");
    assert.equal(lines[0], "ID,Work Item Type,Title,Test Step,Step Action,Step Expected,Area Path,Assigned To,State,Tags");
    assert.equal(lines[1], ",Test Case,Create a new Widget List,,,,,,Design,widget-lifecycle");
    assert.match(lines[2], /^,,,1,Verify that the preconditions are met\.,All preconditions are met\./u);
    assert.ok(lines.some((line) => line.includes("\"In the Widget Code field, enter a value, for example W-1.\"")));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("localizes wording and captions from the app's XLIFF", () => {
  const { root, app, tests, output } = fixture();
  try {
    const result = spawnSync(process.execPath, [
      cli, "docs", "generate", tests, "--app", app, "--language", "de-DE", "--output-dir", output
    ], { encoding: "utf8", timeout: 120_000 });
    assert.equal(result.status, 0, result.stderr);
    const guide = readFileSync(path.join(output, "widget-create.md"), "utf8");
    assert.match(guide, /^# Create and release a widget$/mu, "titles keep the scenario language");
    assert.match(guide, /^## Voraussetzungen$/mu);
    assert.match(guide, /Geben Sie im Feld \*\*Widget-Code\*\* einen Wert ein, zum Beispiel \*\*W-1\*\*\./u);
    assert.match(guide, /Wählen Sie die Aktion \*\*Freigeben\*\*\./u);

    const french = spawnSync(process.execPath, [
      cli, "docs", "generate", tests, "--app", app, "--language", "fr-FR", "--output-dir", output
    ], { encoding: "utf8", timeout: 120_000 });
    assert.equal(french.status, 0, french.stderr);
    assert.match(french.stderr, /no built-in wording for fr-FR/u);
    assert.match(french.stderr, /no fr-FR XLIFF file/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("docs generate validates export options", () => {
  const { root, tests, output } = fixture();
  try {
    for (const args of [
      ["--export", "pdf"],
      ["--as", "manual"],
      ["--id", "widget-create", "--export", "html"]
    ]) {
      const result = spawnSync(process.execPath, [cli, "docs", "generate", tests, "--output-dir", output, ...args], {
        encoding: "utf8"
      });
      assert.equal(result.status, 2, `${args.join(" ")}: ${result.stderr}`);
    }
    const csv = spawnSync(process.execPath, [
      cli, "docs", "generate", tests, "--export", "ado-csv", "--as", "testcase", "--output-dir", output, "--format", "json"
    ], { encoding: "utf8" });
    assert.equal(csv.status, 0, csv.stderr);
    assert.deepEqual(JSON.parse(csv.stdout).map((file) => path.basename(file)), ["test-cases.csv"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
