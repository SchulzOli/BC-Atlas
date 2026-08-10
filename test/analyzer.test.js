import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { analyze, testing } from "../src/analyzer.js";
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
  const calls = createView(model, "call");
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
  const calls = createView(model, "call");
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
  assert.ok(calls.objects.some(({ name }) => name === "Validate"));
  assert.ok(calls.edges.some((edge) => edge.kind === "calls" && edge.to));
  assert.ok(calls.edges.filter((edge) => edge.to).length >= 2);
  assert.ok(calls.edges.some((edge) => edge.kind === "subscribes" && edge.to));
  assert.ok(calls.edges.every(({ to }) => to));
  const callsWithUnresolved = createView(filtered, "call", {
    includeUnresolvedCalls: true
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
