// The user guides joined with the source: the guides in the one graph, a
// journey as a story, and what is not documented as an opt-in finding.
import test from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runHealthCheck } from "../src/commands/check.js";
import { Workspace } from "../src/app/workspace.js";

const warehouse = fileURLToPath(new URL("../examples/warehouse-app", import.meta.url));

test("every documented UI test is a guide in the graph, linked to the pages its steps use", async () => {
  const workspace = new Workspace(warehouse, {}, { live: false });
  const guides = await workspace.guides();
  assert.deepEqual(guides.guides.map(({ id }) => id), ["warehouse-request-create", "warehouse-request-process"]);
  assert.deepEqual(guides.guides[1].pages.map(({ actions }) => actions), [["ProcessRequest"]], "with the actions it uses");
  assert.deepEqual(guides.undocumented.map(({ procedure, line }) => [procedure, line]), [["WarehouseRequests_OpenList_ShowsRequests", 83]]);
  assert.deepEqual(guides.uncovered, [], "every page of the example has a guide");

  const atlas = await workspace.atlas();
  const guideNodes = atlas.nodes.filter(({ kind }) => kind === "guide");
  assert.deepEqual(guideNodes.map(({ label }) => label), ["Create a new Warehouse Request", "Process an existing warehouse request from the request list"]);
  assert.equal(guideNodes[1].roles, "Warehouse Worker");
  assert.equal(guideNodes[1].file, "WarehouseUITests.al", "a guide opens its UI test");
  const page = atlas.nodes.find(({ kind, label }) => kind === "object" && label === "Warehouse Requests");
  assert.equal(page.guides, 2, "a page counts its guides");
  const documents = atlas.relations.findIndex(({ kind }) => kind === "documents");
  const pageAt = atlas.nodes.indexOf(page);
  assert.equal(atlas.edges.filter(([, to, relation]) => relation === documents && to === pageAt).length, 2);

  const pages = atlas.lenses.find(({ id }) => id === "pages");
  assert.ok(pages.kinds.includes("guide") && pages.relations.includes("documents"), "the Pages lens shows the guides");
  assert.ok(!atlas.lenses.find(({ id }) => id === "system").kinds.includes("guide"), "the other lenses do not");

  const journey = atlas.stories.find(({ id }) => id === "journey-inbound-warehouse-request");
  assert.equal(journey.kind, "journey");
  assert.deepEqual(journey.steps.map(({ title }) => title), ["Create a new Warehouse Request", "Process an existing warehouse request from the request list"]);
  assert.ok(journey.steps.every(({ lens, nodes }) => lens === "pages" && nodes.includes(pageAt)), "each stage on its guide and its pages");
});

test("a project without UI tests has no guides, and its Pages lens is as before", async () => {
  const multi = fileURLToPath(new URL("../examples/multi-app", import.meta.url));
  const atlas = await new Workspace(multi, {}, { live: false }).atlas();
  assert.ok(!atlas.nodes.some(({ kind }) => kind === "guide"));
  assert.ok(!atlas.lenses.some(({ kinds }) => kinds.includes("guide")));
  assert.ok(!atlas.stories.some(({ kind }) => kind === "journey"));
});

