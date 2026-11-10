import assert from "node:assert/strict";
import test from "node:test";
import { normalizeSyncConfig, syncOutputs } from "../src/config.js";
import { documentType } from "../src/sources/fact-snapshots.js";
import { kebabId, matchesAny, stableStringify } from "../src/util.js";
import { readZip, writeZip } from "../src/zip.js";

test("zip: what is written can be read back (deflated, UTF-8 names)", () => {
  const entries = readZip(writeZip([{ name: "a/ü.md", data: "x".repeat(1000) }, { name: "b.json", data: "{}" }]));
  assert.deepEqual(entries.map(({ name }) => name), ["a/ü.md", "b.json"]);
  assert.equal(entries[0].data.toString(), "x".repeat(1000));
});

test("zip: rejects files that are not archives", () => {
  assert.throws(() => readZip(Buffer.from("not a zip at all, definitely not")), /not a ZIP archive/u);
});

test("document types are recognised from the AL file names", () => {
  assert.deepEqual(documentType("Demo-Post-sales-order-S12-Layered-Documentation-use-case-to-clicks.md"), { type: "layered", file: "layered.md" });
  assert.deepEqual(documentType("X-S1-BC-Atlas-UI-Test-AL.al"), { type: "ui-test", file: "ui-test.al" });
  assert.deepEqual(documentType("X-S1-JSON-Fact-Sheet.json"), { type: "facts", file: "facts.json" });
  assert.deepEqual(documentType("X-S1-Sequence-Diagram-Mermaid.mmd"), { type: "sequence", file: "sequence.mmd" });
  assert.deepEqual(documentType("X-S1-My-Custom-Type.txt"), { type: "my-custom-type", file: "my-custom-type.txt" }, "types added by other apps keep working");
  assert.equal(documentType("raw/readme.md"), undefined);
});

test("ids, globs and stable JSON", () => {
  assert.equal(kebabId("Demo: Post sales order"), "demo-post-sales-order", "same rule as [DOC-ID] on the AL side");
  assert.ok(matchesAny(["Order*"], ["Demo", "Order to cash"]));
  assert.ok(!matchesAny(["post-*"], ["demo-post"]));
  assert.equal(stableStringify({ b: 1, a: { d: 1, c: 2 } }), '{"a":{"c":2,"d":1},"b":1}');
});

test("config: defaults fill in what, when and how", () => {
  const config = normalizeSyncConfig({
    sync: { sources: { bc: { type: "fact-snapshots", path: "snaps" } }, channels: [{ id: "docs" }] }
  });
  assert.equal(config.state, ".bca/sync-state.json");
  assert.deepEqual(config.channels[0].what, { from: "bc", processes: ["*"], versions: "latest" });
  assert.deepEqual(config.channels[0].when, { triggers: ["manual", "ci"], condition: "changed" });
  assert.deepEqual(config.channels[0].how.formats.map(({ format }) => format), ["documents", "index"]);
  assert.equal(config.channels[0].how.outputDir, "docs/sync/docs");
});

test("config: clear errors for invalid manifests", () => {
  const base = { sources: { bc: { type: "fact-snapshots", path: "s" } } };
  assert.throws(() => normalizeSyncConfig({ sync: { ...base, channels: [{ id: "a", how: { formats: ["pdf"] } }] } }), /unknown format "pdf"/u);
  assert.throws(() => normalizeSyncConfig({ sync: { ...base, channels: [{ id: "a", when: { triggers: ["nightly"] } }] } }), /when.triggers/u);
  assert.throws(() => normalizeSyncConfig({ sync: { ...base, channels: [{ id: "a", when: { condition: "sometimes" } }] } }), /when.condition/u);
  assert.throws(() => normalizeSyncConfig({ sync: { ...base, channels: [{ id: "a", how: { formats: ["architecture"] } }] } }), /needs how.atlas/u);
  assert.throws(() => normalizeSyncConfig({ sync: { ...base, channels: [{ id: "a" }, { id: "a" }] } }), /used twice/u);
  assert.throws(() => normalizeSyncConfig({ sync: { sources: { bc: { type: "fact-snapshots" } } } }), /needs a "path"/u);
  assert.throws(() => normalizeSyncConfig({ sync: { channels: [{ id: "a" }] } }), /what.from/u);
});

test("config: outputs for BC Atlas verify/stage are the channel folders and the state file", () => {
  assert.deepEqual(syncOutputs({}), []);
  assert.deepEqual(syncOutputs({
    sync: {
      sources: { bc: { type: "fact-snapshots", path: "s" } },
      channels: [{ id: "a", how: { outputDir: "docs/a" } }, { id: "b" }]
    }
  }), ["docs/a", "docs/sync/b", ".bca/sync-state.json"]);
});
