// The layered documentation (src/app/layers.js) and `bca layers`, which keeps
// it in sync with the source: for the working tree, and for commits, tags, and
// releases of the past.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildLayers, compareStates, LAYERS_SCHEMA } from "../src/app/layers.js";
import { Workspace } from "../src/app/workspace.js";
import { taskOutputs, TASKS } from "../src/automation/config.js";
import { createCapabilities, findCommand } from "../src/capabilities.js";
import { syncLayers } from "../src/commands/layers.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(root, "src", "cli.js");
const multi = path.join(root, "examples", "multi-app");
const bca = (args, options = {}) => spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", timeout: 180_000, env: { ...process.env, BCA_AL_COMPILER: "off" }, ...options });
const git = (cwd, ...args) => {
  const result = spawnSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false", "-c", "tag.gpgsign=false", ...args], { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, `git ${args.join(" ")}: ${result.stderr}`);
  return result.stdout.trim();
};

/** Every relative link and picture of a Markdown page that leads to a file. */
const links = (text) => [...text.matchAll(/\]\(([^)#\s]+)(?:#[^)]*)?\)/gu)].map(([, target]) => target).filter((target) => !/^[a-z]+:/iu.test(target));

test("the layers are pages from the system down to each procedure, and every link leads somewhere", async () => {
  const { files, manifest, atlas } = await buildLayers(new Workspace(multi, {}, { live: false }));
  assert.equal(manifest.schema, LAYERS_SCHEMA);
  assert.equal(manifest.state, "working tree");
  assert.deepEqual(manifest.counts, { apps: 3, components: 3, namespaces: 4, objects: 12, relations: 26, findings: { error: 1, warning: 0, info: 11 } });
  assert.deepEqual(manifest.files, [...files.keys()].sort(), "the manifest lists every file, itself included");

  // Layer 0: the system, with its picture, and the way down to every layer.
  const system = files.get("README.md");
  assert.match(system, /^# multi-app\n\nThe source as it is now\.\n\n12 objects in 3 apps, 26 relations\. Health failed: 1 error, 0 warnings, 11 info\. Architecture \(configured\): 3 components, 1 dependency the wrong way\.\n\n!\[Overview\]\(system\.svg\)/u);
  assert.match(files.get("system.svg"), /^<svg /u);
  assert.match(system, /\| \[Integration\]\(components\/integration\.md\) \| Layer 2 \| 2 \| depends on \[Sales\]\(components\/sales\.md\), wrong way \[Core\]\(components\/core\.md\) \| 3 \(error\) \|/u);
  assert.match(system, /\| \[Data\]\(lenses\/data\.md\) \| 8 \| 9 \| Tables and the code that reads, writes, relates, and extends them\. \|/u);
  assert.match(system, /- \[What to fix\]\(stories\/fix\.md\)/u);

  // Layers 1 to 3: an app, a component, a namespace, each explained, drawn, and linked to its objects.
  const component = files.get("components/core.md");
  assert.match(component, /^# Component Core\n\n\[System\]\(\.\.\/README\.md\) › Layer 2: components\n\nThe component Core holds 6 objects \(2 codeunits, 2 tables, 1 interface, 1 page\) in layer 0\. It depends on no other component, and 2 other components depend on it\./u);
  assert.match(component, /!\[Core\]\(core\.svg\)/u);
  assert.match(component, /\| \[CON Item\]\(\.\.\/objects\/table-50000-con-item\.md\) \| table \| 50000 \| Contoso\.Core\.Items \| 17 \| 1 \| 4 \| 1 \(info\) \|/u);
  assert.match(files.get("apps/contoso-core.md"), /## Components\n\n\[Core\]\(\.\.\/components\/core\.md\)\n\n## Namespaces\n\n\[Contoso\.Core\.Items\]\(\.\.\/namespaces\/contoso-core-items\.md\), \[Contoso\.Core\.Pricing\]/u);

  // Layers 4 and 5: an object, the way up, what it uses, and what each procedure does.
  const object = files.get("objects/codeunit-50201-con-item-sync.md");
  assert.match(object, /^# codeunit 50201 CON Item Sync\n\n\[System\]\(\.\.\/README\.md\) › \[Contoso Integration\]\(\.\.\/apps\/contoso-integration\.md\) › \[Integration\]\(\.\.\/components\/integration\.md\) › \[Contoso\.Integration\]\(\.\.\/namespaces\/contoso-integration\.md\)/u);
  assert.match(object, /The codeunit CON Item Sync of the app Contoso Integration, in the component Integration, has 1 member in 10 lines\. It reads, uses, writes 1 other object, and nothing in this workspace uses it\./u);
  assert.match(object, /\| `procedure Sync\(ItemNo: Code\[20\]\)` \| procedure \| 7 \| 2 \| reads \[CON Item\]\(table-50000-con-item\.md\); writes \[CON Item\]\(table-50000-con-item\.md\) \|/u);
  assert.match(object, /- \*\*error\*\* `architecture-violation`: codeunit CON Item Sync \(Integration\) depends on 1 object\(s\) in Core/u);
  assert.match(files.get("objects/table-50000-con-item.md"), /## Used by\n\n(?:- .+\n)*- \*\*writes\*\* \[codeunit 50201 CON Item Sync\]\(codeunit-50201-con-item-sync\.md\)/u);

  // Across the layers: lenses, stories, findings, and the graph itself.
  assert.match(files.get("lenses/data.md"), /^# multi-app: Data\n\n\[System\]\(\.\.\/README\.md\) › Lenses\n\n!\[Data\]\(data\.svg\)/u);
  assert.match(files.get("stories/fix.md"), /\[System\]\(\.\.\/README\.md\) › Stories/u);
  assert.match(files.get("findings.md"), /^# Findings\n\n\[System\]\(README\.md\) › Findings\n\n1 error, 0 warnings, 11 info\.\n\n## Error\n\n- \*\*error\*\* `architecture-violation`.+\n {2}- On: \[CON Item Sync\]\(objects\/codeunit-50201-con-item-sync\.md\)\n {2}- Source: `integration\/ItemSync\.al:10`/u);
  const graph = JSON.parse(files.get("atlas.json"));
  assert.equal(graph.nodes.length, atlas.nodes.length);
  assert.equal(graph.updatedAt, undefined, "nothing in the folder says when it was written");

  for (const [file, text] of files) {
    if (!file.endsWith(".md")) continue;
    for (const target of links(text)) assert.ok(files.has(path.posix.normalize(path.posix.join(path.posix.dirname(file), target))), `${file} links to ${target}`);
  }
  // No page names the BC Atlas that wrote it, so an update of BC Atlas alone changes nothing.
  for (const [file, text] of files) if (file.endsWith(".md")) assert.doesNotMatch(text, /BC Atlas \d+\.\d+/u, file);
  // The same source gives the same files, byte for byte.
  const again = await buildLayers(new Workspace(multi, {}, { live: false }));
  assert.deepEqual([...again.files], [...files]);
  // Without pictures the pages stay, and no page shows one.
  const plain = await buildLayers(new Workspace(multi, {}, { live: false }), { pictures: "none" });
  assert.ok(![...plain.files.keys()].some((file) => file.endsWith(".svg")));
  assert.doesNotMatch(plain.files.get("README.md"), /!\[/u);
});

test("the pages say how it is connected, what to change, and how", async () => {
  const { files, atlas } = await buildLayers(new Workspace(multi, {}, { live: false }));
  // The first page leads there: how it works, how it is connected, what to change.
  const start = files.get("README.md");
  assert.match(start, /\n## Start here\n\n1\. \*\*How it works\*\*: the picture above, and \[what is in it\]\(lenses\/overview\.md\)\.\n2\. \*\*\[How it is connected\]\(architecture\.md\)\*\*: 3 apps, 3 components, and what depends on what\.\n3\. \*\*\[What to change, and how\]\(changes\.md\)\*\*: 7 changes, the most important first\.\n {3}- Declare that Contoso Integration depends on Contoso Core \(small\)\n/u);
  assert.ok(start.indexOf("## Start here") < start.indexOf("## Layers"));

  // How it is connected: the apps and the components, each with a picture and what depends on what.
  const connected = files.get("architecture.md");
  assert.match(connected, /^# How it is connected\n\n\[System\]\(README\.md\) › How it is connected\n\n3 apps, 3 components in 3 layers \(configured in \.bca\.json\)\. 57% of the coupling stays inside the components\. 1 dependency the wrong way, 0 cycles\.\n/u);
  assert.ok(connected.includes("![Apps](architecture-apps.svg)") && connected.includes("![Components](architecture-components.svg)"));
  assert.ok(files.get("architecture-apps.svg").startsWith("<svg ") && files.get("architecture-components.svg").startsWith("<svg "));
  assert.ok(connected.includes("| [Contoso Integration](apps/contoso-integration.md) | 2 | [Contoso Sales](apps/contoso-sales.md) (declared, 4 relations), objects that are not found (2 relations), [Contoso Core](apps/contoso-core.md) (undeclared, 3 relations) |  |"));
  assert.ok(connected.includes("| [Core](components/core.md) | Layer 0 | 6 |  | [Integration](components/integration.md) (wrong way), [Sales](components/sales.md) (depends on, 2 relations) | 55% | 0 | no | yes |"));
  assert.ok(connected.includes("## Shared data\n\nTables that are written from outside the component they belong to.\n\n- [CON Item](objects/table-50000-con-item.md) of Core, also written by Integration (codeunit 50201 CON Item Sync)."));
  assert.ok(connected.includes("[7 changes, the most important first](changes.md)."));

  // What to change, and how: the list of the atlas, each with why, the steps, the effort, and where.
  const changes = files.get("changes.md");
  assert.match(changes, /^# What to change, and how\n\n\[System\]\(README\.md\) › What to change\n\n7 changes to the architecture, the most important first; the last 2 are options\. Each says why, and how to do it\./u);
  assert.ok(changes.includes("| 3 | CON Item Sync: declare the dependency; it points inward | Dependency the wrong way | small |"));
  assert.ok(changes.includes([
    "### 3. CON Item Sync: declare the dependency; it points inward", "",
    "**Why.** The codeunit CON Item Sync of Integration depends on table CON Item of Core, which the configured architecture does not allow.", "",
    "**How.**", "",
    "1. Add Core to dependsOn of Integration in .bca.json (and to app.json when they are separate apps).",
    "2. Or: go through a component you already depend on (effort M).", "",
    "Effort: small. On: [CON Item Sync](objects/codeunit-50201-con-item-sync.md), [CON Item](objects/table-50000-con-item.md). Source: `integration/ItemSync.al:6`."
  ].join("\n")));
  assert.ok(changes.indexOf("## Options") > changes.indexOf("### 5.") && changes.indexOf("## Options") < changes.indexOf("### 6."), "what is not wrong as it is comes last");
  assert.equal([...changes.matchAll(/^### \d+\. /gmu)].length, atlas.changes.length);

  // A page says what there is to change about it, and leads to how.
  const app = files.get("apps/contoso-integration.md");
  assert.ok(app.includes("## What to change here\n\n- 1. Declare that Contoso Integration depends on Contoso Core (small)\n"));
  assert.ok(app.includes("Why and how: [What to change, and how](../changes.md)."));
  assert.ok(files.get("objects/table-50000-con-item.md").includes("- 4. Let Core own the writes to table 50000 CON Item (medium)"));
  assert.ok(!files.get("apps/contoso-sales.md").includes("Declare that"), "only what is about it");
  for (const page of ["README.md", "architecture.md", "changes.md", "apps/contoso-integration.md"]) {
    for (const target of links(files.get(page))) assert.ok(files.has(path.posix.normalize(path.posix.join(path.posix.dirname(page), target))), `${page} links to ${target}`);
  }

  // Without a configured architecture the first change is to decide on one; what follows rests on the proposal.
  const proposed = await buildLayers(new Workspace(path.join(root, "examples", "purchasing-app"), {}, { live: false }), { pictures: "none" });
  assert.deepEqual(proposed.atlas.changes.slice(0, 2).map(({ kind, title }) => [kind, title]), [["architecture", "Decide on the architecture"], ["cycle", "Break the cycle between Purchase and Request"]]);
  assert.match(proposed.atlas.changes[0].why, /^No architecture is configured\. From the code, BC Atlas proposes 2 components in 2 layers: Purchase, Request\. 76% of the coupling stays inside them\./u);
  assert.ok(proposed.atlas.changes[0].how.includes("Save it: `bca architecture --write`."));
  assert.match(proposed.atlas.changes[1].why, /The way from Request to Purchase is the thinnest: 3 object dependencies/u);
  assert.ok(proposed.atlas.changes.filter(({ kind }) => kind === "dependency").every((change) => change.proposed), "against a proposal a dependency the wrong way is a suggestion");
  assert.match(proposed.files.get("architecture.md"), /1 app, 2 components in 2 layers \(proposed from the code; none is configured\)\./u);
  assert.ok(proposed.files.get("architecture.md").includes("[decide on one](changes.md)"));

  // Nothing to change is an answer too.
  const calm = await buildLayers(new Workspace(path.join(root, "examples", "warehouse-app"), {}, { live: false }), { pictures: "none" });
  assert.deepEqual(calm.atlas.changes, []);
  assert.match(calm.files.get("changes.md"), /\n\nNothing to change\. No app uses another without declaring it, /u);
  assert.ok(calm.files.get("README.md").includes("3. **[What to change, and how](changes.md)**: nothing, as it stands."));
  assert.deepEqual(calm.atlas.stories.find(({ id }) => id === "architecture").steps.map(({ title }) => title), ["Nothing to change"]);
});

test("bca layers keeps the folder in sync: it writes what changed, removes what is gone, and --check only looks", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "bc-atlas-layers-"));
  try {
    cpSync(multi, directory, { recursive: true });
    const output = path.join(directory, "docs", "layers");
    const run = (...args) => bca(["layers", ".", "--format", "json", ...args], { cwd: directory });
    assert.equal(run("--check").status, 1, "nothing is written yet");
    assert.ok(!existsSync(output), "--check writes nothing");

    const first = JSON.parse(run().stdout);
    assert.deepEqual([first.inSync, first.current.removed, first.current.unchanged], [true, [], 0]);
    assert.equal(first.current.written.length, JSON.parse(readFileSync(path.join(output, "layers.json"), "utf8")).files.length);
    assert.equal(run("--check").status, 0);
    const second = JSON.parse(run().stdout);
    assert.deepEqual([second.current.written, second.current.removed], [[], []], "a second run changes nothing");

    // The source changes: a procedure more in one object, and one object less.
    const sync = path.join(directory, "integration", "ItemSync.al");
    writeFileSync(sync, readFileSync(sync, "utf8").replace(/\n\}\s*$/u, "\n    procedure Clear()\n    begin\n    end;\n}\n"));
    const pricing = path.join(directory, "core", "Pricing.al");
    const source = readFileSync(pricing, "utf8");
    const start = source.indexOf("codeunit 50011");
    assert.ok(start > 0);
    writeFileSync(pricing, source.slice(0, start));
    const check = run("--check");
    assert.equal(check.status, 1);
    assert.ok(JSON.parse(check.stdout).current.written.includes("objects/codeunit-50201-con-item-sync.md"));
    const after = JSON.parse(run().stdout);
    assert.ok(after.current.written.includes("objects/codeunit-50201-con-item-sync.md"));
    assert.ok(after.current.removed.includes("objects/codeunit-50011-con-pricing-mgt.md"), "the page of an object that is gone goes too");
    assert.ok(!existsSync(path.join(output, "objects", "codeunit-50011-con-pricing-mgt.md")));
    assert.ok(after.current.unchanged > 20, "what did not change is not written again");
    assert.match(readFileSync(path.join(output, "objects", "codeunit-50201-con-item-sync.md"), "utf8"), /`procedure Clear\(\)`/u);
    // A file someone else put there stays.
    writeFileSync(path.join(output, "NOTES.md"), "mine\n");
    run();
    assert.equal(readFileSync(path.join(output, "NOTES.md"), "utf8"), "mine\n");

    const text = bca(["layers", ".", "--check"], { cwd: directory });
    assert.equal(text.status, 0);
    assert.match(text.stderr, /[\w-]+: 11 object\(s\) in 3 app\(s\), 3 component\(s\), 4 namespace\(s\); \d+ file\(s\) in docs\/layers\nIn sync with the source\./u);
    assert.equal(bca(["layers", ".", "--pictures", "some"], { cwd: directory }).status, 2);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a commit, a tag, or a release is recorded as it was, and the history says what changed", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "bc-atlas-layers-history-"));
  try {
    cpSync(multi, directory, { recursive: true });
    git(directory, "init", "-q", "-b", "main");
    git(directory, "add", "-A");
    git(directory, "commit", "-q", "-m", "first");
    git(directory, "tag", "v1.0.0");
    const sync = path.join(directory, "integration", "ItemSync.al");
    const before = readFileSync(sync, "utf8");
    writeFileSync(sync, `${before}\ncodeunit 50202 "CON Item Audit"\n{\n    procedure Log(ItemNo: Code[20])\n    var\n        Item: Record "CON Item";\n    begin\n        Item.Get(ItemNo);\n    end;\n}\n`);
    git(directory, "add", "-A");
    git(directory, "commit", "-q", "-m", "second");
    git(directory, "tag", "v1.1.0");
    const first = git(directory, "rev-parse", "v1.0.0");
    // The working tree goes on: it is not what a state of the past is read from.
    writeFileSync(sync, before);

    const output = path.join(directory, "docs", "layers");
    const recorded = await syncLayers(directory, { at: ["v1.0.0"], compiler: "off" });
    assert.deepEqual(recorded.states.map(({ label, status, folder }) => [label, status, folder]), [["v1.0.0", "added", "history/v1.0.0"]]);
    assert.equal(recorded.current, undefined, "--at records that state only");
    const state = path.join(output, "history", "v1.0.0");
    assert.match(readFileSync(path.join(state, "README.md"), "utf8"), new RegExp(`^# ${path.basename(directory)}\\n\\nThe source as it was at \\*\\*v1\\.0\\.0\\*\\* \\(commit \`${first.slice(0, 10)}\` of \\d{4}-\\d{2}-\\d{2}\\)\\.`, "u"));
    assert.deepEqual(JSON.parse(readFileSync(path.join(state, "layers.json"), "utf8")).state.commit, first);
    assert.match(readFileSync(path.join(state, "view.html"), "utf8"), /BCA_SNAPSHOT_GZIP/u, "the view of that state, to open in a browser");
    assert.equal(readFileSync(sync, "utf8"), before, "the working tree is not touched");
    assert.equal(git(directory, "worktree", "list").split("\n").length, 1, "the temporary checkout is gone");

    // Every release, the working tree, and the page that compares them.
    const all = await syncLayers(directory, { releases: true, compiler: "off" });
    assert.deepEqual(all.states.map(({ label, status }) => [label, status]), [["v1.0.0", "recorded"], ["v1.1.0", "added"]]);
    assert.ok(all.current.written.includes("README.md"));
    assert.match(readFileSync(path.join(output, "README.md"), "utf8"), /## History\n\n\[The system as it was\]\(history\/README\.md\)/u);
    const history = readFileSync(path.join(output, "history", "README.md"), "utf8");
    assert.match(history, /\| \[Now \(working tree\)\]\(\.\.\/README\.md\) \| {2}\| {2}\| 12 \| 26 \| 1 \/ 0 \/ 11 \|\n\| \[v1\.1\.0\]\(v1\.1\.0\/README\.md\) \| `[0-9a-f]{10}` \| \d{4}-\d{2}-\d{2} \| 13 \| 28 \|/u);
    assert.match(history, /## Now, since v1\.1\.0\n\n- \*\*Objects removed\*\* \(1\): codeunit 50202 CON Item Audit\n- \*\*Relations\*\*: 0 added, 2 removed/u);
    assert.match(history, /## v1\.1\.0, since v1\.0\.0\n\n- \*\*Objects added\*\* \(1\): codeunit 50202 CON Item Audit\n- \*\*Relations\*\*: 2 added, 0 removed\n- \*\*New findings\*\* \(\d+\): /u);
    assert.match(history, /## v1\.0\.0\n\n- The first recorded state\./u);

    // In sync: nothing to write, every release recorded. A release that is missing is not in sync.
    assert.equal((await syncLayers(directory, { releases: true, check: true, compiler: "off" })).inSync, true);
    rmSync(path.join(output, "history", "v1.1.0"), { recursive: true });
    const missing = await syncLayers(directory, { releases: true, check: true, compiler: "off" });
    assert.equal(missing.inSync, false);
    assert.deepEqual(missing.states.map(({ label, status }) => [label, status]), [["v1.0.0", "recorded"], ["v1.1.0", "missing"]]);
    // A commit is a state too, named by its hash; --last takes the newest releases.
    const commit = await syncLayers(directory, { at: [first.slice(0, 8)], compiler: "off" });
    assert.deepEqual(commit.states.map(({ label, folder }) => [label, folder]), [[first.slice(0, 10), `history/${first.slice(0, 10)}`]]);
    assert.deepEqual((await syncLayers(directory, { releases: true, last: "1", check: true, compiler: "off" })).states.map(({ label }) => label), ["v1.1.0"]);
    await assert.rejects(syncLayers(directory, { at: ["v9"], compiler: "off" }), /--at "v9" names no commit, tag, or release of this repository/u);
    assert.deepEqual(readdirSync(path.join(output, "history")).sort(), ["README.md", first.slice(0, 10), "v1.0.0"].sort());
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("two states of the source are compared by what BC Atlas reads from them", async () => {
  const { atlas } = await buildLayers(new Workspace(multi, {}, { live: false }), { pictures: "none" });
  const same = compareStates(atlas, atlas);
  assert.deepEqual(same, { added: [], removed: [], changed: [], relations: { added: 0, removed: 0 }, others: { added: [], removed: [] }, findings: { new: [], fixed: [] } });
  const item = atlas.nodes.findIndex((node) => node.label === "CON Item" && node.kind === "object");
  const later = { ...atlas, nodes: atlas.nodes.map((node, index) => (index === item ? { ...node, lines: 40 } : node)), findings: atlas.findings.filter(({ rule }) => rule !== "architecture-violation") };
  const changes = compareStates(atlas, later);
  assert.deepEqual(changes.changed, ["table 50000 CON Item"]);
  assert.equal(changes.findings.fixed.length, 1);
  assert.match(changes.findings.fixed[0], /^error architecture-violation: /u);
});

test("layers is a command with options for every setting, and a task of bca run", () => {
  const command = findCommand(createCapabilities("0.0.0"), "layers");
  for (const option of ["output", "at", "releases", "last", "refresh", "check", "pictures", "view", "format"]) assert.ok(command.options[option], option);
  assert.deepEqual(command.options.pictures.enum, ["auto", "all", "none"]);
  assert.ok(TASKS.layers);
  assert.deepEqual(taskOutputs("layers", {}), ["docs/layers"]);
  assert.deepEqual(taskOutputs("layers", { layers: { outputDir: "docs/system" } }), ["docs/system"]);

  const directory = mkdtempSync(path.join(os.tmpdir(), "bc-atlas-layers-run-"));
  try {
    cpSync(multi, directory, { recursive: true });
    const config = JSON.parse(readFileSync(path.join(directory, ".bca.json"), "utf8"));
    writeFileSync(path.join(directory, ".bca.json"), JSON.stringify({ ...config, layers: { outputDir: "docs/system", pictures: "none" } }, null, 2));
    const run = bca(["run", ".", "--tasks", "layers", "--format", "json"], { cwd: directory });
    assert.equal(run.status, 0, run.stderr);
    const result = JSON.parse(run.stdout).results[0];
    assert.equal(result.task, "layers");
    assert.match(result.summary, /^\d+ written, 0 removed, 0 unchanged$/u);
    assert.ok(existsSync(path.join(directory, "docs", "system", "README.md")));
    assert.ok(!existsSync(path.join(directory, "docs", "system", "system.svg")), "layers.pictures none");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("the pages of the example in the repository link to files that are in the repository", () => {
  // The pictures are generated files: a rule that ignores them leaves the pages without pictures and breaks the website.
  const example = path.join(root, "examples", "layers");
  const manifest = JSON.parse(readFileSync(path.join(example, "layers.json"), "utf8"));
  const tracked = new Set(spawnSync("git", ["ls-files", "examples/layers"], { cwd: root, encoding: "utf8" }).stdout.split("\n").filter(Boolean).map((file) => file.slice("examples/layers/".length)));
  for (const file of manifest.files) {
    assert.ok(existsSync(path.join(example, file)), `examples/layers/${file} exists`);
    if (tracked.size) assert.ok(tracked.has(file), `examples/layers/${file} is committed, not ignored`);
    if (!file.endsWith(".md")) continue;
    for (const target of links(readFileSync(path.join(example, file), "utf8"))) assert.ok(existsSync(path.join(example, path.dirname(file), target)), `examples/layers/${file} links to ${target}`);
  }
});
