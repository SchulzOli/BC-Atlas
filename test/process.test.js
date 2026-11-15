import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { renderAppHtml } from "../src/app/page.js";
import { createService } from "../src/app/service.js";
import { Workspace } from "../src/app/workspace.js";
import { renderBpmn } from "../src/docs/render/bpmn.js";
import { applyProcessOperations, bpmnProcess, importBpmn, mineProcesses, processesConfig, runProcesses } from "../src/process/index.js";
import { describeProcesses } from "../src/process/project.js";

const cli = fileURLToPath(new URL("../src/cli.js", import.meta.url));
const example = fileURLToPath(new URL("../examples/purchasing-app", import.meta.url));
const bca = (args, options = {}) => spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", timeout: 180_000, ...options });

function project() {
  const root = mkdtempSync(path.join(os.tmpdir(), "bc-atlas-process-"));
  cpSync(example, root, { recursive: true });
  return root;
}

test("processes are normalized: steps in lanes, wires with the names of their ways, and no circle", () => {
  const [model] = processesConfig({ processes: [{ id: "orders", steps: [
    { id: "take", title: "Take the order", lane: "Order processor", test: "sales-order-create" },
    { id: "post", lane: "Accountant", after: "take" },
    { id: "cancel", lane: "Order processor", after: [{ step: "take", when: "withdrawn" }] }
  ] }] });
  assert.equal(model.title, "orders");
  assert.deepEqual(model.steps.map(({ id, title, lane, test: shown, after }) => [id, title, lane, shown, after]), [
    ["take", "Take the order", "Order processor", "sales-order-create", []],
    ["post", "post", "Accountant", undefined, [{ step: "take" }]],
    ["cancel", "cancel", "Order processor", undefined, [{ step: "take", when: "withdrawn" }]]
  ]);
  const invalid = (steps, pattern) => assert.throws(() => processesConfig({ processes: [{ id: "a", steps }] }), pattern);
  invalid([{ title: "No id" }], /needs an "id"/u);
  invalid([{ id: "a" }, { id: "a" }], /two steps "a"/u);
  invalid([{ id: "a", after: "b" }], /comes after "b", which is not a step of this process/u);
  invalid([{ id: "a", after: "a" }], /comes after itself/u);
  invalid([{ id: "a", after: "b" }, { id: "b", after: "a" }], /the steps of process "a" wait for each other in a circle/u);
  assert.throws(() => processesConfig({ processes: [{ id: "a" }, { id: "a" }] }), /two processes "a"/u);
});

test("operations change the processes: steps, wires, lanes, and a step that goes leaves the way whole", () => {
  let config = applyProcessOperations({ title: "Kept" }, [
    { op: "set", process: "orders", title: "Sales orders" },
    { op: "step", process: "orders", title: "Take the order", lane: "Order processor", test: "sales-order-create" },
    { op: "step", process: "orders", title: "Check the credit", lane: "Accountant" },
    { op: "step", process: "orders", id: "post", title: "Post it", lane: "Accountant" },
    { op: "wire", process: "orders", from: "take-the-order", into: "check-the-credit" },
    { op: "wire", process: "orders", from: "check-the-credit", into: "post", when: "within the limit" }
  ]);
  assert.equal(config.title, "Kept");
  assert.deepEqual(config.processes[0].steps, [
    { id: "take-the-order", title: "Take the order", lane: "Order processor", test: "sales-order-create" },
    { id: "check-the-credit", title: "Check the credit", lane: "Accountant", after: ["take-the-order"] },
    { id: "post", title: "Post it", lane: "Accountant", after: [{ step: "check-the-credit", when: "within the limit" }] }
  ]);
  config = applyProcessOperations(config, [
    { op: "step", process: "orders", step: "post", title: "Post the order", test: "sales-order-post" },
    { op: "lane", process: "orders", lane: "Accountant", title: "Finance" },
    { op: "step", process: "orders", step: "take-the-order", test: "" }
  ]);
  assert.deepEqual(config.processes[0].steps.map(({ title, lane, test: shown }) => [title, lane, shown]), [["Take the order", "Order processor", undefined], ["Check the credit", "Finance", undefined], ["Post the order", "Finance", "sales-order-post"]]);
  // The step in the middle goes: the last comes after the first, by the way it had.
  assert.deepEqual(applyProcessOperations(config, [{ op: "unstep", process: "orders", step: "check-the-credit" }]).processes[0].steps.at(-1).after, [{ step: "take-the-order", when: "within the limit" }]);
  assert.deepEqual(applyProcessOperations(config, [{ op: "unwire", process: "orders", from: "check-the-credit", into: "post" }]).processes[0].steps.at(-1).after, undefined);
  assert.throws(() => applyProcessOperations(config, [{ op: "wire", process: "orders", from: "post", into: "take-the-order" }]), /in a circle/u);
  assert.throws(() => applyProcessOperations(config, [{ op: "step", process: "nope", title: "x" }]), /there is no process "nope"/u);
  assert.throws(() => applyProcessOperations(config, [{ op: "unstep", process: "orders", step: "nope" }]), /has no step "nope"/u);
  assert.equal(applyProcessOperations(config, [{ op: "remove", process: "orders" }]).processes, undefined);
});

