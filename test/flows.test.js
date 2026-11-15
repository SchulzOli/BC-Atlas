import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createService } from "../src/app/service.js";
import { renderAppHtml } from "../src/app/page.js";
import { Workspace } from "../src/app/workspace.js";
import { createCapabilities, findCommand } from "../src/capabilities.js";
import { ARTIFACTS, applyFlowOperations, artifactCatalog, CANVAS_FILE, defineFlows, exportFlow, flowId, flowOutputs, flowsConfig, flowsFor, normalizeCanvas, readFlowCanvas, stepOrder, writeFlowCanvas } from "../src/flows/index.js";

const cli = fileURLToPath(new URL("../src/cli.js", import.meta.url));
const example = fileURLToPath(new URL("../examples/multi-app", import.meta.url));
const bca = (args, options = {}) => spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", timeout: 180_000, ...options });

function git(cwd, ...args) {
  const result = spawnSync("git", ["-c", "user.email=test@example.com", "-c", "user.name=Test", ...args], { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
}

/** A Git repository with the multi-app example. */
function repository() {
  const root = mkdtempSync(path.join(os.tmpdir(), "bc-atlas-flows-"));
  cpSync(example, root, { recursive: true });
  git(root, "init", "-q", "-b", "main");
  git(root, "add", "-A");
  git(root, "commit", "-qm", "init");
  return root;
}

test("flows are normalized: defaults, options, and what is not valid", () => {
  const [flow] = flowsConfig({ flows: [{ id: "docs", when: "pre-push,ci", steps: [
    { what: "layers" },
    { what: "view", lens: "data", form: "diagram", to: "./docs/pictures/data.svg" },
    { what: "check" },
    { what: "diagram", view: "module", depth: 2, to: "docs/modules.png" }
  ] }] });
  assert.deepEqual(flow.when, ["pre-push", "ci"]);
  assert.equal(flow.title, "docs");
  assert.deepEqual(flow.steps.map(({ what, to }) => [what, to]), [["layers", "docs/layers"], ["view", "docs/pictures/data.svg"], ["check", undefined], ["diagram", "docs/modules.png"]]);
  assert.deepEqual(flow.steps[1].options, { lens: "data", form: "diagram" });
  // A drawing keeps its D2 source next to it; a gate without a place saves nothing.
  assert.deepEqual(flowOutputs([flow]), ["docs/layers", "docs/pictures/data.svg", "docs/modules.png", "docs/modules.d2"]);
  assert.deepEqual(flowsFor([flow], "ci").map(({ id }) => id), ["docs"]);
  assert.deepEqual(flowsFor([flow], "schedule"), []);

  const invalid = (flows, pattern) => assert.throws(() => flowsConfig({ flows }), pattern);
  invalid([{ id: "Docs" }], /needs an "id"/u);
  invalid([{ id: "a" }, { id: "a" }], /two flows "a"/u);
  invalid([{ id: "a", when: ["nightly"] }], /"nightly", which is not a trigger/u);
  invalid([{ id: "a", steps: [{ what: "pdf" }] }], /"pdf", which is not an artifact/u);
  invalid([{ id: "a", steps: [{ what: "layers", lens: "data" }] }], /no option "lens"/u);
  invalid([{ id: "a", steps: [{ what: "view", form: "4d" }] }], /"form" must be one of/u);
  invalid([{ id: "a", steps: [{ what: "view", to: "docs/data.pdf" }] }], /ends in \.svg/u);
  invalid([{ id: "a", steps: [{ what: "layers", to: "/tmp/docs" }] }], /relative to the project/u);
  invalid([{ id: "a", steps: [{ what: "layers" }] }, { id: "b", steps: [{ what: "report", to: "docs/layers" }] }], /saved twice/u);
  // A task of a plugin is a step; it saves where its own settings say.
  assert.equal(flowsConfig({ flows: [{ id: "a", steps: [{ what: "sync" }] }] }, { pluginTasks: ["sync"] })[0].steps[0].plugin, true);
  assert.throws(() => flowsConfig({ flows: [{ id: "a", steps: [{ what: "sync", to: "docs" }] }] }, { pluginTasks: ["sync"] }), /remove "to"/u);
  assert.equal(flowId("Docs for the Wiki!"), "docs-for-the-wiki");
});

test("every artifact of the catalog says where it saves and what it takes", () => {
  for (const artifact of artifactCatalog({ sync: "Sync" })) {
    assert.ok(artifact.title && artifact.summary, artifact.id);
    if (artifact.target === "file") assert.ok(artifact.extensions.length, artifact.id);
    if (artifact.target === "folder") assert.ok(artifact.to, artifact.id);
    if (artifact.to && artifact.target === "file") assert.ok(artifact.extensions.includes(path.extname(artifact.to).slice(1)), artifact.id);
  }
  assert.ok(ARTIFACTS.check.optional && ARTIFACTS.check.gate);
  // The schema and the command name the same artifacts.
  const rules = findCommand(createCapabilities(), "flow").rules.join(" ");
  for (const id of Object.keys(ARTIFACTS)) assert.ok(rules.includes(id), id);
});

test("operations change the flows and keep what they do not name", () => {
  let config = applyFlowOperations({ title: "Kept" }, [
    { op: "set", flow: "docs", title: "Documentation", when: ["ci"] },
    { op: "step", flow: "docs", what: "layers", to: "docs/system" },
    { op: "step", flow: "docs", what: "view", lens: "data", to: "docs/data.svg", theme: "" },
    { op: "step", flow: "docs", what: "check" },
    { op: "deliver", trigger: "ci", sync: "verify" }
  ]);
  assert.equal(config.title, "Kept");
  assert.deepEqual(config.flows, [{ id: "docs", title: "Documentation", when: ["ci"], steps: [{ what: "layers", to: "docs/system" }, { what: "view", lens: "data", to: "docs/data.svg" }, { what: "check" }] }]);
  assert.deepEqual(config.automation.triggers.ci, { tasks: [], sync: "verify" });

  config = applyFlowOperations(config, [
    { op: "step", flow: "docs", at: 2, form: "diagram", lens: "events" },
    { op: "move", flow: "docs", at: 3, by: -1 },
    { op: "set", flow: "docs", when: [] }
  ]);
  assert.deepEqual(config.flows[0].steps, [{ what: "layers", to: "docs/system" }, { what: "check" }, { what: "view", lens: "events", to: "docs/data.svg", form: "diagram" }]);
  assert.deepEqual(config.flows[0].when, []);
  assert.equal(config.flows[0].title, "Documentation");
  // Another artifact at the same step starts anew: the place of a picture is not the place of a folder.
  config = applyFlowOperations(config, [{ op: "step", flow: "docs", at: 3, what: "handbook" }, { op: "unstep", flow: "docs", at: 2 }]);
  assert.deepEqual(config.flows[0].steps, [{ what: "layers", to: "docs/system" }, { what: "handbook" }]);
  // The trigger keeps its tasks when its delivery changes.
  assert.deepEqual(applyFlowOperations({ automation: { triggers: { "pre-push": { tasks: ["check"], sync: "none" } } } }, [{ op: "deliver", trigger: "pre-push", sync: "stage" }]).automation.triggers["pre-push"], { tasks: ["check"], sync: "stage" });
  assert.equal(applyFlowOperations(config, [{ op: "remove", flow: "docs" }]).flows, undefined);

  assert.throws(() => applyFlowOperations(config, [{ op: "step", flow: "nope", what: "layers" }]), /there is no flow "nope"/u);
  assert.throws(() => applyFlowOperations(config, [{ op: "unstep", flow: "docs", at: 9 }]), /no step 9/u);
  assert.throws(() => applyFlowOperations(config, [{ op: "deliver", trigger: "pre-commit", sync: "commit" }]), /delivers with none, verify, stage/u);
  assert.throws(() => applyFlowOperations(config, [{ op: "rename", flow: "docs" }]), /unknown operation/u);
});

test("bca flow define writes .bca.json, and bca run makes and verifies what a flow saves", () => {
  const root = repository();
  try {
    const define = (...args) => bca(["flow", "define", root, ...args]);
    let result = define("--flow", "docs", "--title", "Documentation in the repository", "--when", "ci");
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /Wrote .*\.bca\.json/u);
    assert.match(result.stderr, /Nothing calls ci yet/u);
    assert.equal(define("--flow", "docs", "--step", "view", "--to", "docs/pictures/data.svg", "--set", "lens=data", "--set", "form=diagram").status, 0);
    assert.equal(define("--flow", "docs", "--step", "check", "--to", "docs/health.json", "--set", "failOn=never").status, 0);
    assert.equal(define("--flow", "docs", "--step", "handbook").status, 0);
    assert.equal(define("--flow", "docs", "--up", "3").status, 0);
    assert.equal(define("--deliver", "ci=verify").status, 0);

    // What is not valid is not written.
    const before = readFileSync(path.join(root, ".bca.json"), "utf8");
    result = define("--flow", "docs", "--step", "view", "--to", "docs/pictures/data.svg");
    assert.equal(result.status, 2, result.stderr);
    assert.match(result.stderr, /saved twice/u);
    assert.equal(define("--flow", "docs", "--step", "report", "--dry-run").status, 0);
    assert.equal(readFileSync(path.join(root, ".bca.json"), "utf8"), before);

    const config = JSON.parse(before);
    assert.deepEqual(config.flows, [{ id: "docs", title: "Documentation in the repository", when: ["ci"], steps: [
      { what: "view", to: "docs/pictures/data.svg", lens: "data", form: "diagram" },
      { what: "handbook" },
      { what: "check", to: "docs/health.json", failOn: "never" }
    ] }]);
    assert.ok(config.architecture, "the rest of .bca.json stays");

    const shown = JSON.parse(bca(["flow", root, "--format", "json"]).stdout);
    assert.equal(shown.schema, "bc-atlas.flows/1");
    assert.equal(shown.triggers.ci.sync, "verify");
    assert.ok(shown.artifacts.some(({ id, plugin }) => id === "sync" && plugin), "the tasks of plugins are artifacts");
    assert.match(bca(["flow", root]).stdout, /2\. handbook\s+-> docs\/handbook/u);
    assert.match(bca(["flow", root, "--artifacts"]).stdout, /knowledge-graph/u);

    // The trigger runs the flow; what it saved is not committed yet, so verify fails.
    result = bca(["run", root, "--trigger", "ci", "--format", "json"]);
    assert.equal(result.status, 1, result.stderr);
    let run = JSON.parse(result.stdout);
    assert.deepEqual(run.tasks, []);
    assert.deepEqual(run.flows[0].steps.map(({ what, ok }) => [what, ok]), [["view", true], ["handbook", true], ["check", true]]);
    assert.deepEqual(run.outputs, ["docs/pictures/data.svg", "docs/handbook", "docs/health.json"]);
    assert.ok(run.changed.includes("docs/pictures/data.svg"));
    assert.match(readFileSync(path.join(root, "docs/pictures/data.svg"), "utf8"), /^<svg/u);
    assert.ok(existsSync(path.join(root, "docs/handbook/README.md")));
    assert.equal(JSON.parse(readFileSync(path.join(root, "docs/health.json"), "utf8")).passed, true);

    // Committed, the same source gives the same files.
    git(root, "add", "-A");
    git(root, "commit", "-qm", "docs");
    result = bca(["run", root, "--trigger", "ci", "--format", "json"]);
    run = JSON.parse(result.stdout);
    assert.deepEqual(run.changed, []);
    assert.equal(result.status, 0, result.stdout);

    // By name, whatever the trigger; a gate that fails fails the run.
    assert.equal(define("--flow", "gate", "--step", "check").status, 0);
    result = bca(["run", root, "--flow", "gate"]);
    assert.equal(result.status, 1);
    assert.match(result.stdout, /failed {2}check/u);
    assert.match(result.stdout, /FAILED \(flow gate\)/u);
    result = bca(["run", root, "--flow", "nope"]);
    assert.match(result.stderr, /there is no flow "nope"/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the view shows the flows as a lens and changes them from its Flow menu", async () => {
  const root = repository();
  try {
    await defineFlows(root, { operations: [
      { op: "set", flow: "docs", title: "Documentation", when: ["ci", "manual"] },
      { op: "step", flow: "docs", what: "layers", to: "docs/system" },
      { op: "step", flow: "docs", what: "app" },
      { op: "deliver", trigger: "ci", sync: "verify" }
    ] });
    const service = createService(new Workspace(root, {}, { live: false }));
    let atlas = await service.call("atlas");
    assert.ok(atlas.lenses.some(({ id }) => id === "flows"));
    const label = (id) => atlas.nodes.find((node) => node.id === id)?.label;
    assert.equal(label("flow::docs"), "Documentation");
    assert.equal(label("artifact::docs::1"), "Layered documentation");
    assert.equal(label("place::docs/system"), "docs/system");
    assert.match(atlas.nodes.find(({ id }) => id === "trigger::ci").delivery, /^verify: /u);
    assert.deepEqual(atlas.relations.map(({ kind }) => kind).filter((kind) => ["starts", "makes", "saved to"].includes(kind)), ["starts", "makes", "saved to"]);
    // What the menu builds from: the flows, the triggers, and the catalog.
    assert.deepEqual(atlas.flows.flows[0].steps, [{ what: "layers", to: "docs/system" }, { what: "app", to: "docs/bc-atlas.html" }]);
    assert.equal(atlas.flows.triggers.ci.sync, "verify");
    assert.ok(atlas.flows.artifacts.find(({ id }) => id === "view").options.some(({ name }) => name === "lens"));
    // The view as one file holds the time it was made: verify would never pass.
    assert.ok(atlas.findings.some(({ rule }) => rule === "flow-never-in-sync"));

    const changed = await service.call("defineFlows", { operations: [{ op: "unstep", flow: "docs", at: 2 }, { op: "step", flow: "docs", what: "check", to: "docs/health.md", failOn: "never" }] });
    assert.equal(changed.written, true);
    atlas = await service.call("atlas");
    assert.equal(atlas.flows.flows[0].steps.length, 2);
    assert.ok(!atlas.findings.some(({ rule }) => rule === "flow-never-in-sync"));
    await assert.rejects(service.call("defineFlows", { operations: [{ op: "step", flow: "docs", what: "nothing" }] }), /not an artifact/u);

    const run = await service.call("runFlow", { flow: "docs" });
    assert.equal(run.passed, true);
    assert.deepEqual(run.outputs, ["docs/system", "docs/health.md"]);
    assert.ok(existsSync(path.join(root, "docs/system/README.md")));

    // Flows that are not valid are a finding, and the rest of the view is there.
    writeFileSync(path.join(root, ".bca.json"), JSON.stringify({ flows: [{ id: "docs", steps: [{ what: "nothing" }] }] }));
    const broken = await createService(new Workspace(root, {}, { live: false })).call("atlas");
    assert.equal(broken.flows, undefined);
    assert.ok(broken.findings.some(({ rule }) => rule === "flows-invalid"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("bca flow export writes a GitHub Actions workflow that runs the flow and delivers what it saves", async () => {
  const root = repository();
  try {
    await defineFlows(root, { operations: [
      { op: "set", flow: "docs", title: "Docs: in the repository", when: ["ci", "schedule", "pre-push"] },
      { op: "step", flow: "docs", what: "layers", to: "docs/system" },
      { op: "step", flow: "docs", what: "diagram", view: "module", to: "docs/modules.svg" },
      { op: "deliver", trigger: "ci", sync: "verify" },
      { op: "deliver", trigger: "schedule", sync: "pull-request" },
      { op: "set", flow: "hand" },
      { op: "step", flow: "hand", what: "check", to: "docs/health.md" },
      { op: "set", flow: "empty", when: ["ci"] }
    ] });
    let result = bca(["flow", "export", root, "--flow", "docs"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Wrote .*bc-atlas-docs\.yml/u);
    assert.match(result.stdout, /on {7}pull_request, push, schedule \(0 6 \* \* 1\), workflow_dispatch/u);
    const file = path.join(root, ".github/workflows/bc-atlas-docs.yml");
    const workflow = readFileSync(file, "utf8");
    assert.match(workflow, /^# Generated by bca flow export: the flow "docs"/u);
    // A title may hold a colon: the name is quoted.
    assert.ok(workflow.includes('name: "BC Atlas: Docs: in the repository"'));
    assert.ok(workflow.includes('run . --trigger "$BCA_TRIGGER" --flow docs'));
    assert.ok(workflow.includes("  pull_request:") && workflow.includes('- cron: "0 6 * * 1"') && workflow.includes("  workflow_dispatch:"));
    // verify is done by bca run; the schedule writes back what the flow saved, the drawing with its source.
    assert.ok(!workflow.includes("upload-artifact"));
    assert.ok(workflow.includes("peter-evans/create-pull-request") && workflow.includes("branch: bc-atlas/docs"));
    assert.match(workflow, /add-paths: \|\n {12}docs\/system\n {12}docs\/modules\.svg\n {12}docs\/modules\.d2\n/u);
    assert.ok(workflow.includes("pull-requests: write") && workflow.includes("group: bc-atlas-docs-"));

    // The same flow gives the same file; a file somebody else wrote is not replaced.
    assert.match(bca(["flow", "export", root, "--flow", "docs"]).stdout, /Up to date/u);
    writeFileSync(file, "name: mine\n");
    result = bca(["flow", "export", root, "--flow", "docs"]);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /was not written by bca flow export/u);
    assert.equal(readFileSync(file, "utf8"), "name: mine\n");
    assert.equal(bca(["flow", "export", root, "--flow", "docs", "--force"]).status, 0);
    assert.equal(readFileSync(file, "utf8"), workflow);

    // Neither a push nor a schedule starts it: by hand, and what it saves is an artifact.
    result = bca(["flow", "export", root, "--flow", "hand", "-o", "-"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /\non:\n {2}workflow_dispatch:\n\npermissions:\n {2}contents: read\n/u);
    assert.ok(result.stdout.includes("BCA_TRIGGER: manual") && result.stdout.includes("name: bc-atlas-hand") && result.stdout.includes("            docs/health.md"));
    assert.ok(!existsSync(path.join(root, ".github/workflows/bc-atlas-hand.yml")), "- prints, it writes nothing");

    const planned = await exportFlow(root, { flow: "hand", dryRun: true });
    assert.deepEqual([planned.action, planned.written, planned.path], ["create", false, ".github/workflows/bc-atlas-hand.yml"]);
    assert.deepEqual(planned.delivery, { manual: "artifact" });
    await assert.rejects(exportFlow(root, { flow: "empty" }), /has no steps yet/u);
    await assert.rejects(exportFlow(root, { flow: "nope" }), /there is no flow "nope"/u);
    await assert.rejects(exportFlow(root, { flow: "docs", to: "gitlab" }), /exported for github/u);

    // The view writes the same file.
    const service = createService(new Workspace(root, {}, { live: false }));
    const written = await service.call("exportFlow", { flow: "hand" });
    assert.deepEqual([written.action, written.written, written.path], ["create", true, ".github/workflows/bc-atlas-hand.yml"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("removing a step closes the way around it, the same from the terminal and in the builder; a wire that goes keeps the steps", async () => {
  const root = repository();
  try {
    await defineFlows(root, { operations: [
      { op: "set", flow: "docs" },
      { op: "step", flow: "docs", what: "check", id: "gate" },
      { op: "step", flow: "docs", what: "layers", to: "docs/system", id: "pages", after: ["gate"] },
      { op: "step", flow: "docs", what: "handbook", after: ["pages:always"] },
      { op: "step", flow: "docs", what: "catalog" }
    ] });
    // The step in the middle goes: the handbook comes after the gate, on the condition it had.
    let result = bca(["flow", "define", root, "--flow", "docs", "--unstep", "2"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /handbook now comes after gate\./u);
    assert.deepEqual(JSON.parse(readFileSync(path.join(root, ".bca.json"), "utf8")).flows[0].steps, [{ what: "check", id: "gate" }, { what: "handbook", after: [{ step: "gate", if: "always" }] }, { what: "catalog" }]);
    // The gate goes: what it held back starts the flow, and the terminal says so.
    result = bca(["flow", "define", root, "--flow", "docs", "--unstep", "1"]);
    assert.match(result.stderr, /handbook came after nothing else and now starts the flow: nothing holds it back\./u);
    assert.ok(!existsSync(path.join(root, ".bca/flow-canvas.json")), "nothing leaves a flow when a step is removed");
    // The builder sends the same operation, and gets the same.
    const service = createService(new Workspace(root, {}, { live: false }));
    await service.call("defineFlows", { operations: [{ op: "step", flow: "docs", what: "report", after: [] }, { op: "wire", flow: "docs", from: 1, into: 3 }] });
    const removed = await service.call("defineFlows", { operations: [{ op: "unstep", flow: "docs", at: 1 }] });
    assert.deepEqual([removed.flows[0].steps.map(({ what }) => what), removed.rerouted], [["catalog", "report"], [{ flow: "docs", step: "report", after: [] }]]);

    // A wire that goes: the step is in no flow, with what runs only through it. They are kept, with their wire and where they were.
    await defineFlows(root, { operations: [{ op: "wire", flow: "docs", from: 1, into: 2, if: "failed" }] });
    await writeFlowCanvas(root, { positions: { "step:docs/codegraph": [500, 40], "step:docs/atlas": [750, 40] } });
    const cut = await service.call("defineFlows", { operations: [{ op: "detach", flow: "docs", at: 1 }] });
    assert.deepEqual(cut.flows[0].steps, []);
    const canvas = await readFlowCanvas(root);
    assert.deepEqual(canvas.loose.map(({ step, group }) => [step, group]), [
      [{ what: "catalog", id: "catalog" }, "loose:1"],
      [{ what: "report", after: [{ step: "catalog", if: "failed" }] }, "loose:1"]
    ]);
    assert.deepEqual([canvas.positions["loose:2"], canvas.positions["loose:3"]], [[500, 40], [750, 40]]);
    assert.deepEqual((await service.call("atlas")).flows.canvas.loose.length, 2);
    // A dry run keeps nothing.
    await defineFlows(root, { operations: [{ op: "step", flow: "docs", what: "check", id: "gate" }, { op: "step", flow: "docs", what: "view", after: ["gate"] }] });
    const before = readFileSync(path.join(root, ".bca/flow-canvas.json"), "utf8");
    const dry = await defineFlows(root, { operations: [{ op: "detach", flow: "docs", at: 1 }], dryRun: true });
    assert.deepEqual([dry.written, dry.freed[0].steps.map(({ what }) => what)], [false, ["check", "view"]]);
    assert.equal(readFileSync(path.join(root, ".bca/flow-canvas.json"), "utf8"), before);

    const html = renderAppHtml({ mode: "vscode" });
    assert.match(html, /<section id="board" class="float" aria-label="Flow builder" hidden><\/section>/u);
    assert.ok(html.includes('flowApply([{ op: "unstep", flow: node.flow.id, at: node.at }]') && html.includes('flowApply([{ op: "detach"'), "the canvas sends the operations and does not decide itself");
    for (const kind of ["artifact", "trigger", "flow"]) assert.ok(html.includes(`data-drag="${kind}"`), kind);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the canvas of the builder keeps where the nodes are, next to the flows", async () => {
  const root = repository();
  try {
    assert.deepEqual(await readFlowCanvas(root), { positions: {}, loose: [], triggers: [] });
    // Only what a canvas is made of is kept.
    assert.deepEqual(normalizeCanvas({
      positions: { "flow:docs": [260.4, "40"], bad: "here", worse: [1, Number.NaN] },
      loose: [{ key: "loose:1", step: { what: "handbook", language: "de", to: "", nested: { no: 1 } } }, { key: "loose:1", step: { what: "twice" } }, { key: "loose:2" }],
      triggers: ["schedule", "schedule", "nightly"],
      more: true
    }), { positions: { "flow:docs": [260, 40] }, loose: [{ key: "loose:1", step: { what: "handbook", language: "de" } }], triggers: ["schedule"] });

    await defineFlows(root, { operations: [{ op: "set", flow: "docs", when: ["ci"] }, { op: "step", flow: "docs", what: "layers", to: "docs/system" }] });
    const service = createService(new Workspace(root, {}, { live: false }));
    assert.deepEqual((await service.call("atlas")).flows.canvas, { positions: {}, loose: [], triggers: [] });
    const canvas = { positions: { "step:docs/system": [510, 40], "flow:docs": [260, 40] }, loose: [{ key: "loose:1", step: { what: "check" } }], triggers: ["schedule"] };
    assert.deepEqual(await service.call("saveFlowCanvas", canvas), { written: true });
    const file = path.join(root, CANVAS_FILE);
    assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), { positions: { "flow:docs": [260, 40], "step:docs/system": [510, 40] }, loose: canvas.loose, triggers: ["schedule"] });
    // The view reads it with the flows; the flows themselves are only in .bca.json.
    const atlas = await service.call("atlas");
    assert.deepEqual(atlas.flows.canvas.positions["flow:docs"], [260, 40]);
    assert.deepEqual(atlas.flows.flows[0].steps, [{ what: "layers", to: "docs/system" }]);
    assert.ok(!readFileSync(path.join(root, ".bca.json"), "utf8").includes("positions"));
    assert.deepEqual(await service.call("saveFlowCanvas", canvas), { written: false });
    // An empty canvas needs no file.
    assert.deepEqual((await writeFlowCanvas(root, {})).written, true);
    assert.ok(!existsSync(file));

    // What the page wires with.
    const html = renderAppHtml({ mode: "vscode" });
    for (const part of ['data-board-mode="canvas"', 'data-drop="canvas"', 'class="port out"', 'class="port in"', 'data-canvas="remove"', 'data-drag="flow"', "function canvasConnect(", 'call("saveFlowCanvas", canvas)']) assert.ok(html.includes(part), part);
    for (const event of ["pointerdown", "pointermove", "pointerup", "wheel"]) assert.ok(html.includes(`$("#board").addEventListener("${event}"`), event);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the steps of a flow are a graph: names, wires with conditions, and no circle", () => {
  const steps = [
    { id: "gate", what: "check" },
    { id: "pages", what: "layers", after: "gate" },
    { what: "handbook", after: ["pages", { step: "gate", if: "always" }] },
    { what: "check", to: "docs/health.md", after: ["gate:failed"] }
  ];
  const [flow] = flowsConfig({ flows: [{ id: "docs", steps }] });
  assert.deepEqual(flow.steps.map(({ id, after }) => [id, after]), [
    ["gate", []],
    ["pages", [{ step: "gate", if: "passed" }]],
    [undefined, [{ step: "pages", if: "passed" }, { step: "gate", if: "always" }]],
    [undefined, [{ step: "gate", if: "failed" }]]
  ]);
  // Every step after those it waits for, else as written.
  assert.deepEqual(stepOrder(flowsConfig({ flows: [{ id: "a", steps: [{ what: "handbook", after: "last" }, { id: "last", what: "layers", after: "first" }, { id: "first", what: "check" }] }] })[0].steps), [2, 1, 0]);

  const invalid = (list, pattern) => assert.throws(() => flowsConfig({ flows: [{ id: "a", steps: list }] }), pattern);
  invalid([{ what: "check", after: "gate" }], /comes after "gate", which is not a step of this flow/u);
  invalid([{ id: "gate", what: "check" }, { id: "gate", what: "layers" }], /two steps "gate"/u);
  invalid([{ id: "Gate", what: "check" }], /has the id "Gate"/u);
  invalid([{ id: "gate", what: "check", after: "gate" }], /comes after itself/u);
  invalid([{ id: "gate", what: "check" }, { what: "layers", after: "gate:sometimes" }], /if "sometimes"; use passed, failed, always/u);
  invalid([{ id: "gate", what: "check" }, { what: "layers", after: ["gate", "gate:failed"] }], /comes after "gate" twice/u);
  invalid([{ id: "a", what: "check", after: "c" }, { id: "b", what: "layers", after: "a" }, { id: "c", what: "handbook", after: "b" }], /wait for each other in a circle: a > c > b > a/u);

  // Wires by position: the step that is waited for gets a name.
  let config = applyFlowOperations({}, [
    { op: "set", flow: "docs" },
    { op: "step", flow: "docs", what: "check" },
    { op: "step", flow: "docs", what: "layers", to: "docs/system" },
    { op: "step", flow: "docs", what: "check", to: "docs/health.md" },
    { op: "wire", flow: "docs", from: 1, into: 2 },
    { op: "wire", flow: "docs", from: 1, into: 3, if: "failed" },
    { op: "wire", flow: "docs", from: 2, into: 3, if: "always" }
  ]);
  assert.deepEqual(config.flows[0].steps, [
    { what: "check", id: "check" },
    { what: "layers", to: "docs/system", after: ["check"], id: "layers" },
    { what: "check", to: "docs/health.md", after: [{ step: "check", if: "failed" }, { step: "layers", if: "always" }] }
  ]);
  // A wire that is there changes its condition; a rename is followed by those that wait.
  config = applyFlowOperations(config, [{ op: "wire", flow: "docs", from: 1, into: 3 }, { op: "step", flow: "docs", at: 1, id: "gate" }]);
  assert.deepEqual(config.flows[0].steps.map(({ after }) => after), [undefined, ["gate"], [{ step: "layers", if: "always" }, "gate"]]);
  // Another artifact at the same place stays the step it is.
  assert.deepEqual(applyFlowOperations(config, [{ op: "step", flow: "docs", at: 2, what: "report" }]).flows[0].steps[1], { what: "report", id: "layers", after: ["gate"] });
  config = applyFlowOperations(config, [{ op: "unwire", flow: "docs", from: 2, into: 3 }, { op: "step", flow: "docs", at: 2, after: [] }]);
  assert.deepEqual(config.flows[0].steps.map(({ after }) => after), [undefined, undefined, ["gate"]]);
  // A step that goes: the way closes around it. What came after it comes after what it came after, on its condition.
  const chain = applyFlowOperations(config, [{ op: "step", flow: "docs", what: "handbook" }, { op: "wire", flow: "docs", from: 3, into: 4, if: "failed" }]);
  const rerouted = [];
  assert.deepEqual(applyFlowOperations(chain, [{ op: "unstep", flow: "docs", at: 3 }], { rerouted }).flows[0].steps, [
    { what: "check", id: "gate" },
    { what: "layers", to: "docs/system", id: "layers" },
    { what: "handbook", after: [{ step: "gate", if: "failed" }] }
  ]);
  assert.deepEqual(rerouted, [{ flow: "docs", step: "handbook", after: ["gate"] }]);
  // What came after a step that started the flow starts it now, and that is said.
  const open = [];
  assert.deepEqual(applyFlowOperations(config, [{ op: "unstep", flow: "docs", at: 1 }], { rerouted: open }).flows[0].steps, [{ what: "layers", to: "docs/system", id: "layers" }, { what: "check", to: "docs/health.md" }]);
  assert.deepEqual(open, [{ flow: "docs", step: "check", after: [] }]);
  // A wire that goes is something else: the step is in no flow, with what runs only through it, and nothing is lost.
  const cut = [];
  assert.deepEqual(applyFlowOperations(chain, [{ op: "detach", flow: "docs", at: 3 }], { freed: cut }).flows[0].steps.map(({ what }) => what), ["check", "layers"]);
  assert.deepEqual(cut[0].steps.map(({ key, step }) => [key, step.after]), [["step:docs/health.md", undefined], ["step:docs/handbook", [{ step: "check", if: "failed" }]]]);
  // What also waits for a step that stays, stays, and waits for that one.
  const both = applyFlowOperations(config, [{ op: "wire", flow: "docs", from: 2, into: 3, if: "always" }]);
  assert.deepEqual(applyFlowOperations(both, [{ op: "detach", flow: "docs", at: 1 }]).flows[0].steps, [{ what: "layers", to: "docs/system", id: "layers" }, { what: "check", to: "docs/health.md", after: [{ step: "layers", if: "always" }] }]);
  assert.throws(() => applyFlowOperations(config, [{ op: "wire", flow: "docs", from: 3, into: 1 }]), /in a circle/u);
  assert.throws(() => applyFlowOperations(config, [{ op: "wire", flow: "docs", from: 2, into: 2 }]), /cannot come after itself/u);
});

test("bca run runs a step if what it waits for passed, failed, or always, and skips it else", async () => {
  const root = repository();
  try {
    const define = (...args) => bca(["flow", "define", root, "--flow", "docs", ...args]);
    // The example has one error: the gate fails.
    assert.equal(define("--step", "check", "--id", "gate").status, 0);
    assert.equal(define("--step", "view", "--to", "docs/data.svg", "--set", "lens=data", "--id", "picture", "--after", "gate").status, 0);
    assert.equal(define("--step", "view", "--to", "docs/data.md", "--set", "lens=data", "--after", "picture").status, 0);
    assert.equal(define("--step", "check", "--to", "docs/health.md", "--after", "gate:failed").status, 0);
    assert.equal(define("--step", "view", "--to", "docs/events.svg", "--set", "lens=events", "--after", "gate:always,picture:always").status, 0);
    assert.equal(define("--step", "catalog").status, 0);
    assert.match(bca(["flow", root]).stdout, /4\. check {12}-> docs\/health\.md {2}after gate \(if failed\)/u);
    let result = bca(["run", root, "--flow", "docs", "--format", "json"]);
    assert.equal(result.status, 1);
    let run = JSON.parse(result.stdout);
    assert.deepEqual(run.flows[0].steps.map(({ status }) => status), ["failed", "skipped", "skipped", "failed", "passed", "passed"]);
    assert.match(run.flows[0].steps[1].summary, /it comes after gate if that passed, and gate failed/u);
    assert.match(run.flows[0].steps[2].summary, /and picture was skipped/u);
    // Only what ran is delivered.
    assert.deepEqual(run.outputs, ["docs/health.md", "docs/events.svg", "docs/codegraph"]);
    assert.ok(!existsSync(path.join(root, "docs/data.svg")) && existsSync(path.join(root, "docs/health.md")) && existsSync(path.join(root, "docs/events.svg")));
    assert.match(bca(["run", root, "--flow", "docs"]).stdout, /skipped {2}view "picture" -> docs\/data\.svg/u);

    // With a gate that passes, what waits for it runs and what waits for its failure does not.
    assert.equal(define("--at", "1", "--set", "failOn=never").status, 0);
    result = bca(["run", root, "--flow", "docs", "--format", "json"]);
    run = JSON.parse(result.stdout);
    assert.equal(result.status, 0, result.stdout);
    assert.deepEqual(run.flows[0].steps.map(({ status }) => status), ["passed", "passed", "passed", "skipped", "passed", "passed"]);
    assert.ok(existsSync(path.join(root, "docs/data.md")));

    // The lens draws which comes after which, and how.
    const atlas = await createService(new Workspace(root, {}, { live: false })).call("atlas");
    const kinds = new Set(atlas.edges.map(([, , relation]) => atlas.relations[relation].kind));
    for (const kind of ["makes", "then", "if it fails", "in any case"]) assert.ok(kinds.has(kind), kind);
    assert.deepEqual(atlas.flows.flows[0].steps[3].after, [{ step: "gate", if: "failed" }]);
    assert.deepEqual(Object.keys(atlas.flows.conditions), ["passed", "failed", "always"]);

    // A flow written as a list is what it was: every step starts with the flow.
    const html = renderAppHtml({ mode: "vscode" });
    for (const part of ["data-canvas-if", "function canvasDetach(", "function waitsFor(", 'op: "wire"', 'op: "unwire"']) assert.ok(html.includes(part), part);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
