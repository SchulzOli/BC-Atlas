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
import { linkGuides, loadGuideCorpus } from "../src/guides.js";

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

  // With user guides: a guide is a node of the Pages lens, and a journey a story.
  const warehouse = new Workspace(path.join(root, "examples", "warehouse-app"), {}, { live: false });
  const pages = JSON.parse((await renderView(warehouse, { lens: "pages", format: "json" })).content);
  valid(pages, "view");
  assert.ok(pages.nodes.some(({ kind }) => kind === "guide") && pages.relations.some(({ kind }) => kind === "documents"));
  valid(JSON.parse((await renderView(warehouse, { story: "journey-inbound-warehouse-request", format: "json" })).content), "story");
  valid(JSON.parse((await renderView(warehouse, { format: "json" })).content), "atlas");
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

  // A page lists its user guides.
  const warehouse = await loadProject(path.join(root, "examples", "warehouse-app"));
  const guides = linkGuides(warehouse.model, await loadGuideCorpus(warehouse.options), warehouse.options);
  for (const detail of ["summary", "full"]) {
    const pages = inspectModel(warehouse.model, { select: ["type:page"], guides, detail });
    valid(pages, "inspect");
    assert.deepEqual(pages.objects[0].guides.map(({ id }) => id), ["warehouse-request-create", "warehouse-request-process"], detail);
  }
  assert.equal(inspectModel(warehouse.model, { select: ["type:page"], guides }).summary.guides.undocumented, 1);
  assert.throws(() => inspectModel(model, { detail: "all" }), /detail must be summary or full/u);
  assert.throws(() => inspectModel(model, { select: ["nonsense"] }), /Invalid selector/u);
});
