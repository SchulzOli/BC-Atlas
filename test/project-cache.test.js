import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { runHealthCheck } from "../src/commands/check.js";
import { loadProject, projectLevels } from "../src/project.js";
import { analyzeVisibility } from "../src/visibility.js";

const fixtures = fileURLToPath(new URL("./fixtures", import.meta.url));

function deepFreeze(value, seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) deepFreeze(value[key], seen);
  return Object.freeze(value);
}

// Every reader shares one resolved model per project; a write anywhere in it
// would throw here (modules are strict).
test("everything that reads the shared resolved model only reads it", async () => {
  const cache = new Map();
  const fresh = await loadProject(fixtures);
  await loadProject(fixtures, {}, { cache });
  for (const model of cache.values()) deepFreeze(model);
  const shared = await loadProject(fixtures, {}, { cache });
  assert.deepEqual(shared.model, fresh.model);
  assert.deepEqual(projectLevels(shared), projectLevels(fresh));
  assert.deepEqual(analyzeVisibility(shared.project).summary, analyzeVisibility(fresh.project).summary);
  await runHealthCheck(fixtures, {}, { cache });
});
