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

import { buildLayers, LAYERS_SCHEMA } from "../src/app/layers.js";
import { Workspace } from "../src/app/workspace.js";
import { createCapabilities, findCommand } from "../src/capabilities.js";
import { syncLayers } from "../src/commands/layers.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(root, "src", "cli.js");
const multi = path.join(root, "examples", "multi-app");
const bca = (args, options = {}) => spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", timeout: 180_000, ...options });
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
  assert.deepEqual(manifest.counts, { apps: 3, namespaces: 4, objects: 12, relations: 26, findings: { error: 0, warning: 1, info: 7 } });
  assert.deepEqual(manifest.files, [...files.keys()].sort(), "the manifest lists every file, itself included");

  // Layer 0: the system, with its picture, and the way down to every layer.
  const system = files.get("README.md");
  assert.match(system, /^# multi-app\n\n12 objects in 3 apps, 26 relations\. Health passed: 0 errors, 1 warning, 7 info\.\n\n!\[Overview\]\(system\.svg\)/u);
  assert.match(files.get("system.svg"), /^<svg /u);
  assert.ok(system.includes("| [Contoso Integration](apps/contoso-integration.md) | 1.0.0.0 | 2 | declared [Contoso Sales](apps/contoso-sales.md), objects that are not found, undeclared [Contoso Core](apps/contoso-core.md) | 3 (warning) |"), "what no app holds is not named like an app");
  assert.ok(system.includes("| [Contoso.Core.Pricing](namespaces/contoso-core-pricing.md) | Contoso Core | 3 | depends on [Contoso.Core.Items](namespaces/contoso-core-items.md) | 3 (info) |"));
  assert.match(system, /\| \[Data\]\(lenses\/data\.md\) \| 8 \| 9 \| Tables and the code that reads, writes, relates, and extends them\. \|/u);
  assert.match(system, /- \[What to fix\]\(stories\/fix\.md\)/u);

  // Layers 1 and 2: an app and a namespace, each explained, drawn, and linked to its objects.
  const namespace = files.get("namespaces/contoso-core-items.md");
  assert.ok(namespace.startsWith("# Namespace Contoso.Core.Items\n\n[System](../README.md) › Layer 2: namespaces\n\nThe namespace Contoso.Core.Items holds 3 objects (2 tables, 1 page). It depends on no other namespace, and 3 other namespaces depend on it.\n"));
  assert.ok(namespace.includes("![Contoso.Core.Items](contoso-core-items.svg)"));
  assert.ok(namespace.includes("| [CON Item](../objects/table-50000-con-item.md) | table | 50000 | 17 | 1 | 4 |  |"));
  assert.ok(files.get("apps/contoso-core.md").includes("## Namespaces\n\n[Contoso.Core.Items](../namespaces/contoso-core-items.md), [Contoso.Core.Pricing](../namespaces/contoso-core-pricing.md)\n"));

  // Layers 3 and 4: an object, the way up, what it uses, and what each procedure does.
  const object = files.get("objects/codeunit-50201-con-item-sync.md");
  assert.ok(object.startsWith("# codeunit 50201 CON Item Sync\n\n[System](../README.md) › [Contoso Integration](../apps/contoso-integration.md) › [Contoso.Integration](../namespaces/contoso-integration.md)\n"));
  assert.match(object, /The codeunit CON Item Sync of the app Contoso Integration has 1 member in 10 lines\. It reads, uses, writes 1 other object, and nothing in this workspace uses it\./u);
  assert.match(object, /\| `procedure Sync\(ItemNo: Code\[20\]\)` \| procedure \| 7 \| 2 \| reads \[CON Item\]\(table-50000-con-item\.md\); writes \[CON Item\]\(table-50000-con-item\.md\) \|/u);
  assert.match(files.get("objects/table-50000-con-item.md"), /## Used by\n\n(?:- .+\n)*- \*\*writes\*\* \[codeunit 50201 CON Item Sync\]\(codeunit-50201-con-item-sync\.md\)/u);

  // Across the layers: lenses, stories, findings, and the graph itself.
  assert.match(files.get("lenses/data.md"), /^# multi-app: Data\n\n\[System\]\(\.\.\/README\.md\) › Lenses\n\n!\[Data\]\(data\.svg\)/u);
  assert.match(files.get("stories/fix.md"), /\[System\]\(\.\.\/README\.md\) › Stories/u);
  assert.ok(files.get("findings.md").startsWith("# Findings\n\n[System](README.md) › Findings\n\n0 errors, 1 warning, 7 info.\n\n## Warning\n\n- **warning** `undeclared-app-dependency`: Contoso Integration uses Contoso Core (3 relations) without naming it in the dependencies of its app.json\n  - Fix: Add Contoso Core to \"dependencies\" in integration/app.json, or remove the use.\n  - On: [CON Item Sync](objects/codeunit-50201-con-item-sync.md)\n  - Source: `integration/ItemSync.al:10`\n\n## Info\n\n- **info** `undocumented-public-api`: codeunit 50010 CON Standard Pricing: 1 public procedure(s) without a /// summary: UnitPrice\n  - On: [CON Standard Pricing](objects/codeunit-50010-con-standard-pricing.md)\n  - Source: `core/Pricing.al:12`\n"));
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

test("the pages say how it is connected: the apps and the namespaces, and what depends on what", async () => {
  const { files } = await buildLayers(new Workspace(multi, {}, { live: false }));
  // The first page leads there: how it works, how it is connected, down the layers.
  const start = files.get("README.md");
  assert.ok(start.includes("\n## Start here\n\n1. **How it works**: the picture above, and [what is in it](lenses/overview.md).\n2. **[How it is connected](architecture.md)**: 3 apps, 4 namespaces, and what depends on what.\n3. **Down the layers**: from the apps to each procedure, below.\n"));
  assert.ok(start.indexOf("## Start here") < start.indexOf("## Layers"));

  const connected = files.get("architecture.md");
  assert.ok(connected.startsWith("# How it is connected\n\n[System](README.md) › How it is connected\n\n3 apps, 4 namespaces.\n"));
  assert.ok(connected.includes("![Apps](architecture-apps.svg)") && connected.includes("![Modules](architecture-namespaces.svg)"));
  assert.ok(files.get("architecture-apps.svg").startsWith("<svg ") && files.get("architecture-namespaces.svg").startsWith("<svg "));
  assert.ok(connected.includes("| [Contoso Integration](apps/contoso-integration.md) | 2 | [Contoso Sales](apps/contoso-sales.md) (declared, 4 relations), objects that are not found (2 relations), [Contoso Core](apps/contoso-core.md) (undeclared, 3 relations) |  |"));
  assert.ok(connected.includes("| [Contoso.Core.Pricing](namespaces/contoso-core-pricing.md) | Contoso Core | 3 | [Contoso.Core.Items](namespaces/contoso-core-items.md) (depends on, 4 relations) | [Contoso.Sales.Quotes](namespaces/contoso-sales-quotes.md) (depends on, 4 relations) |"));
  for (const page of ["README.md", "architecture.md", "apps/contoso-integration.md"]) {
    for (const target of links(files.get(page))) assert.ok(files.has(path.posix.normalize(path.posix.join(path.posix.dirname(page), target))), `${page} links to ${target}`);
  }
  assert.ok(![...files.keys()].some((file) => file.startsWith("components/") || file === "changes.md"));

  // One app without namespaces: the page has the app, and no section for what is not there.
  const flat = await buildLayers(new Workspace(path.join(root, "examples", "purchasing-app"), {}, { live: false }), { pictures: "none" });
  assert.match(flat.files.get("architecture.md"), /\n\n1 app(?:, \d+ namespaces?)?\.\n/u);
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
    assert.match(text.stderr, /[\w-]+: 11 object\(s\) in 3 app\(s\), 4 namespace\(s\); \d+ file\(s\) in docs\/layers\nIn sync with the source\./u);
    assert.equal(bca(["layers", ".", "--pictures", "some"], { cwd: directory }).status, 2);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("layers is a command with options for every setting", () => {
  const command = findCommand(createCapabilities("0.0.0"), "layers");
  for (const option of ["output", "check", "pictures", "profile", "view", "format"]) assert.ok(command.options[option], option);
  for (const removed of ["at", "releases", "last", "refresh", "compiler"]) assert.equal(command.options[removed], undefined, removed);
  assert.deepEqual(command.options.pictures.enum, ["auto", "all", "none"]);
});

// The example is written on Linux (npm run examples, checked in CI). The same source must give
// the same pages on every system: on Windows this compares them byte for byte.
test("the pages are the same on every system: they are the example in the repository, byte for byte", async () => {
  const example = path.join(root, "examples", "layers");
  const { files } = await buildLayers(new Workspace(multi, {}, { live: false }));
  const committed = JSON.parse(readFileSync(path.join(example, "layers.json"), "utf8")).files;
  assert.deepEqual([...files.keys()].sort(), committed);
  for (const [file, content] of files) assert.equal(content, readFileSync(path.join(example, file), "utf8"), file);
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