test("check.documentation reports pages without a guide and UI tests without documentation", async () => {
  const off = await runHealthCheck(warehouse);
  assert.ok(!off.report.findings.some(({ rule }) => rule === "undocumented-ui-test"), "off by default");
  assert.equal(off.report.thresholds.documentation, "off");

  const directory = mkdtempSync(path.join(os.tmpdir(), "bca-guides-"));
  try {
    cpSync(warehouse, directory, { recursive: true });
    // A page no UI test opens.
    writeFileSync(path.join(directory, "Setup.al"), "page 50120 \"Warehouse Setup\"\n{\n    PageType = Card;\n}\n");
    writeFileSync(path.join(directory, ".bca.json"), JSON.stringify({ check: { documentation: "warning" } }));
    const { report } = await runHealthCheck(directory);
    const found = report.findings.filter(({ rule }) => ["page-without-guide", "undocumented-ui-test"].includes(rule));
    assert.deepEqual(found.map(({ rule, severity, file, line }) => [rule, severity, file, line]), [
      ["page-without-guide", "warning", "Setup.al", 1],
      ["undocumented-ui-test", "warning", "WarehouseUITests.al", 83]
    ]);
    assert.match(found[0].message, /Warehouse Setup is shown in no user guide/u);
    assert.ok(found.every(({ fix }) => fix), "each with what to do");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("the pages of bca layers and the user guides link to each other", async () => {
  const { syncLayers } = await import("../src/commands/layers.js");
  const { exportDocumentation } = await import("../src/docs/export.js");
  const { loadCorpus } = await import("../src/docs/model.js");
  const { readFileSync } = await import("node:fs");
  const directory = mkdtempSync(path.join(os.tmpdir(), "bca-guides-links-"));
  try {
    cpSync(warehouse, directory, { recursive: true });
    const layers = path.join(directory, "docs", "layers");
    const generated = path.join(directory, "docs", "generated");
    const pagePath = path.join(layers, "objects", "page-50110-warehouse-requests.md");

    await syncLayers(directory, { pictures: "none" });
    assert.match(readFileSync(pagePath, "utf8"), /^- Create a new Warehouse Request: 4 steps here, by Purchasing Agent, WAREHOUSE PROCESS \(`WarehouseUITests\.al:17`\)$/mu,
      "before the guides are written, a page names them");
    const manifest = JSON.parse(readFileSync(path.join(layers, "layers.json"), "utf8"));
    assert.ok(manifest.objects.some(({ type, page }) => type === "page" && page === "objects/page-50110-warehouse-requests.md"), "layers.json says where each object is");

    await exportDocumentation(await loadCorpus(directory), { outputDirectory: generated, layersDirectory: layers, formats: "markdown,html", appRoot: directory });
    const guide = readFileSync(path.join(generated, "warehouse-request-process.md"), "utf8");
    assert.match(guide, /## In the system[\s\S]*- \[page 50110 Warehouse Requests\]\(\.\.\/layers\/objects\/page-50110-warehouse-requests\.md\)/u);
    assert.match(readFileSync(path.join(generated, "index.html"), "utf8"), /href="\.\.\/layers\/objects\/page-50110-warehouse-requests\.md"/u);

    await syncLayers(directory, { pictures: "none" });
    assert.match(readFileSync(pagePath, "utf8"), /^- \[Create a new Warehouse Request\]\(\.\.\/\.\.\/generated\/warehouse-request-create\.md\): 4 steps here/mu,
      "once they are written, a page links to them");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("in an editor, a save reads again only the UI tests that changed", async () => {
  const { loadCorpus } = await import("../src/docs/model.js");
  const { utimesSync } = await import("node:fs");
  const directory = mkdtempSync(path.join(os.tmpdir(), "bca-guides-cache-"));
  try {
    cpSync(warehouse, directory, { recursive: true });
    const cache = new Map();
    const first = await loadCorpus(directory, { cache });
    const file = path.join(directory, "WarehouseUITests.al");
    const entry = cache.get(file);
    assert.ok(entry && first.scenarios.length === 2);
    const again = await loadCorpus(directory, { cache });
    assert.equal(cache.get(file), entry, "an unchanged file is not read again");
    assert.deepEqual(again.scenarios.map(({ value }) => value.id), first.scenarios.map(({ value }) => value.id));
    utimesSync(file, new Date(), new Date(Date.now() + 5000));
    await loadCorpus(directory, { cache });
    assert.notEqual(cache.get(file), entry, "a changed file is");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("tests of different codeunits with the same name are both documented", async () => {
  const { loadCorpus } = await import("../src/docs/model.js");
  const directory = mkdtempSync(path.join(os.tmpdir(), "bca-guides-ids-"));
  const test = (codeunit, id) => `codeunit ${id} "${codeunit}"\n{\n    Subtype = Test;\n\n    [Test]\n    procedure AddNewAccountTest()\n    var\n        Accounts: TestPage "Email Accounts";\n    begin\n        // [SCENARIO] Add an account.\n        Accounts.OpenView();\n        Accounts.Close();\n    end;\n}\n`;
  try {
    writeFileSync(path.join(directory, "EmailAccountsTest.Codeunit.al"), test("Email Accounts Test", 50100));
    writeFileSync(path.join(directory, "FileAccountsTest.Codeunit.al"), test("File Accounts Test", 50101));
    writeFileSync(path.join(directory, "Other.Codeunit.al"), test("Other", 50102).replace("AddNewAccountTest", "OtherTest").replace("// [SCENARIO]", "// [DOC-ID] add-new-account-test\n        // [SCENARIO]"));
    const corpus = await loadCorpus(directory);
    assert.deepEqual(corpus.diagnostics, []);
    assert.deepEqual(corpus.scenarios.map(({ value }) => value.id), ["add-new-account-test", "email-accounts-test-add-new-account-test", "file-accounts-test-add-new-account-test"],
      "a derived ID takes its file's name; one an author gave stays");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
