import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { assessArchitecture } from "../src/blueprint/index.js";
import { extractedAppId, idRanges, planExtraction } from "../src/blueprint/extract.js";
import { applyRefactoring, planMove } from "../src/refactor/move.js";
import { lineDiff } from "../src/refactor/diff.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const monolith = path.join(root, "examples", "monolith");
const cli = path.join(root, "src", "cli.js");

function copyMonolith() {
  const directory = mkdtempSync(path.join(os.tmpdir(), "bc-atlas-monolith-"));
  cpSync(monolith, directory, { recursive: true });
  return directory;
}

test("data ownership shows which components write, read, and relate to each table", async () => {
  const { result } = await assessArchitecture(monolith);
  const orders = result.dataOwnership.find(({ table }) => table === "table 50100 CON Sales Order");
  assert.equal(orders.component, "Sales");
  assert.equal(orders.status, "shared-writes");
  assert.deepEqual(orders.writers, [{ component: "Warehouse", objects: ["codeunit 50200 CON Shipment Mgt."] }]);
  assert.deepEqual(orders.relations, [{ component: "Warehouse", objects: ["table 50200 CON Shipment"] }]);
  const item = result.dataOwnership.find(({ table }) => table === "table 50000 CON Item");
  assert.equal(item.status, "owned", "only Core writes CON Item");
  assert.equal(result.summary.sharedTables, 1);

  const check = result.checks.find(({ rule }) => rule === "foreign-table-write");
  assert.equal(check.severity, "info");
  assert.equal(check.file, "src/Sales/SalesOrder.Table.al", "points at the table, not at .bca.json");
  assert.match(check.message, /CON Sales Order of Sales is written by Warehouse \(1 object\)/u);
});

test("work items that are moves carry the bca refactor command", async () => {
  const { result } = await assessArchitecture(monolith);
  const item = result.workItems.find(({ strategy }) => strategy === "move-subscriber");
  assert.equal(item.source.label, "CON Warehouse Hooks");
  assert.equal(item.command, 'bca refactor move --object codeunit:50001 --to "Warehouse"');
  assert.equal(result.workItems.find(({ strategy }) => strategy === "use-public-api").command, undefined);
});

