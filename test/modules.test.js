import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { outputsFor, syncOutputs, TASKS } from "../src/automation/config.js";
import { runAutomation } from "../src/automation/run.js";
import { createModuleHost, loadModules, moduleForCommand, moduleForTask } from "../src/modules.js";

const run = promisify(execFile);
const CLI = fileURLToPath(new URL("../src/cli.js", import.meta.url));

// A module like bc-atlas-sync: a task "sync", commands, and outputs, talking to BC Atlas only via the host.
const FAKE_MODULE = `
export const bcaModule = {
  apiVersion: 1,
  name: "bc-atlas-sync",
  version: "0.0.0-test",
  configKey: "sync",
  outputs: () => ["docs/sync/test"],
  tasks: {
    sync: {
      summary: "test sync",
      async run(host) {
        const fs = await import("node:fs/promises");
        const path = await import("node:path");
        await fs.mkdir(path.join(host.root, "docs/sync/test"), { recursive: true });
        await fs.writeFile(path.join(host.root, "docs/sync/test/trigger.txt"), host.trigger);
        host.log("fake module ran");
        return { ok: true, summary: "1 of 1 channel(s) synced" };
      }
    }
  },
  commands: {
    plan: async (host, values) => ({ passed: true, dryRun: true, trigger: values.trigger ?? host.trigger, channels: [], lines: ["plan from module: " + (values.channel ?? []).join(",")] }),
    run: async () => ({ passed: false, lines: ["run failed on purpose"] }),
    status: async (host) => ({ passed: true, hasAtlasModel: typeof host.atlasModel === "function", hasRenderDocs: typeof host.renderDocs === "function", lines: ["status"] })
  }
};
`;

async function project({ modules, sync, apiVersion = 1 } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "bca-modules-"));
  const moduleDir = path.join(root, "vendor-module");
  await fs.mkdir(moduleDir, { recursive: true });
  await fs.writeFile(path.join(moduleDir, "package.json"), JSON.stringify({ name: "bc-atlas-sync", type: "module", main: "index.js" }));
  await fs.writeFile(path.join(moduleDir, "index.js"), FAKE_MODULE.replace("apiVersion: 1", `apiVersion: ${apiVersion}`));
  const config = {
    modules: modules ?? [{ name: "bc-atlas-sync", path: "vendor-module" }],
    ...(sync ? { sync } : {})
  };
  await fs.writeFile(path.join(root, ".bca.json"), JSON.stringify(config));
  return { root, config };
}

test("modules: a project loads its modules from .bca.json", async () => {
  const { root, config } = await project();
  const modules = await loadModules(root, config, { env: {} });
  assert.deepEqual(modules.map(({ name, version }) => `${name}@${version}`), ["bc-atlas-sync@0.0.0-test"]);
  assert.equal(moduleForTask(modules, "sync").name, "bc-atlas-sync");
  assert.equal(moduleForCommand(modules, "sync").name, "bc-atlas-sync");
  assert.equal(moduleForTask(modules, "docs"), undefined);
});

test("modules: BCA_MODULES adds modules, duplicates are loaded once", async () => {
  const { root, config } = await project();
  const modules = await loadModules(root, config, { env: { BCA_MODULES: "./vendor-module" } });
  assert.equal(modules.length, 1);
});

test("modules: wrong API version and missing modules fail with a clear message", async () => {
  const wrong = await project({ apiVersion: 2 });
  await assert.rejects(loadModules(wrong.root, wrong.config, { env: {} }), /uses module API 2; this BC Atlas .* supports 1/u);
  const missing = await project({ modules: ["bc-atlas-not-installed"] });
  await assert.rejects(loadModules(missing.root, missing.config, { env: {} }), /npm install --save-dev bc-atlas-not-installed/u);
});

test("modules: the host offers the Atlas model and docs rendering", async () => {
  const host = createModuleHost({ root: ".", config: {}, trigger: "ci" });
  assert.equal(host.apiVersion, 1);
  assert.equal(host.trigger, "ci");
  assert.equal(typeof host.atlasModel, "function");
  assert.equal(typeof host.renderDocs, "function");
});

test("sync task: runs inside bca run with the trigger, before docs", async () => {
  const { root } = await project({ sync: { channels: [{ id: "test" }] } });
  const lines = [];
  const result = await runAutomation(root, { trigger: "schedule", tasks: ["sync"], log: (line) => lines.push(line) });
  assert.equal(result.passed, true);
  assert.deepEqual(result.results.map(({ task, ok }) => `${task}:${ok}`), ["sync:true"]);
  assert.equal(await fs.readFile(path.join(root, "docs/sync/test/trigger.txt"), "utf8"), "schedule");
  assert.ok(lines.includes("fake module ran"));
  assert.ok(TASKS.sync);
});

test("sync task: outputs come from the sync manifest (for verify, stage, artifacts)", () => {
  const config = { sync: { state: ".bca/state.json", channels: [{ id: "a", how: { outputDir: "docs/a" } }, { id: "b" }] } };
  assert.deepEqual(syncOutputs(config), ["docs/a", "docs/sync/b", ".bca/state.json"]);
  assert.deepEqual(outputsFor(["sync"], config), ["docs/a", "docs/sync/b", ".bca/state.json"]);
  assert.deepEqual(syncOutputs({}), []);
});

test("sync task: fails clearly without the module", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "bca-modules-"));
  await fs.writeFile(path.join(root, ".bca.json"), "{}");
  const result = await runAutomation(root, { tasks: ["sync"] });
  assert.equal(result.passed, false);
  assert.match(result.results[0].summary, /needs the bc-atlas-sync module/u);
});

test("bca sync plan|run|status delegate to the module", async () => {
  const { root } = await project();
  const plan = await run(process.execPath, [CLI, "sync", "plan", root, "--channel", "a", "--channel", "b"]);
  assert.match(plan.stdout, /plan from module: a,b/u);
  const status = JSON.parse((await run(process.execPath, [CLI, "sync", "status", root, "--format", "json"])).stdout);
  assert.deepEqual([status.hasAtlasModel, status.hasRenderDocs], [true, true]);
  await assert.rejects(run(process.execPath, [CLI, "sync", "run", root]), (error) => error.code === 1 && /run failed on purpose/u.test(error.stdout));
  await assert.rejects(run(process.execPath, [CLI, "sync", "nope", root]), /unknown sync command "nope"/u);
});

test("bca sync without the module explains how to install it", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "bca-modules-"));
  await fs.writeFile(path.join(root, ".bca.json"), "{}");
  await assert.rejects(run(process.execPath, [CLI, "sync", "run", root]), /npm install --save-dev bc-atlas-sync/u);
});
