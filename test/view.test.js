import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { LENSES } from "../src/app/atlas.js";
import { renderView, viewOverview, viewState } from "../src/app/view.js";
import { Workspace } from "../src/app/workspace.js";
import { createCapabilities, findCommand, VIEW_FORMATS, VIEW_FORMS, VIEW_LENSES } from "../src/capabilities.js";

// The view without a window (src/app/view.js): what `bca view` and the MCP
// tool write is what the page shows, from the same code (src/app/ui/scene.js
// and graph.js).
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(root, "src", "cli.js");
const multi = new Workspace(path.join(root, "examples", "multi-app"), {}, { live: false });
const purchasing = new Workspace(path.join(root, "examples", "purchasing-app"), {}, { live: false });
const S = globalThis.BCA_SCENE;

test("the command offers every lens, form, and format of the view", () => {
  assert.deepEqual(VIEW_LENSES, LENSES.map(({ id }) => id), "the lenses the command accepts are the lenses of the atlas");
  assert.deepEqual(VIEW_FORMS, S.FORMS);
  const command = findCommand(createCapabilities("0.0.0"), "view");
  assert.deepEqual(command.options.lens.enum, VIEW_LENSES);
  assert.deepEqual(command.options.format.enum, VIEW_FORMATS);
  assert.deepEqual(command.options.color.enum, S.COLORS);
  assert.deepEqual(command.options.size.enum, S.SIZES);
  assert.deepEqual(command.options.group.enum, S.GROUPS);
  // Everything the toolbar of the page sets has an option.
  for (const option of ["lens", "form", "find", "check", "story", "step", "inside", "focus", "depth", "hide", "off", "color", "size", "group", "select"]) assert.ok(command.options[option], option);
});

test("without a lens the view says what there is to see", async () => {
  const { content, format } = await renderView(multi);
  assert.equal(format, "text");
  assert.match(content, /^multi-app: 12 objects in 3 apps, 26 relations\.\nHealth failed: 1 error, 0 warnings, 11 info\. Architecture \(configured\): 3 components, 1 dependency the wrong way\./u);
  assert.match(content, /Lenses \(bca view --lens <id>\)\n {2}system {6}13 nodes, 30 relations/u);
  assert.match(content, /Stories \(bca view --story <id>\)\n {2}system {8}13 steps/u);
  assert.match(content, /Read from\n {2}AL source: 5 files with 12 objects/u);

  const overview = viewOverview(await multi.atlas());
  assert.deepEqual(overview.lenses.find(({ id }) => id === "components"), {
    id: "components",
    title: "Components",
    summary: "The components in their layers and the dependencies between them, allowed or the wrong way.",
    reads: "the components of `architecture` in .bca.json (or the proposal), and the relations between the objects assigned to them",
    nodes: 3,
    relations: 3
  });
  assert.deepEqual(overview.stories.map(({ id, steps }) => [id, steps]), [["system", 13], ["fix", 1], ["architecture", 1]]);

  // As JSON: the whole atlas, every node, relation, lens, finding, and story.
  const atlas = JSON.parse((await renderView(multi, { format: "json" })).content);
  assert.deepEqual(Object.keys(atlas).filter((key) => ["nodes", "relations", "edges", "lenses", "findings", "stories"].includes(key)), ["nodes", "relations", "edges", "lenses", "findings", "stories"]);
});