test("process mining finds the processes as they are, and a run says who performs each step and what to improve", async () => {
  const described = await describeProcesses(example);
  // Mined from the process tests: who really does what, in which order, and what each step does in the app.
  const [mined] = described.mined;
  assert.deepEqual([mined.id, mined.title, mined.sources, mined.handovers], ["purchase-requests", "Purchase requests", ["process tests"], 2]);
  assert.deepEqual(mined.steps.map(({ id, lane, test: shown, after }) => [id, lane, shown, after]), [
    ["create", "Employee", "purchase-request-create", []],
    ["release", "Employee", "purchase-request-release", [{ step: "create" }]],
    ["approve", "Team lead", "purchase-request-approve", [{ step: "release" }]],
    ["order", "Purchaser", "purchase-request-order", [{ step: "approve" }]]
  ]);
  assert.deepEqual(mined.steps[0].events, { steps: 5, opens: 1, runs: 0, reads: 1, writes: 4, objects: ["page 50210 Purchase Requests", "table 50200 Purchase Request"] });
  assert.deepEqual(described.roles.map(({ name }) => name), ["Employee", "Team lead", "Purchaser", "Administrator"]);
  assert.equal(described.processes.length, 0);

  // The mined process as a model, with a step nobody has a test for, in a lane that is no role, and one in the wrong lane.
  const { simulate } = await import("../src/simulation/index.js");
  const report = await simulate(example, {});
  const models = processesConfig({ processes: [{ id: "purchase-requests", title: "Purchase requests", steps: [
    ...mined.steps.map(({ id, title, lane, test: shown, after }) => ({ id, title, lane: id === "release" ? "Purchaser" : lane, test: shown, after })),
    { id: "receive", title: "Receive the goods", lane: "Warehouse", after: [{ step: "order", when: "delivered" }] },
    { id: "ask", title: "Ask again", lane: "Employee", after: ["approve"] },
    { id: "ghost", title: "A step with a test that is gone", lane: "Employee", test: "no-such-test" }
  ] }] });
  const [run] = runProcesses(models, report);
  assert.equal(run.passed, false);
  assert.deepEqual(run.steps.map(({ id, status }) => [id, status]), [["create", "runs"], ["release", "other-lane"], ["approve", "blocked"], ["order", "runs"], ["receive", "unproven"], ["ask", "unproven"], ["ghost", "unknown"]]);
  const approve = run.steps.find(({ id }) => id === "approve");
  assert.deepEqual([approve.performers.map(({ agent }) => agent), approve.missing, approve.handover], [["Ben"], ['codeunit "Request Notifications" = X'], true]);
  assert.deepEqual(run.steps.find(({ id }) => id === "release").performers.map(({ agent }) => agent), ["Anna", "Ben"]);
  const rules = run.findings.map(({ rule }) => rule);
  for (const rule of ["process-step-blocked", "process-step-other-lane", "process-lane-unknown", "process-step-unproven", "process-step-unknown-test", "process-back-and-forth"]) assert.ok(rules.includes(rule), rule);
  assert.match(run.findings.find(({ rule }) => rule === "process-step-blocked").message, /stops at "Approve a released purchase request": Team lead cannot perform it\. Missing: codeunit "Request Notifications" = X/u);
  assert.ok(run.findings.some(({ rule, message }) => rule === "process-back-and-forth" && /from Purchaser to Team lead and back for "Order what an approved purchase request asks for"/u.test(message)));
  // Against the process as it is: a step the tests have and the model has not, and an order the app does not allow.
  const short = processesConfig({ processes: [{ id: "short", steps: [{ id: "order", lane: "Purchaser", test: "purchase-request-order" }, { id: "approve", lane: "Team lead", test: "purchase-request-approve", after: ["order"] }] }] });
  const other = runProcesses(short, report)[0].findings;
  assert.ok(other.some(({ rule, message }) => rule === "process-step-not-in-model" && /purchase-request-create/u.test(message)));
  assert.ok(other.some(({ rule }) => rule === "process-order-differs"));
  // Without process tests the models are there, and nothing can be shown.
  assert.deepEqual(runProcesses(models, undefined)[0].steps.map(({ status }) => status).slice(0, 2), ["unknown", "unknown"]);
  assert.deepEqual(mineProcesses({ processes: [], tasks: [] }), []);
});

