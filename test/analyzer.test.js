import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { zipSync, strToU8 } from "fflate";
import { analyze, testing } from "../src/analyzer.js";
import { createArchitectureModel } from "../src/architecture.js";
import { renderD2 } from "../src/d2.js";
import { resolveModel } from "../src/resolver.js";
import { createView, filterModel } from "../src/views.js";
import { addInsights } from "../src/insights.js";

test("extracts AL objects and architectural relations", async () => {
  const source = `
    namespace Demo;
    table 50100 Buffer { }
    codeunit 50101 Poster {
      var BufferRecord: Record Buffer;
    }
    tableextension 50102 CustomerExt extends Customer { }
  `;
  const result = await testing.objectsFromSource(source, "sample.al");

  assert.equal(result.objects.length, 3);
  assert.deepEqual(
    result.objects.map(({ type, name }) => [type, name]),
    [["table", "Buffer"], ["codeunit", "Poster"], ["tableextension", "CustomerExt"]]
  );
  assert.ok(result.objects[1].relations.some((relation) => relation.target === "Buffer"));
  assert.ok(result.objects[2].relations.some((relation) => relation.kind === "extends"));
});

test("extracts semantic data, permissions, page members, and parent app context", async () => {
  const source = `
    namespace Demo;
    table 50100 Parent { }
    table 50101 Child {
      fields {
        field(1; ParentCode; Code[20]) {
          TableRelation = Parent.Code;
        }
      }
      procedure Store()
      var
        ParentRecord: Record Parent;
      begin
        ParentRecord.FindFirst();
        ParentRecord.Insert();
      end;
    }
    page 50102 ParentCard {
      SourceTable = Parent;
      layout {
        area(Content) {
          field(ParentCode; Rec.SystemId) { }
        }
      }
      actions {
        area(Processing) {
          action(OpenParent) { }
        }
      }
    }
    permissionset 50103 DemoEdit {
      Permissions = tabledata Parent = RIMD;
    }
  `;
  const result = await testing.objectsFromSource(source, "semantic.al");
  const child = result.objects.find(({ name }) => name === "Child");
  const page = result.objects.find(({ name }) => name === "ParentCard");
  const permissions = result.objects.find(({ name }) => name === "DemoEdit");

  assert.ok(child.relations.some(({ kind, target }) => kind === "relates" && target === "Parent"));
  assert.ok(child.relations.some(({ kind, target }) => kind === "reads" && target === "Parent"));
  assert.ok(child.relations.some(({ kind, target }) => kind === "writes" && target === "Parent"));
  assert.ok(!child.relations.some(({ target }) => target === "Parent.Code"));
  assert.ok(page.fields.length > 0);
  assert.ok(page.actions.length > 0);
  assert.ok(
    permissions.relations.some(
      ({ kind, target, access }) => kind === "permits" && target === "Parent" && access === "RIMD"
    )
  );

  const nested = fileURLToPath(new URL("./context-fixture/src/module", import.meta.url));
  const contextModel = await analyze(nested);
  assert.equal(contextModel.apps[0].name, "Parent App");
});

test("extracts every conditional table relation branch with fields and filters", async () => {
  const source = `
    table 50100 Child {
      fields {
        field(1; ParentCode; Code[20]) {
          TableRelation = if (Kind = const(Item)) Item.Number where(Blocked = const(false))
            else if (Kind = const(Customer)) Customer.Number
            else Resource.Number;
        }
      }
    }
  `;
  const result = await testing.objectsFromSource(source, "relations.al");
  const relations = result.objects[0].relations.filter(({ kind }) => kind === "relates");

  assert.deepEqual(
    relations.map(({ target, relatedField, condition }) => ({ target, relatedField, condition })),
    [
      { target: "Item", relatedField: "Number", condition: "Kind = const(Item)" },
      {
        target: "Customer",
        relatedField: "Number",
        condition: "not (Kind = const(Item)) and Kind = const(Customer)"
      },
      {
        target: "Resource",
        relatedField: "Number",
        condition: "not (Kind = const(Item)) and not (Kind = const(Customer))"
      }
    ]
  );
  assert.deepEqual(relations[0].filters, [
    { field: "Blocked", value: "false", expression: "Blocked = const(false)" }
  ]);
});

