import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createGraphDocument } from "../src/graph/document.js";
import { sampleCommits } from "../src/graph/history.js";
import { renderExplorerHtml } from "../src/graph/html.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workspace = path.join(root, "examples", "multi-app");
const cli = path.join(root, "src", "cli.js");

const objectNamed = (document, label) => document.levels.object.nodes.find((node) => node.label === label);
const edgeBetween = (document, from, to) => {
  const source = objectNamed(document, from);
  return document.levels.object.edges.find((edge) =>
    edge.source === source.id && document.levels.object.nodes.find(({ id }) => id === edge.target)?.label === to
  );
};

test("dependency lens separates dependencies inside one app from dependencies across apps", async () => {
  const document = await createGraphDocument(workspace);
  assert.equal(document.schema, "bc-atlas.graph");
  assert.equal(document.lens.id, "dependency");
  assert.equal(document.timeline.frames.length, 1);

  assert.equal(edgeBetween(document, "CON Standard Pricing", "CON Item").dependency, "intra-app");
  assert.equal(edgeBetween(document, "CON Sales Quote", "CON Item").dependency, "declared");
  assert.equal(edgeBetween(document, "CON Item Sync", "CON Item").dependency, "undeclared");
  assert.equal(edgeBetween(document, "CON Quote Export", "Customer").dependency, "unresolved");
  assert.equal(edgeBetween(document, "CON Item Sync", "CON Item").scope, "inter-app");

  const quoteToPricing = edgeBetween(document, "CON Quote Mgt.", "CON Pricing Mgt.");
  assert.ok(quoteToPricing.kinds.calls >= 1, "resolved calls become dependencies");
  assert.ok(quoteToPricing.kinds.subscribes >= 1, "event subscriptions become dependencies");
  assert.ok(quoteToPricing.evidence.some(({ file }) => file === "sales/Quotes.al"));

  const apps = new Map(document.levels.app.nodes.map((node) => [node.label, node]));
  const appEdge = (from, to) => document.levels.app.edges.find((edge) =>
    edge.source === apps.get(from).id && edge.target === apps.get(to).id);
  assert.equal(appEdge("Contoso Sales", "Contoso Core").dependency, "declared");
  assert.equal(appEdge("Contoso Integration", "Contoso Sales").dependency, "declared");
  assert.equal(appEdge("Contoso Integration", "Contoso Core").dependency, "undeclared");
  assert.equal(appEdge("Contoso Integration", "Contoso Core").declared, false);
  assert.equal(apps.get("Contoso Core").metrics.buildLayer, 0);
  assert.equal(apps.get("Contoso Integration").metrics.buildLayer, 2);

  const item = objectNamed(document, "CON Item");
  assert.equal(item.metrics.crossAppIn, 2);
  assert.ok(item.metrics.pagerank > objectNamed(document, "CON Item Sync").metrics.pagerank);
  assert.deepEqual(item.presence, [[0, null]]);
});

test("dependency lens honors object filters and keeps targets as context", async () => {
  const document = await createGraphDocument(path.join(workspace, "integration"), { projectRoot: workspace });
  const workspaceNodes = document.levels.object.nodes.filter(({ outsideSelection, origin }) => !outsideSelection && origin === "workspace");
  assert.deepEqual(workspaceNodes.map(({ label }) => label).sort(), ["CON Item Sync", "CON Quote Export"]);
  assert.ok(objectNamed(document, "CON Item").outsideSelection);
});

