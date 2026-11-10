import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { strToU8, zipSync } from "fflate";
import { createArchitectureModel } from "../src/architecture.js";
import { permissionGrant } from "../src/permission-semantics.js";
import { createAccessIndex } from "../src/simulation/access.js";
import { simulate } from "../src/simulation/index.js";
import { formatSimulationMarkdown, formatSimulationText } from "../src/simulation/report.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const purchasing = path.join(root, "examples", "purchasing-app");
const warehouse = path.join(root, "examples", "warehouse-app");
const cli = path.join(root, "src", "cli.js");

/** A small app in a temporary folder: { "File.al": source }, plus .bca.json when given. */
function app(t, files, config) {
  const directory = mkdtempSync(path.join(os.tmpdir(), "bca-simulation-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  writeFileSync(path.join(directory, "app.json"), JSON.stringify({ id: "22222222-2222-2222-2222-222222222222", name: "Battle Fixture", publisher: "Test", version: "1.0.0.0" }));
  for (const [name, source] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(directory, name)), { recursive: true });
    writeFileSync(path.join(directory, name), source);
  }
  if (config) writeFileSync(path.join(directory, ".bca.json"), JSON.stringify(config));
  return directory;
}

const scenario = (id, permissions, body, extra = "") => `
    [Test]
    procedure ${id.replaceAll("-", "_")}()
    var
        Orders: TestPage Orders;
    begin
        // [DOC-ID] ${id}
        // [FEATURE] orders
        // [SCENARIO] Scenario ${id}.
        ${permissions.map((name) => `// [PERMISSIONS] ${name}`).join("\n        ")}
        // [WHEN] The user works on the order.
        ${body}
        // [THEN] It worked.
        ${extra}
    end;`;

const tests = (...scenarios) => `codeunit 50990 "Order UI Tests"\n{\n    Subtype = Test;\n${scenarios.join("\n")}\n}\n`;

test("a lowercase permission is an indirect right", () => {
  assert.deepEqual(permissionGrant("tabledata", "RIMD").indirectRights, undefined);
  const grant = permissionGrant("tabledata", "Rimd");
  assert.deepEqual(grant.tableDataRights, ["read", "insert", "modify", "delete"]);
  assert.deepEqual(grant.indirectRights, ["insert", "modify", "delete"]);
  assert.deepEqual(permissionGrant("codeunit", "x").indirectRights, ["execute"]);
});

test("permission sets compose through inclusions, extensions, exclusions, and wildcards", async (t) => {
  const directory = app(t, {
    "Objects.al": `
      table 50000 Orders { fields { field(1; "No."; Code[20]) { } } }
      table 50001 Lines { fields { field(1; "No."; Code[20]) { } } }
      codeunit 50000 Posting { }
      permissionset 50000 Base { Permissions = tabledata Orders = R; }
      permissionset 50001 Editing { IncludedPermissionSets = Base; Permissions = tabledata Orders = im, codeunit Posting = X; }
      permissionsetextension 50002 "Editing Ext" extends Editing { Permissions = tabledata Lines = RIMD; }
      permissionset 50003 Everything { Permissions = tabledata * = RIMD, codeunit * = X; }
      permissionset 50004 Restricted { IncludedPermissionSets = Editing; ExcludedPermissionSets = Base; }
    `
  });
  const { model } = await createArchitectureModel(directory, { view: "project" });
  const access = createAccessIndex(model);
  const object = (name) => model.objects.find((candidate) => candidate.name === name && !candidate.type.startsWith("permission"));

  const editing = access.effective(["Editing"]);
  assert.deepEqual(editing.sets.map(({ name, includedBy }) => [name, includedBy]), [["Editing", undefined], ["Base", "Editing"]]);
  assert.deepEqual(editing.check(object("Orders"), "read"), { granted: "direct", by: ["Base"] });
  assert.deepEqual(editing.check(object("Orders"), "modify"), { granted: "indirect", by: ["Editing"] });
  assert.equal(editing.check(object("Orders"), "delete").granted, false);
  assert.equal(editing.check(object("Lines"), "insert").granted, "direct", "an extension adds to the set it extends");
  assert.equal(editing.check(object("Posting"), "execute").granted, "direct");

  assert.equal(access.effective(["Restricted"]).check(object("Orders"), "read").granted, false, "an excluded set takes its grants away");
  assert.equal(access.effective(["Everything"]).check(object("Lines"), "delete").granted, "direct", "tabledata * covers every table");
  assert.equal(access.effective(["Everything"]).check(object("Posting"), "execute").granted, "direct");

  const unknown = access.effective(["Base", "D365 BASIC", "SUPER"]);
  assert.deepEqual(unknown.unknown, ["D365 BASIC"]);
  assert.equal(unknown.check(object("Lines"), "delete").granted, "direct", "SUPER grants everything");
  assert.equal(access.effective(["D365 BASIC"]).check(object("Orders"), "read").granted, false, "a set outside the source grants nothing on the app's objects");
});

test("agents perform the process tests of the purchasing example with their roles' permission sets", async () => {
  const report = await simulate(purchasing);
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.title, "Battle test: Contoso GmbH uses BC Atlas Purchasing Example");
  assert.equal(report.passed, false);
  assert.deepEqual(report.counts, { error: 2, warning: 2, info: 0 });
  assert.deepEqual(report.summary.assigned, { total: 7, completed: 6, blocked: 1, unverified: 0 });
  assert.deepEqual(report.summary.forbidden, { total: 5, denied: 4, possible: 1, unverified: 0 });

  // The team lead is blocked by the subscriber codeunit the approval raises an event for.
  const ben = report.agents.find(({ name }) => name === "Ben");
  const approve = ben.attempts.find(({ task }) => task === "purchase-request-approve");
  assert.equal(approve.outcome, "blocked");
  assert.equal(approve.blockedAt, 3);
  assert.deepEqual(approve.missing.map(({ object, right }) => [object, right]), [["codeunit 50222 Request Notifications", "execute"]]);
  assert.match(approve.missing[0].because, /subscribes to OnAfterApproveRequest of codeunit 50220 Purchase Request Mgt\./u);
  assert.deepEqual(approve.missingPermissions, ['codeunit "Request Notifications" = X']);
  // The approval log is inserted with the indirect right (Ri) through the codeunit's Permissions property.
  assert.ok(!approve.missing.some(({ object }) => object.includes("Request Approval Entry")));
  const [blocked, forbidden] = report.findings;
  assert.equal(blocked.code, "task-blocked");
  assert.match(blocked.message, /^Ben \(Team lead\) cannot complete "Approve a released purchase request": step 3 \(Choose the Approve action\) needs Execute on codeunit 50222 Request Notifications\.$/u);
  assert.match(blocked.action, /`codeunit "Request Notifications" = X`/u);

  // Who must not approve: the employee is denied, the administrator is not.
  const anna = report.agents.find(({ name }) => name === "Anna");
  assert.deepEqual(anna.attempts.filter(({ expected }) => expected === "deny").map(({ task, outcome }) => [task, outcome]),
    [["purchase-request-approve", "denied"], ["purchase-request-order", "denied"]]);
  assert.equal(forbidden.code, "forbidden-task-possible");
  assert.match(forbidden.message, /^Dana \(Administrator\) can complete "Approve a released purchase request" but must not be able to\.$/u);
  const dana = report.agents.find(({ name }) => name === "Dana");
  assert.deepEqual(dana.permissionSets.map(({ name, includedBy }) => `${name}${includedBy ? ` < ${includedBy}` : ""}`),
    ["PR - ADMIN", "PR - REQUEST < PR - ADMIN", "PR - APPROVE < PR - ADMIN", "PR - ORDER < PR - ADMIN", "PR - SETUP < PR - ADMIN"]);
  assert.deepEqual(dana.alsoAble.map(({ task }) => task), ["purchase-request-create", "purchase-request-release", "purchase-request-order"]);
  // Least privilege: what a role holds and no assigned task needs.
  assert.deepEqual(anna.unusedPermissions.map(({ line }) => line), ['tabledata "Purchase Request Setup" = R']);

  assert.deepEqual(report.matrix.rows.map(({ agent, cells }) => [agent, ...cells]), [
    ["Anna", "completed", "completed", "denied-as-expected", "denied-as-expected", "unable"],
    ["Ben", "completed", "completed", "blocked", "denied-as-expected", "unable"],
    ["Carla", "unable", "unable", "denied-as-expected", "completed", "unable"],
    ["Dana", "able", "able", "forbidden-possible", "able", "completed"]
  ]);

  // The process: blocked at the approval, the order waits for it.
  const [requests, setup] = report.processes;
  assert.equal(requests.status, "blocked");
  assert.deepEqual(requests.steps.map(({ task, status }) => [task, status]), [
    ["purchase-request-create", "done"],
    ["purchase-request-release", "done"],
    ["purchase-request-approve", "blocked"],
    ["purchase-request-order", "waiting"]
  ]);
  assert.deepEqual(requests.steps[3].waitsFor, ["purchase-request-approve"]);
  assert.equal(requests.handovers, 2);
  assert.equal(setup.status, "runs");

  // Fit-gap: fit, a permission gap, a function nothing proves, a function the app lacks.
  assert.deepEqual(report.fitGap.requirements.map(({ id, status }) => [id, status]), [
    ["REQ-1", "fit"], ["REQ-2", "permission-gap"], ["REQ-3", "fit"], ["REQ-4", "fit"], ["REQ-5", "untested"], ["REQ-6", "gap"]
  ]);
  assert.match(report.fitGap.requirements[1].action, /`codeunit "Request Notifications" = X`/u);
  assert.deepEqual(report.fitGap.untestedPages.map(({ object }) => object), ["page 50213 Request Approval Entries"]);
  assert.deepEqual(report.findings.slice(2).map(({ code, requirement }) => [code, requirement]), [["requirement-gap", "REQ-5"], ["requirement-gap", "REQ-6"]]);

  // Every step says what it needs and why.
  const task = report.tasks.find(({ id }) => id === "purchase-request-approve");
  assert.equal(task.source.file, "processes/PurchaseRequestUITests.al");
  assert.deepEqual(task.steps.map(({ kind }) => kind), ["open", "go-to-record", "invoke", "close"]);
  assert.deepEqual(task.steps[0].needs.map(({ letter, object }) => `${letter} ${object}`), ["X page 50210 Purchase Requests", "R table 50200 Purchase Request"]);
  assert.deepEqual(task.steps[2].needs.map(({ letter, object }) => `${letter} ${object}`), [
    "X codeunit 50220 Purchase Request Mgt.",
    "R table 50201 Purchase Request Setup",
    "M table 50200 Purchase Request",
    "I table 50202 Request Approval Entry",
    "X codeunit 50222 Request Notifications"
  ]);
  assert.equal(task.steps[2].needs[3].because, "codeunit 50220 Purchase Request Mgt. (LogApproval) runs Insert", "a helper's access is the helper's");
  const create = report.tasks.find(({ id }) => id === "purchase-request-create");
  assert.deepEqual(create.steps[0].needs.map(({ letter }) => letter), ["X", "R", "I"], "a new record needs Insert");
  assert.deepEqual(create.steps[1].needs.map(({ letter }) => letter), ["M"]);
});

test("without roles, the [PERMISSIONS] of the tests are the roles", async () => {
  const report = await simulate(warehouse);
  assert.equal(report.company.derived, true);
  assert.equal(report.passed, true);
  assert.deepEqual(report.findings, []);
  assert.deepEqual(report.agents.map(({ name, roles }) => [name, roles]), [["WAREHOUSE PROCESS", ["WAREHOUSE PROCESS"]]]);
  assert.deepEqual(report.agents[0].attempts.map(({ task, outcome }) => [task, outcome]),
    [["warehouse-request-create", "completed"], ["warehouse-request-process", "completed"]]);
  assert.deepEqual(report.fitGap.requirements.map(({ title, status }) => [title, status]), [["Warehouse requests", "fit"]]);
  assert.equal(report.fitGap.derived, true);
  assert.equal(report.processes[0].status, "runs");
  // Processing raises an event; the subscriber's codeunit is part of what the step needs.
  const process = report.tasks.find(({ id }) => id === "warehouse-request-process");
  assert.ok(process.steps[2].needs.some(({ object, right }) => object === "codeunit 50120 Warehouse Notifications" && right === "execute"));
});

const ORDERS = `
  table 50000 Orders
  {
      fields
      {
          field(1; "No."; Code[20]) { }
          field(2; Amount; Decimal)
          {
              trigger OnValidate()
              var
                  Audit: Record Audit;
              begin
                  Audit.Insert();
              end;
          }
      }
      trigger OnInsert()
      var
          Numbering: Codeunit Numbering;
      begin
          Numbering.Next();
      end;
  }
  table 50001 Audit { fields { field(1; "No."; Code[20]) { } } }
  table 50002 Lines { fields { field(1; "No."; Code[20]) { } } }
  table 50003 Buffer { TableType = Temporary; fields { field(1; "No."; Code[20]) { } } }
  codeunit 50000 Numbering
  {
      procedure Next()
      var
          Buffer: Record Buffer;
          Scratch: Record Audit temporary;
      begin
          Buffer.Insert();
          Scratch.Insert();
      end;
  }
  codeunit 50001 Posting
  {
      trigger OnRun()
      var
          Lines: Record Lines;
      begin
          Lines.DeleteAll();
      end;
  }
  codeunit 50002 Reader
  {
      [InherentPermissions(PermissionObjectType::TableData, Database::Audit, 'r')]
      procedure Count()
      var
          Audit: Record Audit;
      begin
          Audit.FindFirst();
      end;
  }
  page 50000 Orders
  {
      SourceTable = Orders;
      layout
      {
          area(Content)
          {
              field("No."; Rec."No.") { }
              field(Amount; Rec.Amount) { }
              part(Lines; "Order Lines") { }
          }
      }
      actions
      {
          area(Processing)
          {
              action(Post)
              {
                  trigger OnAction()
                  begin
                      Codeunit.Run(Codeunit::Posting);
                  end;
              }
              action(Count)
              {
                  trigger OnAction()
                  var
                      Reader: Codeunit Reader;
                  begin
                      Reader.Count();
                  end;
              }
              action(ShowLines)
              {
                  RunObject = page "Order Lines";
              }
          }
      }
  }
  page 50001 "Order Lines"
  {
      PageType = ListPart;
      SourceTable = Lines;
      layout { area(Content) { repeater(Rows) { field("No."; Rec."No.") { } } } }
  }