test("an extraction plan names blockers, the app.json, data moves, and steps", async () => {
  const assessment = await assessArchitecture(monolith);
  const plan = planExtraction(assessment, "Warehouse");
  assert.equal(plan.ready, false);
  assert.deepEqual(plan.blockers.map(({ kind }) => kind), ["wrong-way-dependencies-on-it", "app-cycle"]);
  assert.equal(plan.blockers[0].workItems[0].command, 'bca refactor move --object codeunit:50001 --to "Warehouse"');
  assert.match(plan.blockers[1].message, /uses Sales and is used by Permissions, Core, which all stay in Contoso Monolith/u);
  assert.deepEqual(plan.uses, [{ component: "Sales", objects: 1 }]);

  assert.equal(plan.appJson.id, extractedAppId("7e1b2c3d-4f50-4a6b-8c7d-9e0f1a2b3c4d", "Warehouse"));
  assert.equal(planExtraction(assessment, "Warehouse").appJson.id, plan.appJson.id, "the same plan names the same app");
  assert.match(plan.appJson.id, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
  assert.deepEqual(plan.appJson.dependencies.map(({ name }) => name), ["Contoso Monolith"]);
  assert.deepEqual(plan.appJson.idRanges, [{ from: 50200, to: 50200 }]);
  assert.equal(plan.appJson.runtime, "14.0");

  assert.deepEqual(plan.tables.map(({ object }) => object), ["table 50200 CON Shipment"]);
  assert.ok(plan.steps.some((step) => step.includes(`MovedTo = '${plan.appJson.id}'`) && step.includes("ObsoleteState = PendingMove")));
  assert.ok(plan.steps.some((step) => step === "Add Warehouse to the dependencies of the app(s) that use it: Contoso Monolith (Permissions, Core)."));
  assert.deepEqual(plan.permissionSets.map(({ permissionSet }) => permissionSet), ["permissionset 50000 CON ALL"]);
  assert.throws(() => planExtraction(assessment, "Nope"), /no component "Nope"/u);

  // Components that are apps already need no data moves.
  const multi = await assessArchitecture(path.join(root, "examples", "multi-app"));
  const sales = planExtraction(multi, "Sales");
  assert.equal(sales.alreadyAnApp, true);
  assert.deepEqual(sales.tables, []);
});

test("idRanges groups object IDs that lie close together", () => {
  assert.deepEqual(idRanges([50000, 50001, 50050, 50300, 50301]), [{ from: 50000, to: 50050 }, { from: 50300, to: 50301 }]);
  assert.deepEqual(idRanges([undefined, "50100"]), [{ from: 50100, to: 50100 }]);
});

test("refactor move moves a file to another component and fixes its namespace and usings", async () => {
  const directory = copyMonolith();
  try {
    const assessment = await assessArchitecture(directory);
    const plan = await planMove(assessment, { object: "codeunit:50001", to: "Warehouse" });
    assert.deepEqual(plan.operations.map(({ action, from, path: file }) => [action, from, file]),
      [["move", "src/Core/WarehouseHooks.Codeunit.al", "src/Warehouse/WarehouseHooks.Codeunit.al"]]);
    assert.match(plan.diff, /^-namespace Contoso\.Core;\n\+namespace Contoso\.Warehouse;$/mu);
    assert.ok(existsSync(path.join(directory, "src/Core/WarehouseHooks.Codeunit.al")), "planning writes nothing");

    await applyRefactoring(directory, plan);
    const moved = readFileSync(path.join(directory, "src/Warehouse/WarehouseHooks.Codeunit.al"), "utf8");
    assert.match(moved, /^namespace Contoso\.Warehouse;\n\nusing Contoso\.Core;\n\n\/\/ Reacts/u, "uses Core now; no using of its own namespace");
    assert.ok(!existsSync(path.join(directory, "src/Core/WarehouseHooks.Codeunit.al")));

    // The wrong-way dependency and the component cycle are gone.
    const after = await assessArchitecture(directory);
    assert.ok(!after.result.violations.some(({ rule }) => rule === "undeclared-component-dependency"));
    assert.equal(after.result.cycles.length, 0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("refactor move cuts an object out of a shared file and adds usings where it is referenced", async () => {
  const directory = copyMonolith();
  try {
    const assessment = await assessArchitecture(directory);
    const plan = await planMove(assessment, { object: "table:CON Item Category", to: "Sales" });
    assert.deepEqual(plan.operations.map(({ action, path: file }) => [action, file]),
      [["edit", "src/Core/Item.Table.al"], ["create", "src/Sales/CONItemCategory.Table.al"]],
      "the permission set already has using Contoso.Sales");
    assert.equal(plan.to.namespace, "Contoso.Sales");

    // A file that changes after planning is not overwritten.
    const item = path.join(directory, "src/Core/Item.Table.al");
    const original = readFileSync(item, "utf8");
    writeFileSync(item, `${original}\n`);
    await assert.rejects(applyRefactoring(directory, plan), /changed since the plan was made/u);
    writeFileSync(item, original);

    await applyRefactoring(directory, plan);
    const rest = readFileSync(item, "utf8");
    assert.match(rest, /^namespace Contoso\.Core;\n\nusing Contoso\.Sales;\n\ntable 50000 "CON Item"/u);
    assert.doesNotMatch(rest, /CON Item Category"\n\{/u);
    assert.ok(rest.endsWith("}\n"));
    const created = readFileSync(path.join(directory, "src/Sales/CONItemCategory.Table.al"), "utf8");
    assert.match(created, /^namespace Contoso\.Sales;\n\ntable 50001 "CON Item Category"\n\{/u);

    await assert.rejects(planMove(assessment, { object: "Nope", to: "Sales" }), /matches no object/u);
    await assert.rejects(planMove(assessment, { object: "codeunit:50001", to: "Nope" }), /no component "Nope"/u);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("bca refactor move previews by default; bca architecture --extract plans an extraction", () => {
  const directory = copyMonolith();
  try {
    const run = (...args) => spawnSync(process.execPath, [cli, ...args], { encoding: "utf8" });
    const preview = run("refactor", "move", directory, "--object", "codeunit:50001", "--to", "Warehouse");
    assert.equal(preview.status, 0, preview.stderr);
    assert.match(preview.stdout, /Dry run: nothing was written/u);
    assert.ok(existsSync(path.join(directory, "src/Core/WarehouseHooks.Codeunit.al")));
    const applied = run("refactor", "move", directory, "--object", "codeunit:50001", "--to", "Warehouse", "--apply", "--format", "json");
    assert.equal(JSON.parse(applied.stdout).applied, true);
    assert.ok(existsSync(path.join(directory, "src/Warehouse/WarehouseHooks.Codeunit.al")));

    const extraction = run("architecture", directory, "--extract", "Warehouse", "--format", "markdown");
    assert.equal(extraction.status, 0, "a plan never fails the command");
    assert.match(extraction.stdout, /^# Extract Warehouse as an app/u);
    assert.match(extraction.stdout, /## app\.json/u);
    assert.equal(run("refactor", "nope").status, 2);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("lineDiff shows changed lines with context", () => {
  const diff = lineDiff("a.al", "a.al", "one\ntwo\nthree\n", "one\nTWO\nthree\n");
  assert.equal(diff, "--- a/a.al\n+++ b/a.al\n@@ -1,4 +1,4 @@\n one\n-two\n+TWO\n three\n \n");
  assert.equal(lineDiff("a.al", "a.al", "same", "same"), "");
  assert.equal(lineDiff("new.al", "new.al", "", "x\n"), "--- /dev/null\n+++ b/new.al\n@@ -0,0 +1,2 @@\n+x\n+\n");
});
