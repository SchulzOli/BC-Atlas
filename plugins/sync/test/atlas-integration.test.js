// End to end through the BC Atlas CLI of this repository: the built-in sync plugin is discovered
// without configuration, BC Atlas analyzes a real AL project for the model, renders the synced UI
// test with its docs pipeline, runs the sync task in bca run, and reports the health rule.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { REPO, facts, writeSnapshotZip } from "./helpers.js";

const run = promisify(execFile);
const CLI = path.resolve(REPO, "..", "..", "src", "cli.js");
const env = { ...process.env, BCA_AL_COMPILER: "off", BCA_CACHE_DIR: path.join(os.tmpdir(), "bc-atlas-sync-e2e-cache") };

async function project() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "bc-atlas-sync-e2e-"));
  // A real AL app for BC Atlas to analyze: the Business Central side of this plugin.
  await fs.cp(path.join(REPO, "al", "app"), root, { recursive: true, filter: (source) => !source.includes(".alpackages") });
  await fs.mkdir(path.join(root, "bc-snapshots"), { recursive: true });
  const config = {
    sync: {
      sources: { bc: { type: "fact-snapshots", path: "bc-snapshots" }, atlas: { type: "atlas-model" } },
      channels: [{
        id: "processes",
        when: { triggers: ["ci"], condition: "drift" },
        how: { formats: ["documents", "architecture", "index", { format: "atlas-docs", export: ["markdown"] }], outputDir: "docs/processes" }
      }]
    }
  };
  await fs.writeFile(path.join(root, ".bca.json"), JSON.stringify(config, null, 2));
  return root;
}

test("bca sync run, bca run --tasks sync, and bca check with the built-in plugin", async () => {
  const root = await project();
  const uiTest = await fs.readFile(path.join(REPO, "examples", "BASUITestDemoPostSalesOrder.Codeunit.al"), "utf8");
  await writeSnapshotZip(root, facts(), { uiTest });
  const options = { env, cwd: root, maxBuffer: 1 << 24 };

  // Before syncing, bca check reports the process as outdated (health rule of the plugin).
  const check = JSON.parse((await run(process.execPath, [CLI, "check", root, "--format", "json"], options).catch((error) => error)).stdout);
  assert.ok(check.findings.some(({ rule, plugin }) => rule === "sync-outdated" && plugin === "sync"), "sync-outdated finding");

  const { stdout } = await run(process.execPath, [CLI, "sync", "run", root, "--trigger", "ci", "--format", "json"], options);
  const channel = JSON.parse(stdout).channels[0];
  assert.equal(channel.status, "synced", JSON.stringify(channel.warnings));
  assert.ok(channel.written.includes("docs/processes/demo-post-sales-order/layered.md"));
  assert.ok(channel.written.includes("docs/processes/demo-post-sales-order/architecture.md"), "architecture from the model BC Atlas analyzed");
  const guide = channel.written.find((file) => /^docs\/processes\/atlas\/.*demo-post-sales-order\.md$/u.test(file));
  assert.ok(guide, `BC Atlas rendered the synced UI test: ${channel.written.join(", ")}`);
  assert.match(await fs.readFile(path.join(root, guide), "utf8"), /On the Sales Order page, choose Post/u);
  const architecture = JSON.parse(await fs.readFile(path.join(root, "docs/processes/demo-post-sales-order/architecture.json"), "utf8"));
  assert.ok(architecture.atlas.objects > 0, "the host model contains the analyzed AL objects");

  // The same channels as the sync task of bca run; a second run finds no drift.
  const automation = JSON.parse((await run(process.execPath, [CLI, "run", root, "--tasks", "sync", "--trigger", "ci", "--format", "json"], options)).stdout);
  assert.equal(automation.passed, true);
  assert.deepEqual(automation.results.map(({ task, ok, plugin }) => `${task}:${ok}:${plugin}`), ["sync:true:sync"]);
  assert.deepEqual(automation.outputs, ["docs/processes", ".bca/sync-state.json"]);

  // After syncing, the health rule is quiet.
  const after = JSON.parse((await run(process.execPath, [CLI, "check", root, "--format", "json"], options).catch((error) => error)).stdout);
  assert.ok(!after.findings.some(({ rule }) => rule === "sync-outdated"));
});
