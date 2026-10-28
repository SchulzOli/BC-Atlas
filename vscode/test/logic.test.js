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
      { severity: "error", rule: "architecture-violation", message: "Sales-Post (Sales) depends on Core", file: "src/Sales.al", line: 42, object: "b" },
      { severity: "info", rule: "unresolved-references", message: "2 reference(s)" }
    ]
  }, root);
  assert.deepEqual(problems, [{
    file: path.join(root, "src", "Sales.al"), line: 41, severity: "error", message: "Sales-Post (Sales) depends on Core", code: "architecture-violation", object: "b"
  }]);
});

test("finds the object at the cursor and puts a CodeLens above each object", () => {
  assert.equal(logic.objectAt(objects, "src/Sales.al", 10).id, "a");
  assert.equal(logic.objectAt(objects, "src/Sales.al", 39).id, "b");
  assert.equal(logic.objectAt(objects, "src/Sales.al", 0).id, "a", "above the first object, the first object");
  assert.equal(logic.objectAt(objects, "src/None.al", 0), undefined);
  assert.deepEqual(logic.lensesForFile(objects, "src/Sales.al"), [
    { line: 2, id: "a", title: "used by 120 · uses 4 · component Sales", warning: false },
    { line: 39, id: "b", title: "used by 2 · uses 30 · component Sales · 3 dependencies against the architecture", warning: true }
  ]);
});

test("summarizes health in the status bar and the side bar", () => {
  const overview = {
    title: "Contoso",
    summary: { objects: 1200, apps: [{}, {}] },
    health: { passed: false, counts: { error: 2, warning: 5, info: 1 } },
    architecture: { mode: "proposal", violations: 17, extractable: 3, components: 9 },
    docs: { scenarios: 4 }
  };
  const status = logic.statusFor(overview);
  assert.equal(status.text, "$(error) BC Atlas: 2 errors");
  assert.equal(status.tone, "error");
  assert.match(status.tooltip, /Contoso: 1,200 objects in 2 apps/u);
  assert.equal(logic.statusFor(undefined).tone, "busy");
  assert.equal(logic.statusFor({ ...overview, health: { passed: true, counts: { error: 0, warning: 0, info: 0 } } }).text, "$(pass) BC Atlas");
  assert.deepEqual(logic.pages(overview).map(({ id }) => id), ["overview", "health", "architecture", "dependencies", "diagrams", "objects", "docs"]);
  assert.ok(!logic.pages({ ...overview, docs: { scenarios: 0 } }).some(({ id }) => id === "docs"));
});

test("builds page addresses and export arguments", () => {
  assert.equal(logic.pageHash("architecture", { propose: 1 }), "#/architecture?propose=1");
  assert.equal(logic.pageHash("overview"), "#/overview");
  const app = logic.EXPORTS.find(({ view }) => view === "app");
  assert.deepEqual(logic.exportArgs(app, "/p", "/p/atlas.html"), ["export", "/p", "--view", "app", "-o", "/p/atlas.html"]);
  assert.ok(logic.EXPORTS.some(({ view, folder }) => view === "report" && folder));
});
