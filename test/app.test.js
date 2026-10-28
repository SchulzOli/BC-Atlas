import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";

import { startAppServer } from "../src/app/server.js";
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

// fetch() cannot send a foreign Host header, so requests go through http.
function request(url, { method = "GET", headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const sent = http.request(url, { method, headers }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        resolve({ status: response.statusCode, type: response.headers["content-type"], text, json: () => JSON.parse(text) });
      });
    });
    sent.on("error", reject);
    if (body) sent.write(body);
    sent.end();
  });
}

test("the app serves every page's data, the explorer, and diagrams from one analysis", async () => {
  const app = await startAppServer(new Workspace(workspace), { port: 0, watch: false });
  try {
    const page = await request(app.url);
    assert.equal(page.status, 200);
    assert.match(page.type, /text\/html/u);
    assert.match(page.text, /window\.BCA_APP = \{"mode":"live","token":"[0-9a-f]{32}"/u);
    assert.match(page.text, /--accent:/u, "the shared theme is inlined");

    const overview = (await request(`${app.url}api/overview`)).json();
    assert.equal(overview.title, "multi-app");
    assert.equal(overview.summary.objects, 12);
    assert.equal(overview.architecture.mode, "configured");
    assert.equal(overview.architecture.violations, 1);
    assert.equal(overview.health.passed, false);

    const health = (await request(`${app.url}api/health`)).json();
    const violation = health.findings.find(({ rule }) => rule === "architecture-violation");
    assert.ok(violation.object, "findings link to the object at their location");

    const objects = (await request(`${app.url}api/objects`)).json();
    assert.equal(objects.length, 12);
    const sync = objects.find(({ label }) => label === "CON Item Sync");
    assert.equal(sync.component, "Integration");
    assert.equal(sync.violations, 1);
    assert.equal(violation.object, sync.id);

    const detail = (await request(`${app.url}api/object?id=${encodeURIComponent(sync.id)}`)).json();
    assert.deepEqual(detail.uses.map(({ label }) => label), ["CON Item"]);
    assert.equal(detail.violations[0].resolution.strategy, "declare-dependency");
    assert.match(detail.source.editor, /^vscode:\/\/file\/.*ItemSync\.al:\d+$/u);
    assert.ok(detail.members.procedures.length > 0);
    assert.equal((await request(`${app.url}api/object?id=nope`)).status, 404);

    const configured = (await request(`${app.url}api/architecture`)).json();
    assert.equal(configured.mode, "configured");
    assert.equal(configured.violationCount, 1);
    assert.equal(configured.violations, undefined, "the page gets work items, not every violation");
    const proposal = (await request(`${app.url}api/architecture?propose=1&groupBy=app`)).json();
    assert.equal(proposal.mode, "proposal");
    assert.equal(proposal.proposal.groupBy, "app");
    assert.equal((await request(`${app.url}api/architecture?groupBy=nope`)).status, 400);

    const diagram = (await request(`${app.url}api/diagram?view=module`)).json();
    assert.match(diagram.svg, /<svg\b/u);
    assert.ok(diagram.nodes > 0);
    const missing = await request(`${app.url}api/diagram?view=object`);
    assert.equal(missing.status, 400);
    assert.match(missing.json().error, /--object is required/u);

    const explorer = await request(`${app.url}explorer`);
    assert.equal(explorer.status, 200);
    assert.match(explorer.text, /window\.BCA_GRAPH/u);
    assert.equal((await request(`${app.url}docs`)).status, 404, "multi-app has no UI tests");
  } finally {
    await app.close();
  }
});

test("only the app's own page can change files, and only on localhost", async () => {
  const directory = copyWorkspace({ architecture: false });
  const app = await startAppServer(new Workspace(directory), { port: 0, watch: false });
  try {
    const foreign = await request(`${app.url}api/overview`, { headers: { host: "attacker.example:80" } });
    assert.equal(foreign.status, 403);

    const body = JSON.stringify({ groupBy: "app" });
    const anonymous = await request(`${app.url}api/architecture/adopt`, { method: "POST", body, headers: { "content-type": "application/json" } });
    assert.equal(anonymous.status, 403);
    assert.equal(existsSync(path.join(directory, ".bca.json")), false);

    assert.equal((await request(`${app.url}api/overview`)).json().architecture.mode, "proposal");
    const adopted = await request(`${app.url}api/architecture/adopt`, {
      method: "POST", body, headers: { "content-type": "application/json", "x-bca-token": app.token }
    });
    assert.equal(adopted.status, 200, adopted.text);
    const saved = JSON.parse(readFileSync(path.join(directory, ".bca.json"), "utf8")).architecture;
    assert.deepEqual(saved.components.map(({ name }) => name), ["Contoso Core", "Contoso Sales", "Contoso Integration"]);
    assert.ok(existsSync(path.join(directory, ".bca-architecture-baseline.json")));
    // The next request analyzes again and sees the configured architecture.
    assert.equal((await request(`${app.url}api/overview`)).json().architecture.mode, "configured");
  } finally {
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  }
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
