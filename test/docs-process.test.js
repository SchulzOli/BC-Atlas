import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { BpmnModdle } from "bpmn-moddle";
import { exportDocumentation } from "../src/docs/export.js";
import { loadCorpus } from "../src/docs/model.js";
import { layoutProcess, scenarioProcess, useCaseProcess } from "../src/docs/process.js";
import { buildCatalog } from "../src/docs/task.js";

// Two roles, phases with intermediate results, a repeated block, quoted
// field names, and an alternative path.
const TESTS = `codeunit 50160 OrderUITests
{
    Subtype = Test;

    [Test]
    procedure CreateOrder()
    var
        SalesOrder: TestPage "Sales Order";
    begin
        // [DOC-ID] order-create
        // [FEATURE] order-to-cash
        // [SCENARIO] Create and release a sales order.
        // [PERMISSIONS] SALES CLERK
        // [GIVEN] [SETUP] Number series exist.

        // [WHEN] The clerk enters the order header.
        SalesOrder.OpenNew();
        SalesOrder."Sell-to Customer No.".SetValue('10000');
        SalesOrder."External Document No.".SetValue('PO-1');
        SalesOrder."Posting Date".SetValue(WorkDate());

        // [THEN] The header is complete.

        // [WHEN] The clerk enters the lines.
        SalesOrder.SalesLines.New();
        SalesOrder.SalesLines."No.".SetValue('1000');
        SalesOrder.SalesLines.Quantity.SetValue(5);
        SalesOrder.SalesLines."Unit Price".SetValue(10);

        // [THEN] The amounts are calculated.

        // [WHEN] The clerk releases the order.
        SalesOrder.Release.Invoke();
        SalesOrder.Close();

        // [THEN] The sales order is released.
        // [NEXT] order-approve
    end;

    [Test]
    procedure ApproveOrder()
    var
        Approvals: TestPage "Requests to Approve";
    begin
        // [DOC-ID] order-approve
        // [FEATURE] order-to-cash
        // [SCENARIO] Approve a released sales order.
        // [PERMISSIONS] SALES MANAGER
        // [REQUIRES] order-create
        // [NEXT] order-post
        // [WHEN] The manager approves the order.
        Approvals.OpenEdit();
        Approvals.GoToRecord(ApprovalEntry);
        Approvals.Approve.Invoke();
        Approvals.Close();
        // [THEN] The order is approved.
    end;

    [Test]
    procedure PostOrder()
    var
        SalesOrder: TestPage "Sales Order";
    begin
        // [DOC-ID] order-post
        // [FEATURE] order-to-cash
        // [SCENARIO] Ship and invoice the approved sales order.
        // [PERMISSIONS] SALES CLERK
        // [ALTERNATIVE] order-post-batch
        // [WHEN] The clerk posts the order.
        SalesOrder.OpenEdit();
        SalesOrder.Post.Invoke();
        // [THEN] The order is shipped and invoiced.
    end;

    [Test]
    procedure PostOrdersInBatch()
    var
        BatchPost: TestPage "Sales Order List";
    begin
        // [DOC-ID] order-post-batch
        // [FEATURE] order-to-cash
        // [SCENARIO] Post several approved orders in one batch.
        // [PERMISSIONS] SALES CLERK
        // [WHEN] The clerk posts every selected order.
        BatchPost.OpenEdit();
        repeat
            BatchPost.GoToRecord(SalesHeader);
            BatchPost.Post.Invoke();
        until SalesHeader.Next() = 0;
        BatchPost.Close();
        // [THEN] All selected orders are posted.
    end;
}
`;

async function catalogFor(language = "en-US") {
  const root = mkdtempSync(path.join(os.tmpdir(), "bc-atlas-process-"));
  writeFileSync(path.join(root, "OrderUITests.Codeunit.al"), TESTS);
  const corpus = await loadCorpus(root);
  return { root, corpus, catalog: buildCatalog(corpus, { language }) };
}

