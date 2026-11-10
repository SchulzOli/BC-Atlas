// The sync plugin through the plugin API: activate(context) with a context like BC Atlas builds it.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { activate, analyzeArchitecture, architectureMarkdown } from "../src/index.js";
import { ruleFor } from "../src/formats/architecture.js";
import { indexAtlas } from "../src/sources/atlas-model.js";
import { DEMO_FACTS, REPO, facts, tempProject, writeSnapshotZip } from "./helpers.js";

const CONFIG = {
  sync: {
    sources: { bc: { type: "fact-snapshots", path: "bc-snapshots" } },
    channels: [{ id: "docs", how: { formats: ["documents", "index"], outputDir: "docs/processes" } }]
  }
};

/** A context as BC Atlas passes it; extension points answer with the given contributions. */
function context(root, config, { contributions = {}, lines = [] } = {}) {
  return {
    apiVersion: 1,
    plugin: { id: "sync", version: "test", dir: REPO, source: "test" },
    root,
    config,
    settings: config.sync,
    trigger: "manual",
    log: (line) => lines.push(line),
    services: { atlasModel: async () => { throw new Error("no model in this test"); }, renderDocs: async () => ({ warnings: [] }), cacheDir: path.join(root, ".bca/cache/sync") },
    extensions: { get: async (point) => contributions[point] ?? [] },
    plugins: { list: () => [] }
  };
}

test("plugin.json and activate() agree: every declared contribution is implemented", async () => {
  const manifest = JSON.parse(await fs.readFile(path.join(REPO, "plugin.json"), "utf8"));
  const implementation = activate(context(".", {}));
  for (const { name } of manifest.contributes.commands) assert.equal(typeof implementation.commands[name], "function", name);
  for (const { id } of manifest.contributes.tasks) assert.equal(typeof implementation.tasks[id].run, "function", id);
  for (const { id } of manifest.contributes.healthRules) assert.equal(typeof implementation.healthRules[id], "function", id);
  for (const { name } of manifest.contributes.mcpTools) assert.equal(typeof implementation.mcpTools[name], "function", name);
  assert.deepEqual(manifest.contributes.extensionPoints.map(({ id }) => id), ["sync.sources", "sync.formats"]);
});

test("the sync task reports per channel through the context log", async () => {
  const root = await tempProject(CONFIG);
  await writeSnapshotZip(root, facts());
  const lines = [];
  const outcome = await activate(context(root, CONFIG, { lines })).tasks.sync.run({ trigger: "ci" });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.summary, "1 of 1 channel(s) synced");
  assert.ok(lines.some((line) => line.startsWith("sync: docs: synced: 1 process(es)")));
  assert.deepEqual(await activate(context(root, CONFIG)).tasks.sync.outputs(CONFIG), ["docs/processes", ".bca/sync-state.json"]);
});

test("commands: status plans every channel whatever the trigger; plan and run take the trigger", async () => {
  const config = structuredClone(CONFIG);
  config.sync.channels[0].when = { triggers: ["schedule"] };
  const root = await tempProject(config);
  await writeSnapshotZip(root, facts());
  const plugin = activate(context(root, config));
  const status = await plugin.commands.status({ values: {} });
  assert.equal(status.channels[0].status, "planned");
  assert.ok(status.lines[0].startsWith("docs: planned"));
  assert.equal((await plugin.commands.plan({ values: { trigger: "ci" } })).channels[0].status, "skipped");
  assert.equal((await plugin.commands.run({ values: { trigger: "schedule" } })).channels[0].status, "synced");
});

test("health rule sync-outdated: findings until the process is synced", async () => {
  const root = await tempProject(CONFIG);
  await writeSnapshotZip(root, facts());
  const plugin = activate(context(root, CONFIG));
  const before = await plugin.healthRules["sync-outdated"]({});
  assert.equal(before.length, 1);
  assert.match(before[0].message, /Process "Demo: Post sales order" \(snapshot 1\) is not synced in channel "docs": new/u);
  await plugin.commands.run({ values: {} });
  assert.deepEqual(await plugin.healthRules["sync-outdated"]({}), []);
  assert.deepEqual(await activate(context(root, {})).healthRules["sync-outdated"]({}), [], "no sync section, no findings");
});

test("extension points: another plugin contributes a source (what) and a format (how)", async () => {
  const config = {
    sync: {
      sources: { telemetry: { type: "telemetry-export", path: "telemetry.json" } },
      channels: [{ id: "perf", how: { formats: ["hotspots", "index"], outputDir: "docs/perf" } }]
    }
  };
  const root = await tempProject(config);
  const item = { key: "post-sales-order", process: "Post sales order", feature: "Order to cash", snapshotNo: 1, fingerprint: "t1", contentHash: "c1", facts: { snapshot: { no: 1 } }, documents: [] };
  const contributions = {
    "sync.sources": [{ plugin: "telemetry", type: "telemetry-export", summary: "Application Insights export", load: async () => ({ items: [item], warnings: [] }) }],
    "sync.formats": [{ plugin: "telemetry", id: "hotspots", summary: "slowest methods", scope: "process", render: async ({ item: process }) => ({ files: [{ path: `${process.key}/hotspots.md`, content: "# Hotspots\n" }], warnings: [] }) }]
  };
  const plugin = activate(context(root, config, { contributions }));
  const result = await plugin.commands.run({ values: {} });
  assert.deepEqual(result.channels[0].written.sort(), ["docs/perf/index.json", "docs/perf/index.md", "docs/perf/post-sales-order/hotspots.md"]);
  const described = await plugin.commands.describe({ values: {} });
  assert.match(described.sources["telemetry-export"], /plugin telemetry/u);
  assert.match(described.formats.hotspots, /plugin telemetry/u);
  await plugin.validateConfig(config.sync);
  await assert.rejects(activate(context(root, config)).validateConfig(config.sync), /needs a type/u, "without the contributing plugin the type is unknown");
});

test("MCP tool bc_atlas_sync_status reads any project and writes nothing", async () => {
  const root = await tempProject(CONFIG);
  await writeSnapshotZip(root, facts());
  const result = await activate(context(".", {})).mcpTools.bc_atlas_sync_status({ path: root });
  assert.equal(result.dryRun, true);
  assert.equal(result.channels[0].status, "planned");
  await assert.rejects(fs.access(path.join(root, "docs/processes")));
});

test("architecture: the demo crosses Sales -> Finance, and outward calls are flagged", async () => {
  const model = JSON.parse(await fs.readFile(path.join(REPO, "test/fixtures/atlas-model.json"), "utf8"));
  const result = analyzeArchitecture(DEMO_FACTS, model);
  assert.deepEqual(result.components.map(({ name, layer }) => `${name}@${layer}`), ["Sales@31", "Inventory@25", "Finance@20", "No. Series@1"]);
  assert.deepEqual(result.phases.map(({ components }) => components), [["Sales"], ["Sales", "Finance"]]);
  assert.deepEqual(result.unmapped, []);
  assert.match(architectureMarkdown(result), /Recorded calls against the layer rules:\*\* none/u);

  const atlas = indexAtlas(model);
  assert.equal(ruleFor(atlas, "Finance", "Sales"), "outward-dependency");
  assert.equal(ruleFor(atlas, "Sales", "Finance"), "ok");
  model.architecture.components.find(({ name }) => name === "Inventory").layer = 31;
  assert.equal(ruleFor(indexAtlas(model), "Sales", "Inventory"), "same-layer-dependency");
});