test("resolves lexical record scope, parameters, implicit records, and temporary access", async () => {
  const source = `
    table 50100 Persisted { }
    table 50101 Buffer { }
    table 50102 Owner {
      var Shared: Record Persisted;

      procedure UseLocal(Shared: Record Buffer temporary)
      begin
        Shared.Modify();
        Rec.Modify();
        xRec.Get();
      end;

      procedure UseGlobal()
      begin
        Shared.Modify();
      end;
    }
  `;
  const result = await testing.objectsFromSource(source, "scope.al");
  const owner = result.objects.find(({ name }) => name === "Owner");
  const accesses = owner.relations.filter(({ kind }) => ["reads", "writes"].includes(kind));

  assert.ok(accesses.some(({ target, kind, temporary }) =>
    target === "Buffer" && kind === "writes" && temporary
  ));
  assert.ok(accesses.some(({ target, kind, temporary }) =>
    target === "Persisted" && kind === "writes" && !temporary
  ));
  assert.ok(accesses.some(({ target, kind }) => target === "Owner" && kind === "writes"));
  assert.ok(accesses.some(({ target, kind }) => target === "Owner" && kind === "reads"));
  assert.equal(owner.procedures.find(({ name }) => name === "UseLocal").signature,
    "UseLocal(Record Buffer temporary)");
});

test("resolves overloads and interface calls by signature", async () => {
  const source = `
    interface WorkerContract {
      procedure Execute(Value: Integer);
    }
    codeunit 50100 Caller {
      procedure Run(Worker: Interface WorkerContract)
      begin
        Execute(1);
        Execute(1, 2);
        Worker.Execute(1);
      end;
      procedure Execute(Value: Integer)
      begin
      end;
      procedure Execute(Left: Integer; Right: Integer)
      begin
      end;
    }
  `;
  const parsed = await testing.objectsFromSource(source, "overloads.al");
  const model = resolveModel({ objects: parsed.objects, apps: [], diagnostics: [] });
  const calls = createView(model, "call", { expandProcedures: true });
  const executeTargets = calls.edges
    .filter(({ kind, to }) => kind === "calls" && to)
    .map(({ to }) => calls.objects.find(({ key }) => key === to)?.signature);

  assert.ok(executeTargets.includes("Execute(Integer)"));
  assert.ok(executeTargets.includes("Execute(Integer, Integer)"));
  assert.equal(calls.edges.filter(({ confidence }) => confidence === "resolved").length, 3);
});

test("extracts data items, formulas, execute permissions, action refs, and conditions", async () => {
  const source = `
    table 50100 Ledger { }
    table 50101 Summary {
      fields {
        field(1; Total; Decimal) { CalcFormula = sum(Ledger.Amount); }
      }
    }
    report 50102 LedgerReport {
      dataset { dataitem(Lines; Ledger) { } }
    }
    query 50103 LedgerQuery {
      elements { dataitem(Lines; Ledger) { column(Amount; Amount) { } } }
    }
    xmlport 50104 LedgerPort {
      schema { tableelement(Lines; Ledger) { } }
    }
    page 50105 SummaryCard {
      actions { area(Processing) { action(SourceAction) { } actionref(Promoted; SourceAction) { } } }
    }
    permissionset 50106 Operators {
      Permissions = tabledata Ledger = R, codeunit 50107 = X, page SummaryCard = X;
    }
    #if FEATURE
    codeunit 50107 Worker {
      var LedgerRecord: Record Ledger;
    }
    #endif
  `;
  const result = await testing.objectsFromSource(source, "declarations.al");
  const summary = result.objects.find(({ name }) => name === "Summary");
  const permissions = result.objects.find(({ name }) => name === "Operators");
  const page = result.objects.find(({ name }) => name === "SummaryCard");
  const worker = result.objects.find(({ name }) => name === "Worker");

  assert.ok(summary.relations.some(({ target, property, relatedField }) =>
    target === "Ledger" && property === "calcformula" && relatedField === "Amount"
  ));
  for (const objectName of ["LedgerReport", "LedgerQuery", "LedgerPort"]) {
    assert.ok(result.objects.find(({ name }) => name === objectName).relations.some(
      ({ target, kind }) => target === "Ledger" && kind === "reads"
    ));
  }
  assert.ok(permissions.relations.some(({ targetType, target, access }) =>
    targetType === "codeunit" && target === "50107" && access === "X"
  ));
  assert.ok(permissions.relations.some(({ targetType, target }) =>
    targetType === "page" && target === "SummaryCard"
  ));
  assert.ok(page.actions.some(({ kind, target }) =>
    kind === "action-ref" && target === "SourceAction"
  ));
  assert.deepEqual(worker.relations.find(({ target }) => target === "Ledger").conditionalSymbols,
    ["FEATURE"]);
});

test("resolves namespace-qualified EventSubscriber publisher arguments", async () => {
  const source = `
    namespace Demo;
    table 50100 "Publisher Table" {
      [IntegrationEvent(false, false)]
      procedure OnChanged()
      begin
      end;
    }
    codeunit 50101 Subscriber {
      [EventSubscriber(ObjectType::Table, Database::Demo."Publisher Table", 'OnChanged', '', false, false)]
      local procedure HandleChanged()
      begin
      end;
    }
  `;
  const parsed = await testing.objectsFromSource(source, "events.al");
  const model = resolveModel({ objects: parsed.objects, apps: [], diagnostics: [] });
  const events = createView(model, "events");

  assert.ok(events.edges.some(({ kind, to }) => kind === "publishes" && to));
});

