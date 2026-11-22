// A part of the resolved model, sized for an agent's context: the objects a
// selector names (the selectors of .bca.json), a page at a time, with the
// relations that touch them. The MCP tool bc_atlas_inspect returns this; the
// whole model of a large app does not fit a context.
import { appKey } from "./graph/lenses/dependency.js";
import { guidesByPage } from "./guides.js";
import { normalizeIdentifier } from "./resolver.js";
import { compileSelector } from "./selectors.js";

const INSPECT_SCHEMA = "bc-atlas.inspect/1";
export const INSPECT_LIMIT = 50;

/**
 * @param model the model of a project (loadProject of src/project.js)
 * @param options { select: [selector], offset, limit, detail, guides }: a selector such as
 *   "object:codeunit:50100", "type:table", "namespace:Contoso.Sales", or
 *   "app:Contoso Core"; selectors add up. Without one, every object of the
 *   workspace. detail "summary" (default) gives each object in a line and the
 *   relations counted by kind; "full" gives every member, and every relation
 *   with its evidence. guides are the user guides joined with the model
 *   (linkGuides of src/guides.js): a page lists the guides that show it.
 * @returns { schema, project, summary, selected, offset, limit, next?, objects, edges, diagnostics }
 */
export function inspectModel(model, { select = [], offset = 0, limit = INSPECT_LIMIT, detail = "summary", guides } = {}) {
  if (!["summary", "full"].includes(detail)) throw new Error("detail must be summary or full");
  if (!Number.isInteger(offset) || offset < 0) throw new Error("offset must be 0 or more");
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new Error("limit must be from 1 to 500");
  const own = model.objects.filter(({ externalSymbol, isBoundary }) => !externalSymbol && !isBoundary)
    .sort((a, b) => String(a.key).localeCompare(String(b.key)));

  // The selectors read a node: its app and module by key, its name as label.
  const apps = new Map((model.apps ?? []).map((app) => [appKey(app), { label: app.name, appId: app.id }]));
  const modules = new Map((model.modules ?? []).map((module) => [normalizeIdentifier(module.id ?? module.name), { label: module.name, appId: module.id }]));
  const node = (object) => ({
    type: object.type,
    label: object.name,
    objectId: object.id,
    namespace: object.namespace,
    file: object.file,
    app: appKey(object.app),
    module: object.module ? normalizeIdentifier(object.module.id ?? object.module.name) : undefined
  });
  const matchers = [select].flat().filter(Boolean).map((selector) => compileSelector(selector, { apps, modules }));
  const selected = matchers.length ? own.filter((object) => matchers.some((matches) => matches(node(object)) > 0)) : own;

  const page = selected.slice(offset, offset + limit);
  const keys = new Set(page.map(({ key }) => key));
  const files = new Set(page.map(({ file }) => file));
  const edges = model.edges.filter(({ from, to }) => keys.has(from) || keys.has(to));
  // What a user does on a page, in the words of its user guides.
  const byPage = guidesByPage(guides);
  const withGuides = (object, shown) => {
    const found = byPage.get(object.key);
    if (!found) return shown;
    return { ...shown, guides: found.map((guide) => {
      const here = guide.pages.find(({ key }) => key === object.key);
      return detail === "full"
        ? { id: guide.id, title: guide.title, goal: guide.goal, roles: guide.roles, permissions: guide.permissions, features: guide.features, journeys: guide.journeys, steps: here.steps, actions: here.actions, file: guide.file, line: guide.line }
        : { id: guide.id, title: guide.title };
    }) };
  };
  return {
    schema: INSPECT_SCHEMA,
    project: model.projectRoot,
    summary: {
      files: model.files,
      objects: own.length,
      relations: model.edges.length,
      apps: (model.apps ?? []).filter(({ external }) => !external).map(({ name, version }) => ({ name, version })),
      cycles: model.insights?.cycles?.length ?? 0,
      hubs: model.insights?.hubs ?? [],
      ...(guides ? { guides: { tests: guides.path, documented: guides.guides.length, undocumented: guides.undocumented.length, pagesWithoutGuide: guides.uncovered.length } } : {})
    },
    selected: selected.length,
    offset,
    limit,
    ...(offset + limit < selected.length ? { next: offset + limit } : {}),
    detail,
    objects: page.map((object) => withGuides(object, detail === "full" ? object : summarize(object))),
    // What the objects of the page do, and what is done to them.
    edges: detail === "full" ? edges : countEdges(edges),
    diagnostics: model.diagnostics.filter(({ file }) => files.has(file))
  };
}

const count = (items) => (items?.length ? items.length : undefined);

/** An object in a line: what it is, where, and how much is in it. */
function summarize(object) {
  return Object.fromEntries(Object.entries({
    key: object.key,
    type: object.type,
    id: object.id,
    name: object.name,
    namespace: object.namespace,
    app: object.app?.name,
    file: object.file,
    line: object.location?.line,
    access: object.metadata?.access,
    caption: object.metadata?.caption,
    procedures: count(object.procedures?.filter(({ kind }) => kind !== "trigger")),
    triggers: count(object.procedures?.filter(({ kind }) => kind === "trigger")),
    fields: count(object.fields)
  }).filter(([, value]) => value !== undefined));
}

/** The relations without their evidence: one per pair of objects and kind, with how many there are. */
function countEdges(edges) {
  const counted = new Map();
  for (const { from, to, unresolved, kind, weight } of edges) {
    const target = to ?? (unresolved ? `unresolved:${unresolved.type ?? "object"}:${unresolved.name}` : "wildcard");
    const key = `${from}\u0000${target}\u0000${kind}`;
    const entry = counted.get(key) ?? counted.set(key, { from, to: target, kind, count: 0 }).get(key);
    entry.count += weight ?? 1;
  }
  return [...counted.values()];
}
