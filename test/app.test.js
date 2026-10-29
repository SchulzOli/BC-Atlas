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

test("the service answers every page from one analysis", async () => {
  const service = createService(new Workspace(workspace));
  const overview = await service.call("overview");
  assert.equal(overview.title, "multi-app");
  assert.equal(overview.projectRoot, workspace);
  assert.equal(overview.summary.objects, 12);
  assert.equal(overview.architecture.mode, "configured");
  assert.equal(overview.architecture.violations, 1);
  assert.equal(overview.health.passed, false);

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
  assert.equal(configured.violations, undefined, "the page gets work items, not every violation");
  const proposal = await service.call("architecture", { propose: 1, groupBy: "app" });
  assert.equal(proposal.mode, "proposal");
  assert.equal(proposal.proposal.groupBy, "app");
  await assert.rejects(service.call("architecture", { groupBy: "nope" }), /groupBy must be one of/u);

  // Where dependencies should be (rules) and where they are (object links), top layer first.
  assert.deepEqual(configured.matrix.order, ["Integration", "Sales", "Core"]);
  const [integration] = configured.matrix.cells;
  assert.deepEqual(integration.slice(1).map(({ allowed, wrong }) => ({ allowed, wrong })), [{ allowed: true, wrong: 0 }, { allowed: false, wrong: 1 }]);
  assert.equal(configured.matrix.cells[2][0].allowed, false, "Core may not use Integration");

  const component = await service.call("component", { name: "Integration" });
  assert.equal(component.layer, 2);
  assert.ok(component.objects.every(({ group }) => component.groups.some(({ key }) => key === group)), "every object is in a group");
  assert.equal(component.objects.length, component.groups.reduce((sum, { objects: count }) => sum + count, 0));
  const core = component.components.find(({ name }) => name === "Core");
  assert.deepEqual({ mayUse: core.mayUse, wrong: core.out.wrong }, { mayUse: false, wrong: 1 });
  const sales = component.components.find(({ name }) => name === "Sales");
  assert.equal(sales.mayUse, true);
  assert.equal(sales.out.wrong, 0);
  const wrongWay = component.objects.find(({ out }) => out.wrong);
  assert.equal(wrongWay.label, "CON Item Sync");
  assert.ok(component.external.some(([index, name, direction, , wrong]) => component.objects[index] === wrongWay && name === "Core" && direction === "out" && wrong === 1));
  await assert.rejects(service.call("component", { name: "Nope" }), /component not found/u);

  const diagram = await service.call("diagram", { view: "module" });
  assert.match(diagram.svg, /<svg\b/u);
  await assert.rejects(service.call("diagram", { view: "object" }), /--object is required/u);
  assert.match(await service.call("explorer"), /window\.BCA_GRAPH/u);
  await assert.rejects(service.call("explorer", { history: "nope" }), /history must be one of/u);
  await assert.rejects(service.call("docsHtml"), /no UI-test documentation/u, "multi-app has no UI tests");
  await assert.rejects(service.call("deleteEverything"), /unknown method/u);
});

test("the Docs page reads the documentation page by page, as a guide or test case, in a language", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "bc-atlas-app-docs-"));
  cpSync(path.join(root, "examples", "warehouse-app"), directory, { recursive: true });
  try {
    const service = createService(new Workspace(directory));
    const docs = await service.call("docsBrowser");
    assert.equal(docs.mode, "guide");
    assert.deepEqual(Object.keys(docs.items), ["", "use-case-warehouse-requests", "warehouse-request-create", "warehouse-request-process"]);
    assert.deepEqual(docs.useCases.map(({ scenarios }) => scenarios), [["warehouse-request-create", "warehouse-request-process"]]);
    const [create] = docs.scenarios;
    assert.deepEqual(create.source, { file: "WarehouseUITests.al", procedure: "WarehouseRequests_CreateRequest_PersistsDescription", line: 18 },
      "the editor opens the test where its procedure starts");
    const item = docs.items[create.id];
    assert.equal(item.kind, "scenario");
    assert.doesNotMatch(item.html, /<h2>/u, "the page shows the title above the guide");
    assert.match(item.html, /<ol class="steps">/u);
    assert.match(item.markdown, /^<!-- Generated by BC Atlas docs/u);
    assert.match(item.svg, /^<svg/u);
    assert.match(item.dita, /<task /u);
    assert.match(docs.items["use-case-warehouse-requests"].bpmn, /<bpmn:definitions/u);
    assert.match(docs.items[""].html, /href="#use-case-warehouse-requests"/u, "the overview links to the use cases");

    const german = await service.call("docsBrowser", { mode: "testcase", language: "de-DE" });
    assert.equal(german.language, "de-DE");
    assert.match(german.items[create.id].title, /^Testfall /u);
    assert.match(german.items[create.id].html, /<th>Aktion<\/th>/u);
    assert.match(await service.call("docsHtml", { mode: "testcase" }), /<!doctype html>/u);
    await assert.rejects(service.call("docsBrowser", { mode: "manual" }), /mode must be one of: guide, testcase/u);
    await assert.rejects(service.call("docsBrowser", { language: "<script>" }), /language must be a language tag/u);

    // Each box of a diagram names the object behind it, so a click opens its page.
    const diagram = await service.call("diagram", { view: "project" });
    const objects = new Set((await service.call("objects")).map(({ id }) => id));
    const named = [...diagram.svg.matchAll(/data-object="([^"]+)"/gu)].map(([, value]) => value.replaceAll("&quot;", "\"").replaceAll("&amp;", "&"));
    assert.equal(named.length, diagram.nodes);
    assert.ok(named.every((id) => objects.has(id)));
    assert.ok(diagram.svg.includes('class="edge" data-from="'), "each route names its ends for highlighting");
    assert.match(diagram.d2, /^direction: right/u, "the D2 source comes along");
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

