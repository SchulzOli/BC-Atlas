import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { strFromU8, unzipSync } from "fflate";

const cli = fileURLToPath(new URL("../src/cli.js", import.meta.url));
const APP_ID = "11111111-2222-3333-4444-555555555555";

const PACKAGE_UI_TEST = `codeunit 50100 WidgetUITest
{
    Subtype = Test;

    [Test]
    procedure ConfigureWidget()
    var
        Widgets: TestPage Widgets;
    begin
        // [DOC-ID] legacy-widget-id
        // [SCENARIO] Configure a widget.
        // [WHEN] The user configures the widget.
        Widgets.OpenEdit();
        // [THEN] The widget is configured.
    end;

    [Test]
    procedure ProcessWidget()
    var
        Widgets: TestPage Widgets;
    begin
        // [SCENARIO] Process a widget.
        // [WHEN] The user processes the widget.
        Widgets.OpenView();
        // [THEN] The widget is processed.
    end;
}
`;

const CLASSIFIED_UI_TEST = `/// <summary>Widget lifecycle tests.</summary>
/// <bc-atlas role="administrator" process="widget-lifecycle" owner="product-team" type="user-guide" />
codeunit 50100 WidgetUITest
{
    Subtype = Test;

    /// <summary>Configure a widget.</summary>
    /// <bc-atlas stage="setup" />
    [Test]
    procedure ConfigureWidget()
    var
        Widgets: TestPage Widgets;
    begin
        // [SCENARIO] Configure a widget.
        // [WHEN] The user configures the widget.
        Widgets.OpenEdit();
        // [THEN] The widget is configured.
    end;

    /// <summary>Process a widget.</summary>
    /// <bc-atlas role="operator" stage="execute">
    ///   <requires document="ConfigureWidget" />
    /// </bc-atlas>
    [Test]
    procedure ProcessWidget()
    var
        Widgets: TestPage Widgets;
    begin
        // [SCENARIO] Process a widget.
        // [WHEN] The user processes the widget.
        Widgets.OpenView();
        // [THEN] The widget is processed.
    end;
}
`;

function writeFixture(directory, source = PACKAGE_UI_TEST) {
  writeFileSync(path.join(directory, "app.json"), `${JSON.stringify({
    id: APP_ID,
    name: "Widget Tests",
    publisher: "Test",
    version: "1.2.3.4"
  }, null, 2)}\n`);
  writeFileSync(path.join(directory, "UITests.al"), source);
}

function runDocs(directory, ...args) {
  return spawnSync(process.execPath, [cli, "docs", ...args], {
    cwd: directory,
    encoding: "utf8"
  });
}

