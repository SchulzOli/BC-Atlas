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
  assert.equal(command.options.lens.enum, undefined, "plugins add lenses, so a lens is checked against the project");
  for (const lens of VIEW_LENSES) assert.ok(command.options.lens.description.includes(lens), lens);
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
  assert.match(content, /Lenses \(bca view --lens <id>\)\n {2}overview {4}12 nodes, 9 relations {9}How it works, from left to right: .+\n {2}system {6}13 nodes, 30 relations/u);
  assert.match(content, /Stories \(bca view --story <id>\)\n {2}system {8}14 steps/u);
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
  assert.deepEqual(overview.stories.map(({ id, steps }) => [id, steps]), [["system", 14], ["fix", 1], ["architecture", 7]]);

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
  await assert.rejects(renderView(purchasing, { inside: "person:Ben" }), /--inside needs an object, an app, a component, or a namespace of the workspace; "person:Ben" is a person\. Use --focus/u);
  await assert.rejects(renderView(multi, { inside: "CON Sales Quote" }), /--inside "CON Sales Quote" names 2 nodes: (?:page|table):50100, (?:page|table):50100; add the type, as in (?:page|table):50100/u);
  await assert.rejects(renderView(multi, { focus: "Nope" }), /--focus "Nope" names no node/u);
});