function git(directory, ...args) {
  const result = spawnSync("git", args, {
    cwd: directory,
    encoding: "utf8",
    env: { ...process.env, GIT_AUTHOR_DATE: "2026-01-01T10:00:00Z", GIT_COMMITTER_DATE: "2026-01-01T10:00:00Z" }
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

function historyFixture() {
  const directory = mkdtempSync(path.join(os.tmpdir(), "bc-atlas-history-"));
  const project = path.join(directory, "ws");
  git(directory, "init", "-q");
  git(directory, "config", "user.email", "test@example.com");
  git(directory, "config", "user.name", "Test");
  git(directory, "config", "commit.gpgsign", "false");
  const commit = (message) => {
    git(directory, "add", "-A");
    git(directory, "commit", "-q", "-m", message);
  };
  mkdirSync(project);
  cpSync(path.join(workspace, "core"), path.join(project, "core"), { recursive: true });
  writeFileSync(path.join(directory, "README.md"), "not AL\n");
  commit("core");
  writeFileSync(path.join(project, "core", "Legacy.al"), `
namespace Contoso.Core.Pricing;
codeunit 50019 "CON Legacy Pricing"
{
    var
        Item: Record "CON Item";
}
`);
  commit("legacy");
  writeFileSync(path.join(directory, "README.md"), "still not AL\n");
  commit("docs only");
  cpSync(path.join(workspace, "sales"), path.join(project, "sales"), { recursive: true });
  cpSync(path.join(workspace, "integration"), path.join(project, "integration"), { recursive: true });
  rmSync(path.join(project, "core", "Legacy.al"));
  commit("apps on top; legacy removed");
  return { directory, project };
}

test("history replays commits that changed AL files and tracks additions and removals", async () => {
  const { directory, project } = historyFixture();
  try {
    const document = await createGraphDocument(project, { history: true });
    const frames = document.timeline.frames;
    assert.equal(document.timeline.source, "git");
    assert.deepEqual(frames.map(({ label }) => label), ["core", "legacy", "apps on top; legacy removed"]);
    assert.equal(frames[0].stats.addedNodes, 6);
    assert.equal(frames[2].stats.removedNodes, 1);

    assert.deepEqual(objectNamed(document, "CON Legacy Pricing").presence, [[1, 2]]);
    assert.deepEqual(objectNamed(document, "CON Item").presence, [[0, null]]);
    assert.deepEqual(edgeBetween(document, "CON Item Sync", "CON Item").presence, [[2, null]]);

    writeFileSync(path.join(project, "core", "Items.al"), readFileSync(path.join(project, "core", "Items.al"), "utf8").replace("Description", "Name"));
    const dirty = await createGraphDocument(project, { history: true, maxCommits: 2 });
    assert.deepEqual(dirty.timeline.frames.map(({ kind }) => kind), ["commit", "commit", "working-tree"]);
    assert.equal(dirty.timeline.frames[0].label, "core", "sampling keeps the first commit");
    assert.ok(objectNamed(dirty, "CON Item").changes.includes(2));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("history requires a Git repository", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "bc-atlas-nogit-"));
  try {
    cpSync(path.join(workspace, "core"), directory, { recursive: true });
    await assert.rejects(createGraphDocument(directory, { history: true }), /needs a Git repository/u);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("commit sampling keeps the first and last commit", () => {
  const commits = Array.from({ length: 10 }, (_, index) => index);
  assert.deepEqual(sampleCommits(commits, 4), [0, 3, 6, 9]);
  assert.deepEqual(sampleCommits(commits, 1), [9]);
  assert.deepEqual(sampleCommits(commits, 20), commits);
});

test("explorer HTML is self-contained and embeds the graph safely", async () => {
  const document = await createGraphDocument(workspace, { title: "Workspace </script><b>" });
  const html = renderExplorerHtml(document);
  assert.match(html, /<title>Workspace &lt;\/script&gt;&lt;b&gt;<\/title>/u);
  assert.match(html, /ForceGraph3D/u);
  assert.doesNotMatch(html, /<script[^>]+src=/u, "no external scripts");
  const data = html.match(/<script id="bca-graph-data" type="application\/json">(.*?)<\/script>/su)[1];
  assert.doesNotMatch(data, /<\/script/iu);
  assert.equal(JSON.parse(data).title, "Workspace </script><b>");
});

test("explore command writes HTML or JSON", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "bc-atlas-explore-"));
  try {
    const html = spawnSync(process.execPath, [cli, "explore", workspace, "-o", path.join(directory, "graph.html")], { encoding: "utf8" });
    assert.equal(html.status, 0, html.stderr);
    assert.match(html.stdout, /13 object\(s\), 18 dependency edge\(s\), 6 across apps, 4 app\(s\), 1 undeclared/u);
    assert.match(readFileSync(path.join(directory, "graph.html"), "utf8"), /bca-graph-data/u);

    const json = spawnSync(process.execPath, [cli, "explore", workspace, "-f", "json", "-o", path.join(directory, "graph.html")], { encoding: "utf8" });
    assert.equal(json.status, 0, json.stderr);
    assert.equal(JSON.parse(readFileSync(path.join(directory, "graph.json"), "utf8")).schemaVersion, 1);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