test("resolves chained calls through procedure return types", async () => {
  const source = `
    codeunit 50100 Service {
      procedure Execute()
      begin
      end;
    }
    codeunit 50101 Factory {
      procedure Create(): Codeunit Service
      begin
      end;
    }
    codeunit 50102 Caller {
      var ServiceFactory: Codeunit Factory;
      procedure Run()
      begin
        ServiceFactory.Create().Execute();
      end;
    }
  `;
  const parsed = await testing.objectsFromSource(source, "chains.al");
  const model = resolveModel({ objects: parsed.objects, apps: [], diagnostics: [] });
  const calls = createView(model, "call", { expandProcedures: true });
  const caller = calls.objects.find(({ name, namespace }) =>
    name === "Run" && namespace.endsWith(".Caller")
  );
  const execute = calls.objects.find(({ name, namespace }) =>
    name === "Execute" && namespace.endsWith(".Service")
  );

  assert.ok(calls.edges.some(({ from, to }) => from === caller.key && to === execute.key));
});

test("propagates helper writes and extracts page views", async () => {
  const source = `
    table 50100 Ledger { }
    codeunit 50101 Writer {
      procedure Run()
      begin
        WriteLedger();
        Run();
      end;
      local procedure WriteLedger()
      var
        LedgerRecord: Record Ledger;
      begin
        LedgerRecord.ModifyAll(Amount, 0);
      end;
    }
    page 50102 LedgerList {
      SourceTable = Ledger;
      views {
        view(OpenEntries) { }
      }
    }
  `;
  const result = await testing.objectsFromSource(source, "helpers.al");
  const writer = result.objects.find(({ name }) => name === "Writer");
  const page = result.objects.find(({ name }) => name === "LedgerList");

  assert.ok(writer.relations.some(({ target, operation, member, via }) =>
    target === "Ledger" && operation === "ModifyAll" && member === "Run()" &&
    via.includes("WriteLedger()")
  ));
  assert.deepEqual(page.views.map(({ name }) => name), ["OpenEntries"]);
});

test("renders namespaced D2 with internal and external dependencies", async () => {
  const model = resolveModel(
    await analyze(fileURLToPath(new URL("./fixtures", import.meta.url)))
  );
  const d2 = renderD2(model, { title: "Test" });

  assert.match(d2, /Demo\.Sales/);
  assert.match(d2, /Sales Buffer/);
  assert.match(d2, /implements/);
  assert.match(d2, /External \/ unresolved/);
  assert.match(d2, /style\.fill: "#[A-F0-9]{6}"/);
  assert.match(d2, /"implements" \{style\.stroke: "#E69F00"\}/u);
  assert.match(d2, /"reads" \{style\.stroke: "#0072B2"\}/u);
  assert.equal(model.apps[0].name, "BC Atlas Fixture");
  assert.ok(model.objects.every((object) => object.location.line > 0));
  assert.ok(model.edges.some((edge) => edge.kind === "reads" && edge.to));
});

test("filters and projects existing views", async () => {
  const model = addInsights(
    resolveModel(await analyze(fileURLToPath(new URL("./fixtures", import.meta.url))))
  );
  const filtered = filterModel(model, { namespaces: ["Demo.*"] });
  assert.equal(filtered.objects.length, model.objects.length);

  const modules = createView(filtered, "module", { moduleDepth: "auto" });
  assert.equal(modules.objects.length, 2);
  assert.ok(modules.edges.some((edge) => edge.weight >= 1));

  const object = createView(filtered, "object", { object: "codeunit:50101" });
  assert.ok(object.objects.some(({ name }) => name === "Sales Poster"));
  assert.ok(object.objects.some(({ name }) => name === "Sales Buffer"));

  const data = createView(filtered, "data");
  assert.ok(data.objects.some(({ type }) => type === "table"));
  assert.ok(data.edges.every((edge) => ["reads", "writes", "uses", "extends"].includes(edge.kind)));

  const calls = createView(filtered, "call");
  assert.ok(calls.objects.some(({ name }) => name === "Sales Poster"));
  assert.equal(calls.callGraph.level, "object");
  assert.ok(calls.edges.some((edge) => edge.kind === "calls" && edge.to));
  assert.ok(calls.edges.filter((edge) => edge.to).length >= 2);
  assert.ok(calls.edges.some((edge) => edge.kind === "subscribes" && edge.to));
  assert.ok(calls.edges.every(({ to }) => to));
  const callsWithUnresolved = createView(filtered, "call", {
    includeUnresolvedCalls: true,
    expandProcedures: true,
    expandFrameworkCalls: true
  });
  assert.ok(callsWithUnresolved.edges.some(({ to }) => !to));
  assert.ok(model.insights.hubs.length > 0);
  assert.equal(
    model.insights.unresolvedEdges,
    model.edges.filter(({ to }) => !to).length
  );
});