test("the overview shows how it works, in columns from who uses it to the data", async () => {
  const atlas = await purchasing.atlas();
  const found = S.index(atlas);
  // The view opens on it, as a diagram.
  assert.deepEqual([S.DEFAULTS.lens, S.DEFAULTS.form, atlas.lenses[0].id, S.formOf(atlas, S.DEFAULTS)], ["overview", "", "overview", "diagram"]);
  assert.equal(S.formOf(atlas, { ...S.DEFAULTS, lens: "system" }), "2d", "a lens without a form of its own is a graph in a plane");
  assert.equal(S.formOf(atlas, { ...S.DEFAULTS, form: "3d" }), "3d", "the form a state names wins");
  const scene = S.scene(atlas, found, { ...S.DEFAULTS });
  assert.equal(scene.flow, true);
  assert.deepEqual(scene.columns.map(({ title }) => title), ["People", "Processes", "Screens", "Logic", "Data"]);
  const column = (title) => scene.nodes.filter(({ rank }) => rank === scene.columns.find((entry) => entry.title === title).rank).map(({ label }) => label);
  assert.deepEqual(column("People"), ["Anna (Employee)", "Ben (Team lead)", "Carla (Purchaser)", "Dana (Administrator)"]);
  // Process tests stand in the order of the process.
  assert.deepEqual(scene.nodes.filter(({ order }) => order !== undefined).sort((a, b) => a.order - b.order).map(({ label }) => label).slice(0, 3),
    ["Create a new Purchase Request", "Release a purchase request so that it can be approved", "Approve a released purchase request"]);
  assert.deepEqual(column("Screens").sort(), ["Purchase Request Setup", "Purchase Requests", "Request Approval Entries"]);
  assert.deepEqual(column("Logic").sort(), ["Purchase Order Creation", "Purchase Request Mgt.", "Request Notifications"]);
  assert.deepEqual(column("Data").sort(), ["Purchase Request", "Purchase Request Setup", "Request Approval Entry"]);
  // What is not part of how it works is not in it: permission sets, enums, and the test codeunit.
  for (const label of ["PR - APPROVE", "Purchase Request Status", "Purchase Request UI Tests"]) assert.ok(!scene.nodes.some((node) => node.label === label), label);
  assert.equal(atlas.nodes.find(({ label }) => label === "Purchase Request UI Tests").test, true);
  // Few kinds of relation, each from a column on the left to one on the right, each pair once.
  assert.deepEqual(scene.kinds.map(({ kind }) => kind), ["does", "stopped at", "uses"]);
  assert.ok(scene.edges.every(([from, to]) => scene.nodes[from].rank < scene.nodes[to].rank));
  assert.equal(new Set(scene.edges.map(([from, to]) => `${from}>${to}`)).size, scene.edges.length);
  const at = (label, title) => scene.nodes.findIndex((node) => node.label === label && (!title || node.rank === scene.columns.find((entry) => entry.title === title).rank));
  const kindOf = (from, to) => scene.edges.filter(([a, b]) => a === at(from) && b === at(to)).map(([, , kind]) => scene.kinds[kind].kind);
  assert.deepEqual(kindOf("Ben (Team lead)", "Approve a released purchase request"), ["stopped at"]);
  assert.deepEqual(kindOf("Anna (Employee)", "Create a new Purchase Request"), ["does"]);
  // A process test leads to what it touches first; what that uses is reached through it.
  assert.deepEqual(kindOf("Approve a released purchase request", "Purchase Requests"), ["uses"]);
  assert.deepEqual(kindOf("Approve a released purchase request", "Purchase Request Mgt."), []);

  // The way of a process test: who performs it, and everything it touches.
  const names = (set) => [...set].map((index) => scene.nodes[index].label).sort();
  const way = S.highlight(atlas, scene, { ...S.DEFAULTS, sel: scene.nodes[at("Approve a released purchase request")].id });
  assert.deepEqual(names(way), ["Approve a released purchase request", "Ben (Team lead)", "Purchase Request", "Purchase Request Mgt.", "Purchase Request Setup", "Purchase Requests", "Request Approval Entry", "Request Notifications"]);
  // The way of an object: what uses it, what it uses, the process tests that touch it, and who performs them.
  const logic = names(S.highlight(atlas, scene, { ...S.DEFAULTS, sel: scene.nodes[at("Request Notifications")].id }));
  assert.ok(logic.includes("Approve a released purchase request") && logic.includes("Ben (Team lead)") && logic.includes("Purchase Request"));
  assert.ok(!logic.includes("Set the highest amount that can be approved") && !logic.includes("Dana (Administrator)"));
  // Another lens lights nothing by a selection alone.
  assert.equal(S.highlight(atlas, S.scene(atlas, found, { ...S.DEFAULTS, lens: "system" }), { ...S.DEFAULTS, lens: "system", sel: scene.nodes[at("Request Notifications")].id }), undefined);

  // As text it reads in the order of the columns; as a picture the columns have their titles.
  const text = (await renderView(purchasing, { lens: "overview" })).content;
  assert.match(text, /^BC Atlas Purchasing Example: Overview\n18 nodes, 23 relations\. How it works, from left to right: /u);
  assert.deepEqual([...text.matchAll(/^(\S[^\n]*)$/gmu)].map(([line]) => line).slice(2), ["People", "Processes", "Screens", "Logic", "Data"]);
  const picture = (await renderView(purchasing, { lens: "overview", format: "svg" })).content;
  for (const title of ["PEOPLE", "PROCESSES", "SCREENS", "LOGIC", "DATA"]) assert.ok(picture.includes(`>${title}</text>`), title);
  // The columns stand from left to right.
  const x = (label) => Number(picture.match(new RegExp(`<text x="([\\d.-]+)"[^>]*>${label}</text>`, "u"))[1]);
  assert.ok(x("PEOPLE") < x("PROCESSES") && x("PROCESSES") < x("SCREENS") && x("SCREENS") < x("LOGIC") && x("LOGIC") < x("DATA"));
  assert.ok(Math.abs(x("Ben \\(Team lead\\)") - x("PEOPLE")) < 40 && Math.abs(x("Request Notifications") - x("LOGIC")) < 40, "each node under the title of its column");

  // Without process tests the overview is screens, logic, and data.
  const plain = S.scene(await multi.atlas(), S.index(await multi.atlas()), { ...S.DEFAULTS });
  assert.deepEqual(plain.columns.map(({ title }) => title), ["Screens", "Logic", "Data"]);
  assert.ok(plain.nodes.some(({ label }) => label === "Customer"), "what it uses of other apps is part of how it works");
});