`;

test("a step needs what the code behind it runs: triggers, Codeunit.Run, parts, RunObject", async (t) => {
  const directory = app(t, {
    "Orders.al": `${ORDERS}
      permissionset 50000 Clerk { Permissions = tabledata Orders = RIM, tabledata Audit = i, page Orders = X, codeunit Numbering = X; }
    `,
    "test/OrderTests.al": tests(
      scenario("order-create", ["Clerk"], "Orders.OpenNew();\n        Orders.Amount.SetValue(10);\n        Orders.Close();"),
      scenario("order-post", ["Clerk"], "Orders.OpenEdit();\n        Orders.Post.Invoke();"),
      scenario("order-count", ["Clerk"], "Orders.OpenEdit();\n        Orders.Count.Invoke();"),
      scenario("order-lines", ["Clerk"], "Orders.OpenEdit();\n        Orders.Lines.New();\n        Orders.Lines.\"No.\".SetValue('1');\n        Orders.ShowLines.Invoke();")
    )
  });
  const report = await simulate(directory, { tests: path.join(directory, "test") });
  const needs = (id, step) => report.tasks.find((task) => task.id === id).steps[step].needs.map(({ letter, object, because }) => `${letter} ${object} | ${because}`);

  // Insert(true) on the page runs OnInsert, which calls a codeunit; temporary records need nothing.
  assert.deepEqual(needs("order-create", 0), [
    "X page 50000 Orders | the user opens the page",
    "R table 50000 Orders | page 50000 Orders shows its records",
    "I table 50000 Orders | a record is created on page 50000 Orders",
    "X codeunit 50000 Numbering | called by table 50000 Orders (OnInsert)"
  ]);
  // Entering a value validates the field: the table field's OnValidate writes the audit table.
  assert.deepEqual(needs("order-create", 1), [
    "M table 50000 Orders | a record is changed on page 50000 Orders",
    "I table 50001 Audit | table 50000 Orders (OnValidate) runs Insert"
  ]);
  assert.deepEqual(needs("order-post", 1), [
    "X codeunit 50001 Posting | run by page 50000 Orders (action Post)",
    "D table 50002 Lines | codeunit 50001 Posting (OnRun) runs DeleteAll"
  ]);
  assert.deepEqual(needs("order-lines", 1), ["I table 50002 Lines | a record is created on page 50001 Order Lines"]);
  assert.deepEqual(needs("order-lines", 2), ["M table 50002 Lines | a record is changed on page 50001 Order Lines"]);
  assert.deepEqual(needs("order-lines", 3), [
    "X page 50001 Order Lines | run by the action ShowLines",
    "R table 50002 Lines | page 50001 Order Lines shows its records"
  ]);

  const [clerk] = report.agents;
  const outcome = Object.fromEntries(clerk.attempts.map((attempt) => [attempt.task, attempt]));
  // Indirect insert (i) without code that has the permission itself is not enough.
  assert.equal(outcome["order-create"].outcome, "blocked");
  assert.deepEqual(outcome["order-create"].missing.map(({ step, object, right, reason }) => [step, object, right, reason]),
    [[2, "table 50001 Audit", "insert", "indirect-only"]]);
  assert.match(outcome["order-create"].missing[0].why, /Clerk grants it only indirectly/u);
  assert.deepEqual(outcome["order-post"].missing.map(({ object, right }) => `${right} ${object}`), ["execute codeunit 50001 Posting", "delete table 50002 Lines"]);
  // InherentPermissions grant the read to everyone; Execute on the codeunit is still missing.
  assert.deepEqual(outcome["order-count"].missing.map(({ object, right }) => `${right} ${object}`), ["execute codeunit 50002 Reader"]);
  assert.deepEqual(outcome["order-lines"].missingPermissions, ['tabledata "Lines" = RIM', 'page "Order Lines" = X']);
});

test("the trace follows the record of the object, objects run through variables, and the events of pages and fields", async (t) => {
  const directory = app(t, {
    "Orders.al": `
      table 50000 Orders
      {
          fields { field(1; "No."; Code[20]) { } field(2; Amount; Decimal) { } field(3; Status; Integer) { } }
          procedure Release()
          begin
              Modify(true);
          end;
      }
      table 50001 Audit { fields { field(1; "No."; Code[20]) { } } }
      table 50002 Lines { fields { field(1; "No."; Code[20]) { } } }
      table 50003 Log { fields { field(1; "No."; Code[20]) { } } }
      table 50004 Open { InherentPermissions = RIMD; fields { field(1; "No."; Code[20]) { } } }
      codeunit 50000 Posting
      {
          TableNo = Orders;
          trigger OnRun()
          begin
              Rec.Delete();
          end;
      }
      codeunit 50001 Helper
      {
          procedure Write()
          var
              Log: Record Log;
          begin
              Log.Insert();
          end;
      }
      codeunit 50002 Plain
      {
          procedure Step()
          var
              Helper: Codeunit Helper;
          begin
              Helper.Write();
          end;
      }
      codeunit 50003 Wrapper
      {
          Permissions = tabledata Log = i;
          procedure Do()
          var
              Helper: Codeunit Helper;
          begin
              Helper.Write();
          end;
      }
      codeunit 50004 "Status Watcher"
      {
          [EventSubscriber(ObjectType::Table, Database::Orders, 'OnAfterValidateEvent', 'Status', false, false)]
          local procedure OnStatus()
          var
              Audit: Record Audit;
          begin
              Audit.Insert();
          end;

          [EventSubscriber(ObjectType::Page, Page::Orders, 'OnOpenPageEvent', '', false, false)]
          local procedure OnOpen()
          var
              Lines: Record Lines;
          begin
              Lines.FindFirst();
          end;

          [EventSubscriber(ObjectType::Page, Page::Orders, 'OnAfterActionEvent', 'Wrapped', false, false)]
          local procedure OnWrapped()
          var
              Lines: Record Lines;
          begin
              Lines.DeleteAll();
          end;
      }
      codeunit 50005 Reader
      {
          [InherentPermissions(PermissionObjectType::TableData, Database::Audit, 'r')]
          [InherentPermissions(PermissionObjectType::TableData, Database::Lines, 'r')]
          procedure Count()
          var
              Audit: Record Audit;
              Lines: Record Lines;
              Open: Record Open;
          begin
              Audit.FindFirst();
              Lines.FindFirst();
              Open.Insert();
          end;
      }
      page 50000 Orders
      {
          SourceTable = Orders;
          layout { area(Content) { field("No."; "No.") { } field(Amount; Rec.Amount) { } } }
          actions
          {
              area(Processing)
              {
                  action(Release) { trigger OnAction() begin Rec.Release(); end; }
                  action(Post)
                  {
                      trigger OnAction()
                      var
                          Posting: Codeunit Posting;
                      begin
                          Posting.Run(Rec);
                      end;
                  }
                  action(Wrapped)
                  {
                      trigger OnAction()
                      var
                          Wrapper: Codeunit Wrapper;
                      begin
                          Wrapper.Do();
                      end;
                  }
                  action(Both)
                  {
                      trigger OnAction()
                      var
                          Plain: Codeunit Plain;
                          Wrapper: Codeunit Wrapper;
                      begin
                          Wrapper.Do();
                          Plain.Step();
                      end;
                  }
                  action(Count)
                  {
                      trigger OnAction()
                      var
                          Reader: Codeunit Reader;
                      begin
                          Reader.Count();
                      end;
                  }
              }
          }
      }
      pageextension 50001 "Orders Ext" extends Orders
      {
          actions { addlast(Processing) { action(Remove) { trigger OnAction() begin Rec.Delete(true); end; } } }
      }
      permissionset 50000 Clerk { Permissions = tabledata Orders = RIMD, tabledata Lines = RIMD, tabledata Log = i, page Orders = X, codeunit * = X; }
    `,
    "test/OrderTests.al": tests(
      scenario("a-edit", ["Clerk"], "Orders.OpenEdit();\n        Orders.Amount.SetValue(1);\n        Orders.\"No.\".SetValue('A');"),
      scenario("b-release", ["Clerk"], "Orders.OpenEdit();\n        Orders.Release.Invoke();\n        Orders.Post.Invoke();\n        Orders.Remove.Invoke();"),
      scenario("c-wrapped", ["Clerk"], "Orders.OpenEdit();\n        Orders.Wrapped.Invoke();"),
      scenario("d-both", ["Clerk"], "Orders.OpenEdit();\n        Orders.Both.Invoke();"),
      scenario("e-count", ["Clerk"], "Orders.OpenEdit();\n        Orders.Count.Invoke();")
    )
  });
  const report = await simulate(directory, { tests: path.join(directory, "test") });
  const needs = (id, step) => report.tasks.find((task) => task.id === id).steps[step].needs.map(({ letter, object }) => `${letter} ${object}`);
  const outcome = Object.fromEntries(report.agents[0].attempts.map((attempt) => [attempt.task, attempt]));

  // Opening the page raises OnOpenPageEvent; its subscriber reads the lines.
  assert.deepEqual(needs("a-edit", 0), ["X page 50000 Orders", "R table 50000 Orders", "X codeunit 50004 Status Watcher", "R table 50002 Lines"]);
  // The subscriber to the validation of Status does not run for Amount; a bare field name is a field of the record.
  assert.deepEqual(needs("a-edit", 1), ["M table 50000 Orders"]);
  assert.deepEqual(needs("a-edit", 2), ["M table 50000 Orders"]);
  // A bare Modify in a table, Rec in a codeunit with TableNo that a variable runs, Rec in a page extension.
  assert.deepEqual(needs("b-release", 1), ["M table 50000 Orders"]);
  assert.deepEqual(needs("b-release", 2), ["X codeunit 50000 Posting", "D table 50000 Orders"]);
  assert.deepEqual(needs("b-release", 3), ["D table 50000 Orders"]);
  // OnAfterActionEvent of this action, and no other.
  assert.deepEqual(needs("c-wrapped", 1), ["X codeunit 50004 Status Watcher", "D table 50002 Lines", "X codeunit 50003 Wrapper", "X codeunit 50001 Helper", "I table 50003 Log"]);
  assert.ok(!needs("d-both", 1).includes("D table 50002 Lines"));

  // The indirect insert holds through the wrapper, which has the permission itself, and not on the plain path.
  assert.equal(outcome["c-wrapped"].outcome, "completed");
  assert.equal(outcome["d-both"].outcome, "blocked");
  assert.deepEqual(outcome["d-both"].missing.map(({ object, right, reason }) => [object, right, reason]), [["table 50003 Log", "insert", "indirect-only"]]);
  // Both InherentPermissions attributes of the procedure count, and the table's own.
  assert.equal(outcome["e-count"].outcome, "completed");
  assert.deepEqual(needs("e-count", 1), ["X codeunit 50005 Reader", "R table 50001 Audit", "R table 50002 Lines", "I table 50004 Open"]);
  assert.equal(outcome["a-edit"].outcome, "completed");
  assert.equal(outcome["b-release"].outcome, "completed");
});

test("an excluded permission set reduces only the set that excludes it", async (t) => {
  const directory = app(t, {
    "Objects.al": `
      table 50000 Orders { fields { field(1; "No."; Code[20]) { } } }
      table 50001 Deep { fields { field(1; "No."; Code[20]) { } } }
      table 50002 Lines { fields { field(1; "No."; Code[20]) { } } }
      permissionset 50000 DeepSet { Permissions = tabledata Deep = R; }
      permissionset 50001 Base { IncludedPermissionSets = DeepSet; Permissions = tabledata Orders = R; }
      permissionset 50002 Editing { IncludedPermissionSets = Base; Permissions = tabledata Orders = M, tabledata Lines = R; }
      permissionset 50003 Restricted { IncludedPermissionSets = Editing; ExcludedPermissionSets = Base; }
    `
  });
  const { model } = await createArchitectureModel(directory, { view: "project" });
  const access = createAccessIndex(model);
  const table = (name) => model.objects.find((candidate) => candidate.name === name && candidate.type === "table");
  const restricted = access.effective(["Restricted"]);
  assert.equal(restricted.check(table("Orders"), "read").granted, false);
  assert.equal(restricted.check(table("Deep"), "read").granted, false, "what the excluded set includes goes with it");
  assert.equal(restricted.check(table("Orders"), "modify").granted, "direct");
  assert.deepEqual(restricted.sets.map(({ name }) => name), ["Restricted", "Editing"]);
  assert.deepEqual([...restricted.grants.get(table("Orders").key).keys()], ["modify"]);
  // Assigned directly next to it, the excluded set grants what it grants.
  const both = access.effective(["Restricted", "Base"]);
  assert.deepEqual(both.check(table("Orders"), "read"), { granted: "direct", by: ["Base"] });
  assert.equal(both.check(table("Deep"), "read").granted, "direct");
});

test("alternatives reach a step, pages opened before [WHEN] count, and a forbidden task must be proven denied", async (t) => {
  const directory = app(t, {
    "Orders.al": `${ORDERS}
      permissionset 50000 Clerk { Permissions = tabledata Orders = RIM, tabledata Audit = RI, page Orders = X, codeunit Numbering = X; }
    `,
    "test/OrderTests.al": tests(
      scenario("order-create", ["Clerk"], "Orders.OpenNew();"),
      scenario("order-post", ["Clerk"], "Orders.OpenEdit();\n        Orders.Post.Invoke();", "// [REQUIRES] order-create\n        // [ALTERNATIVE] order-skip"),
      scenario("order-skip", ["Clerk"], "Orders.OpenEdit();\n        Orders.Close();"),
      scenario("order-close", ["Clerk"], "Orders.OpenEdit();", "// [REQUIRES] order-post"),
      `
    [Test]
    procedure order_given()
    var
        Orders: TestPage Orders;
        VendorCard: TestPage "Vendor Card";
    begin
        // [DOC-ID] order-given
        // [FEATURE] vendors
        // [SCENARIO] Scenario order-given.
        // [PERMISSIONS] Clerk
        // [GIVEN] The order page is open.
        Orders.OpenEdit();
        // [WHEN] The user counts and looks at the vendor.
        Orders.Count.Invoke();
        VendorCard.OpenView();
        // [THEN] It worked.
    end;`
    )
  }, {
    simulation: {
      tests: "test",
      fullAccess: "SUPER",
      roles: [
        { name: "Clerk", permissionSets: "Clerk", features: ["orders"] },
        { name: "Boss", permissionSets: ["SUPER"], mustNot: ["order-given", "order-post"] }
      ]
    }
  });
  const report = await simulate(directory);
  const [orders] = report.processes;
  // Posting is blocked, but its alternative works: closing does not wait, and the process runs.
  assert.deepEqual(orders.steps.map(({ task, status }) => [task, status]),
    [["order-create", "done"], ["order-post", "blocked"], ["order-close", "done"], ["order-skip", "done"]]);
  assert.equal(orders.status, "runs");
  assert.equal(report.fitGap.requirements.find(({ title }) => title === "Orders").status, "fit");

  // The page the [WHEN] steps work on is opened first, although the test opens it under [GIVEN].
  const given = report.tasks.find(({ id }) => id === "order-given");
  assert.deepEqual(given.steps.map(({ kind, page }) => [kind, page]), [["open", "Orders"], ["invoke", "Orders"], ["open", "Vendor Card"]]);
  assert.deepEqual(given.steps[0].needs.map(({ letter, object }) => `${letter} ${object}`), ["X page 50000 Orders", "R table 50000 Orders"]);

  // SUPER can post: that is possible. What cannot be verified is not counted as denied.
  const boss = report.agents.find(({ name }) => name === "Boss");
  assert.deepEqual(boss.attempts.map(({ task, expected, outcome }) => [task, expected, outcome]),
    [["order-given", "deny", "unverified"], ["order-post", "deny", "completed"]]);
  assert.deepEqual(report.summary.forbidden, { total: 2, denied: 0, possible: 1, unverified: 1 });
  assert.deepEqual(report.matrix.rows.find(({ agent }) => agent === "Boss").cells.filter((cell) => cell.startsWith("forbidden")), ["forbidden-possible", "forbidden-unverified"]);
  assert.ok(report.findings.some(({ code, agent, severity }) => code === "task-unverified" && agent === "Boss" && severity === "info"));
  assert.match(formatSimulationText(report), /1 not verifiable/u);

  // Names that would break a table are escaped.
  const company = path.join(directory, "company.json");
  writeFileSync(company, JSON.stringify({ roles: [{ name: "R|1", permissionSets: ["Clerk"], features: ["orders"] }], agents: [{ name: "Al|ce", roles: ["R|1"] }] }));
  assert.match(formatSimulationMarkdown(await simulate(directory, { company })), /\| Process test \| Al\\\|ce \(R\\\|1\) \|\n\| --- \| --- \|/u);
});

test("the company comes from .bca.json or a file; mistakes in it are findings", async (t) => {
  const directory = app(t, {
    "Orders.al": `${ORDERS}
      permissionset 50000 Clerk { Permissions = tabledata Orders = RIM, tabledata Audit = RI, page Orders = X, codeunit Numbering = X; }
    `,
    "test/OrderTests.al": tests(
      scenario("order-create", [], "Orders.OpenNew();\n        Orders.Amount.SetValue(10);"),
      scenario("order-post", [], "Orders.OpenEdit();\n        Orders.Post.Invoke();")
    )
  }, {
    simulation: {
      tests: "test",
      roles: [{ name: "Clerk", permissionSets: ["Clerk", "D365 BASIC"], tasks: ["order-create", "order-archive"], taskGroups: ["Month end"], mustNot: ["order-post"] }],
      agents: [{ name: "Kim", roles: ["Clerk", "Auditor"] }, { name: "Lee", roles: ["Clerk"], permissionSets: ["SUPER"], tasks: ["order-post"] }]
    }
  });
  const report = await simulate(directory);
  assert.deepEqual(report.findings.map(({ severity, code }) => `${severity} ${code}`), [
    "error unknown-task",
    "error unknown-task-group",
    "error unknown-role",
    "warning assigned-and-forbidden",
    "warning unknown-permission-set"
  ]);
  assert.match(report.findings[0].message, /role "Clerk" names "order-archive"/u);
  assert.match(report.findings[4].message, /Permission set "D365 BASIC" \(Kim, Lee\)/u);
  const [kim, lee] = report.agents;
  assert.deepEqual(kim.attempts.map(({ task, expected, outcome }) => [task, expected, outcome]), [["order-create", "complete", "completed"], ["order-post", "deny", "denied"]]);
  assert.deepEqual(kim.permissionSets.map(({ name, unknown }) => [name, unknown]), [["Clerk", undefined], ["D365 BASIC", true]]);
  // Lee is assigned what the role forbids: the assignment wins, and SUPER lets it through.
  assert.deepEqual(lee.attempts.map(({ task, expected, outcome }) => [task, expected, outcome]), [["order-create", "complete", "completed"], ["order-post", "complete", "completed"]]);
  assert.equal(report.processes[0].status, "runs");

  // A company file replaces the roles of .bca.json; a derived company has nobody for tests without [PERMISSIONS].
  const company = path.join(directory, "company.json");
  writeFileSync(company, JSON.stringify({ simulation: { roles: [], agents: [], requirements: [{ id: "R1", title: "Orders are archived", objects: ["page:Order Archive"] }] } }));
  const derived = await simulate(directory, { company, failOn: "warning" });
  assert.equal(derived.company.derived, true);
  assert.deepEqual(derived.findings.map(({ code }) => code), ["no-permissions-named", "no-permissions-named", "requirement-gap"]);
  assert.equal(derived.passed, false);
  assert.equal(derived.fitGap.requirements[0].status, "gap");
  assert.deepEqual(derived.fitGap.notRequired.map(({ task }) => task), ["order-create", "order-post"]);
  assert.equal((await simulate(directory, { company, failOn: "never" })).passed, true);

  await assert.rejects(simulate(directory, { tests: path.join(directory, "missing") }), /ENOENT|not found/u);
  mkdirSync(path.join(directory, "empty"));
  await assert.rejects(simulate(directory, { tests: path.join(directory, "empty") }), /no process tests found/u);
  writeFileSync(company, JSON.stringify({ roles: [{ name: "A" }, { name: "a" }] }));
  await assert.rejects(simulate(directory, { company }), /roles lists "a" twice/u);
  await assert.rejects(simulate(directory, { failOn: "sometimes" }), /fail-on must be one of/u);
});

test("rights on objects of other apps are assumed, or checked on request", async (t) => {
  const source = {
    "Customers.al": `
      codeunit 50000 "Customer Blocker"
      {
          procedure Block(var Customer: Record Customer)
          begin
              Customer.Modify(true);
          end;
      }
      pageextension 50000 "Customer Card Ext" extends "Customer Card"
      {
          actions
          {
              addlast(Processing)
              {
                  action(Block)
                  {
                      trigger OnAction()
                      var
                          CustomerBlocker: Codeunit "Customer Blocker";
                      begin
                          CustomerBlocker.Block(Rec);
                      end;
                  }
              }
          }
      }
      permissionset 50000 Blocking { Permissions = codeunit "Customer Blocker" = X; }
    `,
    "test/CustomerTests.al": `codeunit 50990 "Customer UI Tests"
      {
          Subtype = Test;
          [Test]
          procedure BlockCustomer()
          var
              CustomerCard: TestPage "Customer Card";
              Missing: TestPage "Vendor Card";
          begin
              // [DOC-ID] customer-block
              // [FEATURE] customers
              // [SCENARIO] Block a customer.
              // [PERMISSIONS] Blocking
              // [PERMISSIONS] D365 BASIC
              // [WHEN] The user blocks the customer.
              CustomerCard.OpenEdit();
              CustomerCard.Block.Invoke();
              // [THEN] The customer is blocked.
          end;
      }`
  };
  const directory = app(t, source, { simulation: { tests: "test" } });
  mkdirSync(path.join(directory, ".alpackages"));
  writeFileSync(path.join(directory, ".alpackages", "Microsoft_Base Application_27.0.0.0.app"), zipSync({
    "SymbolReference.json": strToU8(JSON.stringify({
      AppId: "437dbf0e-84ff-417a-965d-ed2bb9650972",
      Name: "Base Application",
      Publisher: "Microsoft",
      Version: "27.0.0.0",
      Tables: [{ Id: 18, Name: "Customer" }],
      Pages: [{ Id: 21, Name: "Customer Card", Properties: [{ Name: "SourceTable", Value: "18" }] }],
      PermissionSets: [{ Id: 21, Name: "D365 BASIC" }]
    }))
  }));

  // By default the base app's rights come with the base app's permission sets.
  const assumed = await simulate(directory);
  assert.equal(assumed.passed, true);
  assert.deepEqual(assumed.findings, []);
  const [agent] = assumed.agents;
  assert.equal(agent.attempts[0].outcome, "completed");
  assert.deepEqual(agent.permissionSets.map(({ name, inSource }) => [name, inSource]), [["Blocking", undefined], ["D365 BASIC", false]]);
  assert.deepEqual(agent.assumedPermissions, ['page "Customer Card" = X', 'tabledata "Customer" = RM']);
  const steps = assumed.tasks[0].steps;
  assert.deepEqual(steps[1].needs.map(({ letter, object, external }) => [letter, object, external]), [
    ["X", "codeunit 50000 Customer Blocker", undefined],
    ["M", "table 18 Customer", true]
  ], "an action of a page extension is traced on the page it extends");
  assert.match(formatSimulationMarkdown(assumed), /\*\*Assumed from the permission sets of other apps:\*\* `page "Customer Card" = X`, `tabledata "Customer" = RM`/u);

  // Checked: D365 BASIC may grant them, its content is not in the source, so nothing can be decided.
  writeFileSync(path.join(directory, ".bca.json"), JSON.stringify({ simulation: { tests: "test", otherApps: "check" } }));
  const checked = await simulate(directory);
  assert.equal(checked.agents[0].attempts[0].outcome, "unverified");
  assert.deepEqual(checked.agents[0].attempts[0].unverified.map(({ step, object, right }) => `${step} ${right} ${object}`),
    ["1 execute page 21 Customer Card", "1 read table 18 Customer", "2 modify table 18 Customer"]);
  assert.deepEqual(checked.findings.map(({ severity, code }) => `${severity} ${code}`), ["info task-unverified"]);
  assert.equal(checked.passed, true);
  assert.equal(checked.processes[0].status, "unverified");
  assert.equal(checked.fitGap.requirements[0].status, "fit-unverified");

  // Checked with nothing but the app's own set: the base app's rights are missing.
  const company = path.join(directory, "company.json");
  writeFileSync(company, JSON.stringify({ roles: [{ name: "Clerk", permissionSets: ["Blocking"], features: ["customers"] }] }));
  const strict = await simulate(directory, { company });
  assert.equal(strict.agents[0].attempts[0].outcome, "blocked");
  assert.deepEqual(strict.agents[0].attempts[0].missingPermissions, ['page "Customer Card" = X', 'tabledata "Customer" = RM']);
  writeFileSync(company, JSON.stringify({ otherApps: "sometimes" }));
  await assert.rejects(simulate(directory, { company }), /otherApps must be "assume" or "check"/u);
});

test("a page that is not part of the analyzed source leaves the task undecided", async (t) => {
  const directory = app(t, {
    "Objects.al": "permissionset 50000 Clerk { Assignable = true; }",
    "test/VendorTests.al": `codeunit 50990 "Vendor UI Tests"
      {
          Subtype = Test;
          [Test]
          procedure OpenVendor()
          var
              VendorCard: TestPage "Vendor Card";
          begin
              // [DOC-ID] vendor-open
              // [SCENARIO] Open a vendor.
              // [PERMISSIONS] Clerk
              // [WHEN] The user opens the vendor.
              VendorCard.OpenView();
              // [THEN] The vendor is shown.
          end;
      }`
  });
  const report = await simulate(directory, { tests: path.join(directory, "test") });
  assert.equal(report.agents[0].attempts[0].outcome, "unverified");
  assert.deepEqual(report.tasks[0].steps[0].notes, ['Page "Vendor Card" is not part of the analyzed app.']);
  assert.deepEqual(report.findings.map(({ code }) => code), ["task-unverified"]);
  assert.equal(report.matrix.rows[0].cells[0], "unverified");
});

test("the report is documentation: Markdown and text, in English or German", async () => {
  const report = await simulate(purchasing);
  const markdown = formatSimulationMarkdown(report, { marker: true });
  assert.match(markdown, /^<!-- Generated by BC Atlas \(battle test\)/u);
  assert.match(markdown, /\*\*Result: FAILED\*\* \(2 error\(s\), 2 warning\(s\), 0 info\)/u);
  for (const heading of ["Summary", "Who can do what", "Findings", "Fit-gap analysis", "Processes", "Roles and agents", "Process tests and what they need", "How the battle test decides"]) {
    assert.match(markdown, new RegExp(`^## ${heading}$`, "mu"));
  }
  assert.match(markdown, /\| \[Approve a released purchase request\]\(#purchase-request-approve\) \| 🚫 \| ❌ \| 🚫 \| ⚠️ \|/u);
  assert.match(markdown, /\| \*\*REQ-2\*\* A team lead approves every request \| Gap: permissions \|/u);
  assert.match(markdown, /### Purchase requests: blocked/u);
  assert.match(markdown, /### <a id="purchase-request-approve"><\/a>Approve a released purchase request/u);
  assert.match(markdown, /\|  \|  \| Execute on codeunit 50222 Request Notifications \| it subscribes to OnAfterApproveRequest of codeunit 50220 Purchase Request Mgt\. \(NotifyRequester\) \|/u);

  const text = formatSimulationText(report);
  assert.match(text, /^Battle test: Contoso GmbH uses BC Atlas Purchasing Example$/mu);
  assert.match(text, /^ {2}purchase-request-approve {2}denied {3}BLOCKED {2}denied {3}CAN$/mu);
  assert.match(text, /^FAILED - 6 completed, 1 blocked; 4 denied as expected, 1 possible; 2 error\(s\), 2 warning\(s\), 0 info \(fail on: error\)$/mu);

  const german = await simulate(purchasing, { language: "de" });
  assert.equal(german.title, "Battle-Test: Contoso GmbH nutzt BC Atlas Purchasing Example");
  assert.match(german.findings[0].message, /^Ben \(Team lead\) kann "Approve a released purchase request" nicht erledigen: Schritt 3 \(.+\) braucht Ausführen auf Codeunit 50222 Request Notifications\.$/u);
  const deutsch = formatSimulationMarkdown(german);
  assert.match(deutsch, /\*\*Ergebnis: NICHT BESTANDEN\*\*/u);
  assert.match(deutsch, /^## Fit-Gap-Analyse$/mu);
  assert.match(deutsch, /Gap: Berechtigungen/u);
});

test("bca simulate gates CI, writes the report, and runs as a bca run task", (t) => {
  const run = (...args) => spawnSync(process.execPath, [cli, ...args], { encoding: "utf8" });
  const failed = run("simulate", purchasing);
  assert.equal(failed.status, 1, failed.stderr);
  assert.match(failed.stdout, /ERROR {3}Ben \(Team lead\) cannot complete/u);
  assert.equal(failed.stderr, "", "a failed battle test is a result, not an error message");

  const json = run("simulate", purchasing, "--format", "json", "--fail-on", "never");
  assert.equal(json.status, 0, json.stderr);
  assert.equal(JSON.parse(json.stdout).passed, true);

  const passed = run("simulate", warehouse);
  assert.equal(passed.status, 0, passed.stderr);
  assert.match(passed.stdout, /^PASSED - 2 completed, 0 blocked; 0 error\(s\), 0 warning\(s\), 0 info \(fail on: error\)$/mu);

  const directory = mkdtempSync(path.join(os.tmpdir(), "bca-simulate-run-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const output = path.join(directory, "out", "battle.md");
  const written = run("simulate", warehouse, "-o", output, "--language", "de");
  assert.equal(written.status, 0, written.stderr);
  assert.match(written.stderr, /BESTANDEN - 2 erledigt, 0 blockiert/u);
  assert.match(readFileSync(output, "utf8"), /^<!-- Generated by BC Atlas \(battle test\)[^\n]*\n\n# Battle-Test: BC Atlas Warehouse Example/u);

  assert.equal(run("simulate", warehouse, "--fail-on", "sometimes").status, 2);
  const help = run("simulate", "--help");
  assert.match(help.stdout, /^bca simulate - Battle-test the app as your company uses it/u);

  cpSync(purchasing, path.join(directory, "app"), { recursive: true });
  const task = spawnSync(process.execPath, [cli, "run", "--tasks", "simulate"], { cwd: path.join(directory, "app"), encoding: "utf8" });
  assert.equal(task.status, 1, task.stderr);
  assert.match(task.stdout, /simulate: FAILED - 6 completed, 1 blocked/u);
  assert.match(task.stdout, /BC Atlas manual: FAILED \(simulate\)/u);
  assert.ok(existsSync(path.join(directory, "app", "docs", "simulation", "README.md")), "the report is written even when the battle test fails");
});

test("the app's Docs page has the battle test when the project has process tests", async () => {
  const { Workspace } = await import("../src/app/workspace.js");
  const { createService } = await import("../src/app/service.js");
  const service = createService(new Workspace(purchasing, {}, { live: false }));
  const handbook = await service.call("handbook");
  const page = handbook.pages.at(-1);
  assert.equal(page.id, "battle-test");
  assert.equal(page.title, "Battle test");
  assert.match(page.markdown, /\*\*Result: FAILED\*\*/u);
  assert.match(page.markdown, /\[Approve a released purchase request\]\(#\/docs\?guide=1&id=purchase-request-approve\)/u, "process tests link to their guides");
  assert.doesNotMatch(page.markdown, /<br>|<a id=/u, "the app renders Markdown, not HTML");
  assert.equal((await service.call("battleTest")).summary.assigned.blocked, 1);
  assert.equal((await service.call("handbook", { language: "de" })).pages.at(-1).title, "Battle-Test");

  // Without process tests there is no such page.
  const plain = createService(new Workspace(path.join(root, "examples", "monolith"), {}, { live: false }));
  assert.ok(!(await plain.call("handbook")).pages.some(({ id }) => id === "battle-test"));
  await assert.rejects(plain.call("battleTest"), /no process tests found/u);
});
