// What BC Atlas writes for agents is what schemas/output.schema.json says:
// every shape of `bca view --format json` and of bc_atlas_inspect, checked
// against the published schema on the examples.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { renderView, viewOverview } from "../src/app/view.js";
import { Workspace } from "../src/app/workspace.js";
import { inspectModel } from "../src/inspect.js";
import { loadProject } from "../src/project.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const schema = JSON.parse(readFileSync(path.join(root, "schemas", "output.schema.json"), "utf8"));
const multi = path.join(root, "examples", "multi-app");

/** The part of JSON Schema the file uses: $ref, allOf, oneOf, type, const, enum, required, properties, items. */
function errors(value, rule, where = "$") {
  if (rule.$ref) return errors(value, schema.$defs[rule.$ref.replace("#/$defs/", "")], where);
  const found = [];
  for (const part of rule.allOf ?? []) found.push(...errors(value, part, where));
  if (rule.oneOf && rule.oneOf.filter((part) => !errors(value, part, where).length).length !== 1) found.push(`${where}: matches not exactly one shape`);
  const type = Array.isArray(value) ? "array" : value === null ? "null" : Number.isInteger(value) ? "integer" : typeof value;
  if (rule.type && !(rule.type === type || (rule.type === "number" && type === "integer"))) return [...found, `${where}: ${type}, not ${rule.type}`];
  if ("const" in rule && value !== rule.const) found.push(`${where}: ${JSON.stringify(value)}, not ${JSON.stringify(rule.const)}`);
  if (rule.enum && !rule.enum.includes(value)) found.push(`${where}: ${JSON.stringify(value)}, not one of ${rule.enum.join(", ")}`);
  for (const key of rule.required ?? []) if (!(key in value)) found.push(`${where}: no ${key}`);
  for (const [key, part] of Object.entries(rule.properties ?? {})) if (value?.[key] !== undefined) found.push(...errors(value[key], part, `${where}.${key}`));
  if (rule.items && Array.isArray(value)) value.forEach((item, at) => found.push(...errors(item, rule.items, `${where}[${at}]`)));
  return found;
}

const valid = (value, shape) => {
  assert.deepEqual(errors(value, schema.$defs[shape]), [], shape);
  assert.deepEqual(errors(value, schema), [], `${shape} is one of the shapes`);
};

test("every shape of bca view --format json is the shape the schema publishes", async () => {
  const workspace = new Workspace(multi, {}, { live: false });
  const json = async (options) => JSON.parse((await renderView(workspace, { ...options, format: "json" })).content);
  valid(await json({}), "atlas");
  for (const lens of (await workspace.atlas()).lenses) valid(await json({ lens: lens.id, check: true }), "view");
  valid(await json({ inside: "codeunit:50201" }), "view");
  valid(await json({ focus: "table:50000", depth: 2 }), "view");
  valid(await json({ story: "fix", step: 1 }), "view");
  valid(await json({ story: "system" }), "story");
  valid(await json({ stories: true }), "stories");
  valid(viewOverview(await workspace.atlas()), "overview");
});

test("bc_atlas_inspect gives a part of the model, a page at a time, in the published shape", async () => {
  const { model } = await loadProject(multi);
  const all = inspectModel(model, { limit: 5 });
  valid(all, "inspect");
  assert.deepEqual([all.selected, all.objects.length, all.next, all.detail], [12, 5, 5, "summary"]);
  assert.ok(all.objects.every((object) => !object.procedures?.length || typeof object.procedures === "number"), "a summary counts the members");
  const rest = inspectModel(model, { offset: 10, limit: 5 });
  assert.deepEqual([rest.objects.length, rest.next], [2, undefined], "the last page has no next");

  const sync = inspectModel(model, { select: ["object:codeunit:50201"], detail: "full" });
  valid(sync, "inspect");
  assert.deepEqual(sync.objects.map(({ name }) => name), ["CON Item Sync"]);
  assert.ok(sync.objects[0].procedures[0].calls, "full detail has the members as read");
  assert.ok(sync.edges.every(({ from, to }) => from === sync.objects[0].key || to === sync.objects[0].key), "only the relations that touch it");
  assert.ok(sync.edges.some(({ location }) => location?.line), "with their evidence");

  const counted = inspectModel(model, { select: ["object:codeunit:50201"] }).edges;
  assert.ok(counted.every(({ count }) => count > 0) && counted.length <= sync.edges.length, "a summary counts the relations by kind");
  assert.equal(inspectModel(model, { select: ["type:table", "app:Contoso Sales"] }).selected, 6, "selectors add up");
  assert.throws(() => inspectModel(model, { limit: 0 }), /limit must be from 1 to 500/u);
  assert.throws(() => inspectModel(model, { detail: "all" }), /detail must be summary or full/u);
  assert.throws(() => inspectModel(model, { select: ["nonsense"] }), /Invalid selector/u);
});