test("projects boundary, contracts, events, and UI views", async () => {
  const model = resolveModel(
    await analyze(fileURLToPath(new URL("./fixtures", import.meta.url)))
  );

  const boundary = createView(model, "boundary", {
    scope: ["namespace:Demo.Sales"]
  });
  assert.ok(boundary.objects.some(({ viewGroup }) => viewGroup === "Inside boundary"));
  assert.ok(boundary.objects.some(({ viewGroup }) => viewGroup === "Outside boundary"));
  assert.ok(boundary.edges.every(({ label }) => /inbound|outbound/u.test(label)));

  const contracts = createView(model, "contracts");
  assert.ok(contracts.objects.some(({ type }) => type === "interface"));
  assert.ok(contracts.edges.some(({ kind }) => kind === "implements"));
  assert.ok(
    contracts.edges.some(
      ({ kind, contract, member }) =>
        kind === "selects" && contract === "Posts Sales" && member === "Default"
    )
  );

  const events = createView(model, "events");
  assert.ok(events.objects.some(({ type, name }) => type === "event" && name === "OnPosted"));
  assert.ok(
    events.objects.some(
      ({ type, name }) => type === "subscriber" && name === "HandlePosted"
    )
  );
  assert.ok(events.edges.some(({ kind, to }) => kind === "publishes" && to));

  const ui = createView(model, "ui", { focus: "Sales Buffer Card" });
  assert.ok(ui.objects.some(({ type }) => type === "action"));
  assert.ok(ui.edges.some(({ kind }) => kind === "part"));
  assert.ok(ui.edges.some(({ kind }) => kind === "runs"));
  assert.ok(
    ui.edges.some(
      ({ kind, label }) => kind === "reads" && label === "source table"
    )
  );

  const d2 = renderD2(events, { title: "Events" });
  assert.match(d2, /Publishers/u);
  assert.match(d2, /publishes to/u);

  const emptyEvents = createView(
    { ...model, objects: [], edges: [] },
    "events"
  );
  assert.match(renderD2(emptyEvents), /No event publishers or subscribers found/u);
});

test("projects bounded, configurable workflows with certainty, mutations, and cycles", async () => {
  const source = `
    namespace Demo;
    table 50100 Buffer { }
    codeunit 50101 Flow {
      var
        BufferRecord: Record Buffer;

      procedure Start()
      begin
        Utility();
      end;

      procedure Utility()
      begin
        BufferRecord.Insert();
        Publish();
        LoopA();
        Missing.Run();
      end;

      procedure LoopA()
      begin
        LoopB();
      end;

      procedure LoopB()
      begin
        LoopA();
      end;

      [IntegrationEvent(false, false)]
      procedure Publish()
      begin
      end;

      [EventSubscriber(ObjectType::Codeunit, Codeunit::Flow, 'Publish', '', false, false)]
      local procedure HandlePublish()
      begin
      end;
    }

    page 50102 FlowCard {
      var
        Runner: Codeunit Flow;
      actions {
        area(Processing) {
          action(RunFlow) {
            trigger OnAction()
            begin
              Runner.Start();
            end;
          }
        }
      }
    }
  `;
  const parsed = await testing.objectsFromSource(source, "workflow.al");
  const model = resolveModel({
    schemaVersion: 1,
    files: 1,
    apps: [],
    diagnostics: [],
    ...parsed
  });
  const workflow = createView(model, "workflow", {
    entry: ["Start"],
    depth: 10,
    maxNodes: 20,
    maxEdges: 30,
    edgeTypes: ["calls", "events", "writes"],
    phases: {
      Processing: ["Start", "Utility", "Loop*"],
      Notifications: ["Publish", "HandlePublish"]
    }
  });

  assert.ok(workflow.objects.some(({ name }) => name === "Buffer"));
  assert.ok(workflow.edges.some(({ kind }) => kind === "writes"));
  assert.ok(
    workflow.edges.some(
      ({ kind, sequence }) => kind === "calls" && sequence === "definite"
    )
  );
  assert.ok(
    workflow.edges.some(
      ({ kind, sequence }) => kind === "events" && sequence === "inferred"
    )
  );
  assert.ok(workflow.edges.some(({ unresolved }) => unresolved?.name === "Missing.Run"));
  assert.ok(workflow.edges.some(({ isCycle }) => isCycle));
  assert.ok(workflow.objects.some(({ cycle }) => cycle));
  assert.ok(workflow.objects.some(({ viewGroup }) => viewGroup === "Notifications"));
  assert.deepEqual(workflow.workflow.edgeTypes, ["calls", "events", "writes"]);

  const collapsed = createView(model, "workflow", {
    entry: "Start",
    collapse: ["Utility"],
    maxNodes: 20
  });
  assert.ok(!collapsed.objects.some(({ name }) => name === "Utility"));
  assert.ok(collapsed.workflow.collapsed.length === 1);
  assert.ok(collapsed.edges.some(({ sequence }) => sequence === "inferred"));

  const stopped = createView(model, "workflow", {
    entry: "Start",
    stop: ["Utility"]
  });
  assert.deepEqual(
    stopped.objects.map(({ name }) => name).sort(),
    ["Start", "Utility"]
  );

  const writesOnly = createView(model, "workflow", {
    entry: "Utility",
    edgeTypes: ["writes"]
  });
  assert.ok(writesOnly.edges.length > 0);
  assert.ok(writesOnly.edges.every(({ kind }) => kind === "writes"));

  const actionFlow = createView(model, "workflow", {
    entry: "action:RunFlow",
    depth: 2
  });
  assert.ok(actionFlow.objects.some(({ type, name }) => type === "action" && name === "RunFlow"));
  assert.ok(actionFlow.edges.some(({ kind }) => kind === "starts"));

  const limited = createView(model, "workflow", {
    entry: "Start",
    maxNodes: 2
  });
  assert.equal(limited.objects.length, 2);
  assert.equal(limited.workflow.truncatedByNodes, true);

  const d2 = renderD2(workflow, { title: "Workflow" });
  assert.match(d2, /\[definite\]/u);
  assert.match(d2, /\[inferred\]/u);
  assert.match(d2, /\[cycle\]/u);
});