test("docs package writes procedure-named guides with calculated IDs and traceability", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "bc-atlas-docs-package-"));
  const output = path.join(directory, "Docu", "UI");
  try {
    writeFixture(directory);

    const result = runDocs(directory, "package", ".", "--output-dir", output);

    assert.equal(result.status, 0, result.stderr);
    const configureFile = path.join(output, "ConfigureWidget.md");
    const processFile = path.join(output, "ProcessWidget.md");
    assert.ok(existsSync(configureFile));
    assert.ok(existsSync(processFile));
    assert.ok(!existsSync(path.join(output, "legacy-widget-id.md")));

    const documentId = `${APP_ID}-ConfigureWidget`;
    const sourceSha256 = createHash("sha256").update(PACKAGE_UI_TEST).digest("hex");
    const metadata = readFileSync(path.join(output, "metadata.yml"), "utf8");
    assert.match(metadata, /^schemaVersion: 1$/mu);
    assert.match(metadata, new RegExp(`^  ${APP_ID}:$`, "mu"));
    assert.match(metadata, /^    version: "1\.2\.3\.4"$/mu);
    assert.match(metadata, new RegExp(`^    documentId: "${documentId}"$`, "mu"));
    assert.match(metadata, /^    sourceFile: "UITests\.al"$/mu);
    assert.match(metadata, /^    procedure: "ConfigureWidget"$/mu);
    assert.match(metadata, new RegExp(`^    sourceSha256: "${sourceSha256}"$`, "mu"));

    const guide = readFileSync(configureFile, "utf8");
    assert.match(guide, new RegExp(`^---\\ndocumentId: "${documentId}"`, "u"));
    assert.match(guide, new RegExp(`^appId: "${APP_ID}"$`, "mu"));
    assert.match(guide, /^sourceFile: "UITests\.al"$/mu);
    assert.match(guide, /^procedure: "ConfigureWidget"$/mu);
    assert.match(guide, new RegExp(`^sourceSha256: "${sourceSha256}"$`, "mu"));
    assert.doesNotMatch(guide, /Source and verification/u);

    const index = readFileSync(path.join(output, "index.md"), "utf8");
    assert.equal((index.match(/\.\/ConfigureWidget\.md/gu) ?? []).length, 1);
    assert.equal((index.match(/\.\/ProcessWidget\.md/gu) ?? []).length, 1);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("docs package rejects calculated ID and filename collisions before writing", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "bc-atlas-docs-package-"));
  const output = path.join(directory, "Docu", "UI");
  try {
    writeFixture(directory, PACKAGE_UI_TEST.replace(
      /\n    \[Test\]\n    procedure ProcessWidget\(\)[\s\S]*?\n    end;/u,
      ""
    ));
    writeFileSync(path.join(directory, "Duplicate.al"), PACKAGE_UI_TEST
      .replace("codeunit 50100 WidgetUITest", "codeunit 50101 DuplicateWidgetUITest")
      .replace(
        /\n    \[Test\]\n    procedure ProcessWidget\(\)[\s\S]*?\n    end;/u,
        ""
      ));

    const result = runDocs(directory, "package", ".", "--output-dir", output);

    assert.equal(result.status, 1);
    assert.match(result.stderr, /duplicate calculated document ID/iu);
    assert.match(result.stderr, /duplicate guide filename/iu);
    assert.ok(!existsSync(output));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("docs package inherits XML classifications and builds journeys and navigation", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "bc-atlas-docs-package-"));
  const output = path.join(directory, "Docu", "UI");
  try {
    writeFixture(directory, CLASSIFIED_UI_TEST);

    const result = runDocs(directory, "package", ".", "--output-dir", output);

    assert.equal(result.status, 0, result.stderr);
    const configureId = `${APP_ID}-ConfigureWidget`;
    const processId = `${APP_ID}-ProcessWidget`;
    const metadata = readFileSync(path.join(output, "metadata.yml"), "utf8");
    assert.match(metadata, new RegExp(
      `documentId: "${configureId}"[\\s\\S]*?role: "administrator"` +
      `[\\s\\S]*?process: "widget-lifecycle"[\\s\\S]*?stage: "setup"` +
      `[\\s\\S]*?owner: "product-team"[\\s\\S]*?type: "user-guide"` +
      `[\\s\\S]*?next:\\n      - "${processId}"`,
      "u"
    ));
    assert.match(metadata, new RegExp(
      `documentId: "${processId}"[\\s\\S]*?role: "operator"` +
      `[\\s\\S]*?requires:\\n      - "${configureId}"`,
      "u"
    ));

    const configure = readFileSync(path.join(output, "ConfigureWidget.md"), "utf8");
    const process = readFileSync(path.join(output, "ProcessWidget.md"), "utf8");
    assert.match(configure, /^role: "administrator"$/mu);
    assert.match(configure, /^process: "widget-lifecycle"$/mu);
    assert.match(configure, /^stage: "setup"$/mu);
    assert.match(configure, /\[Index\]\(\.\/index\.md\)/u);
    assert.match(configure, /Next: \[Process a widget\]\(\.\/ProcessWidget\.md\)/u);
    assert.match(process, /^role: "operator"$/mu);
    assert.match(process, /Back: \[Configure a widget\]\(\.\/ConfigureWidget\.md\)/u);

    const index = readFileSync(path.join(output, "index.md"), "utf8");
    assert.match(index, /## Process by role/u);
    assert.match(index, /\| Process \| administrator \| operator \|/u);
    assert.match(index, /\| widget-lifecycle \|[^\n]*ConfigureWidget\.md[^\n]*ProcessWidget\.md/u);
    assert.match(index, /## Process journeys[\s\S]*ConfigureWidget\.md[\s\S]*ProcessWidget\.md/u);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("docs package accepts the controlled monitor and recover stages", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "bc-atlas-docs-package-"));
  const output = path.join(directory, "Docu", "UI");
  try {
    writeFixture(directory, CLASSIFIED_UI_TEST
      .replace('stage="setup"', 'stage="monitor"')
      .replace('stage="execute"', 'stage="recover"'));

    const result = runDocs(directory, "package", ".", "--output-dir", output);

    assert.equal(result.status, 0, result.stderr);
    const metadata = readFileSync(path.join(output, "metadata.yml"), "utf8");
    assert.match(metadata, /^    stage: "monitor"$/mu);
    assert.match(metadata, /^    stage: "recover"$/mu);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("docs package applies procedure metadata overrides without changing siblings", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "bc-atlas-docs-package-"));
  const output = path.join(directory, "Docu", "UI");
  try {
    writeFixture(directory, CLASSIFIED_UI_TEST.replace(
      'role="operator" stage="execute"',
      'role="operator" process="widget-execution" stage="execute" ' +
      'owner="operations-team" type="admin-guide"'
    ));

    const result = runDocs(directory, "package", ".", "--output-dir", output);

    assert.equal(result.status, 0, result.stderr);
    const configure = readFileSync(path.join(output, "ConfigureWidget.md"), "utf8");
    const process = readFileSync(path.join(output, "ProcessWidget.md"), "utf8");
    assert.match(configure, /^process: "widget-lifecycle"$/mu);
    assert.match(configure, /^owner: "product-team"$/mu);
    assert.match(configure, /^type: "user-guide"$/mu);
    assert.match(process, /^process: "widget-execution"$/mu);
    assert.match(process, /^owner: "operations-team"$/mu);
    assert.match(process, /^type: "admin-guide"$/mu);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("docs validate and package share classification and duplicate-title warnings", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "bc-atlas-docs-package-"));
  const output = path.join(directory, "Docu", "UI");
  try {
    writeFixture(directory, PACKAGE_UI_TEST.replaceAll("Process a widget", "Configure a widget"));

    const validation = runDocs(directory, "validate", ".", "--format", "json");
    assert.equal(validation.status, 0, validation.stderr);
    const codes = JSON.parse(validation.stdout).map(({ code }) => code);
    assert.ok(codes.includes("missing-role"));
    assert.ok(codes.includes("missing-process"));
    assert.ok(codes.includes("missing-stage"));
    assert.ok(codes.includes("duplicate-guide-title"));

    const strictValidation = runDocs(directory, "validate", ".", "--strict");
    assert.equal(strictValidation.status, 1);
    const strictPackage = runDocs(
      directory,
      "package",
      ".",
      "--output-dir",
      output,
      "--strict"
    );
    assert.equal(strictPackage.status, 1);
    assert.match(strictPackage.stderr, /missing-role/iu);
    assert.ok(!existsSync(output));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("docs package rejects invalid XML metadata and missing XML references", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "bc-atlas-docs-package-"));
  const output = path.join(directory, "Docu", "UI");
  try {
    writeFixture(directory, CLASSIFIED_UI_TEST
      .replace(
        "role=\"operator\" stage=\"execute\"",
        "role=\"Operator\" stage=\"operate\" document-id=\"forbidden\""
      )
      .replace("document=\"ConfigureWidget\"", "document=\"MissingProcedure\""));

    const result = runDocs(directory, "package", ".", "--output-dir", output);

    assert.equal(result.status, 1);
    assert.match(result.stderr, /invalid-bc-atlas-role/iu);
    assert.match(result.stderr, /invalid-bc-atlas-stage/iu);
    assert.match(result.stderr, /unsupported-bc-atlas-attribute/iu);
    assert.match(result.stderr, /broken-document-link|invalid-link-target/iu);
    assert.ok(!existsSync(output));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("docs package resolves complete calculated IDs across apps", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "bc-atlas-docs-package-"));
  const output = path.join(directory, "Docu", "UI");
  const secondAppId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
  try {
    const firstApp = path.join(directory, "FirstApp");
    const secondApp = path.join(directory, "SecondApp");
    mkdirSync(firstApp);
    mkdirSync(secondApp);
    writeFixture(firstApp, PACKAGE_UI_TEST.replace(
      /\n    \[Test\]\n    procedure ProcessWidget\(\)[\s\S]*?\n    end;/u,
      ""
    ));
    writeFileSync(path.join(secondApp, "app.json"), `${JSON.stringify({
      id: secondAppId,
      name: "Processing Tests",
      publisher: "Test",
      version: "2.0.0.0"
    }, null, 2)}\n`);
    writeFileSync(path.join(secondApp, "UITests.al"), PACKAGE_UI_TEST
      .replace("codeunit 50100 WidgetUITest", "codeunit 50101 ProcessWidgetUITest")
      .replace(
        /\n    \[Test\]\n    procedure ConfigureWidget\(\)[\s\S]*?\n    end;/u,
        ""
      )
      .replace(
        "    [Test]\n    procedure ProcessWidget()",
        `    /// <bc-atlas>\n` +
        `    ///   <requires document="${APP_ID}-ConfigureWidget" />\n` +
        "    /// </bc-atlas>\n" +
        "    [Test]\n    procedure ProcessWidget()"
      ));

    const result = runDocs(directory, "package", ".", "--output-dir", output);

    assert.equal(result.status, 0, result.stderr);
    const process = readFileSync(path.join(output, "ProcessWidget.md"), "utf8");
    assert.match(process, new RegExp(
      `requires:\\n  - "${APP_ID}-ConfigureWidget"`,
      "u"
    ));
    assert.match(process, /Back: \[Configure a widget\]\(\.\/ConfigureWidget\.md\)/u);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("docs package recalculates local references when the app ID changes", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "bc-atlas-docs-package-"));
  const output = path.join(directory, "Docu", "UI");
  const changedAppId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
  try {
    writeFixture(directory, CLASSIFIED_UI_TEST);
    const first = runDocs(directory, "package", ".", "--output-dir", output);
    assert.equal(first.status, 0, first.stderr);
    assert.match(
      readFileSync(path.join(output, "ProcessWidget.md"), "utf8"),
      new RegExp(`requires:\\n  - "${APP_ID}-ConfigureWidget"`, "u")
    );

    writeFileSync(path.join(directory, "app.json"), `${JSON.stringify({
      id: changedAppId,
      name: "Widget Tests",
      publisher: "Test",
      version: "1.2.3.4"
    }, null, 2)}\n`);
    const second = runDocs(directory, "package", ".", "--output-dir", output);
    assert.equal(second.status, 0, second.stderr);

    const metadata = readFileSync(path.join(output, "metadata.yml"), "utf8");
    const process = readFileSync(path.join(output, "ProcessWidget.md"), "utf8");
    assert.doesNotMatch(metadata, new RegExp(APP_ID, "u"));
    assert.match(metadata, new RegExp(`${changedAppId}-ConfigureWidget`, "u"));
    assert.match(metadata, new RegExp(`${changedAppId}-ProcessWidget`, "u"));
    assert.match(
      process,
      new RegExp(`requires:\\n  - "${changedAppId}-ConfigureWidget"`, "u")
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("docs package rejects prerequisite cycles before writing", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "bc-atlas-docs-package-"));
  const output = path.join(directory, "Docu", "UI");
  try {
    writeFixture(directory, CLASSIFIED_UI_TEST.replace(
      "    /// <summary>Configure a widget.</summary>",
      "    /// <summary>Configure a widget.</summary>\n" +
      "    /// <bc-atlas>\n" +
      "    ///   <requires document=\"ProcessWidget\" />\n" +
      "    /// </bc-atlas>"
    ));

    const result = runDocs(directory, "package", ".", "--output-dir", output);

    assert.equal(result.status, 1);
    assert.match(result.stderr, /requires-cycle/iu);
    assert.ok(!existsSync(output));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("docs package rejects malformed calculated document IDs", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "bc-atlas-docs-package-"));
  const output = path.join(directory, "Docu", "UI");
  try {
    writeFixture(directory);
    writeFileSync(path.join(directory, "app.json"), `${JSON.stringify({
      id: "not-a-business-central-app-id",
      name: "Invalid App",
      publisher: "Test",
      version: "1.0.0.0"
    }, null, 2)}\n`);

    const result = runDocs(directory, "package", ".", "--output-dir", output);

    assert.equal(result.status, 1);
    assert.match(result.stderr, /invalid-calculated-document-id/iu);
    assert.ok(!existsSync(output));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("docs package check is write-free and regeneration removes only owned stale guides", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "bc-atlas-docs-package-"));
  const output = path.join(directory, "Docu", "UI");
  try {
    writeFixture(directory);
    const generated = runDocs(directory, "package", ".", "--output-dir", output);
    assert.equal(generated.status, 0, generated.stderr);
    const unmanaged = path.join(output, "notes.md");
    writeFileSync(unmanaged, "Keep this file.\n");
    const configure = path.join(output, "ConfigureWidget.md");
    const stale = path.join(output, "ProcessWidget.md");
    writeFileSync(configure, `${readFileSync(configure, "utf8")}manual change\n`);
    const beforeConfigure = readFileSync(configure, "utf8");
    const beforeStale = readFileSync(stale, "utf8");
    writeFixture(directory, PACKAGE_UI_TEST.replace(
      /\n    \[Test\]\n    procedure ProcessWidget\(\)[\s\S]*?\n    end;/u,
      ""
    ));

    const checked = runDocs(
      directory,
      "package",
      ".",
      "--output-dir",
      output,
      "--check"
    );

    assert.equal(checked.status, 1);
    assert.match(checked.stderr, /ConfigureWidget\.md/iu);
    assert.match(checked.stderr, /ProcessWidget\.md/iu);
    assert.equal(readFileSync(configure, "utf8"), beforeConfigure);
    assert.equal(readFileSync(stale, "utf8"), beforeStale);
    assert.equal(readFileSync(unmanaged, "utf8"), "Keep this file.\n");

    const regenerated = runDocs(directory, "package", ".", "--output-dir", output);
    assert.equal(regenerated.status, 0, regenerated.stderr);
    assert.ok(!existsSync(stale));
    assert.doesNotMatch(readFileSync(configure, "utf8"), /manual change/u);
    assert.equal(readFileSync(unmanaged, "utf8"), "Keep this file.\n");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("docs metadata writes the same deterministic sidecar as docs package", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "bc-atlas-docs-package-"));
  const output = path.join(directory, "Docu", "UI");
  const metadataOutput = path.join(directory, "artifacts", "ui-metadata.yml");
  try {
    writeFixture(directory, CLASSIFIED_UI_TEST);

    const metadata = runDocs(
      directory,
      "metadata",
      ".",
      "--output",
      metadataOutput
    );
    assert.equal(metadata.status, 0, metadata.stderr);
    const first = readFileSync(metadataOutput, "utf8");

    const packaged = runDocs(directory, "package", ".", "--output-dir", output);
    assert.equal(packaged.status, 0, packaged.stderr);
    assert.equal(first, readFileSync(path.join(output, "metadata.yml"), "utf8"));

    const repeated = runDocs(
      directory,
      "metadata",
      ".",
      "--output",
      metadataOutput
    );
    assert.equal(repeated.status, 0, repeated.stderr);
    assert.equal(readFileSync(metadataOutput, "utf8"), first);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("docs package is byte-deterministic and clean check is write-free", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "bc-atlas-docs-package-"));
  const output = path.join(directory, "Docu", "UI");
  try {
    writeFixture(directory, CLASSIFIED_UI_TEST);
    const generated = runDocs(directory, "package", ".", "--output-dir", output);
    assert.equal(generated.status, 0, generated.stderr);
    const filenames = ["ConfigureWidget.md", "ProcessWidget.md", "index.md", "metadata.yml"];
    const before = new Map(filenames.map((filename) => [
      filename,
      readFileSync(path.join(output, filename))
    ]));

    const checked = runDocs(directory, "package", ".", "--output-dir", output, "--check");
    assert.equal(checked.status, 0, checked.stderr);
    assert.match(checked.stdout, /documentation package is current/iu);
    for (const filename of filenames) {
      assert.deepEqual(readFileSync(path.join(output, filename)), before.get(filename));
    }

    const repeated = runDocs(directory, "package", ".", "--output-dir", output);
    assert.equal(repeated.status, 0, repeated.stderr);
    for (const filename of filenames) {
      assert.deepEqual(readFileSync(path.join(output, filename)), before.get(filename));
    }

    const guide = readFileSync(path.join(output, "ConfigureWidget.md"), "utf8");
    const metadata = readFileSync(path.join(output, "metadata.yml"), "utf8");
    assert.doesNotMatch(metadata, /^    commit:/mu);
    assert.doesNotMatch(guide, /^(?:version|commit):/mu);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("docs package records a caller-supplied commit for each app", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "bc-atlas-docs-package-"));
  const output = path.join(directory, "Docu", "UI");
  try {
    writeFixture(directory, CLASSIFIED_UI_TEST);

    const result = runDocs(
      directory,
      "package",
      ".",
      "--output-dir",
      output,
      "--commit",
      "abc123def456"
    );

    assert.equal(result.status, 0, result.stderr);
    const metadata = readFileSync(path.join(output, "metadata.yml"), "utf8");
    assert.match(metadata, /^    version: "1\.2\.3\.4"$/mu);
    assert.match(metadata, /^    commit: "abc123def456"$/mu);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("docs package writes a byte-deterministic ZIP containing the complete package", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "bc-atlas-docs-package-"));
  const output = path.join(directory, "Docu", "UI");
  const firstZip = path.join(directory, "artifacts", "ui-first.zip");
  const secondZip = path.join(directory, "artifacts", "ui-second.zip");
  try {
    writeFixture(directory, CLASSIFIED_UI_TEST);
    const first = runDocs(
      directory,
      "package",
      ".",
      "--output-dir",
      output,
      "--zip",
      firstZip
    );
    assert.equal(first.status, 0, first.stderr);

    writeFixture(directory, CLASSIFIED_UI_TEST);
    const second = runDocs(
      directory,
      "package",
      ".",
      "--output-dir",
      output,
      "--zip",
      secondZip
    );
    assert.equal(second.status, 0, second.stderr);
    assert.deepEqual(readFileSync(secondZip), readFileSync(firstZip));

    const archive = unzipSync(new Uint8Array(readFileSync(firstZip)));
    assert.deepEqual(Object.keys(archive).sort(), [
      "ConfigureWidget.md",
      "ProcessWidget.md",
      "index.md",
      "metadata.yml"
    ]);
    for (const [filename, content] of Object.entries(archive)) {
      assert.equal(strFromU8(content), readFileSync(path.join(output, filename), "utf8"));
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
