import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import { gunzipSync } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createGraphDocument } from "../src/graph/document.js";
import { pullRequestOf, sampleCommits } from "../src/graph/history.js";
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

test("nested app.json files are modules of the outer app; platform objects are implicit", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "bc-atlas-modules-"));
  try {
    const module = path.join(directory, "Modules", "Pricing");
    mkdirSync(module, { recursive: true });
    writeFileSync(path.join(directory, "app.json"), JSON.stringify({ id: "a0000000-0000-0000-0000-000000000001", name: "Core", publisher: "Contoso", dependencies: [] }));
    writeFileSync(path.join(module, "app.json"), JSON.stringify({ id: "a0000000-0000-0000-0000-000000000002", name: "Pricing", publisher: "Contoso", dependencies: [] }));
    writeFileSync(path.join(directory, "Root.al"), `
namespace Core;
table 50000 "Root Table" { fields { field(1; Code; Code[20]) { } } }
codeunit 50001 "Root Logic"
{
    var
        Price: Record Core.Pricing."Price Entry";
        Numbers: Record Integer;
}
`);
    writeFileSync(path.join(module, "Price.al"), `
namespace Core.Pricing;
table 50010 "Price Entry" { fields { field(1; Code; Code[20]) { TableRelation = "Root Table".Code; } } }
`);
    const document = await createGraphDocument(directory);
    assert.deepEqual(document.levels.app.nodes.map(({ label, origin }) => [label, origin]).sort(), [["(platform)", "platform"], ["Core", "workspace"]]);
    assert.equal(edgeBetween(document, "Root Logic", "Price Entry").dependency, "cross-module");
    assert.equal(edgeBetween(document, "Root Logic", "Price Entry").scope, "intra-app");
    assert.equal(edgeBetween(document, "Root Logic", "Integer").dependency, "implicit");
    assert.equal(objectNamed(document, "Integer").origin, "platform");

    const modules = new Map(document.levels.module.nodes.map((node) => [node.label, node]));
    assert.equal(modules.get("Pricing").path, "Modules/Pricing/app.json");
    const moduleEdge = (from, to) => document.levels.module.edges.find((edge) =>
      edge.source === modules.get(from).id && edge.target === modules.get(to).id);
    assert.equal(moduleEdge("Core", "Pricing").dependency, "cross-module");
    assert.equal(moduleEdge("Pricing", "Core").dependency, "undeclared", "a module must declare what it uses");
  } finally {
    rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});

