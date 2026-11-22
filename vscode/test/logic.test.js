"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const logic = require("../src/logic");

const root = path.resolve("/work/app");
const objects = [
  { id: "a", label: "Sales Header", type: "table", objectId: "36", file: "src/Sales.al", line: 3, uses: 4, usedBy: 120, violations: 0, component: "Sales" },
  { id: "b", label: "Sales-Post", type: "codeunit", objectId: "80", file: "src/Sales.al", line: 40, uses: 30, usedBy: 2, violations: 3, component: "Sales" },
  { id: "c", label: "Item", type: "table", objectId: "27", file: "src/Item.al", line: 1, uses: 1, usedBy: 1, violations: 0 }
];

test("maps documents to the project paths BC Atlas uses", () => {
  assert.equal(logic.projectPath(root, path.join(root, "src", "Sales.al")), "src/Sales.al");
  assert.equal(logic.projectPath(root, path.resolve("/work/other/Sales.al")), undefined);
});

test("turns health findings into Problems-panel entries at their file and line", () => {
  const problems = logic.findingsToProblems({
    findings: [
      { severity: "error", rule: "forbidden-dependency", message: "Core must not depend on UI", file: "src/Sales.al", line: 42, object: "b" },
      { severity: "info", rule: "unresolved-references", message: "2 reference(s)" }
    ]
  }, root);
  assert.deepEqual(problems, [{
    file: path.join(root, "src", "Sales.al"), line: 41, severity: "error", message: "Core must not depend on UI", code: "forbidden-dependency", object: "b"
  }]);

  const ranged = { findings: [{ severity: "warning", rule: "parse-error", message: "Unexpected token", file: "src/Sales.al", line: 5, column: 9, endLine: 5, endColumn: 10 }] };
  assert.deepEqual(logic.findingsToProblems(ranged, root), [{
    file: path.join(root, "src", "Sales.al"), line: 4, column: 8, endLine: 4, endColumn: 9, severity: "warning", message: "Unexpected token", code: "parse-error"
  }], "a finding with a range keeps it");
});

test("finds the object at the cursor and puts a CodeLens above each object", () => {
  assert.equal(logic.objectAt(objects, "src/Sales.al", 10).id, "a");
  assert.equal(logic.objectAt(objects, "src/Sales.al", 39).id, "b");
  assert.equal(logic.objectAt(objects, "src/Sales.al", 0).id, "a", "above the first object, the first object");
  assert.equal(logic.objectAt(objects, "src/None.al", 0), undefined);
  assert.deepEqual(logic.lensesForFile(objects, "src/Sales.al"), [
    { line: 2, id: "a", title: "used by 120 · uses 4" },
    { line: 39, id: "b", title: "used by 2 · uses 30" }
  ]);
});

test("summarizes health in the status bar", () => {
  const overview = {
    title: "Contoso",
    summary: { objects: 1200, apps: [{}, {}] },
    health: { passed: false, counts: { error: 2, warning: 5, info: 1 } }
  };
  const status = logic.statusFor(overview);
  assert.equal(status.text, "$(error) BC Atlas: 2 errors");
  assert.equal(status.tone, "error");
  assert.match(status.tooltip, /Contoso: 1,200 objects in 2 apps/u);
  assert.equal(logic.statusFor(undefined).tone, "busy");
  assert.equal(logic.statusFor({ ...overview, health: { passed: true, counts: { error: 0, warning: 0, info: 0 } } }).text, "$(pass) BC Atlas");
});

test("builds view addresses and export arguments", () => {
  assert.equal(logic.viewHash({ lens: "modules", form: "diagram" }), "#lens=modules&form=diagram");
  assert.equal(logic.viewHash({ sel: "app::Contoso.Core::table::50000", form: undefined }), "#sel=app%3A%3AContoso.Core%3A%3Atable%3A%3A50000");
  assert.equal(logic.viewHash(), "#");
  assert.deepEqual(logic.exportArgs("/p", "/p/atlas.html"), ["export", "/p", "-o", "/p/atlas.html"]);
  assert.equal(logic.EXPORT.file, "bc-atlas.html");
});

test("resolves ${workspaceFolder} in al.* settings to the VS Code workspace folder", () => {
  const folder = path.resolve("/work");
  assert.equal(logic.expandWorkspaceFolder("${workspaceFolder}/.alpackages", folder), `${folder}/.alpackages`);
  assert.deepEqual(logic.expandWorkspaceFolder(["${workspaceRoot}/a", "${CodeCop}"], folder), [`${folder}/a`, "${CodeCop}"]);
  assert.equal(logic.expandWorkspaceFolder("${workspaceFolder}/x", undefined), "${workspaceFolder}/x");
  assert.equal(logic.expandWorkspaceFolder(true, folder), true);
});

test("passes only al.* settings someone set, by layer, without the AL defaults", () => {
  const folder = path.resolve("/work");
  const values = {
    packageCachePath: { defaultValue: "./.alpackages", workspaceFolderValue: "${workspaceFolder}/symbols", workspaceValue: "${workspaceFolder}/shared", globalValue: "~/cache" },
    codeAnalyzers: { defaultValue: [], globalValue: ["${CodeCop}"] }
  };
  assert.deepEqual(logic.editorAlSettings((key) => values[key], { workspaceFolder: folder }), {
    user: { packageCachePath: "~/cache" },
    workspace: { packageCachePath: `${folder}/shared` },
    workspaceFolder: { packageCachePath: `${folder}/symbols` }
  }, "only the settings BC Atlas reads");
  // In a multi-root workspace, ${workspaceFolder} in the .code-workspace is resolved per project by the engine.
  assert.equal(logic.editorAlSettings((key) => values[key], { workspaceFolder: folder, multiRoot: true }).workspace.packageCachePath,
    "${workspaceFolder}/shared");
  assert.deepEqual(logic.editorAlSettings(() => undefined), {});
});
