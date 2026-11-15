import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createService } from "../src/app/service.js";
import { Workspace } from "../src/app/workspace.js";
import { createCapabilities, findCommand } from "../src/capabilities.js";
import { ARTIFACTS, applyFlowOperations, artifactCatalog, defineFlows, flowId, flowOutputs, flowsConfig, flowsFor } from "../src/flows/index.js";

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
