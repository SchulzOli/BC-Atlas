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