test("analyzes a multi-app root, resolves packages, and aggregates focus boundaries", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "bc-atlas-workspace-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const appA = path.join(root, "AppA");
  const focus = path.join(appA, "src", "focus");
  const modelFolder = path.join(appA, "src", "model");
  const appB = path.join(root, "AppB", "src");
  const packages = path.join(appA, ".alpackages");
  await Promise.all([focus, modelFolder, appB, packages].map((directory) =>
    fs.mkdir(directory, { recursive: true })
  ));
  await fs.writeFile(path.join(appA, "app.json"), JSON.stringify({
    id: "app-a", name: "App A", publisher: "Example", version: "1.0.0.0",
    dependencies: [
      { id: "app-b", name: "App B", publisher: "Example", version: "1.0.0.0" },
      { id: "ms-base", name: "Base Application", publisher: "Microsoft", version: "1.0.0.0" }
    ]
  }));
  await fs.writeFile(path.join(root, "AppB", "app.json"), JSON.stringify({
    id: "app-b", name: "App B", publisher: "Example", version: "1.0.0.0"
  }));
  await fs.writeFile(path.join(modelFolder, "Shared.al"),
    "namespace Common; table 50100 Shared { }");
  await fs.writeFile(path.join(appB, "Dependencies.al"), `
    namespace Dependency.Model;
    table 50100 Shared { }
    table 50200 "Dependency One" { }
    table 50201 "Dependency Two" { }
  `);
  await fs.writeFile(path.join(focus, "Caller.al"), `
    namespace App.Focus;
    codeunit 50101 Caller {
      var
        SharedRecord: Record Shared;
        DependencyOneRecord: Record "Dependency One";
        DependencyTwoRecord: Record "Dependency Two";
        CustomerRecord: Record Customer;
        MissingRecord: Record Missing;
    }
  `);
  const symbols = {
    AppId: "ms-base",
    Name: "Base Application",
    Publisher: "Microsoft Corporation",
    Version: "1.0.0.0",
    Tables: [{ Id: 18, Name: "Customer", Namespace: "Microsoft.Sales.Customer" }]
  };
  const archive = zipSync({ "SymbolReference.json": strToU8(JSON.stringify(symbols)) });
  const navxHeader = new Uint8Array([0x4e, 0x41, 0x56, 0x58, 0, 0, 0, 0]);
  const appPackage = new Uint8Array(navxHeader.length + archive.length);
  appPackage.set(navxHeader);
  appPackage.set(archive, navxHeader.length);
  await fs.writeFile(path.join(packages, "Microsoft_Base.app"), appPackage);
  await fs.writeFile(path.join(packages, "Broken.app"), "not an app package");

  const full = resolveModel(await analyze(root));
  const sharedObjects = full.objects.filter(({ name }) => name === "Shared");
  assert.equal(sharedObjects.length, 2);
  assert.notEqual(sharedObjects[0].key, sharedObjects[1].key);
  const caller = full.objects.find(({ name }) => name === "Caller");
  const callerEdges = full.edges.filter(({ from }) => from === caller.key);
  const resolvedShared = callerEdges
    .map(({ to }) => full.objects.find(({ key }) => key === to))
    .find(({ name } = {}) => name === "Shared");
  assert.equal(resolvedShared?.app.id, "app-a", JSON.stringify({ caller, callerEdges }));
  assert.ok(full.symbolPackages.some(({ id }) => id === "ms-base"));
  assert.ok(full.diagnostics.some(({ code }) => code === "symbol-package-error"));
  assert.ok(callerEdges.some(({ targetOrigin }) => targetOrigin === "microsoft-base-app"));

  const focused = (await createArchitectureModel(focus, { projectRoot: root })).model;
  assert.ok(focused.objects.some(({ name }) => name === "Caller"));
  assert.ok(!focused.objects.some(({ name }) => name === "Shared"));
  assert.equal(
    focused.objects.find(({ boundaryCategory }) => boundaryCategory === "declared-dependency").members.length,
    2
  );
  assert.ok(focused.objects.some(({ boundaryCategory }) =>
    boundaryCategory === "same-app-outside-focus"
  ));
  assert.ok(focused.objects.some(({ boundaryCategory }) =>
    boundaryCategory === "microsoft-base-app"
  ));
  assert.ok(focused.edges.some(({ targetOrigin, unresolved }) =>
    targetOrigin === "unknown" && unresolved?.name === "Missing"
  ));
});

