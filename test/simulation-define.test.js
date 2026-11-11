// Defining the simulation (src/simulation/define.js): the company of the
// battle test changed by operations, from the command line, and what the
// graph shows of it: roles, the Simulation lens, and process tests grounded
// on recordings of Business Central.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Workspace } from "../src/app/workspace.js";
import { createCapabilities, findCommand } from "../src/capabilities.js";
import { applyOperations, DEFINE_FIELDS, DEFINE_KINDS, defineSimulation, definitionOf } from "../src/simulation/define.js";
import { simulate } from "../src/simulation/index.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(root, "src", "cli.js");
const purchasing = path.join(root, "examples", "purchasing-app");
const bca = (args, options = {}) => spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", timeout: 180_000, env: { ...process.env, BCA_AL_COMPILER: "off" }, ...options });
const copyOf = (example) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "bc-atlas-define-"));
  cpSync(example, directory, { recursive: true });
  return directory;
};

test("operations change what they name and keep the rest", () => {
  const section = { company: "Contoso", tests: "test", roles: [{ name: "Lead", permissionSets: ["A"], taskGroups: ["Approval"] }], agents: [{ name: "Ben", roles: ["Lead"] }], taskGroups: [{ name: "Approval", tasks: ["approve"] }] };
  const next = applyOperations(section, [
    { op: "set", kind: "agent", name: "Eve", roles: ["Lead"], mustNot: "order, pay" },
    { op: "set", kind: "role", name: "lead", description: "Decides.", permissionSets: ["A", "B", "A"] },
    { op: "set", kind: "requirement", name: "REQ-1", title: "Requests are approved", tasks: ["approve"] },
    { op: "ground", task: "approve", snapshot: "approve-a-request" },
    { op: "company", name: "Contoso GmbH" }
  ]);
  assert.deepEqual(next.agents, [{ name: "Ben", roles: ["Lead"] }, { name: "Eve", roles: ["Lead"], mustNot: ["order", "pay"] }]);
  assert.deepEqual(next.roles, [{ name: "Lead", permissionSets: ["A", "B"], taskGroups: ["Approval"], description: "Decides." }], "found whatever the case, fields not named stay");
  assert.deepEqual(next.requirements, [{ id: "REQ-1", title: "Requests are approved", tasks: ["approve"] }]);
  assert.deepEqual([next.grounding, next.company, next.tests], [{ approve: "approve-a-request" }, "Contoso GmbH", "test"]);
  assert.deepEqual(section.agents, [{ name: "Ben", roles: ["Lead"] }], "the given section is not changed");

  // An empty value takes a field away; what is removed is not pointed to any more.
  const less = applyOperations(next, [
    { op: "set", kind: "agent", name: "Eve", mustNot: [] },
    { op: "remove", kind: "taskGroup", name: "Approval" },
    { op: "remove", kind: "role", name: "Lead" },
    { op: "unground", task: "APPROVE" }
  ]);
  assert.deepEqual(less.agents, [{ name: "Ben" }, { name: "Eve" }]);
  assert.deepEqual([less.roles, less.taskGroups, less.grounding], [undefined, undefined, undefined]);

  assert.throws(() => applyOperations({}, [{ op: "set", kind: "team", name: "x" }]), /"team" is not something to define; use agent, role, taskGroup, requirement/u);
  assert.throws(() => applyOperations({}, [{ op: "set", kind: "agent", name: " " }]), /set agent needs a name/u);
  assert.throws(() => applyOperations({}, [{ op: "set", kind: "agent", name: "x", title: "y" }]), /agent has no "title"; it has roles, permissionSets, taskGroups, tasks, mustNot/u);
  assert.throws(() => applyOperations({}, [{ op: "set", kind: "requirement", name: "REQ-9" }]), /requirement "REQ-9" needs a title/u);
  assert.throws(() => applyOperations({}, [{ op: "remove", kind: "agent", name: "x" }]), /there is no agent "x" to remove/u);
  assert.throws(() => applyOperations({}, [{ op: "ground", task: "x" }]), /ground needs the recording as "snapshot"/u);
  assert.throws(() => applyOperations({}, [{ op: "rename" }]), /unknown operation "rename"/u);
  assert.deepEqual(DEFINE_KINDS, Object.keys(DEFINE_FIELDS));
});

