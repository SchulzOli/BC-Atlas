// Who may use what, in three levels: public (other apps), internal (this
// app), and local (this object). Every app, object, procedure, event, and
// table field is a data point with the level it has today and, where the
// uses found in the analyzed source need less, the level it can be.
// A use is as wide as the border it crosses: inside an object it is local,
// between objects of one app internal, between apps public.
import { normalizeIdentifier } from "./resolver.js";
import { createCallResolver } from "./call-analysis.js";

export const LEVELS = Object.freeze(["public", "internal", "local"]);
export const LEVEL_REACH = Object.freeze({ public: "other apps", internal: "this app", local: "this object" });
// Categorical, colorblind-safe (validated light and dark); the same on every surface of BC Atlas.
export const LEVEL_COLORS = Object.freeze({
  public: { color: "#D55E00", dark: "#d95926", fill: "#FDEBDD" },
  internal: { color: "#0072B2", dark: "#3987e5", fill: "#DDEBF6" },
  local: { color: "#009E73", dark: "#199e70", fill: "#DDF3EB" }
});
/** The relation kind of a use in the visibility view: its level and what it crosses. */
export const reachKind = (level) => `${level} (${LEVEL_REACH[level]})`;

const rank = (level) => LEVELS.indexOf(level);
const narrower = (a, b) => (rank(a) >= rank(b) ? a : b);
const wider = (a, b) => (rank(a) <= rank(b) ? a : b);

