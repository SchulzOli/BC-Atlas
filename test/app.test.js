import test from "node:test";
import assert from "node:assert/strict";
import { fork, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";

import { renderAppHtml } from "../src/app/page.js";
import { createService } from "../src/app/service.js";
import { Workspace } from "../src/app/workspace.js";

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

  const diagram = await service.call("diagram", { view: "module" });
  assert.match(diagram.svg, /<svg\b/u);
  await assert.rejects(service.call("diagram", { view: "object" }), /--object is required/u);
  assert.match(await service.call("explorer"), /window\.BCA_GRAPH/u);
  await assert.rejects(service.call("explorer", { history: "nope" }), /history must be one of/u);
  await assert.rejects(service.call("docsHtml"), /no UI-test documentation/u, "multi-app has no UI tests");
  await assert.rejects(service.call("deleteEverything"), /unknown method/u);
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
    const explorer = gunzipSync(Buffer.from(packed("BCA_EXPLORER_GZIP"), "base64")).toString("utf8");
    assert.match(explorer, /^<!doctype html>/u);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
