import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createArchitectureModel } from "../src/architecture.js";
import { runHealthCheck } from "../src/commands/check.js";

const fixtures = fileURLToPath(new URL("./fixtures", import.meta.url));

function deepFreeze(value, seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) deepFreeze(value[key], seen);
  return Object.freeze(value);
}

const VIEWS = [
  { view: "project" },
  { view: "module" },
  { view: "object", object: "Sales Poster" },
  { view: "data" },
  { view: "call" },
  { view: "boundary", scope: "namespace:Demo.Sales" },
  { view: "contracts" },
  { view: "events" },
  { view: "ui" },
  { view: "workflow" },
  { view: "visibility" },
  { view: "visibility", expandProcedures: true }
];

// Views share one resolved model per project and copy only its top level;
// a write anywhere below would throw here (modules are strict).
test("diagram views only read the shared resolved model", async () => {
  const cache = new Map();
  const fresh = [];
  for (const values of VIEWS) fresh.push(await createArchitectureModel(fixtures, values));
  await createArchitectureModel(fixtures, { view: "project" }, { cache });
  for (const model of cache.values()) deepFreeze(model);
  for (const [index, values] of VIEWS.entries()) {
    const shared = await createArchitectureModel(fixtures, values, { cache });
    assert.deepEqual(shared.model, fresh[index].model, values.view);
  }
  await runHealthCheck(fixtures, {}, { cache });
});