test("a lens is the part of the graph the page shows, as text, data, and a table", async () => {
  const text = (await renderView(multi, { lens: "data", check: true })).content;
  assert.match(text, /^multi-app: Data\n8 nodes, 9 relations\. Tables and the code that reads, writes, relates, and extends them\./u);
  assert.match(text, /\nIntegration\n(?: {2,}.*\n)* {2}codeunit CON Item Sync \(50201; 2 findings, worst error\)\n {4}-> reads CON Item\n {4}-> writes CON Item\n {4}! error architecture-violation: /u, "a node with what it does, and with --check its findings");
  assert.match(text, /\nOther apps\n {2}table Customer \(other app\)/u);

  const { content, scene } = await renderView(multi, { lens: "data", format: "json" });
  const data = JSON.parse(content);
  assert.equal(data.lens, "data");
  assert.equal(data.nodes.length, scene.entries.length);
  assert.deepEqual(new Set(data.relations.map(({ kind }) => kind)), new Set(["reads", "writes", "relates"]));
  const sync = data.nodes.find(({ label }) => label === "CON Item Sync");
  assert.deepEqual({ group: sync.group, relations: sync.relations, color: sync.color, findings: sync.findings.map(({ rule }) => rule) },
    { group: "Integration", relations: 2, color: undefined, findings: ["architecture-violation", "undocumented-public-api"] });
  assert.ok(data.relations.every(({ from, to }) => data.nodes.some(({ id }) => id === from) && data.nodes.some(({ id }) => id === to)));

  // The same as the page exports: one implementation.
  const atlas = await multi.atlas();
  const found = S.index(atlas);
  const state = viewState(atlas, { lens: "data" });
  const same = S.scene(atlas, found, state);
  assert.deepEqual(data, JSON.parse(JSON.stringify(S.sceneData(atlas, found, same, S.shown(same, state)))));

  const nodes = (await renderView(multi, { lens: "data", format: "csv" })).content.trim().split("\n");
  assert.match(nodes[0], /^id,kind,label,type,objectId,.*,relations,findings$/u);
  assert.equal(nodes.length, 9);
  const relations = (await renderView(multi, { lens: "data", format: "csv", rows: "relations" })).content.trim().split("\n");
  assert.equal(relations[0], "from,to,kind,weight");
  assert.ok(relations.includes("CON Item Sync,CON Item,writes,1"));
  const markdown = (await renderView(multi, { lens: "data", format: "md" })).content;
  assert.match(markdown, /^# multi-app: Data\n\nTables and the code/u);
  assert.match(markdown, /\| CON Item Sync \| codeunit \| Integration \| 2 \|/u);
  assert.match(markdown, /## Findings\n\n- \*\*error\*\* `architecture-violation`: /u);
});

test("find, hide, off, and focus narrow what shows, as in the page", async () => {
  const count = async (options) => JSON.parse((await renderView(multi, { format: "json", ...options })).content);
  const all = await count({ lens: "system" });
  assert.deepEqual([all.nodes.length, all.relations.length], [13, 30]);
  // Hidden kinds of node and of relation are out, and what they connected with them.
  const noTables = await count({ lens: "system", hide: "table,other apps" });
  assert.ok(noTables.nodes.every(({ type, external }) => type !== "table" && !external));
  assert.ok(noTables.relations.every(({ from, to }) => noTables.nodes.some(({ id }) => id === from) && noTables.nodes.some(({ id }) => id === to)));
  const onlyData = await count({ lens: "system", off: ["uses,permits", "calls"] });
  assert.ok(!onlyData.relations.some(({ kind }) => ["uses", "permits", "calls"].includes(kind)));
  assert.equal(onlyData.nodes.length, 13, "the nodes stay");
  // A search lists what it finds.
  assert.deepEqual((await count({ lens: "system", find: "pricing" })).nodes.map(({ label }) => label).sort(), ["CON Price Calculation", "CON Pricing Mgt.", "CON Standard Pricing"], "by name, and by the namespace Contoso.Core.Pricing");
  assert.deepEqual((await count({ lens: "system", find: "contoso.integration" })).nodes.map(({ label }) => label).sort(), ["CON Item Sync", "CON Quote Export"], "also by namespace");
  // A node and what is near it, by name, by type and ID, and a step further.
  const near = await count({ lens: "system", focus: "codeunit:50201" });
  assert.deepEqual(near.nodes.map(({ label }) => label).sort(), ["CON Item", "CON Item Sync"]);
  const further = await count({ lens: "system", focus: "CON Item Sync", depth: 2 });
  assert.ok(further.nodes.length > near.nodes.length);
});

test("an object opens from the terminal too", async () => {
  const text = (await renderView(multi, { inside: "codeunit:50201" })).content;
  assert.match(text, /^multi-app: Inside CON Item Sync\n3 nodes, 4 relations\. Its procedures, triggers, and events/u);
  assert.match(text, / {2}procedure Sync\(Code\[20\]\)\n {4}-> reads CON Item\n {4}-> writes CON Item/u);
  await assert.rejects(renderView(multi, { inside: "Core" }), /--inside needs an object of the workspace; "Core" is a component/u);
  await assert.rejects(renderView(multi, { inside: "CON Sales Quote" }), /--inside "CON Sales Quote" names 2 nodes: (?:page|table):50100, (?:page|table):50100; add the type, as in (?:page|table):50100/u);
  await assert.rejects(renderView(multi, { focus: "Nope" }), /--focus "Nope" names no node/u);
});

test("a story reads as text and as a document, and each step is a view", async () => {
  const text = (await renderView(purchasing, { story: "fix" })).content;
  assert.match(text, /^BC Atlas Purchasing Example: What to fix\n4 findings, the most severe first/u);
  assert.match(text, /\n1\. error: task-blocked \[error\]\n {3}Ben \(Team lead\) cannot complete "Approve a released purchase request".+Fix: Add to a permission set of the agent: `codeunit "Request Notifications" = X`\n {3}On: Ben \(Team lead\), Approve a released purchase request\n/u);
  const markdown = (await renderView(purchasing, { story: "process:use-case-purchase-requests", format: "md" })).content;
  assert.match(markdown, /^# Purchase requests\n\n4 process tests in order.+\n\n_Generated by BC Atlas .+ from the AL source of BC Atlas Purchasing Example\. Do not edit; export it again\._\n\n## 1\. Create a new Purchase Request\n/u);
  assert.equal(JSON.parse((await renderView(purchasing, { story: "people", format: "json" })).content).steps.length, 4);

  // One step: the nodes it is about, in its lens.
  const step = JSON.parse((await renderView(purchasing, { story: "process:use-case-purchase-requests", step: 2, format: "json" })).content);
  assert.equal(step.lens, "processes");
  assert.deepEqual(step.nodes.map(({ label }) => label).sort(), ["Create a new Purchase Request", "Purchase Request", "Purchase Requests"]);

  // Every story as one document: the documentation of the system.
  const documentation = (await renderView(purchasing, { stories: true, format: "md" })).content;
  assert.match(documentation, /^# BC Atlas Purchasing Example\n/u);
  for (const title of ["What BC Atlas Purchasing Example is", "Purchase requests", "Purchase setup", "What to fix", "Dependencies the wrong way", "Who can do what"]) assert.ok(documentation.includes(`\n## ${title}\n`), title);

  await assert.rejects(renderView(purchasing, { story: "nope" }), /unknown story "nope"; this project has: system, process:use-case-purchase-requests, /u);
  await assert.rejects(renderView(purchasing, { story: "fix", step: 9 }), /--step must be a number from 1 to 4/u);
  await assert.rejects(renderView(multi, { lens: "people" }), /unknown lens "people"; this project has: system, components, /u, "a lens with nothing in it does not exist for a project");
});

test("a picture is drawn without a browser, in every form, the same every time", async () => {
  const picture = async (options) => (await renderView(purchasing, { format: "svg", ...options })).content;
  const diagram = await picture({ lens: "data", form: "diagram" });
  assert.match(diagram, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 1440 900" width="1440" height="900" role="img" aria-label="Data">/u);
  // Boxes with their names, and relations as curves between them.
  assert.equal([...diagram.matchAll(/<text /gu)].length, 7, "one name per node");
  for (const name of ["Purchase Request", "Purchase Request Mgt.", "Request Approval Entry"]) assert.ok(diagram.includes(`>${name}</text>`), name);
  assert.match(diagram, /<path d="M[\d. -]+C[\d. -]+"/u);
  assert.equal(diagram, await picture({ lens: "data", form: "diagram" }), "the same options give the same picture");

  const flat = await picture({ lens: "data" });
  assert.equal([...flat.matchAll(/<circle /gu)].length, 7, "one dot per node");
  assert.notEqual(flat, await picture({ lens: "data", form: "3d" }), "3D is another picture of the same nodes");
  // Dark, another size, a selection, and what a search finds standing out.
  const dark = await picture({ lens: "people", form: "diagram", theme: "dark", width: 800, height: 600, select: "person:Ben" });
  assert.match(dark, /viewBox="0 0 800 600"/u);
  assert.match(dark, /<rect width="800" height="600" fill="#16171a"\/>/u);
  const found = await picture({ lens: "system", find: "setup" });
  assert.ok([...found.matchAll(/fill-opacity="0\.26"/gu)].length > 5, "the rest steps back");
  // Check: a ring on what has a finding.
  const rings = (await renderView(multi, { format: "svg", check: true })).content;
  assert.ok([...rings.matchAll(/<circle [^>]*fill="none"|<circle [^>]* stroke="#C0392B" stroke-opacity/gu)].length > 0 || rings.includes('stroke="#C0392B"'), "the error is on the graph");

  const png = (await renderView(purchasing, { lens: "components", form: "diagram", format: "png" })).content;
  assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], "a PNG");
  await assert.rejects(renderView(purchasing, { format: "svg", width: 50 }), /--width must be a number of pixels from 200 to 8000/u);
  await assert.rejects(renderView(purchasing, { story: "fix", format: "csv" }), /a story writes text, md, or json; add --step/u);
});

test("a link opens the same view in the app", async () => {
  const link = (await renderView(purchasing, { lens: "people", form: "diagram", check: true, find: "Ben", format: "link" })).content.trim();
  assert.equal(link, "#lens=people&form=diagram&q=Ben&check=1");
  const atlas = await purchasing.atlas();
  const state = viewState(atlas, { inside: "codeunit:50220", form: "3d" });
  assert.equal(atlas.nodes.find(({ id }) => id === state.inside).label, "Purchase Request Mgt.");
  assert.match(S.stateHash(state), /^#form=3d&inside=.+codeunit%3A%3A50220$/u);
});

test("bca view prints to the terminal and writes files by their extension", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "bc-atlas-view-"));
  const run = (...args) => spawnSync(process.execPath, [cli, "view", path.join(root, "examples", "purchasing-app"), ...args], { encoding: "utf8", timeout: 180_000 });
  try {
    const overview = run();
    assert.equal(overview.status, 0, overview.stderr);
    assert.match(overview.stdout, /^BC Atlas Purchasing Example: 16 objects in 1 app/u);
    assert.match(overview.stdout, /\n {2}people {8}14 nodes, 21 relations/u);

    const svg = path.join(directory, "out", "people.svg");
    const written = run("--lens", "people", "--form", "diagram", "-o", svg);
    assert.equal(written.status, 0, written.stderr);
    assert.match(written.stderr, /People: 14 node\(s\), 21 relation\(s\)\nWrote /u);
    assert.equal(written.stdout, "");
    assert.match(readFileSync(svg, "utf8"), /^<svg .*>Ben \(Team lead\)<\/text>/su);

    const csv = path.join(directory, "relations.csv");
    assert.equal(run("--lens", "people", "--rows", "relations", "-o", csv).status, 0);
    assert.ok(readFileSync(csv, "utf8").includes("Ben (Team lead),Approve a released purchase request,blocked,1"));
    const png = path.join(directory, "system.png");
    assert.equal(run("--form", "3d", "--check", "-o", png).status, 0);
    assert.equal(readFileSync(png).subarray(1, 4).toString(), "PNG");
    const docs = path.join(directory, "system.md");
    assert.equal(run("--stories", "-o", docs).status, 0);
    assert.match(readFileSync(docs, "utf8"), /^# BC Atlas Purchasing Example\n/u);

    const json = run("--story", "people", "--format", "json");
    assert.equal(JSON.parse(json.stdout).id, "people");
    const wrong = run("--lens", "nope");
    assert.equal(wrong.status, 2);
    assert.match(wrong.stderr, /--lens must be one of: system, components, /u);
    const noFile = run("--format", "png");
    assert.equal(noFile.status, 2);
    assert.match(noFile.stderr, /a PNG needs --output/u);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