test("a process goes to BPMN 2.0 and comes back: lanes, tasks, ways, and what a gateway parts", () => {
  const [model] = processesConfig({ processes: [{ id: "orders", title: "Sales orders", steps: [
    { id: "take", title: "Take the order", lane: "Order processor", test: "sales-order-create" },
    { id: "post", title: "Post it", lane: "Accountant", after: [{ step: "take", when: "released" }] },
    { id: "cancel", title: "Cancel it", lane: "Order processor", after: [{ step: "take", when: "withdrawn" }] }
  ] }] });
  const xml = renderBpmn(bpmnProcess(model), { version: "1.0.0", note: "A test -- with dashes" });
  assert.match(xml, /<bpmn:lane id="Lane_1" name="Order processor">/u);
  assert.match(xml, /<bpmn:userTask id="Activity_orders_take" name="Take the order">/u);
  assert.match(xml, /<bpmn:exclusiveGateway id="Gateway_orders_take"/u);
  assert.match(xml, /<bpmn:sequenceFlow id="Flow_orders_\d+" name="released" sourceRef="Gateway_orders_take" targetRef="Activity_orders_post" \/>/u);
  assert.ok(xml.includes("<!-- A test - - with dashes -->") && xml.includes("bpmndi:BPMNShape"));
  const back = importBpmn(xml, { id: "orders" });
  assert.deepEqual(back, { id: "orders", title: "Sales orders", steps: [
    { id: "take-the-order", title: "Take the order", lane: "Order processor", test: "sales-order-create" },
    { id: "post-it", title: "Post it", lane: "Accountant", after: [{ step: "take-the-order", when: "released" }] },
    { id: "cancel-it", title: "Cancel it", lane: "Order processor", after: [{ step: "take-the-order", when: "withdrawn" }] }
  ] });
  // As another tool writes it: other prefixes, a way back that cannot be walked.
  const foreign = `<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL"><process id="p" name="Returns">
    <laneSet><lane id="l1" name="Service"><flowNodeRef>a</flowNodeRef><flowNodeRef>c</flowNodeRef></lane><lane id="l2" name="Warehouse"><flowNodeRef>b</flowNodeRef></lane></laneSet>
    <startEvent id="s"/><task id="a" name="Take the return"/><serviceTask id="b" name="Check the goods"/><userTask id="c" name="Refund"/><endEvent id="e"/>
    <sequenceFlow id="f1" sourceRef="s" targetRef="a"/><sequenceFlow id="f2" sourceRef="a" targetRef="b"/><sequenceFlow id="f3" sourceRef="b" targetRef="c" name="fine"/>
    <sequenceFlow id="f4" sourceRef="c" targetRef="a" name="again"/><sequenceFlow id="f5" sourceRef="c" targetRef="e"/></process></definitions>`;
  const returns = importBpmn(foreign);
  assert.deepEqual([returns.id, returns.steps.map(({ id, lane, after }) => [id, lane, after])], ["returns", [["take-the-return", "Service", undefined], ["check-the-goods", "Warehouse", ["take-the-return"]], ["refund", "Service", [{ step: "check-the-goods", when: "fine" }]]]]);
  assert.throws(() => importBpmn("<svg/>"), /not BPMN 2\.0/u);
});