test("the VS Code page talks to the extension and carries its Content-Security-Policy", () => {
  const html = renderAppHtml({ mode: "vscode", csp: "default-src 'none'" });
  assert.match(html, /window\.BCA_APP = \{"mode":"vscode"/u);
  assert.match(html, /<meta http-equiv="Content-Security-Policy" content="default-src 'none'">/u);
  assert.match(html, /acquireVsCodeApi\(\)/u);
  assert.throws(() => renderAppHtml({ mode: "live" }), /unknown page mode/u);
});

test("in VS Code the page inherits the editor's color theme", () => {
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
  // Embedded pages are documents of their own: they get the resolved colors.
  assert.match(html, /type: "bca-theme", theme, tokens/u);
  const viewer = readFileSync(path.join(root, "src", "graph", "viewer", "viewer.js"), "utf8");
  assert.match(viewer, /setTheme\(event\.data\.theme, event\.data\.tokens\)/u);

  const exported = renderAppHtml({ mode: "static", snapshot: {} });
  assert.match(exported, /<html lang="en">/u, "an exported page keeps the BC Atlas design");
});

test("in VS Code the extension's side bar is the navigation, not a second one in the panel", () => {
  const html = renderAppHtml({ mode: "vscode", csp: "default-src 'none'" });
  assert.match(html, /:root\[data-host="vscode"\] #sidebar \{ display: none; \}/u);
  // The panel tells the extension which page it shows, so its side bar marks it.
  assert.match(html, /vscode\.postMessage\(\{ type: "page", page \}\)/u);
});

test("the embedded 3D explorer asks for the theme once its graph is unpacked", () => {
  // The explorer inflates its data asynchronously, so a theme sent on the
  // frame's load event can arrive before it listens; it asks instead.
  const viewer = readFileSync(path.join(root, "src", "graph", "viewer", "viewer.js"), "utf8");
  assert.match(viewer, /window\.parent\.postMessage\(\{ type: "bca-ready" \}, "\*"\)/u);
  assert.ok(viewer.indexOf('"bca-ready"') > viewer.indexOf("await inflate("), "asks only after the graph is unpacked");
  const html = renderAppHtml({ mode: "vscode", csp: "default-src 'none'" });
  assert.match(html, /event\.data\?\.type === "bca-ready"[\s\S]{0,200}type: "bca-theme"/u);
});

test("bca export writes the app as one offline file with every page's data", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "bc-atlas-export-"));
  try {
    const output = path.join(directory, "atlas.html");
    const result = spawnSync(process.execPath, [cli, "export", workspace, "-o", output], { encoding: "utf8", timeout: 180_000 });
    assert.equal(result.status, 0, result.stderr);
    const html = readFileSync(output, "utf8");
    assert.match(html, /window\.BCA_APP = \{"mode":"static"/u);
    assert.doesNotMatch(html, /"token"/u);
    const packed = (name) => /window\.(\w+) = "([A-Za-z0-9+/=]+)";/gu.exec(html.slice(html.indexOf(`window.${name}`)))[2];
    const snapshot = JSON.parse(gunzipSync(Buffer.from(packed("BCA_SNAPSHOT_GZIP"), "base64")).toString("utf8"));
    assert.equal(snapshot.overview.summary.objects, 12);
    assert.equal(snapshot.overview.root, undefined, "no local paths in a file meant to be shared");
    assert.equal(Object.keys(snapshot.details).length, 12);
    assert.ok(Object.values(snapshot.details).every(({ source }) => !source.editor));
    const sync = snapshot.objects.find(({ label }) => label === "CON Item Sync");
    const [target] = snapshot.details[sync.id].uses;
    assert.equal(snapshot.nodes[target[0]][1], "CON Item", "links point into the node table");
    assert.deepEqual(Object.keys(snapshot.diagrams).sort(), snapshot.views.map(({ id }) => id).sort());
    assert.ok(snapshot.diagrams.project.svg.startsWith("<"));
    assert.match(snapshot.diagrams.project.svg, /data-object="/u, "a click on a box opens its object page");
    assert.equal(snapshot.docs, undefined, "without documented UI tests there is no Docs page");
    assert.deepEqual(Object.keys(snapshot.components).sort(), ["Core", "Integration", "Sales"], "every component page is in the export");
    assert.ok(snapshot.architecture.matrix.cells.length === 3);
    const explorer = gunzipSync(Buffer.from(packed("BCA_EXPLORER_GZIP"), "base64")).toString("utf8");
    assert.match(explorer, /^<!doctype html>/u);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
