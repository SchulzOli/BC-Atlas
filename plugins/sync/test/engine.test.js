import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { runSync } from "../src/engine.js";
import { exists, facts, tempProject, writeSnapshotZip } from "./helpers.js";

const CONFIG = {
  sync: {
    sources: {
      bc: { type: "fact-snapshots", path: "bc-snapshots" },
      atlas: { type: "atlas-model", path: "atlas-model.json" }
    },
    channels: [
      {
        id: "processes",
        what: { from: "bc" },
        when: { triggers: ["ci", "manual"], condition: "drift" },
        how: { formats: ["documents", "architecture", "index"], outputDir: "docs/processes" }
      },
      {
        id: "scenarios",
        when: { triggers: ["schedule"], condition: "changed" },
        how: { formats: ["ui-tests"], outputDir: "test/UITest/Recorded" }
      }
    ]
  }
};

const sync = (root, extra = {}) => runSync({ root, projectConfig: CONFIG, ...extra });

test("first sync writes documents, architecture, index and state", async () => {
  const root = await tempProject(CONFIG);
  await writeSnapshotZip(root, facts());
  const result = await sync(root);
  const processes = result.channels.find(({ id }) => id === "processes");
  assert.equal(processes.status, "synced");
  assert.deepEqual(processes.processes.map(({ key, reason }) => [key, reason]), [["demo-post-sales-order", "new"]]);
  for (const file of ["layered.md", "user-guide.md", "ui-test.al", "facts.json", "architecture.md", "architecture.json"]) {
    assert.ok(await exists(path.join(root, "docs/processes/demo-post-sales-order", file)), file);
  }
  assert.ok(await exists(path.join(root, "docs/processes/index.md")));
  assert.ok(!processes.written.some((file) => file.includes("raw/")), "raw recordings are not documents");
  const architecture = JSON.parse(await fs.readFile(path.join(root, "docs/processes/demo-post-sales-order/architecture.json"), "utf8"));
  assert.deepEqual(architecture.dependencies.map(({ from, to, rule }) => `${from}->${to}:${rule}`), ["Sales->Finance:ok"]);
  assert.equal(result.channels.find(({ id }) => id === "scenarios").status, "skipped", "scenarios run on schedule only");
  assert.ok(await exists(path.join(root, ".bca/sync-state.json")));
});

test("when: the drift condition skips re-recordings with the same fingerprint", async () => {
  const root = await tempProject(CONFIG);
  await writeSnapshotZip(root, facts({ no: 1, fingerprint: "same" }));
  await sync(root);
  await writeSnapshotZip(root, facts({ no: 2, fingerprint: "same" }), { layered: "# Layered S2\n" });
  const second = (await sync(root)).channels.find(({ id }) => id === "processes");
  assert.equal(second.status, "skipped");
  assert.equal(second.reason, "no process drifted");

  await writeSnapshotZip(root, facts({ no: 3, fingerprint: "other", drift: true }), { layered: "# Layered S3\n" });
  const third = (await sync(root)).channels.find(({ id }) => id === "processes");
  assert.equal(third.status, "synced");
  assert.equal(third.processes[0].reason, "fingerprint changed (drift)");
  assert.equal(third.processes[0].snapshot, 3, "latest version wins");
  assert.equal(await fs.readFile(path.join(root, "docs/processes/demo-post-sales-order/layered.md"), "utf8"), "# Layered S3\n");
  assert.match(await fs.readFile(path.join(root, "docs/processes/index.md"), "utf8"), /\*\*changed\*\*/u);
});

test("when: the changed condition reacts to any new snapshot content", async () => {
  const root = await tempProject(CONFIG);
  await writeSnapshotZip(root, facts({ no: 1, fingerprint: "same" }));
  await sync(root, { trigger: "schedule" });
  await writeSnapshotZip(root, facts({ no: 2, fingerprint: "same" }));
  const scenarios = (await sync(root, { trigger: "schedule" })).channels.find(({ id }) => id === "scenarios");
  assert.equal(scenarios.status, "synced");
  assert.equal(scenarios.processes[0].reason, "snapshot changed");
  assert.ok(await exists(path.join(root, "test/UITest/Recorded/demo-post-sales-order.Codeunit.al")));
});

