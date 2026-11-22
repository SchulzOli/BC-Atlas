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

function copyWorkspace() {
  const directory = mkdtempSync(path.join(os.tmpdir(), "bc-atlas-app-"));
  cpSync(workspace, directory, { recursive: true });
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
  const directory = copyWorkspace();
  try {
    const shared = new Workspace(directory);
    deepFreeze((await shared.model()).model);
    await shared.overview();
    await shared.levels();
    const atlas = await shared.atlas();
    const object = atlas.nodes.find(({ kind, external }) => kind === "object" && !external);
    assert.ok((await shared.inside(object.id)).nodes.length >= 0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("the service answers the view and the editor from one analysis", async () => {
  const service = createService(new Workspace(workspace));
  const overview = await service.call("overview");
  assert.equal(overview.title, "multi-app");
  assert.equal(overview.projectRoot, workspace);
  assert.equal(overview.summary.objects, 12);
  assert.equal(overview.architecture, undefined, "no target architecture: what is shown is what the source has");
  assert.equal(overview.health.passed, true);
  assert.match(overview.sources[0][1], /5 files with 12 objects/u, "what everything is read from");

  const health = await service.call("health");
  const finding = health.findings.find(({ rule, message }) => rule === "undocumented-public-api" && message.includes("CON Item Sync"));
  assert.ok(finding.object, "findings link to the object at their location");

  const objects = await service.call("objects");
  assert.equal(objects.length, 12);
  const sync = objects.find(({ label }) => label === "CON Item Sync");
  assert.equal(sync.component, undefined);
  assert.equal(finding.object, sync.id);

  const detail = await service.call("object", { id: sync.id });
  assert.deepEqual(detail.uses.map(({ label }) => label), ["CON Item"]);
  assert.match(detail.source.file, /ItemSync\.al$/u);
  assert.ok(detail.members.procedures.length > 0);
  await assert.rejects(service.call("object", { id: "nope" }), /object not found/u);

  assert.deepEqual((await service.call("lenses")).slice(0, 3), [
    { id: "overview", title: "Overview", summary: "How it works, from left to right: the screens, the logic behind them, and the data." },
    { id: "system", title: "System", summary: "Every object and every relation between them." },
    { id: "apps", title: "Apps", summary: "The apps of the workspace, the apps they depend on, and what they use of each other." }
  ]);
  for (const removed of ["architecture", "adoptArchitecture", "updateBaseline", "compareArchitecture", "deleteEverything"]) await assert.rejects(service.call(removed), /unknown method/u);
});

test("the atlas is everything read from the source as one graph", async () => {
  const service = createService(new Workspace(workspace));
  const atlas = await service.call("atlas");
  assert.equal(atlas.title, "multi-app");
  assert.deepEqual({ objects: atlas.summary.objects, apps: atlas.summary.apps, passed: atlas.summary.health.passed }, { objects: 12, apps: 3, passed: true });
  assert.deepEqual(atlas.sources.map(([term]) => term), ["AL source", "app.json", "Symbol packages", "Settings"]);

  // Nodes of every kind there is, each with a name and a color.
  const count = (kind) => atlas.nodes.filter((node) => node.kind === kind && !node.external).length;
  assert.deepEqual({ object: count("object"), app: count("app"), component: count("component"), module: count("module") }, { object: 12, app: 3, component: 0, module: 4 });
  assert.ok(atlas.nodes.some(({ kind }) => kind === "rule"), "the rules of the health check are nodes");
  assert.equal(new Set(atlas.nodes.map(({ id }) => id)).size, atlas.nodes.length, "every node once");
  assert.ok(atlas.nodes.every(({ label, kind, color }) => label && kind && /^#[0-9a-f]{6}$/iu.test(color)));
  assert.ok(atlas.nodes.some(({ external, label }) => external && label === "Customer"), "what the workspace refers to in other apps is there, marked");

  // Relations point at nodes and at their kind; every kind has a color.
  assert.ok(atlas.edges.every(([from, to, relation, weight]) => atlas.nodes[from] && atlas.nodes[to] && from !== to && atlas.relations[relation] && weight > 0));
  assert.ok(atlas.relations.every(({ kind, color }) => kind && /^#[0-9a-f]{6}$/iu.test(color)));
  const related = (from, to) => atlas.edges.filter(([a, b]) => atlas.nodes[a].label === from && atlas.nodes[b].label === to).map(([, , relation]) => atlas.relations[relation].kind).sort();
  assert.deepEqual(related("CON Item Sync", "CON Item"), ["reads", "uses", "writes"], "one relation per kind, not one line for all");
  assert.deepEqual(related("Contoso Integration", "Contoso Core"), ["undeclared"]);
  assert.deepEqual(related("Contoso Sales", "Contoso Core"), ["declared"]);
  assert.deepEqual(related("Contoso.Core.Pricing", "Contoso.Core.Items"), ["depends on"]);

  // An object carries what the view says about it.
  const sync = atlas.nodes.find(({ label }) => label === "CON Item Sync");
  assert.deepEqual(
    { type: sync.type, app: sync.app, namespace: sync.namespace, level: sync.level, canBe: sync.canBe, file: sync.file, line: sync.line },
    { type: "codeunit", app: "Contoso Integration", namespace: "Contoso.Integration", level: "public", canBe: "internal", file: "integration/ItemSync.al", line: 6 }
  );

  // Lenses: parts of the one graph. One without anything in it is left out.
  assert.deepEqual(atlas.lenses.map(({ id }) => id), ["overview", "system", "apps", "modules", "data", "calls", "events", "contracts", "pages", "security", "visibility", "health"]);
  const kinds = new Set(atlas.relations.map(({ kind }) => kind));
  for (const lens of atlas.lenses) {
    assert.ok(lens.title && lens.summary && lens.reads, `${lens.id} says what it shows and what it reads`);
    assert.ok(lens.relations.length > 0 && lens.relations.every((kind) => kinds.has(kind)), `${lens.id} names relations that exist`);
    assert.ok(lens.kinds.some((kind) => atlas.nodes.some((node) => node.kind === kind)), `${lens.id} has nodes`);
  }
  assert.ok(atlas.lenses.find(({ id }) => id === "system").relations.includes("source"), "every relation between objects, also a page's source table");

  // Findings point at the nodes they are about: the rule and the object.
  const finding = atlas.findings.find(({ rule, message }) => rule === "undocumented-public-api" && message.includes("CON Item Sync"));
  assert.deepEqual(finding.nodes.map((index) => atlas.nodes[index].label), ["undocumented-public-api", "CON Item Sync"]);
  assert.equal(finding.severity, "info");
  assert.equal(atlas.nodes[finding.nodes[0]].severity, "info", "a rule is as severe as its worst finding");
  assert.ok(atlas.findings.every(({ nodes }) => nodes.every((index) => atlas.nodes[index])));

  // Stories: walks through the graph, generated from the same source.
  assert.deepEqual(atlas.stories.map(({ id }) => id), ["system", "fix"]);
  const lenses = new Set(atlas.lenses.map(({ id }) => id));
  for (const story of atlas.stories) {
    assert.ok(story.title && story.summary && story.steps.length > 0);
    assert.ok(story.steps.every(({ title, text, lens, nodes }) => title && text && lenses.has(lens) && nodes.every((index) => atlas.nodes[index])), `${story.id}: every step has a text, a lens, and nodes that exist`);
  }
  // The story of the system starts with how it works, then what it is made of.
  const [how, first] = atlas.stories[0].steps;
  assert.deepEqual([how.title, how.lens], ["How it works", "overview"]);
  assert.match(how.text, /^From left to right: 2 screens, 6 logic objects, 3 tables\. The screens run the logic, and the logic reads and writes the data\./u);
  assert.match(first.text, /^12 objects in 3 apps: 5 codeunits, 3 tables, 2 pages, 1 interface, 1 permissionset\./u);
  assert.equal(atlas.changes, undefined);
  assert.equal(atlas.architecture, undefined);

  // One object from the inside: its procedures, and what each does with other objects.
  const inside = await service.call("inside", { id: sync.id });
  assert.deepEqual(inside.nodes.map(({ label, type, kind, parent }) => ({ label, type, kind, parent })), [{ label: "Sync(Code[20])", type: "procedure", kind: "member", parent: sync.id }]);
  const item = atlas.nodes.find(({ label, type }) => label === "CON Item" && type === "table");
  const does = inside.edges.filter(([from, to]) => from === inside.nodes[0].id && to === item.id).map(([, , relation]) => inside.relations[relation].kind).sort();
  assert.deepEqual(does, ["reads", "writes"], "the procedure reads and writes the table");
  await assert.rejects(service.call("inside", { id: "nope" }), /object not found/u);
});

test("the workspace keeps parse results on disk and parses only changed files again", async () => {
  const directory = copyWorkspace();
  const cacheDirectory = mkdtempSync(path.join(os.tmpdir(), "bc-atlas-parse-cache-"));
  const previous = process.env.BCA_CACHE_DIR;
  process.env.BCA_CACHE_DIR = cacheDirectory;
  try {
    const first = new Workspace(directory);
    const objects = (await first.overview()).summary.objects;
    assert.equal(await first.flush(), true);
    assert.ok(existsSync(parseCacheFile(directory)));

    // The next editor session reads every file's objects from disk.
    const second = new Workspace(directory);
    assert.equal((await second.parseCache()).size, 5);
    assert.equal((await second.overview()).summary.objects, objects);
    assert.equal(await second.flush(), false, "nothing was parsed, so nothing is written");

    // A changed file is parsed again; its old entry is dropped.
    const file = path.join(directory, "sales", "Quotes.al");
    writeFileSync(file, `${readFileSync(file, "utf8")}\n// changed\n`);
    second.reset();
    await second.overview();
    assert.ok(second.pendingSave, "in an editor the write waits until the saves have settled");
    assert.equal(await second.flush(), true);
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
  assert.deepEqual([...body.matchAll(/data-menu="(\w+)"/gu)].map(([, menu]) => menu), ["lens", "story", "view", "export", "sync"]);
  // What floats on the graph starts hidden: the legend, the selected node, the story.
  for (const id of ["legend", "inspector", "story"]) assert.match(body, new RegExp(`id="${id}" class="float"[^>]* hidden>`, "u"));
  assert.match(html, /root\.BCA_GRAPH = \{ create, drawing, seed, step, random, layered \}/u, "the graph is part of the file");
  // What shows and how it reads as text is one module, shared with `bca view` (test/view.test.js).
  assert.ok(html.indexOf("root.BCA_SCENE = {") > html.indexOf("root.BCA_GRAPH = {") && html.indexOf("const S = BCA_SCENE;") > html.indexOf("root.BCA_SCENE = {"), "graph, scene, then the view");
  // The whole state of the view is in its address, and the editor hears of it.
  assert.match(html, /const DEFAULTS = Object\.freeze\(\{ lens: "overview", form: "", q: "", sel: ""/u, "the view opens on the overview, in the form its lens reads best in");
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
    assert.match(result.stderr + result.stdout, /multi-app: 12 object\(s\), health passed\./u);
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
    // The canvas of the builder (React Flow) comes along, so the file builds flows offline too.
    assert.ok(html.length < 900_000, `one small file (${html.length} bytes)`);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("the view is the same page in VS Code, as an MCP App, and as a file: every request it makes is answered in each", () => {
  const vscodePage = renderAppHtml({ mode: "vscode" });
  const mcpPage = renderAppHtml({ mode: "mcp" });
  // One page: the MCP App is the page of the extension with the adapter for its host in front.
  assert.ok(mcpPage.includes('data-host="mcp"') && mcpPage.includes("window.BCA_MCP_HOST"));
  assert.ok(!vscodePage.includes("window.BCA_MCP_HOST ="), "the adapter is only in the MCP App");
  const body = (html) => html.slice(html.indexOf('<div id="app">'), html.indexOf("</main>"));
  assert.equal(body(mcpPage), body(vscodePage));
  // Every method the page calls is one the service has, or one the host answers itself.
  const service = createService(new Workspace(fileURLToPath(new URL("../examples/warehouse-app", import.meta.url)), {}, { live: true }));
  const called = [...new Set([...readFileSync(new URL("../src/app/ui/atlas.js", import.meta.url), "utf8").matchAll(/\bcall\("(\w+)"/gu)].map(([, method]) => method))];
  const hostOnly = ["openFile", "saveFile"];
  assert.deepEqual(called.slice().sort(), ["atlas", "inside", "openFile", "refresh", "saveFile"]);
  for (const method of called) assert.ok(service.methods.includes(method) || hostOnly.includes(method), `the view calls ${method}, which no host answers`);
  // Both hosts answer the two that are theirs.
  const extension = readFileSync(new URL("../vscode/src/extension.js", import.meta.url), "utf8");
  const server = readFileSync(new URL("../src/mcp.js", import.meta.url), "utf8");
  for (const method of hostOnly) {
    assert.ok(extension.includes(`async ${method}(`), `the extension answers ${method}`);
    assert.ok(server.includes(`method === "${method}"`), `the MCP server answers ${method}`);
  }
});

// The page in a real browser: every menu opens and a selected node shows its facts, without an
// error of the page. Runs where Playwright with Chromium is installed; with BCA_BROWSER_TEST set
// (one CI job), a missing Playwright fails the test instead of skipping it.
let chromium;
try {
  ({ chromium } = (await import("node:module")).createRequire(import.meta.url)("playwright"));
} catch {
  chromium = undefined;
}
test("the exported view works in a browser: a selection, every menu, and every lens", { skip: !chromium && !process.env.BCA_BROWSER_TEST && "Playwright is not installed" }, async () => {
  assert.ok(chromium, "BCA_BROWSER_TEST is set, but Playwright is not installed");
  const { renderSnapshotHtml } = await import("../src/app/snapshot.js");
  const { html, snapshot } = await renderSnapshotHtml(new Workspace(workspace, {}, { live: false }));
  const directory = mkdtempSync(path.join(os.tmpdir(), "bc-atlas-browser-"));
  const file = path.join(directory, "atlas.html");
  writeFileSync(file, html);
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const sync = snapshot.atlas.nodes.find(({ label }) => label === "CON Item Sync");
    const failed = () => page.evaluate(() => document.body.innerText.includes("BC Atlas could not show this"));
    await page.goto(`file://${file}#${new URLSearchParams({ sel: sync.id })}`);
    await page.waitForSelector("#inspector:not([hidden])");
    assert.match(await page.innerText("#inspector"), /CON Item Sync[\s\S]*Contoso\.Integration/u, "the selected node shows its facts");
    for (const menu of ["lens", "story", "view", "export", "sync"]) {
      await page.click(`[data-menu="${menu}"]`);
      assert.ok(await page.isVisible("#popover"), `${menu} opens`);
      await page.keyboard.press("Escape");
      await page.click("#graph", { position: { x: 5, y: 5 } });
    }
    for (const { id } of snapshot.atlas.lenses) {
      await page.goto(`file://${file}#${new URLSearchParams({ lens: id, check: "1" })}`);
      await page.waitForTimeout(150);
      assert.equal(await failed(), false, `the ${id} lens shows`);
    }
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
