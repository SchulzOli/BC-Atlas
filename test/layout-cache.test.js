import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { cachedLayout } from "../src/diagram/layout-cache.js";

const graph = { id: "root", children: [{ id: "a", width: 10, height: 10 }, { id: "b", width: 10, height: 10 }], edges: [{ id: "e0", sources: ["a"], targets: ["b"], labels: [] }] };
const result = {
  width: 50, height: 20, extra: "dropped",
  children: [{ id: "a", x: 0, y: 0, width: 10, height: 10, layoutOptions: {} }, { id: "b", x: 40, y: 0, width: 10, height: 10 }],
  edges: [{ id: "e0", sources: ["a"], targets: ["b"], labels: [], sections: [{ id: "s", startPoint: { x: 10, y: 5 }, endPoint: { x: 40, y: 5 } }] }]
};

test("layouts are stored by graph and read back instead of laid out again", async (t) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "bca-layout-cache-"));
  const previous = process.env.BCA_CACHE_DIR;
  process.env.BCA_CACHE_DIR = directory;
  t.after(() => {
    process.env.BCA_CACHE_DIR = previous;
    rmSync(directory, { recursive: true, force: true });
  });
  let calls = 0;
  const layout = async () => { calls++; return structuredClone(result); };

  const first = await cachedLayout(graph, layout);
  assert.equal(calls, 1);
  assert.equal(first.extra, undefined, "only what the renderer reads is kept");
  assert.deepEqual(first.edges[0].sections, [{ startPoint: { x: 10, y: 5 }, endPoint: { x: 40, y: 5 } }]);
  assert.deepEqual(await cachedLayout(structuredClone(graph), layout), first);
  assert.equal(calls, 1, "the same graph is read from the cache");

  await cachedLayout({ ...graph, children: [...graph.children, { id: "c", width: 10, height: 10 }] }, layout);
  assert.equal(calls, 2, "another graph is laid out");

  const files = readdirSync(path.join(directory, "layout"));
  for (const file of files) writeFileSync(path.join(directory, "layout", file), "damaged");
  assert.deepEqual(await cachedLayout(graph, layout), first);
  assert.equal(calls, 3, "a damaged entry is laid out again");

  process.env.BCA_LAYOUT_CACHE = "off";
  t.after(() => delete process.env.BCA_LAYOUT_CACHE);
  await cachedLayout(graph, layout);
  assert.equal(calls, 4, "BCA_LAYOUT_CACHE=off always lays out");
});