test("a large project shows areas in the overview, and an area opens to its objects", async () => {
  // 60 pages, codeunits, and tables in three components: more than the overview shows one by one.
  const nodes = [];
  const edges = [];
  for (const [component, count] of [["Sales", 30], ["Stock", 20], ["Finance", 10]]) {
    nodes.push({ id: `component::${component}`, kind: "component", label: component, color: "#000000" });
    for (let at = 0; at < count; at++) {
      const type = ["page", "codeunit", "table"][at % 3];
      nodes.push({ id: `${component}-${at}`, kind: "object", type, label: `${component} ${type} ${at}`, component, color: "#000000" });
      // A page uses the codeunit after it, a codeunit the table after it.
      if (type !== "table") edges.push([nodes.length - 1, nodes.length, 0, 1]);
    }
  }
  // Stock uses the data of Sales.
  edges.push([nodes.findIndex(({ id }) => id === "Stock-1"), nodes.findIndex(({ id }) => id === "Sales-2"), 0, 3]);
  const lens = { id: "overview", title: "Overview", summary: "How it works.", flow: true, form: "diagram", kinds: ["object"], relations: ["calls"], group: "kind", color: "type" };
  const atlas = { title: "Large", nodes, edges, relations: [{ kind: "calls" }], lenses: [lens, { id: "system", title: "System", summary: "", kinds: ["object"], relations: ["calls"], group: "component", color: "type" }], findings: [], stories: [], levels: {} };
  const found = S.index(atlas);
  const scene = S.scene(atlas, found, { ...S.DEFAULTS });
  assert.deepEqual(scene.columns.map(({ title }) => title), ["Screens", "Logic", "Data"]);
  // One box per area and column, the largest area first in every column.
  assert.deepEqual(scene.nodes.filter(({ rank }) => rank === 2).sort((a, b) => a.order - b.order).map(({ label }) => label), ["Sales · 10", "Stock · 7", "Finance · 4"]);
  assert.equal(scene.nodes.length, 9);
  const area = scene.entries.find(({ node }) => node.id === "area::logic::Stock").node;
  assert.deepEqual([area.kind, area.count, area.holder], ["area", 7, "component::Stock"]);
  assert.match(area.about, /^7 logic objects of Stock: Stock codeunit 1, /u);
  // Relations between areas, with how many there are; what runs through the column between is told by that way.
  const edge = (from, to) => scene.edges.find(([a, b]) => scene.nodes[a].id === from && scene.nodes[b].id === to);
  assert.equal(edge("area::screens::Sales", "area::logic::Sales")[3], 10);
  assert.equal(edge("area::logic::Stock", "area::data::Sales")[3], 3);
  assert.equal(edge("area::screens::Sales", "area::data::Sales"), undefined);
  // A double click on an area goes into its component: how that works, object by object.
  assert.deepEqual(S.into(atlas, area, { ...S.DEFAULTS }), { inside: "component::Stock", focus: "", sel: "", story: "" });
  const inside = S.scene(atlas, found, { ...S.DEFAULTS, inside: "component::Stock" });
  assert.equal(inside.title, "Stock");
  assert.equal(inside.nodes.length, 20);
  assert.ok(inside.nodes.every(({ label }) => label.startsWith("Stock ")));
});

test("an app, a component, and a namespace open to their objects", async () => {
  assert.match((await renderView(multi, { lens: "system", inside: "component:Core" })).content, /^multi-app: Core\n6 nodes, 9 relations\. The objects of the component Core, and what they do with each other\./u);
  assert.match((await renderView(multi, { lens: "system", inside: "Contoso Core" })).content, /^multi-app: Contoso Core\n6 nodes, 9 relations\. The objects of the app Contoso Core/u);
  // From the overview a component opens to how it works: its screens, its logic, its data.
  assert.match((await renderView(multi, { inside: "component:Core" })).content, /^multi-app: Core\n6 nodes, 3 relations\. How the component Core works, from left to right: its screens, its logic, its data, and who uses them\.\n\nScreens\n {2}page CON Item Card/u);
  const namespace = JSON.parse((await renderView(multi, { lens: "system", inside: "Contoso.Core.Items", format: "json" })).content);
  assert.deepEqual(namespace.nodes.map(({ label }) => label).sort(), ["CON Item", "CON Item Card", "CON Price Group"]);
  assert.equal(namespace.relations.length, 2);
});

