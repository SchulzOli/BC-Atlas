import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import bcaModule, { analyzeArchitecture, architectureMarkdown, describe } from "../src/index.js";
import { ruleFor } from "../src/formats/architecture.js";
import { indexAtlas } from "../src/sources/atlas-model.js";
import { DEMO_FACTS, REPO, facts, tempProject, writeSnapshotZip } from "./helpers.js";
import fs from "node:fs/promises";

const run = promisify(execFile);
const CONFIG = {
  sync: {
    sources: { bc: { type: "fact-snapshots", path: "bc-snapshots" } },
    channels: [{ id: "docs", how: { formats: ["documents", "index"], outputDir: "docs/processes" } }]
  }
};

test("module contract for BC Atlas (API version 1)", () => {
  assert.equal(bcaModule.apiVersion, 1);
  assert.equal(bcaModule.name, "bc-atlas-sync");
  assert.equal(bcaModule.configKey, "sync");
  assert.equal(typeof bcaModule.tasks.sync.run, "function");
  for (const command of ["plan", "run", "status"]) assert.equal(typeof bcaModule.commands[command], "function");
  assert.deepEqual(bcaModule.outputs(CONFIG), ["docs/processes", ".bca/sync-state.json"]);
  assert.ok(Object.isFrozen(bcaModule));
  const description = describe();
  assert.ok(description.formats.architecture && description.conditions.drift && description.sources["fact-snapshots"]);
});

test("the sync task reports per channel through the host log", async () => {
  const root = await tempProject(CONFIG);
  await writeSnapshotZip(root, facts());
  const lines = [];
  const outcome = await bcaModule.tasks.sync.run({ root, config: CONFIG, trigger: "ci", log: (line) => lines.push(line) });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.summary, "1 of 1 channel(s) synced");
  assert.ok(lines.some((line) => line.startsWith("sync: docs: synced: 1 process(es)")));
});

test("status plans every channel, whatever the trigger", async () => {
  const config = structuredClone(CONFIG);
  config.sync.channels[0].when = { triggers: ["schedule"] };
  const root = await tempProject(config);
  await writeSnapshotZip(root, facts());
  const status = await bcaModule.commands.status({ root, config, trigger: "pre-commit" }, {});
  assert.equal(status.channels[0].status, "planned");
  assert.equal(status.dryRun, true);
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

test("standalone CLI: bca-sync run --format json", async () => {
  const root = await tempProject(CONFIG);
  await writeSnapshotZip(root, facts());
  const { stdout } = await run(process.execPath, [path.join(REPO, "src/cli.js"), "run", root, "--format", "json"]);
  const result = JSON.parse(stdout);
  assert.equal(result.schema, "bc-atlas-sync.result/1");
  assert.equal(result.channels[0].status, "synced");
  const { stdout: described } = await run(process.execPath, [path.join(REPO, "src/cli.js"), "describe", "--format", "json"]);
  assert.equal(JSON.parse(described).configKey, "sync");
});