test("when: triggers filter channels, --channel and --force override", async () => {
  const root = await tempProject(CONFIG);
  await writeSnapshotZip(root, facts());
  const onPush = await sync(root, { trigger: "pre-push" });
  assert.ok(onPush.channels.every(({ status }) => status === "skipped"));
  assert.match(onPush.channels[0].reason, /runs on ci, manual, not on pre-push/u);
  const explicit = await sync(root, { trigger: "pre-push", channels: ["scenarios"] });
  assert.equal(explicit.channels.length, 1);
  assert.equal(explicit.channels[0].status, "synced");
  const forced = await sync(root, { channels: ["scenarios"], force: true });
  assert.equal(forced.channels[0].processes[0].reason, "forced");
  await assert.rejects(sync(root, { channels: ["nope"] }), /unknown sync channel/u);
});

test("plan (dry run) writes nothing and reports what would change", async () => {
  const root = await tempProject(CONFIG);
  await writeSnapshotZip(root, facts());
  const plan = await sync(root, { dryRun: true });
  const processes = plan.channels.find(({ id }) => id === "processes");
  assert.equal(processes.status, "planned");
  assert.ok(processes.written.includes("docs/processes/demo-post-sales-order/layered.md"));
  assert.ok(!await exists(path.join(root, "docs/processes")));
  assert.ok(!await exists(path.join(root, ".bca/sync-state.json")));
});

test("outputs are deterministic: a second forced run changes nothing on disk", async () => {
  const root = await tempProject(CONFIG);
  await writeSnapshotZip(root, facts());
  await sync(root);
  const state = await fs.readFile(path.join(root, ".bca/sync-state.json"), "utf8");
  const again = await sync(root, { force: true });
  assert.equal(again.changed, false, "BC Atlas verify sees no difference");
  assert.equal(await fs.readFile(path.join(root, ".bca/sync-state.json"), "utf8"), state);
});

test("processes that leave the source are removed with their files", async () => {
  const root = await tempProject(CONFIG);
  const zip = await writeSnapshotZip(root, facts());
  await sync(root);
  await fs.rm(zip);
  const result = (await sync(root)).channels.find(({ id }) => id === "processes");
  assert.ok(result.removed.includes("docs/processes/demo-post-sales-order/layered.md"));
  assert.ok(!await exists(path.join(root, "docs/processes/demo-post-sales-order/layered.md")));
  assert.equal(result.processes[0].reason, "no longer in the source");
});

test("what: process filters and plain JSON fact sheets", async () => {
  const config = structuredClone(CONFIG);
  config.sync.channels[0].what.processes = ["Order to cash"];
  config.sync.channels[0].how.formats = ["facts", "index"];
  const root = await tempProject(config);
  await fs.writeFile(path.join(root, "bc-snapshots", "facts.json"), JSON.stringify(facts()));
  await fs.writeFile(path.join(root, "bc-snapshots", "other.json"), JSON.stringify(facts({ process: "Release purchase order" })));
  await fs.writeFile(path.join(root, "bc-snapshots", "unrelated.json"), "{\"schema\":\"x\"}");
  const result = (await runSync({ root, projectConfig: config })).channels[0];
  assert.deepEqual(result.processes.map(({ key }) => key), ["demo-post-sales-order", "release-purchase-order"], "both carry the feature Order to cash");
  assert.ok(result.warnings.some((warning) => warning.includes("unrelated.json")));
});

test("how: the host provides the BC Atlas model and renders atlas-docs", async () => {
  const config = structuredClone(CONFIG);
  delete config.sync.sources.atlas.path;
  config.sync.channels[0].how.formats = ["architecture", { format: "atlas-docs", export: ["markdown"] }];
  const root = await tempProject(config);
  await writeSnapshotZip(root, facts());
  const model = JSON.parse(await fs.readFile(path.join(root, "atlas-model.json"), "utf8"));
  const calls = [];
  const host = {
    atlasModel: async () => model,
    renderDocs: async ({ testsDir, outputDir, formats }) => {
      calls.push({ tests: await fs.readdir(testsDir), formats });
      await fs.mkdir(outputDir, { recursive: true });
      await fs.writeFile(path.join(outputDir, "index.md"), "# Guides\n");
      return { warnings: [] };
    }
  };
  const result = (await runSync({ root, projectConfig: config, host })).channels[0];
  assert.deepEqual(calls, [{ tests: ["demo-post-sales-order.Codeunit.al"], formats: ["markdown"] }]);
  assert.ok(result.written.includes("docs/processes/atlas/index.md"));
  assert.ok(result.written.includes("docs/processes/demo-post-sales-order/architecture.md"));

  const standalone = (await runSync({ root, projectConfig: config, force: true })).channels[0];
  assert.ok(standalone.warnings.some((warning) => /no BC Atlas host provides the model/u.test(warning)));
  assert.ok(standalone.warnings.some((warning) => /atlas-docs needs BC Atlas/u.test(warning)));
});
