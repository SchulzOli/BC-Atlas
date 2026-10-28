// The public surface of each component: the objects other components
// actually use (its de facto API), the objects that could be Access =
// Internal because nobody outside uses them, and, against a committed
// snapshot (.bca-surface.json), the changes that break the components that
// use it, the way AppSourceCop guards the API of an app.
import fs from "node:fs/promises";
import path from "node:path";

export const SURFACE_FILE = ".bca-surface.json";
export const SURFACE_SCHEMA = "bc-atlas.public-surface";

// Objects that support Access = Internal and are no extension point by design.
// Tables stay public (other apps extend them), so do interfaces and
// extensible enums (other apps implement and extend them) and codeunits that
// publish events (other apps subscribe).
const INTERNALIZABLE = new Set(["codeunit", "query", "enum"]);

const property = (object, name) => object.properties?.find((item) => item.name?.toLowerCase() === name)?.value?.trim();

function objectName(object) {
  return `${object.type} ${object.id ? `${object.id} ` : ""}${object.name}`;
}

/** A stable key for an object across commits: its type and ID, or its name when it has no ID. */
export function surfaceKey(object) {
  return `${object.type}:${object.id ?? object.name}`;
}

function publishesEvents(object) {
  return (object.procedures ?? []).some(({ kind }) => kind === "event");
}

/** Why an object stays public although nobody uses it, or undefined. */
function extensionPoint(object) {
  if (object.type === "codeunit" && publishesEvents(object)) return "publishes events";
  if (object.type === "enum" && /^true$/iu.test(property(object, "extensible") ?? "")) return "extensible enum";
  return undefined;
}

/** `var Record "Customer"; Integer` for `(var Customer: Record Customer; Count: Integer)`; names do not matter in AL calls. */
function parameterTypes(header) {
  const open = header.indexOf("(");
  if (open < 0) return { parameters: "", rest: "" };
  let depth = 0;
  let close = open;
  for (; close < header.length; close++) {
    if (header[close] === "(") depth++;
    if (header[close] === ")" && --depth === 0) break;
  }
  const parameters = header.slice(open + 1, close).split(";").map((parameter) => parameter.trim()).filter(Boolean)
    .map((parameter) => {
      const modifier = /^var\s+/iu.test(parameter) ? "var " : "";
      return `${modifier}${parameter.replace(/^var\s+/iu, "").replace(/^[^:]+:\s*/u, "").replace(/\s+/gu, " ")}`;
    });
  return { parameters: parameters.join("; "), rest: header.slice(close + 1) };
}

/** A procedure's signature as callers see it: name, parameter types, and return type. */
export function procedureSignature(procedure) {
  const { parameters, rest } = parameterTypes(procedure.header ?? "");
  const returns = rest.replace(/\s+var\b[\s\S]*$/iu, "").trim().replace(/^\w+\s*:/u, ":").replace(/^:\s*/u, ": ").replace(/\s+/gu, " ");
  return `${procedure.name}(${parameters})${returns && returns.startsWith(":") ? returns : ""}`;
}

/** What other apps can rely on in an object: public procedures, events, fields, and values. */
export function surfaceMembers(object) {
  const members = { object: objectName(object) };
  if (/^internal$/iu.test(property(object, "access") ?? "")) members.access = "internal";
  const procedures = (object.procedures ?? []).filter(({ kind, visibility }) => kind === "procedure" && (visibility ?? "public") === "public");
  const events = (object.procedures ?? []).filter(({ kind }) => kind === "event");
  if (["codeunit", "interface"].includes(object.type)) {
    members.procedures = procedures.map(procedureSignature).sort();
    if (events.length) members.events = events.map(procedureSignature).sort();
  }
  if (object.type === "table") {
    members.fields = (object.fields ?? []).filter(({ kind }) => kind === "field").map((field) => `${field.number} ${field.name}: ${field.type}`).sort();
  }
  if (object.type === "enum") {
    members.values = (object.elements ?? []).filter(({ kind }) => kind === "enum-value").map((value) => `${value.ordinal} ${value.name}`).sort();
  }
  return members;
}

/**
 * The de facto API of every component, and what could be internal.
 * @returns [{ component, api: [...], candidates: [...], exposes: [selectors] }]
 */