test("event subscriptions prefer the subscriber's own app for duplicate names", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "bc-atlas-duplicates-"));
  try {
    for (const [folder, id, name] of [["old", "b0000000-0000-0000-0000-000000000001", "Old"], ["new", "b0000000-0000-0000-0000-000000000002", "New"]]) {
      mkdirSync(path.join(directory, folder));
      writeFileSync(path.join(directory, folder, "app.json"), JSON.stringify({ id, name, publisher: "Contoso", dependencies: [] }));
      writeFileSync(path.join(directory, folder, "Line.al"), `
namespace Contoso;
table 309 "Series Line" { fields { field(1; Code; Code[20]) { } } }
`);
    }
    writeFileSync(path.join(directory, "new", "Subscriber.al"), `
namespace Contoso;
codeunit 50000 "Series Subscriber"
{
    [EventSubscriber(ObjectType::Table, Database::"Series Line", 'OnAfterDeleteEvent', '', false, false)]
    local procedure HandleDelete()
    begin
    end;
}
`);
    const document = await createGraphDocument(directory);
    const edge = document.levels.object.edges.find(({ kinds }) => kinds.subscribes);
    assert.equal(edge.dependency, "intra-app");
  } finally {
    rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
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

// main: core (direct, tag v1.0) -> merged pull request #2 (two commits:
// sales) -> squash merge #3 (integration, tag v1.1) -> a direct commit.
function pullRequestFixture() {
  const directory = mkdtempSync(path.join(os.tmpdir(), "bc-atlas-prs-"));
  git(directory, "init", "-q", "-b", "main");
  git(directory, "config", "user.email", "test@example.com");
  git(directory, "config", "user.name", "Test");
  git(directory, "config", "commit.gpgsign", "false");
  git(directory, "config", "tag.gpgsign", "false");
  const commit = (message) => {
    git(directory, "add", "-A");
    git(directory, "commit", "-q", "-m", message);
  };
  writeFileSync(path.join(directory, "README.md"), "not AL\n");
  commit("readme before the project");
  git(directory, "tag", "v0.1");
  cpSync(path.join(workspace, "core"), path.join(directory, "core"), { recursive: true });
  commit("core");
  git(directory, "tag", "-a", "v1.0", "-m", "First release");
  git(directory, "checkout", "-q", "-b", "sales");
  cpSync(path.join(workspace, "sales"), path.join(directory, "sales"), { recursive: true });
  commit("sales app");
  writeFileSync(path.join(directory, "sales", "Extra.al"), "codeunit 50150 \"CON Extra\" { }\n");
  commit("sales extra");
  git(directory, "checkout", "-q", "main");
  git(directory, "merge", "-q", "--no-ff", "sales", "-m", "Merge pull request #2 from contoso/sales\n\nAdd the sales app");
  cpSync(path.join(workspace, "integration"), path.join(directory, "integration"), { recursive: true });
  commit("Add the integration app (#3)");
  git(directory, "tag", "v1.1");
  writeFileSync(path.join(directory, "core", "Note.al"), "codeunit 50099 \"CON Note\" { }\n");
  commit("hotfix on main");
  return directory;
}

test("recognizes merged pull requests from GitHub, Azure DevOps, GitLab, and squash merges", () => {
  assert.deepEqual(pullRequestOf("Merge pull request #12 from contoso/sales", "Add the sales app\n"), { number: 12, id: "#12", title: "Add the sales app" });
  assert.deepEqual(pullRequestOf("Merged PR 7: Move pricing"), { number: 7, id: "#7", title: "Move pricing" });
  assert.deepEqual(pullRequestOf("Merge branch 'pricing' into 'main'", "Move pricing\n\nSee merge request contoso/bc!5"), { number: 5, id: "!5", title: "Move pricing" });
  assert.deepEqual(pullRequestOf("Add the integration app (#3)"), { number: 3, id: "#3", title: "Add the integration app" });
  assert.equal(pullRequestOf("hotfix on main"), undefined);
});

test("history replays one frame per pull request or per release", async () => {
  const directory = pullRequestFixture();
  try {
    const prs = await createGraphDocument(directory, { historyBy: "prs" });
    assert.equal(prs.timeline.by, "prs");
    assert.deepEqual(prs.timeline.frames.map(({ kind, id, label, commits }) => [kind, id, label, commits]), [
      ["commit", prs.timeline.frames[0].id, "core", 1],
      ["pull-request", "#2", "Add the sales app", 2],
      ["pull-request", "#3", "Add the integration app", 1],
      ["commit", prs.timeline.frames[3].id, "hotfix on main", 1]
    ]);
    assert.ok(objectNamed(prs, "CON Extra").presence[0][0] === 1, "the pull request brings both of its commits");

    const releases = await createGraphDocument(directory, { historyBy: "releases" });
    assert.deepEqual(releases.timeline.frames.map(({ kind, id, label, commits }) => [kind, id, label, commits]), [
      // v0.1 predates the AL source and is skipped.
      ["release", "v1.0", "v1.0: First release", 1],
      ["release", "v1.1", "v1.1", 3],
      ["unreleased", "unreleased", "Unreleased: hotfix on main", 1]
    ]);

    const last = await createGraphDocument(directory, { historyBy: "prs", last: 2 });
    assert.deepEqual(last.timeline.frames.map(({ id }) => id).slice(0, 1), ["#3"]);
    assert.equal(last.timeline.frames.length, 2);
  } finally {
    // On Windows, Git processes that just exited can hold files open for a moment.
    rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});

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
    rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});

test("history requires a Git repository", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "bc-atlas-nogit-"));
  try {
    cpSync(path.join(workspace, "core"), directory, { recursive: true });
    await assert.rejects(createGraphDocument(directory, { history: true }), /needs a Git repository/u);
  } finally {
    rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
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
  const data = html.match(/<script id="bca-graph-data">window\.BCA_GRAPH = (.*?);<\/script>/su)[1];
  assert.doesNotMatch(data, /<\/script/iu);
  assert.equal(JSON.parse(data).title, "Workspace </script><b>");
});

test("explorer HTML compresses large graphs", async () => {
  const document = await createGraphDocument(workspace);
  document.padding = "x".repeat(3 * 1024 * 1024);
  const html = renderExplorerHtml(document);
  const base64 = html.match(/window\.BCA_GRAPH_GZIP = "([A-Za-z0-9+/=]+)";/u)[1];
  assert.ok(base64.length < 200 * 1024);
  const restored = JSON.parse(gunzipSync(Buffer.from(base64, "base64")).toString("utf8"));
  assert.equal(restored.title, document.title);
});

test("the explorer export writes HTML or JSON", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "bc-atlas-explore-"));
  try {
    const html = spawnSync(process.execPath, [cli, "export", workspace, "--view", "explorer", "-o", path.join(directory, "graph.html")], { encoding: "utf8" });
    assert.equal(html.status, 0, html.stderr);
    assert.match(html.stdout, /13 object\(s\), 18 dependency edge\(s\), 6 across apps, 4 app\(s\), 1 undeclared/u);
    assert.match(readFileSync(path.join(directory, "graph.html"), "utf8"), /bca-graph-data/u);

    const json = spawnSync(process.execPath, [cli, "export", workspace, "--view", "explorer", "-f", "json", "-o", path.join(directory, "graph.html")], { encoding: "utf8" });
    assert.equal(json.status, 0, json.stderr);
    assert.equal(JSON.parse(readFileSync(path.join(directory, "graph.json"), "utf8")).schemaVersion, 1);
  } finally {
    rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});