test("every node leads on, and the way back is a trail", async () => {
  const atlas = await multi.atlas();
  const found = S.index(atlas);
  const node = (label, kind) => atlas.nodes.find((candidate) => candidate.label === label && (!kind || candidate.kind === kind));
  const state = { ...S.DEFAULTS, lens: "components" };
  const core = node("Core", "component");
  const item = node("CON Item", "object");
  // A double click goes into what a node is made of: a component into its objects, an object into its procedures.
  assert.deepEqual(S.into(atlas, core, state), { inside: core.id, focus: "", sel: core.id, story: "" });
  assert.deepEqual(S.into(atlas, item, { ...state, inside: core.id }), { inside: item.id, focus: "", sel: item.id, story: "" });
  assert.equal(S.into(atlas, item, { ...state, inside: item.id }), undefined, "it is open already");
  assert.equal(S.into(atlas, { kind: "member", id: "x" }, state), undefined, "a procedure opens in the source");
  // What is in another app has no inside here: the view shows what is next to it.
  const customer = atlas.nodes.find(({ external }) => external);
  assert.deepEqual(S.into(atlas, customer, state), { lens: "system", inside: "", focus: customer.id, depth: "1", sel: customer.id, story: "" });

  // Where the view is: the lens, the component of an opened object, the object, and what it is near.
  const trail = S.trail(atlas, found, { ...state, inside: item.id, focus: node("CON Item Sync").id });
  assert.deepEqual(trail.map(({ label }) => label), ["Components", "Core", "CON Item", "near CON Item Sync"]);
  assert.deepEqual(trail[0].change, { inside: "", focus: "", story: "" });
  assert.deepEqual(trail[1].change, { inside: core.id, focus: "", sel: core.id, story: "" });
  assert.deepEqual(trail[2].change, { inside: item.id, focus: "", story: "" });
  assert.deepEqual(S.trail(atlas, found, state).map(({ label }) => label), ["Components"], "a lens alone has no way back");

  // The same node from another side: the lenses it is in.
  assert.deepEqual(S.lensesOf(atlas, found, item.id).map(({ id }) => id), ["overview", "system", "data", "pages", "visibility", "health"]);
  assert.deepEqual(S.lensesOf(atlas, found, core.id).map(({ id }) => id), ["components"]);

  // A person, a process, a recording: each leads to the lens it lives in, with what is near it.
  const people = await purchasing.atlas();
  const kind = (name) => people.nodes.find((candidate) => candidate.kind === name);
  assert.deepEqual(S.into(people, kind("person"), { ...S.DEFAULTS, lens: "system" }), { lens: "people", inside: "", focus: kind("person").id, depth: "1", sel: kind("person").id, story: "" });
  assert.equal(S.into(people, kind("process"), { ...S.DEFAULTS }).lens, "processes");
  assert.equal(S.into(people, kind("process"), { ...S.DEFAULTS }).depth, "2");
  assert.equal(S.into(people, kind("recording"), { ...S.DEFAULTS }).lens, "sync");
  // In the overview a person stays in it: the person and what is next to them.
  assert.equal(S.into(people, kind("person"), { ...S.DEFAULTS }).lens, "overview");
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
  for (const title of ["What BC Atlas Purchasing Example is", "Purchase requests", "Purchase setup", "What to fix", "What to change, and how", "Who can do what"]) assert.ok(documentation.includes(`\n## ${title}\n`), title);

  await assert.rejects(renderView(purchasing, { story: "nope" }), /unknown story "nope"; this project has: system, process:use-case-purchase-requests, /u);
  await assert.rejects(renderView(purchasing, { story: "fix", step: 9 }), /--step must be a number from 1 to 4/u);
  await assert.rejects(renderView(multi, { lens: "people" }), /unknown lens "people"; this project has: overview, system, components, /u, "a lens with nothing in it does not exist for a project");
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

test("a run builds its picture step by step: a step shows what the run reached so far", async () => {
  const atlas = await purchasing.atlas();
  const ben = atlas.stories.find(({ id }) => id === "run:Ben");
  const state = { ...S.DEFAULTS, lens: "run", form: "diagram", story: "run:Ben", step: "1" };
  const scene = S.scene(atlas, S.index(atlas), state);
  const seen = (step, story = "run:Ben") => scene.entries.filter((entry, at) => S.shown(scene, { ...state, story, step: String(step) }, atlas).nodes[at]).map(({ node }) => node.label).sort();
  assert.deepEqual(seen(0), ["Ben (Team lead)"]);
  assert.deepEqual(seen(1), ["Ben (Team lead)", "Create a new Purchase Request", "Purchase Request", "Purchase Requests"]);
  assert.ok(seen(ben.steps.length - 1).length > seen(1).length);
  assert.ok(!seen(ben.steps.length - 1).includes("Anna (Employee)"), "a run shows its own person");
  // A story that does not build shows its lens as it is.
  assert.equal(seen(0, "people").length, scene.entries.length);

  // The command and the tool draw the same: step 2 holds four nodes, the end holds the whole run.
  const early = await renderView(purchasing, { story: "run:Ben", step: 2, form: "diagram", format: "svg" });
  assert.match(early.content, /Create a new Purchase Request/u);
  assert.doesNotMatch(early.content, /Approve a released|Request Notifications|Anna/u);
  const end = await renderView(purchasing, { story: "run:Ben", step: ben.steps.length, form: "diagram", format: "svg" });
  assert.match(end.content, /Request Notifications/u);
  assert.doesNotMatch(end.content, /Anna|Carla/u);
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
    assert.match(wrong.stderr, /unknown lens "nope"; this project has: overview, system, components, .+, requirements, simulation, run, sync\n/u);
    const noFile = run("--format", "png");
    assert.equal(noFile.status, 2);
    assert.match(noFile.stderr, /a PNG needs --output/u);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