// Objects that support Access = Internal and are no extension point by
// design (as in blueprint/surface.js): tables stay public because other apps
// extend them, interfaces because other apps implement them.
const INTERNALIZABLE = new Set(["codeunit", "query", "enum"]);
// Procedures the platform calls by attribute; their level is not a choice.
const PLATFORM_ATTRIBUTE = /\[\s*(?:Test|\w*Handler|ServiceEnabled|ExternalBusinessEvent)\b/iu;

const property = (item, name) => item.properties?.find((entry) => entry.name?.toLowerCase() === name)?.value?.trim();
const appOf = (object) => object.app?.id ?? object.app?.name ?? "(app)";
const objectLabel = (object) => `${object.type} ${object.id ? `${object.id} ` : ""}${object.name}`;
const isSubscriber = (procedure) => (procedure.attributes ?? []).some((attribute) => /\[\s*EventSubscriber\b/iu.test(attribute));

function declaredObjectLevel(object) {
  const access = property(object, "access") ?? object.objectAccess ?? object.metadata?.access ?? "";
  return /^internal$/iu.test(String(access)) ? "internal" : "public";
}

/** The level a member declares, on the three levels: protected reaches extensions in other apps. */
function declaredMemberLevel(declared) {
  if (declared === "local") return "local";
  if (declared === "internal") return "internal";
  return "public";
}

/**
 * @param model a resolved architecture model (objects with members, edges)
 * @returns {
 *   levels, points: [{ id, kind, parent, name, type, level, declared, canBe, why, object, file, line }],
 *   uses: [{ from, to, level, kinds, weight }], summary
 * }
 *   kind is app, object, procedure, event, or field; parent the id of the
 *   app or object a point is in; uses connect objects or members.
 */
export function analyzeVisibility(model) {
  const objects = model.objects.filter((object) => !object.externalSymbol && !object.isBoundary && object.type !== "module" && Array.isArray(object.relations));
  const objectByKey = new Map(model.objects.map((object) => [object.key, object]));
  const inScope = new Set(objects.map(({ key }) => key));
  const points = [];
  const pointById = new Map();
  const add = (point) => {
    points.push(point);
    pointById.set(point.id, point);
    return point;
  };

  const apps = new Map();
  for (const object of objects) {
    const id = `app::${appOf(object)}`;
    if (!apps.has(id)) apps.set(id, add({ id, kind: "app", name: object.app?.name ?? "This app", type: "app", level: "public" }));
  }

  // The widest level anything outside an object needs of it, by object key.
  const objectNeed = new Map();
  const need = (map, key, level) => map.set(key, map.has(key) ? wider(map.get(key), level) : level);
  // A path or type filter hides the users outside it; they still count.
  const outside = (boundary) => (boundary.boundaryCategory === "same-app-outside-focus" ? "internal" : "public");
  const useIndex = new Map();
  const use = (from, to, level, kind, weight = 1) => {
    if (from === to) return;
    const key = `${from}\u0000${to}`;
    const entry = useIndex.get(key) ?? useIndex.set(key, { from, to, level, kinds: {}, weight: 0 }).get(key);
    entry.kinds[kind] = (entry.kinds[kind] ?? 0) + weight;
    entry.weight += weight;
  };
  const between = (source, target) => (source.key === target.key ? "local" : appOf(source) === appOf(target) ? "internal" : "public");

  for (const edge of model.edges) {
    if (!edge.to || edge.from === edge.to) continue;
    const source = objectByKey.get(edge.from);
    const target = objectByKey.get(edge.to);
    if (!source || !target) continue;
    // A permission set grants; it does not use.
    if (edge.kind === "permits" || edge.kind === "includes") continue;
    if (inScope.has(target.key) && source.isBoundary) need(objectNeed, target.key, outside(source));
    if (!inScope.has(source.key) || !inScope.has(target.key)) continue;
    const level = between(source, target);
    need(objectNeed, target.key, level);
    use(source.key, target.key, level, edge.kind, edge.weight ?? 1);
  }

  // Members: procedures and events of every object, fields of tables.
  const records = [];
  const memberNeed = new Map();
  const interfaceMethods = new Map();
  for (const object of objects) {
    if (object.type !== "interface") continue;
    interfaceMethods.set(object.key, new Set((object.procedures ?? []).map(({ name }) => normalizeIdentifier(name))));
  }
  const objectPoints = new Map();
  for (const object of objects) {
    const level = declaredObjectLevel(object);
    const point = add({
      id: object.key,
      kind: "object",
      parent: `app::${appOf(object)}`,
      name: object.name,
      type: object.type,
      objectId: object.id,
      level,
      declared: level,
      file: object.file,
      line: object.location?.line
    });
    objectPoints.set(object.key, point);
    for (const [index, procedure] of (object.procedures ?? []).entries()) {
      // A trigger is run by the platform; it has no level, but what it calls is used.
      const id = `${object.key}::${procedure.kind}::${normalizeIdentifier(procedure.name)}::${procedure.location?.line ?? index}`;
      const node = { key: id };
      records.push({ owner: object, procedure, node });
      if (procedure.kind === "trigger") continue;
      const declared = procedure.visibility ?? "public";
      const internalEvent = (procedure.attributes ?? []).some((attribute) => /\[\s*InternalEvent\b/iu.test(attribute));
      // An event is as wide as who may subscribe: a local publisher only limits who raises it.
      const own = procedure.kind === "event"
        ? (declared === "internal" || internalEvent ? "internal" : "public")
        : declaredMemberLevel(declared);
      add({
        id,
        kind: procedure.kind === "event" ? "event" : "procedure",
        parent: object.key,
        name: procedure.name,
        type: procedure.kind,
        signature: procedure.signature,
        level: narrower(level, own),
        declared,
        file: object.file,
        line: procedure.location?.line
      });
    }
    if (!["table", "tableextension"].includes(object.type)) continue;
    for (const [index, field] of (object.fields ?? []).entries()) {
      if (field.kind !== "field") continue;
      const declared = (property(field, "access") ?? "public").toLowerCase();
      add({
        id: `${object.key}::field::${field.number ?? index}::${normalizeIdentifier(field.name)}`,
        kind: "field",
        parent: object.key,
        name: field.name,
        type: field.type ?? "field",
        level: narrower(level, declaredMemberLevel(declared)),
        declared,
        file: object.file,
        line: field.location?.line
      });
    }
  }

  // Calls between members. A call nobody could resolve may reach any
  // procedure of that name, so it counts for all of them.
  const resolver = createCallResolver({ ...model, objects }, records);
  const recordByNode = new Map(records.map((record) => [record.node.key, record]));
  const unresolved = new Map();
  const callerId = (record) => (record.procedure.kind === "trigger" ? record.owner.key : record.node.key);
  for (const record of records) {
    for (const call of record.procedure.calls ?? []) {
      const resolved = resolver.resolveCall(record.owner, call);
      if (resolved.builtin) continue;
      const targets = resolved.target ? [resolved.target] : (resolved.candidates ?? []).map(({ node }) => node);
      if (!targets.length) {
        const name = normalizeIdentifier(call.name);
        if (!unresolved.has(name)) unresolved.set(name, []);
        unresolved.get(name).push(record.owner);
        continue;
      }
      for (const target of targets) {
        const callee = recordByNode.get(target.key);
        if (!callee || callee.procedure.kind === "trigger") continue;
        const level = between(record.owner, callee.owner);
        need(memberNeed, callee.node.key, level);
        use(callerId(record), callee.node.key, level, "calls");
      }
    }
  }
  // Subscriptions: the subscriber uses the event it listens to.
  for (const edge of model.edges) {
    if (edge.kind !== "subscribes" || !edge.to || !edge.event || !inScope.has(edge.from) || !inScope.has(edge.to)) continue;
    const source = objectByKey.get(edge.from);
    const target = objectByKey.get(edge.to);
    const subscriber = records.find(({ owner, procedure }) => owner === source && normalizeIdentifier(procedure.name) === normalizeIdentifier(edge.member ?? edge.sourceProcedure ?? ""));
    const publisher = records.find(({ owner, procedure }) => owner === target && procedure.kind === "event" && normalizeIdentifier(procedure.name) === normalizeIdentifier(edge.event));
    if (!publisher) continue;
    use(subscriber && subscriber.procedure.kind !== "trigger" ? subscriber.node.key : source.key, publisher.node.key, between(source, target), "subscribes");
  }

  // What it can be: the narrowest level the uses allow, where that is a choice.
  const implemented = new Map();
  for (const edge of model.edges) {
    if (edge.kind !== "implements" || !inScope.has(edge.from)) continue;
    const methods = implemented.get(edge.from) ?? implemented.set(edge.from, { names: new Set(), unknown: false }).get(edge.from);
    const contract = edge.to ? interfaceMethods.get(edge.to) : undefined;
    if (contract) for (const name of contract) methods.names.add(name);
    else methods.unknown = true;
  }
  for (const record of records) {
    const { owner, procedure, node } = record;
    const point = pointById.get(node.key);
    if (!point || point.kind !== "procedure") continue;
    const contract = implemented.get(owner.key);
    const fixed = owner.type === "interface" ? "part of an interface"
      : owner.type === "controladdin" ? "part of a control add-in"
        : contract && (contract.unknown || contract.names.has(normalizeIdentifier(procedure.name))) && procedure.visibility !== "local" ? "implements an interface"
          : (procedure.attributes ?? []).some((attribute) => PLATFORM_ATTRIBUTE.test(attribute)) ? "called by the platform"
            : undefined;
    if (fixed) {
      point.why = fixed;
      continue;
    }
    let needed = memberNeed.get(node.key) ?? "local";
    for (const caller of unresolved.get(normalizeIdentifier(procedure.name)) ?? []) {
      needed = wider(needed, between(caller, owner));
    }
    // Users a filter hides may call any procedure of the object.
    if (model.objects.some(({ isBoundary }) => isBoundary) && objectNeed.has(owner.key) && point.declared !== "local") {
      needed = wider(needed, objectNeed.get(owner.key));
    }
    if (rank(needed) > rank(point.level)) {
      point.canBe = needed;
      point.why = isSubscriber(procedure)
        ? "an event subscriber is called by the platform only"
        : needed === "local" ? "no use outside its object found" : "no use outside its app found";
    }
  }
  for (const object of objects) {
    const point = objectPoints.get(object.key);
    if (point.level !== "public" || !INTERNALIZABLE.has(object.type)) continue;
    const events = (object.procedures ?? []).some(({ kind }) => kind === "event");
    const reason = object.type === "codeunit" && events ? "publishes events"
      : object.type === "enum" && /^true$/iu.test(property(object, "extensible") ?? "") ? "extensible enum"
        : /^test/iu.test(property(object, "subtype") ?? "") ? "test codeunit"
          : undefined;
    if (reason) {
      point.why = reason;
      continue;
    }
    if (objectNeed.get(object.key) === "public") continue;
    point.canBe = "internal";
    point.why = "no use from another app found";
  }

  const uses = [...useIndex.values()].filter(({ from, to }) => pointById.has(from) && pointById.has(to));
  const count = (list, field) => Object.fromEntries(LEVELS.map((level) => [level, list.filter((point) => point[field] === level).length]));
  const dataPoints = points.filter(({ kind }) => kind !== "app");
  const members = dataPoints.filter(({ kind }) => kind !== "object");
  return {
    levels: LEVELS,
    points,
    uses,
    summary: {
      apps: apps.size,
      objects: count(dataPoints.filter(({ kind }) => kind === "object"), "level"),
      members: count(members, "level"),
      canBe: count(dataPoints, "canBe"),
      uses: Object.fromEntries(LEVELS.map((level) => [level, uses.filter((entry) => entry.level === level).length]))
    }
  };
}

/** `3 public, 1 internal, 7 local` for the members of one object; levels without members are left out. */
export function levelCounts(points) {
  return LEVELS.map((level) => [level, points.filter((point) => point.level === level).length])
    .filter(([, total]) => total)
    .map(([level, total]) => `${total} ${level}`)
    .join(", ");
}

/**
 * The analysis as arrays for the canvas of the app pages: points by index
 * (apps, then objects, then members), uses as index pairs.
 */
export function compactVisibility(analysis) {
  const order = { app: 0, object: 1 };
  const points = [...analysis.points].sort((a, b) => (order[a.kind] ?? 2) - (order[b.kind] ?? 2));
  const index = new Map(points.map((point, position) => [point.id, position]));
  return {
    levels: analysis.levels,
    summary: analysis.summary,
    // [kind, parent, name, type, level, canBe, why, object page, declared]
    points: points.map((point) => [
      point.kind,
      point.parent === undefined ? -1 : index.get(point.parent),
      point.kind === "object" ? objectLabel({ type: point.type, id: point.objectId, name: point.name }) : point.name,
      point.type,
      rank(point.level),
      point.canBe ? rank(point.canBe) : -1,
      point.why ?? null,
      point.kind === "object" ? point.id : null,
      point.declared ?? null
    ]),
    uses: analysis.uses.map(({ from, to, level, weight }) => [index.get(from), index.get(to), rank(level), weight])
  };
}