export function componentSurfaces({ levels, componentOf, model, components }) {
  const objects = new Map(model.objects.map((object) => [object.key, object]));
  const nodes = new Map(levels.object.nodes.map((node) => [node.id, node]));
  const used = new Map();
  for (const edge of levels.object.edges) {
    const source = nodes.get(edge.source);
    const target = nodes.get(edge.target);
    if (source?.origin !== "workspace" || target?.origin !== "workspace") continue;
    const from = componentOf.get(source.id);
    const to = componentOf.get(target.id);
    if (!from || !to || from === to) continue;
    if (!used.has(target.id)) used.set(target.id, { users: new Map(), kinds: new Set() });
    const entry = used.get(target.id);
    if (!entry.users.has(from)) entry.users.set(from, new Set());
    entry.users.get(from).add(source.id);
    for (const kind of Object.keys(edge.kinds ?? {})) entry.kinds.add(kind);
  }

  return components.map(({ name }) => {
    const members = levels.object.nodes.filter((node) => node.origin === "workspace" && componentOf.get(node.id) === name)
      .map((node) => objects.get(node.id)).filter(Boolean);
    const api = members.filter((object) => used.has(object.key)).map((object) => {
      const { users, kinds } = used.get(object.key);
      return {
        key: surfaceKey(object),
        object: objectName(object),
        type: object.type,
        name: object.name,
        file: object.file,
        line: object.location?.line,
        internal: /^internal$/iu.test(property(object, "access") ?? ""),
        usedBy: [...users].map(([component, sources]) => ({ component, objects: sources.size })).sort((a, b) => b.objects - a.objects || a.component.localeCompare(b.component)),
        kinds: [...kinds].sort()
      };
    }).sort((a, b) => a.object.localeCompare(b.object));
    const candidates = members.filter((object) =>
      !used.has(object.key) && INTERNALIZABLE.has(object.type) && property(object, "access") === undefined && !extensionPoint(object))
      .map((object) => ({ key: surfaceKey(object), object: objectName(object), type: object.type, name: object.name, file: object.file, line: object.location?.line }))
      .sort((a, b) => a.object.localeCompare(b.object));
    const extensionPoints = members.filter((object) => !used.has(object.key) && extensionPoint(object))
      .map((object) => ({ object: objectName(object), reason: extensionPoint(object) }));
    return {
      component: name,
      objects: members.length,
      api,
      candidates,
      extensionPoints,
      exposes: api.map((item) => `object:${item.type}:${item.name}`)
    };
  });
}

/** The snapshot written to .bca-surface.json: per component, the members of every object in its surface. */
export function surfaceSnapshot(surfaces, model) {
  const byKey = new Map(model.objects.filter(({ externalSymbol }) => !externalSymbol).map((object) => [surfaceKey(object), object]));
  return {
    schema: SURFACE_SCHEMA,
    schemaVersion: 1,
    components: Object.fromEntries(surfaces.filter(({ api }) => api.length).map(({ component, api }) => [component,
      Object.fromEntries(api.map(({ key }) => [key, surfaceMembers(byKey.get(key))]))]))
  };
}

export async function readSurface(file) {
  try {
    const data = JSON.parse(await fs.readFile(file, "utf8"));
    if (data.schema !== SURFACE_SCHEMA) throw new Error(`${file} is not a BC Atlas public surface snapshot`);
    return data;
  } catch (error) {
    if (error.code === "ENOENT") return undefined;
    if (error instanceof SyntaxError) throw new Error(`Invalid JSON in ${file}: ${error.message}`);
    throw error;
  }
}

export async function writeSurface(file, surfaces, model) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(surfaceSnapshot(surfaces, model), null, 2)}\n`);
}

const LISTS = { procedures: "procedure", events: "event", fields: "field", values: "enum value" };

/**
 * Changes since the snapshot that break components using the surface:
 * objects removed or made internal, and members removed or changed.
 * Additions never break anyone.
 */
export function compareSurface(snapshot, model) {
  const byKey = new Map(model.objects.filter(({ externalSymbol }) => !externalSymbol).map((object) => [surfaceKey(object), object]));
  const changes = [];
  for (const [component, objects] of Object.entries(snapshot?.components ?? {})) {
    for (const [key, before] of Object.entries(objects)) {
      const object = byKey.get(key);
      if (!object) {
        changes.push({ component, key, object: before.object, change: "removed", message: `${before.object} of ${component} was removed, but other components used it` });
        continue;
      }
      const where = { file: object.file, line: object.location?.line };
      if (before.access !== "internal" && /^internal$/iu.test(property(object, "access") ?? "")) {
        changes.push({ component, key, object: before.object, change: "made-internal", message: `${before.object} of ${component} became Access = Internal, but other components used it`, ...where });
      }
      const after = surfaceMembers(object);
      for (const [list, label] of Object.entries(LISTS)) {
        const current = new Set(after[list] ?? []);
        for (const member of before[list] ?? []) {
          if (current.has(member)) continue;
          // A member whose name (procedures, events) or number (fields, values) is still there changed.
          const identity = ["fields", "values"].includes(list) ? (value) => value.split(" ")[0] : (value) => value.split("(")[0];
          const changed = [...current].filter((other) => identity(other) === identity(member) && !(before[list] ?? []).includes(other));
          changes.push({
            component,
            key,
            object: before.object,
            change: changed.length ? `${label}-changed` : `${label}-removed`,
            member,
            ...(changed.length ? { now: changed } : {}),
            message: `${before.object} of ${component}: ${label} ${member} was ${changed.length ? `changed to ${changed.join(", ")}` : "removed"}`,
            ...where
          });
        }
      }
    }
  }
  return changes;
}