test("a definition starts from what the process tests say, runs before it is written, and is written whole", async () => {
  const directory = copyOf(path.join(root, "examples", "warehouse-app"));
  try {
    // Nothing is defined: the process tests describe the company.
    const shown = await defineSimulation(directory, { compiler: "off" });
    assert.deepEqual([shown.derived, shown.written, shown.definition.roles.map(({ name }) => name)], [true, false, ["WAREHOUSE PROCESS"]]);
    assert.deepEqual(shown.definition, definitionOf(await simulate(directory, { compiler: "off" })));

    // The first change keeps that company and adds to it.
    const tried = await defineSimulation(directory, { compiler: "off", dryRun: true, operations: [{ op: "set", kind: "agent", name: "Walter", roles: ["WAREHOUSE PROCESS"] }] });
    assert.deepEqual([tried.started, tried.changed, tried.written], [true, true, false]);
    assert.ok(!existsSync(path.join(directory, ".bca.json")), "a dry run writes nothing");
    const written = await defineSimulation(directory, { compiler: "off", operations: [{ op: "set", kind: "agent", name: "Walter", roles: ["WAREHOUSE PROCESS"] }] });
    assert.equal(written.written, true);
    const config = JSON.parse(readFileSync(path.join(directory, ".bca.json"), "utf8"));
    assert.deepEqual(config.simulation.roles.map(({ name }) => name), ["WAREHOUSE PROCESS"], "the company of the tests is written with the change");
    assert.ok(config.simulation.agents.some(({ name }) => name === "Walter"));
    assert.ok(written.report.agents.some(({ name }) => name === "Walter"), "the changed simulation ran");
    assert.equal((await defineSimulation(directory, { compiler: "off" })).derived, false);

    // What is not valid never reaches the file.
    const before = readFileSync(path.join(directory, ".bca.json"), "utf8");
    await assert.rejects(defineSimulation(directory, { compiler: "off", operations: [{ op: "set", kind: "agent", name: "Walter", roles: ["A", "B"] }, { op: "remove", kind: "role", name: "Nobody" }] }), /there is no role "Nobody" to remove/u);
    assert.equal(readFileSync(path.join(directory, ".bca.json"), "utf8"), before);
    // A name that does not exist is a finding of the run, as in bca simulate.
    const unknown = await defineSimulation(directory, { compiler: "off", dryRun: true, operations: [{ op: "set", kind: "agent", name: "Xena", roles: ["Nobody"] }] });
    assert.ok(unknown.report.findings.some(({ code }) => code === "unknown-role"));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("bca simulate define shows, changes, and runs the simulation", () => {
  const command = findCommand(createCapabilities("0.0.0"), "simulate.define");
  for (const option of ["agent", "role", "taskGroup", "requirement", "roles", "permissionSets", "taskGroups", "tasks", "features", "mustNot", "objects", "title", "description", "remove", "ground", "unground", "companyName", "init", "from", "dryRun", "format"]) assert.ok(command.options[option], option);
  const directory = copyOf(purchasing);
  try {
    const run = (...args) => bca(["simulate", "define", ".", ...args], { cwd: directory });
    const shown = run();
    assert.equal(shown.status, 0, shown.stderr);
    assert.match(shown.stdout, /^Contoso GmbH\n\nAgents\n {2}Anna; roles: Employee\n {2}Ben; roles: Team lead\n/u);
    assert.match(shown.stdout, /\n {2}Team lead; permission sets: PR - REQUEST, PR - APPROVE; task groups: Requesting, Approval; must not: Ordering\n/u);
    assert.match(shown.stderr, /FAILED - 6 completed, 1 blocked; 4 denied as expected, 1 possible/u);
    assert.match(shown.stderr, /error task-blocked: Ben \(Team lead\) cannot complete "Approve a released purchase request"/u);

    // The fix of the example: the administrator must not approve, so the role loses the set that lets it.
    const fixed = JSON.parse(run("--role", "Administrator", "--permission-sets", "PR - SETUP", "--format", "json").stdout);
    assert.deepEqual([fixed.written, fixed.file, fixed.derived], [true, ".bca.json", false]);
    assert.deepEqual(fixed.definition.roles.find(({ name }) => name === "Administrator").permissionSets, ["PR - SETUP"]);
    assert.ok(!fixed.result.findings.some(({ code }) => code === "forbidden-task-possible"), "the simulation ran with the change");
    assert.equal(fixed.definition.roles.find(({ name }) => name === "Administrator").taskGroups[0], "Administration", "what the change does not name stays");

    const added = run("--agent", "Eve", "--roles", "Purchaser", "--must-not", "Approval", "--dry-run");
    assert.match(added.stdout, /\n {2}Eve; roles: Purchaser; must not: Approval\n/u);
    assert.match(added.stderr, /Dry run: nothing written\./u);
    assert.doesNotMatch(run().stdout, /Eve/u);

    // Several changes at once, as the Simulate menu of the view saves them.
    writeFileSync(path.join(directory, "changes.json"), JSON.stringify({ operations: [
      { op: "set", kind: "requirement", name: "REQ-7", title: "Orders come from approved requests", tasks: ["purchase-request-order"] },
      { op: "ground", task: "purchase-request-approve", snapshot: "approve-a-released-purchase-request" },
      { op: "remove", kind: "agent", name: "Carla" }
    ] }));
    const several = run("--from", "changes.json", "--remove", "requirement:REQ-6", "--company-name", "Contoso AG");
    assert.equal(several.status, 0, several.stderr);
    assert.match(several.stdout, /^Contoso AG\n/u);
    assert.match(several.stdout, /\n {2}REQ-7: Orders come from approved requests; process tests: purchase-request-order\n\nGrounded on recordings\n {2}purchase-request-approve on approve-a-released-purchase-request\n/u);
    assert.doesNotMatch(several.stdout, /Carla|REQ-6/u);
    assert.match(several.stderr, /Wrote \.bca\.json/u);

    assert.equal(run("--agent", "A", "--role", "B").status, 2);
    assert.match(run("--agent", "A", "--title", "x").stderr, /an agent has no --title/u);
    assert.match(run("--remove", "Anna").stderr, /--remove needs kind:name/u);
    assert.match(run("--ground", "purchase-request-approve").stderr, /--ground needs <process test>=<recording>/u);
    assert.match(run("--remove", "role:Nobody").stderr, /there is no role "Nobody" to remove/u);
    // bca simulate itself is unchanged: a path is still a path.
    assert.equal(bca(["simulate", ".", "--format", "json"], { cwd: directory }).status, 1);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("the graph shows the simulation: roles, a lens, and process tests grounded on recordings", async () => {
  const atlas = await new Workspace(purchasing, {}, { live: false }).atlas();
  const index = (label, kind) => atlas.nodes.findIndex((node) => node.label === label && node.kind === kind);
  const related = (from, to) => atlas.edges.filter(([a, b]) => a === from && b === to).map(([, , relation]) => atlas.relations[relation].kind);
  const lens = atlas.lenses.find(({ id }) => id === "simulation");
  assert.deepEqual(lens.relations, ["has role", "does", "forbids", "blocked", "can, but must not", "proven by", "grounds"]);
  const role = index("Team lead", "role");
  const approve = index("Approve a released purchase request", "task");
  assert.deepEqual(related(index("Ben (Team lead)", "person"), role), ["has role"]);
  assert.deepEqual(related(role, approve), ["does"]);
  assert.deepEqual(related(role, index("Order what an approved purchase request asks for", "task")), ["forbids"]);
  assert.deepEqual(related(role, atlas.nodes.findIndex((node) => node.label === "PR - APPROVE")), ["grants"]);
  // A recording with the title of a process test is the ground it stands on.
  assert.deepEqual(related(index("Approve a released purchase request", "recording"), approve), ["grounds"]);
  assert.equal(atlas.nodes[approve].grounded, "Approve a released purchase request");
  assert.equal(atlas.nodes[index("Set the highest amount that can be approved", "task")].grounded, "no");
  assert.ok(!atlas.findings.some(({ rule }) => rule.startsWith("grounding-")), "the test and the recording agree");
  // What the Simulate menu needs: the definition, and what a definition can name.
  assert.deepEqual([atlas.simulation.derived, atlas.simulation.definition.company, atlas.simulation.definition.agents.length], [false, "Contoso GmbH", 4]);
  assert.deepEqual(atlas.simulation.tasks.map(({ id }) => id).slice(0, 2), ["purchase-request-create", "purchase-request-release"]);
  assert.ok(atlas.simulation.permissionSets.includes("PR - APPROVE"));
  assert.deepEqual(atlas.simulation.recordings.map(({ id }) => id), ["approve-a-released-purchase-request", "create-a-new-purchase-request"]);

  const directory = copyOf(purchasing);
  try {
    // The recording went through one object less than the test touches, and the definition names a recording that is not there.
    const file = path.join(directory, "recordings", "create-a-new-purchase-request.json");
    const snapshot = JSON.parse(readFileSync(file, "utf8"));
    const text = JSON.stringify(snapshot).replaceAll("Purchase Request Setup", "Purchase Request").replaceAll("50201", "50200");
    writeFileSync(file, JSON.stringify(JSON.parse(text), null, 2));
    await defineSimulation(directory, { compiler: "off", operations: [
      { op: "ground", task: "purchase-request-release", snapshot: "release-a-request" },
      { op: "ground", task: "purchase-request-order", snapshot: "approve-a-released-purchase-request" }
    ] });
    const changed = await new Workspace(directory, {}, { live: false }).atlas();
    const missing = changed.findings.find(({ rule }) => rule === "grounding-missing");
    assert.match(missing.message, /^The process test "Release a purchase request so that it can be approved" is grounded on the recording "release-a-request", which is not among the recordings of the project\.$/u);
    assert.equal(missing.severity, "warning");
    // A test grounded on the recording of another process: the two differ, and the finding says how.
    const differs = changed.findings.find(({ rule, message }) => rule === "grounding-differs" && message.includes("Order what an approved purchase request asks for"));
    assert.equal(differs.severity, "info");
    assert.match(differs.message, /what ran in Business Central went through .+, which the test does not touch/u);
    const order = changed.nodes.findIndex((node) => node.kind === "task" && node.label === "Order what an approved purchase request asks for");
    assert.ok(differs.nodes.includes(order));
    assert.equal(changed.nodes[order].grounded, "Approve a released purchase request");
    assert.deepEqual(changed.simulation.definition.grounding, { "purchase-request-release": "release-a-request", "purchase-request-order": "approve-a-released-purchase-request" });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