test("bca process mines, defines, runs, and exports, and the view builds on the same", async () => {
  const root = project();
  try {
    assert.match(bca(["process", root]).stdout, /No processes yet\. The process tests have 2/u);
    assert.match(bca(["process", root, "--mine"]).stdout, /Team lead {8}approve {8}Approve a released purchase request {2}\[purchase-request-approve\] {2}after release\n.*4 click\(s\): opens 1, runs 2, reads 2, writes 2; 6 object\(s\)/u);
    let result = bca(["process", "define", root, "--adopt", "purchase-requests"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /Wrote .*\.bca\.json/u);
    const define = (...args) => bca(["process", "define", root, "--process", "purchase-requests", ...args]);
    assert.equal(define("--step", "Receive the goods", "--lane", "Warehouse", "--after", "order:delivered").status, 0);
    assert.equal(define("--at", "receive-the-goods", "--title", "Receive what was ordered").status, 0);
    result = define("--at", "create", "--after", "order");
    assert.equal(result.status, 2);
    assert.match(result.stderr, /in a circle/u);
    const steps = JSON.parse(readFileSync(path.join(root, ".bca.json"), "utf8")).processes[0].steps;
    assert.deepEqual(steps.at(-1), { id: "receive-the-goods", title: "Receive what was ordered", lane: "Warehouse", after: [{ step: "order", when: "delivered" }] });
    assert.deepEqual(steps[2], { id: "approve", title: "Approve a released purchase request", lane: "Team lead", test: "purchase-request-approve", after: ["release"] });

    // The run is the test: the process stops where the team lead cannot go on.
    result = bca(["process", "run", root]);
    assert.equal(result.status, 1);
    assert.match(result.stdout, /Stops: 5 step\(s\) in 4 lane\(s\), 3 handover\(s\)\./u);
    assert.match(result.stdout, /3\. \[STOPPED\] Team lead: Approve a released purchase request\n {5}after release: the work changes hands\n {5}tried by Ben \(purchase-request-approve\)/u);
    assert.match(result.stdout, /5\. \[unproven\] Warehouse: Receive what was ordered\n {5}after order \(delivered\)/u);
    assert.match(result.stdout, /What to improve[\s\S]*error process-step-blocked[\s\S]*warning process-lane-unknown/u);
    const json = JSON.parse(bca(["process", "run", root, "--format", "json"]).stdout);
    assert.deepEqual([json.schema, json.passed, json.runs[0].steps.length], ["bc-atlas.processes/1", false, 5]);
    result = bca(["process", "run", root, "-o", path.join(root, "docs/processes.md")]);
    assert.match(readFileSync(path.join(root, "docs/processes.md"), "utf8"), /^# Purchase requests\n[\s\S]*## What to improve/u);
    assert.match(bca(["process", "run", root, "--process", "nope"]).stderr, /there is no process "nope"/u);

    // BPMN out, and in again as another process.
    result = bca(["process", "export", root, "--process", "purchase-requests", "-o", path.join(root, "pr.bpmn")]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(readFileSync(path.join(root, "pr.bpmn"), "utf8"), /<bpmn:participant id="Participant_purchase_requests" name="Purchase requests"/u);
    result = bca(["process", "define", root, "--process", "copy", "--title", "A copy", "--import", path.join(root, "pr.bpmn"), "--format", "json"]);
    assert.equal(result.status, 0, result.stderr);
    const copy = JSON.parse(result.stdout).processes.find(({ id }) => id === "copy");
    assert.deepEqual([copy.title, copy.steps.length, copy.steps[0].test, copy.steps.at(-1).lane], ["A copy", 5, "purchase-request-create", "Warehouse"]);

    // The view: a lens, a walk through each model, findings on the steps, and what the builder builds on.
    const service = createService(new Workspace(root, {}, { live: false }));
    let atlas = await service.call("atlas");
    assert.ok(atlas.lenses.some(({ id }) => id === "models"));
    const node = (id) => atlas.nodes.find((item) => item.id === id);
    assert.deepEqual([node("model::purchase-requests").status, node("activity::purchase-requests::approve").status, node("lane::Warehouse").kind], ["stops", "blocked", "lane"]);
    const kinds = new Set(atlas.edges.map(([, , relation]) => atlas.relations[relation].kind));
    for (const kind of ["in lane", "begins with", "leads to", "shown by"]) assert.ok(kinds.has(kind), kind);
    const story = atlas.stories.find(({ id }) => id === "model:purchase-requests");
    assert.deepEqual([story.steps.length, story.steps[2].status, story.steps.at(-1).title], [6, "error", "What to improve"]);
    assert.ok(atlas.findings.some(({ rule, origin, nodes }) => rule === "process-step-blocked" && origin === "process" && nodes.length === 1));
    assert.deepEqual([atlas.processes.processes.length, atlas.processes.mined.length, atlas.processes.tests.length, Object.keys(atlas.processes.bpmn)], [2, 2, 5, ["purchase-requests", "copy"]]);
    // The builder sends operations; what is not valid is not written.
    const changed = await service.call("defineProcesses", { operations: [{ op: "remove", process: "copy" }, { op: "step", process: "purchase-requests", step: "receive-the-goods", lane: "Purchaser", test: "purchase-request-order" }] });
    assert.equal(changed.written, true);
    atlas = await service.call("atlas");
    assert.equal(atlas.processes.runs[0].steps.at(-1).status, "runs");
    await assert.rejects(service.call("defineProcesses", { operations: [{ op: "wire", process: "purchase-requests", from: "order", into: "create" }] }), /in a circle/u);

    const html = renderAppHtml({ mode: "vscode" });
    for (const part of ['data-board-mode="process"', 'data-drop="lane"', 'data-drop="newlane"', 'data-drag="test"', 'data-drag="pstep"', 'data-proc="play"', 'data-proc="bpmn"', 'data-proc="adopt"', 'call("defineProcesses", { operations })', "function procLocal("]) assert.ok(html.includes(part), part);

    // Processes that are not valid are a finding, and the rest of the view is there.
    writeFileSync(path.join(root, ".bca.json"), JSON.stringify({ ...JSON.parse(readFileSync(path.join(root, ".bca.json"), "utf8")), processes: [{ id: "x", steps: [{ id: "a", after: "b" }] }] }));
    const broken = await createService(new Workspace(root, {}, { live: false })).call("atlas");
    assert.equal(broken.processes, undefined);
    assert.ok(broken.findings.some(({ rule }) => rule === "processes-invalid"));
    assert.ok(!existsSync(path.join(root, "no-such-file")));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
