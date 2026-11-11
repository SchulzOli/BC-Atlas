import test from "node:test";
import assert from "node:assert/strict";
import { fork, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";

import { renderAppHtml } from "../src/app/page.js";
import { createService } from "../src/app/service.js";
import { Workspace } from "../src/app/workspace.js";
import { openParseCache, parseCacheFile } from "../src/parse-cache.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(root, "src", "cli.js");
const workspace = path.join(root, "examples", "multi-app");

function copyWorkspace({ architecture = true } = {}) {
  const directory = mkdtempSync(path.join(os.tmpdir(), "bc-atlas-app-"));
  cpSync(workspace, directory, { recursive: true });
  if (!architecture) rmSync(path.join(directory, ".bca.json"));
  return directory;
}

function deepFreeze(value, seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) deepFreeze(value[key], seen);
  return Object.freeze(value);
}

// The view shares the one resolved model instead of copying it; a write to
// it would throw here (modules are strict).
test("the atlas only reads the shared model", async () => {
  for (const architecture of [true, false]) {
    const directory = copyWorkspace({ architecture });
    try {
      const shared = new Workspace(directory);
      deepFreeze((await shared.model()).model);
      await shared.overview();
      await shared.architecture();
      await shared.architecture({ propose: true });
      const atlas = await shared.atlas();
      const object = atlas.nodes.find(({ kind, external }) => kind === "object" && !external);
      assert.ok((await shared.inside(object.id)).nodes.length >= 0);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }
});

test("the service answers the view and the editor from one analysis", async () => {
  const service = createService(new Workspace(workspace));
  const overview = await service.call("overview");
  assert.equal(overview.title, "multi-app");
  assert.equal(overview.projectRoot, workspace);
  assert.equal(overview.summary.objects, 12);
  assert.equal(overview.architecture.mode, "configured");
  assert.equal(overview.architecture.violations, 1);
  assert.equal(overview.health.passed, false);
  assert.match(overview.sources[0][1], /5 files with 12 objects/u, "what everything is read from");

  const health = await service.call("health");
  const violation = health.findings.find(({ rule }) => rule === "architecture-violation");
  assert.ok(violation.object, "findings link to the object at their location");

  const objects = await service.call("objects");
  assert.equal(objects.length, 12);
  const sync = objects.find(({ label }) => label === "CON Item Sync");
  assert.equal(sync.component, "Integration");
  assert.equal(sync.violations, 1);
  assert.equal(violation.object, sync.id);

  const detail = await service.call("object", { id: sync.id });
  assert.deepEqual(detail.uses.map(({ label }) => label), ["CON Item"]);
  assert.equal(detail.violations[0].resolution.strategy, "declare-dependency");
  assert.match(detail.source.file, /ItemSync\.al$/u);
  assert.ok(detail.members.procedures.length > 0);
  await assert.rejects(service.call("object", { id: "nope" }), /object not found/u);

  const configured = await service.call("architecture");
  assert.equal(configured.mode, "configured");
  assert.equal(configured.violationCount, 1);
  const proposal = await service.call("architecture", { propose: 1, groupBy: "app" });
  assert.equal(proposal.mode, "proposal");
  assert.equal(proposal.proposal.groupBy, "app");
  await assert.rejects(service.call("architecture", { groupBy: "nope" }), /groupBy must be one of/u);
  // Where dependencies should be (rules) and where they are (object links), top layer first.
  assert.deepEqual(configured.matrix.order, ["Integration", "Sales", "Core"]);
  assert.equal(configured.matrix.cells[2][0].allowed, false, "Core may not use Integration");
  assert.deepEqual((await service.call("lenses")).slice(0, 2), [
    { id: "system", title: "System", summary: "Every object and every relation between them." },
    { id: "components", title: "Components", summary: "The components in their layers and the dependencies between them, allowed or the wrong way." }
  ]);
  await assert.rejects(service.call("deleteEverything"), /unknown method/u);
});

test("the atlas is everything read from the source as one graph", async () => {
  const service = createService(new Workspace(workspace));
  const atlas = await service.call("atlas");
  assert.equal(atlas.title, "multi-app");
  assert.deepEqual({ objects: atlas.summary.objects, apps: atlas.summary.apps, passed: atlas.summary.health.passed }, { objects: 12, apps: 3, passed: false });
  assert.deepEqual(atlas.sources.map(([term]) => term), ["AL source", "app.json", "Symbol packages", "AL compiler", "Settings"]);

  // Nodes of every kind there is, each with a name and a color.
  const count = (kind) => atlas.nodes.filter((node) => node.kind === kind && !node.external).length;
  assert.deepEqual({ object: count("object"), app: count("app"), component: count("component"), module: count("module") }, { object: 12, app: 3, component: 3, module: 4 });
  assert.ok(atlas.nodes.some(({ kind }) => kind === "rule"), "the rules of the health check are nodes");
  assert.equal(new Set(atlas.nodes.map(({ id }) => id)).size, atlas.nodes.length, "every node once");
  assert.ok(atlas.nodes.every(({ label, kind, color }) => label && kind && /^#[0-9a-f]{6}$/iu.test(color)));
  assert.ok(atlas.nodes.some(({ external, label }) => external && label === "Customer"), "what the workspace refers to in other apps is there, marked");

  // Relations point at nodes and at their kind; every kind has a color.
  assert.ok(atlas.edges.every(([from, to, relation, weight]) => atlas.nodes[from] && atlas.nodes[to] && from !== to && atlas.relations[relation] && weight > 0));
  assert.ok(atlas.relations.every(({ kind, color }) => kind && /^#[0-9a-f]{6}$/iu.test(color)));
  const related = (from, to) => atlas.edges.filter(([a, b]) => atlas.nodes[a].label === from && atlas.nodes[b].label === to).map(([, , relation]) => atlas.relations[relation].kind).sort();
  assert.deepEqual(related("CON Item Sync", "CON Item"), ["reads", "uses", "writes"], "one relation per kind, not one line for all");
  assert.deepEqual(related("Integration", "Core"), ["wrong way"]);
  assert.deepEqual(related("Sales", "Core"), ["depends on"]);

  // An object carries what the view says about it.
  const sync = atlas.nodes.find(({ label }) => label === "CON Item Sync");
  assert.deepEqual(
    { type: sync.type, component: sync.component, app: sync.app, namespace: sync.namespace, level: sync.level, canBe: sync.canBe, wrongWay: sync.wrongWay, file: sync.file, line: sync.line },
    { type: "codeunit", component: "Integration", app: "Contoso Integration", namespace: "Contoso.Integration", level: "public", canBe: "internal", wrongWay: 1, file: "integration/ItemSync.al", line: 6 }
  );

  // Lenses: parts of the one graph. One without anything in it is left out.
  assert.deepEqual(atlas.lenses.map(({ id }) => id), ["system", "components", "apps", "modules", "data", "calls", "events", "contracts", "pages", "security", "visibility", "health"]);
  const kinds = new Set(atlas.relations.map(({ kind }) => kind));
  for (const lens of atlas.lenses) {
    assert.ok(lens.title && lens.summary && lens.reads, `${lens.id} says what it shows and what it reads`);
    assert.ok(lens.relations.length > 0 && lens.relations.every((kind) => kinds.has(kind)), `${lens.id} names relations that exist`);
    assert.ok(lens.kinds.some((kind) => atlas.nodes.some((node) => node.kind === kind)), `${lens.id} has nodes`);
  }
  assert.ok(atlas.lenses.find(({ id }) => id === "system").relations.includes("source"), "every relation between objects, also a page's source table");

  // Findings point at the nodes they are about: the rule and the object.
  const violation = atlas.findings.find(({ rule }) => rule === "architecture-violation");
  assert.deepEqual(violation.nodes.map((index) => atlas.nodes[index].label), ["architecture-violation", "CON Item Sync"]);
  assert.equal(violation.severity, "error");
  assert.equal(atlas.nodes[violation.nodes[0]].severity, "error", "a rule is as severe as its worst finding");
  assert.ok(atlas.findings.every(({ nodes }) => nodes.every((index) => atlas.nodes[index])));

  // Stories: walks through the graph, generated from the same source.
  assert.deepEqual(atlas.stories.map(({ id }) => id), ["system", "fix", "architecture"]);
  const lenses = new Set(atlas.lenses.map(({ id }) => id));
  for (const story of atlas.stories) {
    assert.ok(story.title && story.summary && story.steps.length > 0);
    assert.ok(story.steps.every(({ title, text, lens, nodes }) => title && text && lenses.has(lens) && nodes.every((index) => atlas.nodes[index])), `${story.id}: every step has a text, a lens, and nodes that exist`);
  }
  const [first] = atlas.stories[0].steps;
  assert.match(first.text, /^12 objects in 3 apps: 5 codeunits, 3 tables, 2 pages, 1 interface, 1 permissionset\./u);
  const wrongWay = atlas.stories.find(({ id }) => id === "architecture").steps[0];
  assert.match(wrongWay.text, /CON Item Sync \(Integration\) depends on CON Item in Core\. Add Core to dependsOn of Integration/u);
  assert.deepEqual(wrongWay.nodes.map((index) => atlas.nodes[index].label), ["CON Item Sync", "CON Item"]);

  // One object from the inside: its procedures, and what each does with other objects.
  const inside = await service.call("inside", { id: sync.id });
  assert.deepEqual(inside.nodes.map(({ label, type, kind, parent }) => ({ label, type, kind, parent })), [{ label: "Sync(Code[20])", type: "procedure", kind: "member", parent: sync.id }]);
  const item = atlas.nodes.find(({ label, type }) => label === "CON Item" && type === "table");
  const does = inside.edges.filter(([from, to]) => from === inside.nodes[0].id && to === item.id).map(([, , relation]) => inside.relations[relation].kind).sort();
  assert.deepEqual(does, ["reads", "writes"], "the procedure reads and writes the table");
  await assert.rejects(service.call("inside", { id: "nope" }), /object not found/u);
});

test("process tests are nodes, lenses, findings, and stories of the same graph", async () => {
  const service = createService(new Workspace(path.join(root, "examples", "purchasing-app"), {}, { live: false }));
  const atlas = await service.call("atlas");
  const count = (kind) => atlas.nodes.filter((node) => node.kind === kind).length;
  assert.deepEqual({ process: count("process"), task: count("task"), person: count("person"), requirement: count("requirement") }, { process: 2, task: 5, person: 4, requirement: 6 });
  // After the lenses of BC Atlas come those of plugins: here the recordings of the sync plugin.
  assert.deepEqual(atlas.lenses.map(({ id }) => id).slice(-6), ["processes", "people", "requirements", "simulation", "run", "sync"]);
  assert.equal(atlas.summary.battle.company, "Contoso GmbH");

  const index = (label) => atlas.nodes.findIndex((node) => node.label === label);
  const related = (from, to) => atlas.edges.filter(([a, b]) => a === index(from) && b === index(to)).map(([, , relation]) => atlas.relations[relation].kind);
  // A process test touches the objects its steps need; people perform it, or are blocked.
  assert.deepEqual(related("Create a new Purchase Request", "Purchase Requests"), ["touches"]);
  assert.deepEqual(related("Purchase requests", "Create a new Purchase Request"), ["step"]);
  assert.deepEqual(related("Create a new Purchase Request", "Release a purchase request so that it can be approved"), ["next"]);
  assert.deepEqual(related("Anna (Employee)", "Create a new Purchase Request"), ["performs"]);
  assert.deepEqual(related("Anna (Employee)", "Approve a released purchase request"), ["must not"]);
  assert.deepEqual(related("Ben (Team lead)", "Approve a released purchase request"), ["blocked"]);
  assert.deepEqual(related("Anna (Employee)", "PR - REQUEST"), ["holds"]);
  assert.equal(atlas.nodes[index("Approve a released purchase request")].status, "blocked");

  // What blocks someone is a finding on that person and that process test.
  const blocked = atlas.findings.find(({ rule }) => rule === "task-blocked");
  assert.deepEqual(blocked.nodes.map((node) => atlas.nodes[node].label), ["Ben (Team lead)", "Approve a released purchase request"]);
  assert.match(blocked.fix, /codeunit "Request Notifications" = X/u);

  // A process is a story: its tests in order, step by step, each on the objects it touches.
  const story = atlas.stories.find(({ id }) => id === "process:use-case-purchase-requests");
  assert.equal(story.kind, "process");
  assert.equal(story.steps[0].title, "Create a new Purchase Request");
  const step = story.steps[1];
  assert.equal(step.title, "Create a new Purchase Request · step 1");
  assert.match(step.text, /^Choose the .+ icon, enter Purchase Requests.+Needs: execute on page 50210 Purchase Requests \(the user opens the page\)/u);
  assert.deepEqual(step.nodes.map((node) => atlas.nodes[node].label), ["Create a new Purchase Request", "Purchase Requests", "Purchase Request"]);
  assert.ok(story.steps.every(({ lens }) => lens === "processes"));
  const people = atlas.stories.find(({ id }) => id === "people");
  assert.match(people.steps.find(({ title }) => title === "Ben (Team lead)").text, /Blocked: Approve a released purchase request \(/u);

  // Without process tests there are no such nodes, lenses, or stories.
  const plain = await createService(new Workspace(workspace)).call("atlas");
  assert.ok(!plain.nodes.some(({ kind }) => ["process", "task", "person", "requirement"].includes(kind)));
  assert.ok(!plain.lenses.some(({ id }) => ["processes", "people", "requirements", "run"].includes(id)));
  assert.ok(!plain.stories.some(({ kind }) => kind === "run"));
});

test("a run of the simulation goes step by step and builds its picture as it goes", async () => {
  const service = createService(new Workspace(path.join(root, "examples", "purchasing-app"), {}, { live: false }));
  const atlas = await service.call("atlas");
  const labels = (nodes) => nodes.map((node) => atlas.nodes[node].label);
  // One run per person with process tests to do.
  const runs = atlas.stories.filter(({ kind }) => kind === "run");
  assert.deepEqual(runs.map(({ id, title, build }) => [id, title, build]), [["run:Anna", "Anna at work", true], ["run:Ben", "Ben at work", true], ["run:Carla", "Carla at work", true], ["run:Dana", "Dana at work", true]]);
  const ben = runs[1];
  assert.ok(ben.steps.every(({ lens }) => lens === "run"));
  // It starts at the person, then every step of every assigned test in order, on the objects that step needs.
  assert.deepEqual(labels(ben.steps[0].nodes), ["Ben (Team lead)"]);
  assert.match(ben.steps[0].text, /^Ben has the role Team lead, with the permission sets PR - REQUEST, PR - APPROVE, and is assigned 3 process tests: /u);
  assert.equal(ben.steps[1].title, "Create a new Purchase Request · step 1");
  assert.deepEqual(labels(ben.steps[1].nodes), ["Ben (Team lead)", "Create a new Purchase Request", "Purchase Requests", "Purchase Request"]);
  assert.match(ben.steps[1].text, /Ben can do this\.$/u);
  // Where the person is stopped, the step says what is missing and what to add; what follows is not reached.
  const stopped = ben.steps.findIndex(({ status }) => status === "blocked");
  assert.equal(ben.steps[stopped].title, "Approve a released purchase request · step 3");
  assert.match(ben.steps[stopped].text, /Ben is stopped here: execute on codeunit 50222 Request Notifications is missing .+ Add to a permission set: `codeunit "Request Notifications" = X`\.$/u);
  assert.deepEqual(ben.steps.slice(1, -1).map(({ status }) => status).slice(stopped - 1), ["blocked", "waiting"]);
  assert.match(ben.steps[stopped + 1].text, /Not reached: Ben was stopped at step 3\.$/u);
  // The end is the whole picture the run built.
  const end = ben.steps.at(-1);
  assert.deepEqual([end.title, end.status], ["Ben: 2 of 3 done", "blocked"]);
  assert.deepEqual([...end.nodes].sort((a, b) => a - b), [...new Set(ben.steps.slice(0, -1).flatMap(({ nodes }) => nodes))].sort((a, b) => a - b));
  assert.equal(runs[0].steps.at(-1).status, "done");
});

test("the view builds the bundle next to the project", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "bc-atlas-app-bundle-"));
  try {
    cpSync(path.join(root, "examples", "purchasing-app"), directory, { recursive: true });
    const service = createService(new Workspace(directory, { compiler: "off" }, { live: false }));
    const result = await service.call("bundle");
    assert.equal(result.folder, "bc-atlas-bundle");
    assert.equal(result.passed, false, "someone is stopped in the example");
    assert.deepEqual(result.steps.map(({ id }) => id), ["check", "simulate", "snapshots", "runs", "docs", "narrative", "tests", "build"]);
    for (const file of ["bc-atlas-bundle/README.md", "bc-atlas-bundle/docs/stories/run-ben.md", "bc-atlas-bundle.zip"]) assert.ok(existsSync(path.join(directory, file)), file);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("adopting an architecture writes .bca.json and the baseline", async () => {
  const directory = copyWorkspace({ architecture: false });
  try {
    const service = createService(new Workspace(directory));
    assert.equal((await service.call("overview")).architecture.mode, "proposal");
    await service.call("adoptArchitecture", { groupBy: "app" });
    const saved = JSON.parse(readFileSync(path.join(directory, ".bca.json"), "utf8")).architecture;
    assert.deepEqual(saved.components.map(({ name }) => name), ["Contoso Core", "Contoso Sales", "Contoso Integration"]);
    assert.ok(existsSync(path.join(directory, ".bca-architecture-baseline.json")));
    // The next request analyzes again and sees the configured architecture.
    assert.equal((await service.call("overview")).architecture.mode, "configured");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("the workspace keeps parse results on disk and parses only changed files again", async () => {
  const directory = copyWorkspace();
  const cacheDirectory = mkdtempSync(path.join(os.tmpdir(), "bc-atlas-parse-cache-"));
  const previous = process.env.BCA_CACHE_DIR;
  process.env.BCA_CACHE_DIR = cacheDirectory;
  try {
    const first = new Workspace(directory);
    const objects = (await first.overview()).summary.objects;
    assert.equal(await first.saving, true);
    assert.ok(existsSync(parseCacheFile(directory)));

    // The next editor session reads every file's objects from disk.
    const second = new Workspace(directory);
    assert.equal((await second.parseCache()).size, 5);
    assert.equal((await second.overview()).summary.objects, objects);
    assert.equal(await second.saving, false, "nothing was parsed, so nothing is written");

    // A changed file is parsed again; its old entry is dropped.
    const file = path.join(directory, "sales", "Quotes.al");
    writeFileSync(file, `${readFileSync(file, "utf8")}\n// changed\n`);
    second.reset();
    await second.overview();
    assert.equal(await second.saving, true);
    assert.equal((await openParseCache(directory)).size, 5);

    // A damaged file starts over instead of failing.
    writeFileSync(parseCacheFile(directory), "not a cache");
    assert.equal((await openParseCache(directory)).size, 0);
    assert.equal((await new Workspace(directory).overview()).summary.objects, objects);
  } finally {
    if (previous === undefined) delete process.env.BCA_CACHE_DIR;
    else process.env.BCA_CACHE_DIR = previous;
    rmSync(directory, { recursive: true, force: true });
    rmSync(cacheDirectory, { recursive: true, force: true });
  }
});

test("the worker process answers requests over IPC, for editors", async () => {
  const child = fork(path.join(root, "src", "app", "worker.js"), [workspace, "{}"], { stdio: ["ignore", "ignore", "inherit", "ipc"] });
  const replies = new Map();
  const ready = new Promise((resolve) => child.once("message", resolve));
  child.on("message", (message) => replies.get(message.id)?.(message));
  const request = (id, method, params) => new Promise((resolve) => {
    replies.set(id, resolve);
    child.send({ id, method, params });
  });
  try {
    assert.ok((await ready).methods.includes("overview"));
    assert.equal((await request(1, "overview")).result.summary.objects, 12);
    assert.match((await request(2, "object", { id: "nope" })).error, /object not found/u);
  } finally {
    child.disconnect();
  }
});

test("in VS Code the view talks to the extension and carries its Content-Security-Policy", () => {
  const html = renderAppHtml({ mode: "vscode", csp: "default-src 'none'" });
  assert.match(html, /window\.BCA_APP = \{"mode":"vscode"/u);
  assert.match(html, /<meta http-equiv="Content-Security-Policy" content="default-src 'none'">/u);
  assert.match(html, /acquireVsCodeApi\(\)/u);
  assert.throws(() => renderAppHtml({ mode: "live" }), /unknown page mode/u);
});

test("in VS Code the view inherits the editor's color theme", () => {
  const html = renderAppHtml({ mode: "vscode", csp: "default-src 'none'" });
  assert.match(html, /<html lang="en" data-host="vscode">/u);
  for (const [token, variable] of [
    ["--bg", "--vscode-editor-background"], ["--text", "--vscode-foreground"], ["--accent", "--vscode-button-background"],
    ["--border", "--vscode-panel-border"], ["--font", "--vscode-font-family"], ["--mono", "--vscode-editor-font-family"],
    ["--selected", "--vscode-list-activeSelectionBackground"], ["--error", "--vscode-editorError-foreground"]
  ]) {
    assert.match(html, new RegExp(`${token}: var\\(${variable}`, "u"), `${token} follows ${variable}`);
  }
  assert.match(html, /body\.vscode-high-contrast[\s\S]*--accent: var\(--vscode-focusBorder/u, "high contrast themes use their contrast colors");
  assert.match(html, /:root\[data-host="vscode"\] \{ --canvas: var\(--bg\); \}/u, "the graph stands on the editor's background");

  const exported = renderAppHtml({ mode: "static", snapshot: {} });
  assert.match(exported, /<html lang="en">/u, "an exported file keeps the BC Atlas design");
});

test("recordings of Business Central are nodes, a lens, findings, and a story of the same graph", async () => {
  const example = path.join(root, "examples", "purchasing-app");
  const atlas = await createService(new Workspace(example, {}, { live: false })).call("atlas");
  const labels = (kind) => atlas.nodes.filter((node) => node.kind === kind).map(({ label, status }) => `${label} (${status})`);
  assert.deepEqual(labels("channel"), ["processes (in sync)"]);
  assert.deepEqual(labels("recording"), ["Approve a released purchase request (in sync)", "Create a new Purchase Request (in sync)"]);
  const lens = atlas.lenses.find(({ id }) => id === "sync");
  assert.deepEqual([lens.title, lens.plugin, lens.color], ["Recordings", "sync", "status"]);
  const index = (label, kind) => atlas.nodes.findIndex((node) => node.label === label && node.kind === kind);
  const related = (from, to) => atlas.edges.filter(([a, b]) => a === from && b === to).map(([, , relation]) => atlas.relations[relation].kind);
  const approve = index("Approve a released purchase request", "recording");
  // What was recorded runs through objects of the source: the same nodes every other lens shows.
  assert.deepEqual(related(index("processes", "channel"), approve), ["syncs"]);
  assert.deepEqual(related(approve, atlas.nodes.findIndex((node) => node.label === "Purchase Request Mgt.")), ["runs through"]);
  assert.deepEqual(related(approve, atlas.nodes.findIndex((node) => node.label === "Request Approval Entry" && node.type === "table")), ["runs through", "changes"]);
  const story = atlas.stories.find(({ id }) => id === "sync");
  assert.deepEqual([story.title, story.plugin, story.steps.length], ["What runs in Business Central", "sync", 7]);
  assert.ok(story.steps.every((step) => step.lens === "sync" && step.nodes.every((node) => atlas.nodes[node])));
  assert.ok(!atlas.findings.some(({ rule }) => rule === "sync-outdated"), "everything is in sync");

  // A recording that changed since the last sync waits for it: a status, a relation, and one finding on its node.
  const directory = mkdtempSync(path.join(os.tmpdir(), "bc-atlas-sync-view-"));
  try {
    cpSync(example, directory, { recursive: true });
    const file = path.join(directory, "recordings", "approve-a-released-purchase-request.json");
    writeFileSync(file, readFileSync(file, "utf8").replace("pr-approve-3", "pr-approve-4"));
    const changed = await createService(new Workspace(directory, {}, { live: false })).call("atlas");
    const recording = changed.nodes.findIndex((node) => node.kind === "recording" && node.label === "Approve a released purchase request");
    assert.notEqual(changed.nodes[recording].status, "in sync");
    assert.equal(changed.nodes.find((node) => node.kind === "channel").status, "1 to sync");
    assert.ok(changed.edges.some(([, to, relation]) => to === recording && changed.relations[relation].kind === "not synced"));
    const outdated = changed.findings.filter(({ rule }) => rule === "sync-outdated");
    assert.equal(outdated.length, 1, "the health rule and the atlas of the plugin report it once");
    assert.ok(outdated[0].nodes.includes(recording));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("the app is one view: a toolbar and the graph", () => {
  const html = renderAppHtml({ mode: "vscode", csp: "default-src 'none'" });
  const body = html.slice(html.indexOf("<body>"), html.indexOf("<script>"));
  assert.match(body, /<header id="bar" role="toolbar"/u);
  assert.match(body, /<div id="graph"><\/div>/u);
  // No list of pages, no tabs, no side bar: what shows is chosen in the toolbar.
  assert.doesNotMatch(body, /<nav\b(?! id="trail")|role="tablist"|id="sidebar"|id="page"/u);
  // Where the view is stands next to the lens, and every part of the way is one click back.
  assert.match(body, /id="lens-button"[^\n]+\n\s*<nav id="trail" aria-label="Where the view is" hidden><\/nav>/u);
  assert.match(html, /history\[moved \? "pushState" : "replaceState"\]/u, "a step to another place is one Back takes back");
  assert.match(html, /addEventListener\("popstate", followAddress\)/u);
  // The picture after a step starts from the picture before it.
  assert.match(html, /const before = graph\?\.snapshot\(\);[\s\S]{0,260}from: before,/u);
  assert.deepEqual([...body.matchAll(/data-form="(\w+)"/gu)].map(([, form]) => form), ["2d", "diagram", "3d"], "any part of the graph in three forms");
  assert.deepEqual([...body.matchAll(/data-menu="(\w+)"/gu)].map(([, menu]) => menu), ["lens", "story", "simulate", "view", "export", "sync"]);
  // Simulate stands next to Story, and is there when the project has process tests.
  assert.match(body, /id="story-button"[^\n]+\n\s*<button class="tool menu" id="simulate-button" data-menu="simulate"[^>]* hidden>Simulate<\/button>/u);
  assert.match(html, /call\("defineSimulation", \{ operations: \[operation\] \}\)/u, "a change is an operation, applied and run again");
  assert.match(html, /data-sim-run=/u, "a run of the simulation starts from the Simulate menu");
  assert.match(html, /call\("bundle"\)/u, "and so does the build of the bundle");
  // What floats on the graph starts hidden: the legend, the selected node, the story.
  for (const id of ["legend", "inspector", "story"]) assert.match(body, new RegExp(`id="${id}" class="float"[^>]* hidden>`, "u"));
  assert.match(html, /root\.BCA_GRAPH = \{ create, drawing, seed, step, random, layered \}/u, "the graph is part of the file");
  // What shows and how it reads as text is one module, shared with `bca view` (test/view.test.js).
  assert.ok(html.indexOf("root.BCA_SCENE = {") > html.indexOf("root.BCA_GRAPH = {") && html.indexOf("const S = BCA_SCENE;") > html.indexOf("root.BCA_SCENE = {"), "graph, scene, then the view");
  // The whole state of the view is in its address, and the editor hears of it.
  assert.match(html, /const DEFAULTS = Object\.freeze\(\{ lens: "system", form: "2d", q: "", sel: ""/u);
  assert.match(html, /vscode\.postMessage\(\{ type: "state", lens: state\.lens, story: state\.story \}\)/u);
  // Everything that shows can be saved.
  for (const format of ["png", "svg", "json", "nodes", "relations", "lens", "docs", "link"]) assert.ok(html.includes(`["${format}", "`), `export: ${format}`);
});

test("bca export writes the app as one offline file with the whole atlas", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "bc-atlas-export-"));
  try {
    const output = path.join(directory, "atlas.html");
    const result = spawnSync(process.execPath, [cli, "export", workspace, "-o", output], { encoding: "utf8", timeout: 180_000 });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr + result.stdout, /multi-app: 12 object\(s\), health failed, 1 wrong-way dependency/u);
    const html = readFileSync(output, "utf8");
    assert.match(html, /window\.BCA_APP = \{"mode":"static"/u);
    assert.match(html, /<title>multi-app · BC Atlas<\/title>/u);
    assert.doesNotMatch(html, /"token"/u);
    const packed = /window\.BCA_SNAPSHOT_GZIP = "([A-Za-z0-9+/=]+)";/u.exec(html)[1];
    const text = gunzipSync(Buffer.from(packed, "base64")).toString("utf8");
    const snapshot = JSON.parse(text);
    assert.deepEqual(Object.keys(snapshot), ["generatedAt", "atlas", "inside"]);
    assert.equal(snapshot.atlas.summary.objects, 12);
    assert.equal(snapshot.atlas.live, false);
    assert.ok(!text.includes(JSON.stringify(workspace).slice(1, -1)), "no local paths in a file meant to be shared");
    assert.ok(snapshot.atlas.lenses.length >= 10 && snapshot.atlas.stories.length >= 2 && snapshot.atlas.findings.length > 0);
    // What is inside every object comes along, so a double click works offline.
    const objects = snapshot.atlas.nodes.filter(({ kind, external }) => kind === "object" && !external);
    const withMembers = objects.filter(({ id }) => snapshot.inside[id]);
    assert.ok(withMembers.length >= 5 && withMembers.length <= objects.length);
    assert.ok(Object.values(snapshot.inside).every(({ nodes, edges, relations }) => (nodes.length || edges.length) && edges.every(([, , relation]) => relations[relation])));
    assert.ok(html.length < 400_000, `one small file (${html.length} bytes)`);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("the app keeps a component and excludes an object in architecture.proposal of .bca.json", async () => {
  const directory = copyWorkspace({ architecture: false });
  try {
    const service = createService(new Workspace(directory));
    const proposed = await service.call("architecture", { propose: true });
    const component = proposed.architecture.components[0];
    const kept = await service.call("updateProposal", { keep: { name: component.name, match: component.match } });
    assert.deepEqual(kept.keep, [component.name]);
    await service.call("updateProposal", { exclude: "type:permissionset" });
    const config = JSON.parse(readFileSync(path.join(directory, ".bca.json"), "utf8"));
    assert.deepEqual(config.architecture.proposal, { keep: [{ name: component.name, match: component.match }], exclude: ["type:permissionset"] });
    const again = await service.call("architecture", { propose: true });
    assert.deepEqual(again.proposal.basis.kept.map(({ name }) => name), [component.name], "the next proposal keeps it");
    await service.call("updateProposal", { release: component.name, include: "type:permissionset" });
    assert.deepEqual(JSON.parse(readFileSync(path.join(directory, ".bca.json"), "utf8")).architecture.proposal, {});
    await assert.rejects(service.call("updateProposal", { keep: { name: "X" } }), /keep needs a name and match selectors/u);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
