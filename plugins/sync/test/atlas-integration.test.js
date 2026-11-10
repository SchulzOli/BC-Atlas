// End to end with a real BC Atlas checkout (BC_ATLAS_ROOT, default ../BC-Atlas): BC Atlas loads this
// module from .bca.json, analyzes a real AL project for the host model, and renders the synced UI
// test with its own docs pipeline. Skipped when no BC Atlas checkout is found.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { REPO, facts, writeSnapshotZip } from "./helpers.js";

const run = promisify(execFile);
const ATLAS = path.resolve(process.env.BC_ATLAS_ROOT ?? path.join(REPO, "..", "BC-Atlas"));
const CLI = path.join(ATLAS, "src", "cli.js");
const available = existsSync(CLI) && existsSync(path.join(ATLAS, "node_modules"));

async function project() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "bc-atlas-sync-e2e-"));
  // A real AL app for BC Atlas to analyze: the BC side of this repository.
  await fs.cp(path.join(REPO, "al", "app"), root, { recursive: true, filter: (source) => !source.includes(".alpackages") });
  await fs.mkdir(path.join(root, "bc-snapshots"), { recursive: true });
  const config = {
    modules: [{ name: "bc-atlas-sync", path: REPO }],
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

const env = { ...process.env, BCA_AL_COMPILER: "off", BCA_CACHE_DIR: path.join(os.tmpdir(), "bc-atlas-sync-e2e-cache") };

test("bca sync run: real BC Atlas loads the module, provides the model, renders the UI test", { skip: !available && `no BC Atlas checkout with node_modules at ${ATLAS}` }, async () => {
  const root = await project();
  const uiTest = await fs.readFile(path.join(REPO, "examples", "BASUITestDemoPostSalesOrder.Codeunit.al"), "utf8");
  await writeSnapshotZip(root, facts(), { uiTest });

  const { stdout } = await run(process.execPath, [CLI, "sync", "run", root, "--trigger", "ci", "--format", "json"], { env, maxBuffer: 1 << 24 });
  const result = JSON.parse(stdout);
  const channel = result.channels[0];
  assert.equal(channel.status, "synced", JSON.stringify(channel.warnings));
  assert.ok(channel.written.includes("docs/processes/demo-post-sales-order/layered.md"));
  assert.ok(channel.written.includes("docs/processes/demo-post-sales-order/architecture.md"), "architecture from the model BC Atlas analyzed");
  const guide = channel.written.find((file) => /^docs\/processes\/atlas\/.*demo-post-sales-order\.md$/u.test(file));
  assert.ok(guide, `BC Atlas rendered the synced UI test: ${channel.written.join(", ")}`);
  assert.match(await fs.readFile(path.join(root, guide), "utf8"), /On the Sales Order page, choose Post/u);
  const architecture = JSON.parse(await fs.readFile(path.join(root, "docs/processes/demo-post-sales-order/architecture.json"), "utf8"));
  assert.ok(architecture.atlas.objects > 0, "the host model contains the analyzed AL objects");

  // The same channels as the "sync" task of bca run; a second run finds no drift.
  const { stdout: again } = await run(process.execPath, [CLI, "run", root, "--tasks", "sync", "--trigger", "ci", "--format", "json"], { env, maxBuffer: 1 << 24 });
  const automation = JSON.parse(again);
  assert.equal(automation.passed, true);
  assert.deepEqual(automation.results.map(({ task, ok }) => `${task}:${ok}`), ["sync:true"]);
  assert.deepEqual(automation.outputs, ["docs/processes", ".bca/sync-state.json"]);
});