test("filters, aggregates, expands, and marks focused call subgraphs", async () => {
  const source = `
    codeunit 50100 A {
      var BUnit: Codeunit B; AmbUnit: Codeunit Amb;
      procedure Start()
      begin
        BUnit.Step();
        AmbUnit.Run(1);
        Message('started');
      end;
    }
    codeunit 50101 B {
      var CUnit: Codeunit C;
      procedure Step()
      begin
        CUnit.Finish();
      end;
    }
    codeunit 50102 C {
      var BUnit: Codeunit B;
      procedure Finish()
      begin
        BUnit.Step();
        Recurse();
      end;
      procedure Recurse()
      begin
        Recurse();
      end;
    }
    codeunit 50103 Inbound {
      var AUnit: Codeunit A;
      procedure CallStart()
      begin
        AUnit.Start();
      end;
    }
    codeunit 50104 Amb {
      procedure Run(Value: Integer) begin end;
      procedure Run(Value: Text) begin end;
    }
  `;
  const parsed = await testing.objectsFromSource(source, "calls.al");
  const model = resolveModel({ objects: parsed.objects, apps: [], diagnostics: [] });

  const outgoing = createView(model, "call", {
    rootProcedure: "A.Start",
    callDepth: 1,
    callDirection: "outgoing"
  });
  assert.deepEqual(
    outgoing.objects.filter(({ frameworkCalls }) => !frameworkCalls).map(({ name }) => name).sort(),
    ["A", "B"]
  );
  assert.ok(outgoing.objects.some(({ frameworkCalls }) => frameworkCalls));
  assert.ok(outgoing.edges.some(({ confidence }) => confidence === "ambiguous"));
  assert.deepEqual(outgoing.callGraph.roots, [outgoing.objects.find(({ name }) => name === "A").key]);

  const incoming = createView(model, "call", {
    rootProcedure: "A.Start",
    callDepth: 1,
    callDirection: "incoming"
  });
  assert.deepEqual(incoming.objects.map(({ name }) => name).sort(), ["A", "Inbound"]);

  const expanded = createView(model, "call", {
    rootProcedure: "A.Start",
    callDepth: 4,
    callDirection: "outgoing",
    expandProcedures: true,
    expandFrameworkCalls: true,
    includeUnresolvedCalls: true
  });
  assert.equal(expanded.callGraph.level, "procedure");
  assert.ok(expanded.callGraph.cycles.length >= 2);
  assert.ok(expanded.objects.some(({ name, cycle }) => name === "Recurse" && cycle));
  assert.ok(expanded.edges.some(({ isCycle }) => isCycle));

  const d2 = renderD2(expanded, { title: "Calls" });
  assert.match(d2, /\[ambiguous\]/u);
  assert.match(d2, /style\.stroke: "#B45309"/u);
  assert.match(d2, /style\.stroke: "#6B7280"/u);
  assert.match(d2, /\[cycle\]/u);
});