test("scenario flows show every click, phase results, and repeated blocks", async () => {
  const { root, catalog } = await catalogFor();
  try {
    const create = scenarioProcess(catalog.tasks.find(({ id }) => id === "order-create"));
    assert.deepEqual(create.nodes.map(({ kind, name }) => `${kind}:${name}`), [
      "start:",
      "task:Create Sales Order",
      "task:Enter Sell-to Customer No.",
      "task:Enter External Document No.",
      "task:Enter Posting Date",
      "event:The header is complete.",
      "task:Sales Lines: Add a line",
      "task:Sales Lines: Enter No.",
      "task:Sales Lines: Enter Quantity",
      "task:Sales Lines: Enter Unit Price",
      "event:The amounts are calculated.",
      "task:Choose Release",
      "task:Close Sales Order",
      "end:The sales order is released."
    ], "quoted fields are steps; [THEN] between phases is an intermediate event");
    assert.equal(create.flows.length, create.nodes.length - 1);

    const layout = layoutProcess(create);
    const rows = new Set([...layout.bounds.values()].map(({ y, height }) => y + height / 2));
    assert.equal(rows.size, 3, "a long flow wraps into rows");

    const batch = scenarioProcess(catalog.tasks.find(({ id }) => id === "order-post-batch"));
    const loop = batch.nodes.find(({ loop }) => loop);
    assert.equal(loop.name, "For each Sales Header");
    assert.match(loop.documentation, /^- Choose the Post action\.$/mu, "the loop lists its repeated clicks");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("use-case processes have a lane per permission set and a gateway for alternatives", async () => {
  const { root, catalog } = await catalogFor();
  try {
    const process = useCaseProcess(catalog.useCases[0], catalog);
    layoutProcess(process);
    assert.deepEqual(process.lanes.map(({ name }) => name), ["SALES CLERK", "SALES MANAGER"]);
    const byId = new Map(process.nodes.map((node) => [node.id, node]));
    const targets = (id) => process.flows.filter(({ from }) => from === id).map(({ to }) => byId.get(to));
    const approve = byId.get("Activity_order-approve");
    assert.equal(approve.lane, "Lane_2", "the manager approves");
    const [gateway] = targets(approve.id);
    assert.equal(gateway.kind, "gateway");
    assert.deepEqual(targets(gateway.id).map(({ id }) => id).sort(), ["Activity_order-post", "Activity_order-post-batch"]);
    assert.ok(process.nodes.every((node) => node.lane), "events and gateways sit in a lane");
    assert.equal(targets(byId.get("Activity_order-create").id)[0].id, "Activity_order-approve",
      "[NEXT] and [REQUIRES] give one sequence flow");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("exports valid BPMN 2.0 with diagram layout and drill-down planes", async () => {
  const { root, corpus } = await catalogFor();
  const output = path.join(root, "out");
  try {
    const result = await exportDocumentation(corpus, { outputDirectory: output, formats: ["markdown", "html", "bpmn"] });
    const names = result.files.map((file) => path.relative(output, file).replaceAll("\\", "/"));
    assert.ok(names.includes("use-case-order-to-cash.bpmn"));
    assert.ok(names.includes("diagrams/use-case-order-to-cash.svg"));
    assert.ok(names.includes("diagrams/order-create.svg"));

    const xml = readFileSync(path.join(output, "use-case-order-to-cash.bpmn"), "utf8");
    const { rootElement, warnings } = await new BpmnModdle().fromXML(xml);
    assert.deepEqual(warnings, []);
    const process = rootElement.rootElements.find(({ $type }) => $type === "bpmn:Process");
    assert.deepEqual(process.laneSets[0].lanes.map(({ name }) => name), ["SALES CLERK", "SALES MANAGER"]);
    const subProcess = process.flowElements.find(({ id }) => id === "Activity_order-create");
    assert.equal(subProcess.$type, "bpmn:SubProcess");
    assert.ok(subProcess.flowElements.some(({ $type, name }) => $type === "bpmn:UserTask" && name === "Choose Release"));
    assert.equal(rootElement.diagrams.length, 5, "one plane for the collaboration and one per scenario");
    assert.ok(rootElement.diagrams.every(({ plane }) => plane.planeElement.length > 0));
    const loop = process.flowElements.find(({ id }) => id === "Activity_order-post-batch").flowElements
      .find(({ loopCharacteristics }) => loopCharacteristics);
    assert.equal(loop.loopCharacteristics.$type, "bpmn:StandardLoopCharacteristics");

    const useCase = readFileSync(path.join(output, "use-case-order-to-cash.md"), "utf8");
    assert.match(useCase, /\[use-case-order-to-cash\.bpmn\]\(\.\/use-case-order-to-cash\.bpmn\)/u);
    const html = readFileSync(path.join(output, "index.html"), "utf8");
    assert.match(html, /<a href="#order-approve"><g class="bpmn-subprocess">/u, "scenarios in the process link to their guide");
    assert.equal((html.match(/<div class="diagram">/gu) ?? []).length, 5);
    const ids = [...html.matchAll(/<marker id="([^"]+)"/gu)].map(([, id]) => id);
    assert.equal(new Set(ids).size, ids.length, "inline SVG marker IDs are unique");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("diagram labels follow the documentation language", async () => {
  const { root, catalog } = await catalogFor("de-DE");
  try {
    const names = scenarioProcess(catalog.tasks.find(({ id }) => id === "order-approve")).nodes.map(({ name }) => name);
    assert.deepEqual(names.slice(1, 5), ["Requests to Approve öffnen", "Datensatz auswählen", "Approve wählen", "Requests to Approve schließen"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