test("controls object depth, member visibility, roles, legends, and source links", async () => {
  const node = (key) => ({
    key,
    name: key,
    type: "codeunit",
    namespace: "Demo",
    file: `src/${key}.al`,
    location: { line: 1 },
    relations: [],
    procedures: [],
    fields: [],
    actions: []
  });
  const objects = ["Inbound2", "Inbound1", "Center", "Outbound1", "Outbound2"].map(node);
  const edges = [
    ["Inbound2", "Inbound1"],
    ["Inbound1", "Center"],
    ["Center", "Outbound1"],
    ["Outbound1", "Outbound2"]
  ].map(([from, to], index) => ({
    id: `depth${index}`, from, to, kind: "calls", confidence: "resolved"
  }));
  const depthModel = { objects, edges, apps: [], diagnostics: [] };
  assert.deepEqual(
    createView(depthModel, "object", {
      object: "Center", objectInboundDepth: 0, objectOutboundDepth: 2
    }).objects.map(({ name }) => name).sort(),
    ["Center", "Outbound1", "Outbound2"]
  );
  assert.deepEqual(
    createView(depthModel, "object", {
      object: "Center", objectInboundDepth: 2, objectOutboundDepth: 0
    }).objects.map(({ name }) => name).sort(),
    ["Center", "Inbound1", "Inbound2"]
  );

  const parsed = await testing.objectsFromSource(`
    namespace Demo;
    page 50100 Visible {
      layout { area(Content) { field(Name; Rec.SystemId) { } } }
      actions { area(Processing) { action(Run) { } } }
      procedure PublicWork() begin end;
      internal procedure InternalWork() begin end;
      local procedure LocalWork() begin end;
      [IntegrationEvent(false, false)]
      procedure Changed() begin end;
      trigger OnOpenPage() begin end;
    }
  `, "src/Visible.al");
  const visible = parsed.objects[0];
  assert.deepEqual(
    visible.procedures.filter(({ kind }) => kind === "procedure")
      .map(({ name, visibility }) => [name, visibility]),
    [["PublicWork", "public"], ["InternalWork", "internal"], ["LocalWork", "local"]]
  );
  const memberModel = createView(resolveModel({
    objects: parsed.objects, edges: [], apps: [], diagnostics: []
  }), "object", { object: "Visible" });
  const d2 = renderD2(memberModel, {
    groupBy: "role",
    roleMappings: { Domain: ["Demo:page:*"] },
    memberNames: true,
    members: ["procedures"],
    sourceUrlTemplate: "https://example.test/repo/blob/{ref}/{file}#L{line}",
    sourceRef: "abc123",
    sourcePathPrefix: "apps/Main"
  });
  assert.match(d2, /g0: "Domain"/u);
  assert.match(d2, /Procedures: \[public\] PublicWork, \[internal\] InternalWork, \[local\] LocalWork/u);
  assert.doesNotMatch(d2, /Fields:/u);
  assert.doesNotMatch(d2, /Actions:/u);
  assert.match(d2, /https:\/\/example\.test\/repo\/blob\/abc123\/apps\/Main\/src\/Visible\.al#L/u);
  assert.match(d2, /Confidence overlay: resolved = relation style/u);
});

test("preserves data evidence, aggregates access, infers safe cardinality, and finds commits", async () => {
  const parsed = await testing.objectsFromSource(`
    table 50100 Parent {
      fields { field(1; Code; Code[20]) { } }
      keys { key(PK; Code) { Clustered = true; } }
    }
    table 50101 Other {
      fields { field(1; Code; Code[20]) { } field(2; Description; Text[100]) { } }
      keys { key(PK; Code) { Clustered = true; } }
    }
    table 50102 Child {
      fields {
        field(1; ParentCode; Code[20]) { TableRelation = Parent.Code; }
        field(2; OtherDescription; Text[100]) { TableRelation = Other.Description; }
      }
    }
    table 50103 WriteOnly { }
    table 50104 Unused { }
    codeunit 50105 DataUser {
      var
        ParentRecord: Record Parent;
        OtherRecord: Record Other;
        WriteRecord: Record WriteOnly;
      procedure Process()
      begin
        ParentRecord.Get();
        ParentRecord.Insert();
        Commit();
        ParentRecord.Modify();
        OtherRecord.FindFirst();
        WriteRecord.Insert();
      end;
    }
  `, "data-accuracy.al");
  const model = resolveModel({ objects: parsed.objects, apps: [], diagnostics: [] });
  const user = model.objects.find(({ name }) => name === "DataUser");
  const process = user.procedures.find(({ name }) => name === "Process");
  assert.equal(process.transactionSegments, 2);
  assert.equal(process.transactionBoundaries.length, 1);
  assert.equal(user.transactionBoundaries[0].procedure, "Process()");

  const directWrite = model.edges.find(({ operation }) => operation === "Modify");
  assert.equal(directWrite.sourceProcedure, "Process()");
  assert.equal(directWrite.transactionSegment, 2);

  const parentRelation = model.edges.find(({ kind, cardinality, to }) =>
    kind === "relates" && cardinality && model.objects.find(({ key }) => key === to)?.name === "Parent"
  );
  assert.equal(parentRelation.cardinality, "0..* -> 0..1");
  assert.match(parentRelation.cardinalityEvidence, /primary key Code/u);
  assert.equal(model.edges.find(({ kind, to }) =>
    kind === "relates" && model.objects.find(({ key }) => key === to)?.name === "Other"
  ).cardinality, undefined);

  const data = createView(model, "data");
  const parent = data.objects.find(({ name }) => name === "Parent");
  const other = data.objects.find(({ name }) => name === "Other");
  const writeOnly = data.objects.find(({ name }) => name === "WriteOnly");
  const unused = data.objects.find(({ name }) => name === "Unused");
  assert.deepEqual(
    [parent.dataAccess, other.dataAccess, writeOnly.dataAccess, unused.dataAccess],
    ["read-write", "read-only", "write-only", "never-accessed"]
  );
  assert.deepEqual([parent.readCount, parent.writeCount], [1, 2]);
  const parentWrites = data.edges.find(({ kind, to }) => kind === "writes" && to === parent.key);
  assert.equal(parentWrites.weight, 2);
  assert.deepEqual(parentWrites.operations.sort(), ["Insert", "Modify"]);
  assert.deepEqual(parentWrites.sourceProcedures, ["Process()"]);
  assert.deepEqual(parentWrites.occurrences.map(({ transactionSegment }) => transactionSegment), [1, 2]);

  const d2 = renderD2(data, { title: "Data" });
  assert.match(d2, /Operations: Insert, Modify/u);
  assert.match(d2, /Source procedures: Process\(\)/u);
  assert.match(d2, /Cardinality: 0\.\.\* -> 0\.\.1/u);
  assert.match(d2, /Data: schema = dashed; runtime access = solid/u);
  assert.match(d2, /never-accessed; reads 0; writes 0/u);
});

test("models execute, tabledata, composed, internal, and dependent permission sets", async (t) => {
  const parsed = await testing.objectsFromSource(`
    table 50100 Ledger { }
    report 50101 ReportTarget { Permissions = tabledata Ledger = R; dataset { } }
    page 50102 PageTarget { Permissions = tabledata Ledger = RI; layout { } }
    codeunit 50103 CodeunitTarget { Permissions = tabledata Ledger = RIMD; }
    query 50104 QueryTarget { Permissions = tabledata Ledger = R; elements { } }
    xmlport 50105 XmlportTarget { Permissions = tabledata Ledger = R; schema { } }
    permissionset 50110 InternalSet {
      Access = Internal;
      Assignable = false;
      Permissions = tabledata Ledger = R;
    }
    permissionset 50111 UserSet {
      Assignable = true;
      IncludedPermissionSets = InternalSet;
      Permissions = report ReportTarget = X, page PageTarget = X,
        codeunit CodeunitTarget = X, query QueryTarget = X, xmlport XmlportTarget = X;
    }
  `, "permissions.al");
  const model = resolveModel({ objects: parsed.objects, apps: [], diagnostics: [] });
  for (const type of ["report", "page", "codeunit", "query", "xmlport"]) {
    const object = model.objects.find(({ type: objectType }) => objectType === type);
    assert.ok(object.relations.some(({ permissionKind, tableDataRights }) =>
      permissionKind === "tabledata" && tableDataRights.includes("read")
    ), type);
  }
  const userSet = model.objects.find(({ name }) => name === "UserSet");
  const internalSet = model.objects.find(({ name }) => name === "InternalSet");
  const grants = model.edges.filter(({ from, permissionKind }) =>
    from === userSet.key && permissionKind === "execute"
  );
  assert.deepEqual(grants.map(({ execute }) => execute), [true, true, true, true, true]);
  assert.ok(grants.every(({ tableDataRights }) => tableDataRights === undefined));
  assert.deepEqual(userSet.permissionSetRoles, ["assignable"]);
  assert.deepEqual(internalSet.permissionSetRoles, ["internal", "included"]);
  assert.equal(internalSet.objectAccess, "internal");
  assert.deepEqual(internalSet.includedBy, [userSet.key]);
  const d2 = renderD2(model, { title: "Permissions" });
  assert.match(d2, /executes \[X\]/u);
  assert.match(d2, /permission set: internal, included/u);

  const root = await fs.mkdtemp(path.join(os.tmpdir(), "bc-atlas-permissions-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, ".alpackages"));
  await fs.writeFile(path.join(root, "app.json"), JSON.stringify({
    id: "main-app", name: "Main", publisher: "Example", version: "1.0.0.0",
    dependencies: [{ id: "dependency-app", name: "Dependency", version: "1.0.0.0" }]
  }));
  await fs.writeFile(path.join(root, "Main.al"), `
    permissionset 50200 MainSet {
      Assignable = true;
      IncludedPermissionSets = "Dependency Base";
    }
  `);
  const symbols = {
    AppId: "dependency-app",
    Name: "Dependency",
    Publisher: "Example",
    Version: "1.0.0.0",
    PermissionSets: [{
      Id: 70000, Name: "Dependency Base", Assignable: false, Access: "Internal"
    }]
  };
  await fs.writeFile(
    path.join(root, ".alpackages", "Dependency.app"),
    zipSync({ "SymbolReference.json": strToU8(JSON.stringify(symbols)) })
  );
  const workspace = resolveModel(await analyze(root));
  const mainSet = workspace.objects.find(({ name }) => name === "MainSet");
  const dependencySet = workspace.objects.find(({ name }) => name === "Dependency Base");
  const inclusion = workspace.edges.find(({ from, kind }) => from === mainSet.key && kind === "includes");
  assert.equal(inclusion.to, dependencySet.key);
  assert.equal(inclusion.targetOrigin, "declared-dependency");
  assert.deepEqual(dependencySet.permissionSetRoles, ["internal", "included"]);
});
