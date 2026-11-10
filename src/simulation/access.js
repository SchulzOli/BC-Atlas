// What a set of permission sets lets a user do, read from the resolved
// architecture model: table-data rights (direct or indirect) and execute
// rights per object, composed through IncludedPermissionSets, permission set
// extensions, and ExcludedPermissionSets; plus what objects grant to their
// own code (the Permissions property, InherentPermissions).
import { includedPermissionSets } from "../permission-semantics.js";
import { normalizeIdentifier } from "../resolver.js";

export const RIGHTS = Object.freeze(["read", "insert", "modify", "delete", "execute"]);
export const RIGHT_LETTERS = Object.freeze({ read: "R", insert: "I", modify: "M", delete: "D", execute: "X" });
// Object types a user needs Execute on to run them.
export const EXECUTABLE = Object.freeze(["codeunit", "page", "report", "xmlport", "query"]);

const SET_TYPES = ["permissionset", "permissionsetextension"];

function rightsOf(edge) {
  if (edge.permissionKind === "tabledata") return edge.tableDataRights ?? [];
  return edge.execute ? ["execute"] : [];
}

function propertyValue(object, name) {
  return (object.properties ?? []).find((property) => property.name?.toLowerCase() === name)?.value;
}

/**
 * @param model a resolved project model (createArchitectureModel, project view)
 * @param options.fullAccess names of permission sets that grant everything
 *   although their content is not in the analyzed source (default: SUPER)
 */
export function createAccessIndex(model, { fullAccess = ["SUPER"] } = {}) {
  const objects = new Map(model.objects.map((object) => [object.key, object]));
  const full = new Set(fullAccess.map(normalizeIdentifier));
  const sets = new Map();
  for (const object of model.objects.filter(({ type }) => type === "permissionset")) {
    // A set of the analyzed source wins over one of the same name in a symbol package.
    for (const identity of [object.name, object.id].filter(Boolean)) {
      const key = normalizeIdentifier(identity);
      if (!sets.has(key) || (sets.get(key).externalSymbol && !object.externalSymbol)) sets.set(key, object);
    }
  }
  const outgoing = new Map();
  for (const edge of model.edges) {
    if (!["permits", "includes", "extends"].includes(edge.kind)) continue;
    if (!outgoing.has(edge.from)) outgoing.set(edge.from, []);
    outgoing.get(edge.from).push(edge);
  }
  // Extensions add their grants and inclusions to the set they extend.
  const extensionsOf = new Map();
  for (const object of model.objects.filter(({ type }) => type === "permissionsetextension")) {
    for (const edge of (outgoing.get(object.key) ?? []).filter(({ kind, to }) => kind === "extends" && to)) {
      if (!extensionsOf.has(edge.to)) extensionsOf.set(edge.to, []);
      extensionsOf.get(edge.to).push(object);
    }
  }

  // What objects grant their own code: Permissions = tabledata X = rimd.
  const declared = new Map();
  for (const edge of model.edges) {
    if (edge.kind !== "permits" || !edge.to || edge.permissionKind !== "tabledata") continue;
    if (SET_TYPES.includes(objects.get(edge.from)?.type)) continue;
    if (!declared.has(edge.from)) declared.set(edge.from, new Map());
    const tables = declared.get(edge.from);
    if (!tables.has(edge.to)) tables.set(edge.to, new Set());
    for (const right of rightsOf(edge)) tables.get(edge.to).add(right);
  }

  function setNamed(name) {
    return sets.get(normalizeIdentifier(name));
  }

  /** A set with every set it and its extensions include: Map(key -> { object, via }). */
  function closure(start, onUnresolved = () => {}) {
    const members = new Map();
    const visit = (object, via) => {
      if (members.has(object.key)) return;
      members.set(object.key, { object, via });
      for (const source of [object, ...(extensionsOf.get(object.key) ?? [])]) {
        for (const edge of outgoing.get(source.key) ?? []) {
          if (edge.kind !== "includes") continue;
          if (edge.to && objects.get(edge.to)) visit(objects.get(edge.to), object.name);
          else if (edge.unresolved?.name) {
            const set = setNamed(edge.unresolved.name);
            if (set) visit(set, object.name);
            else onUnresolved(edge.unresolved.name);
          }
        }
      }
    };
    visit(start);
    return members;
  }

  /** What the sets grant: rights per object, and the wildcard grants (tabledata * = R). */
  function grantsOf(members) {
    const grants = new Map();
    const wildcards = [];
    for (const { object } of members) {
      for (const source of [object, ...(extensionsOf.get(object.key) ?? [])]) {
        for (const edge of outgoing.get(source.key) ?? []) {
          if (edge.kind !== "permits") continue;
          for (const right of rightsOf(edge)) {
            const direct = !(edge.indirectRights ?? []).includes(right);
            if (edge.to) {
              if (!grants.has(edge.to)) grants.set(edge.to, new Map());
              const rights = grants.get(edge.to);
              const current = rights.get(right) ?? { direct: false, by: new Set() };
              // A direct grant wins; the sets named are those that give the strongest form.
              if (direct && !current.direct) current.by.clear();
              if (direct || !current.direct) current.by.add(object.name);
              current.direct ||= direct;
              rights.set(right, current);
            } else if (edge.wildcard) {
              wildcards.push({ type: edge.wildcard.type, kind: edge.permissionKind, right, direct, by: object.name });
            }
          }
        }
      }
    }
    return { grants, wildcards };
  }

  function lookup(bag, object, right) {
    const own = bag.grants.get(object.key)?.get(right);
    const kind = right === "execute" ? "execute" : "tabledata";
    const wild = bag.wildcards.filter((entry) => entry.kind === kind && entry.right === right && entry.type === object.type);
    if (own?.direct) return { granted: "direct", by: [...own.by] };
    if (wild.some(({ direct }) => direct)) return { granted: "direct", by: [...new Set(wild.filter(({ direct }) => direct).map(({ by }) => by))] };
    if (own) return { granted: "indirect", by: [...own.by] };
    if (wild.length) return { granted: "indirect", by: [...new Set(wild.map(({ by }) => by))] };
    return { granted: false, by: [] };
  }

  /**
   * The permission sets `names` resolve to, with every set they include.
   * @returns {{ sets, unknown, opaque, full, grants, check(object, right) }}
   */
  function effective(names = []) {
    const unknown = new Set();
    const everything = [];
    const listed = new Map();
    const roots = [];
    const outside = (name) => {
      if (full.has(normalizeIdentifier(name))) everything.push(name);
      else unknown.add(name);
    };
    for (const name of names) {
      const set = setNamed(name);
      if (full.has(normalizeIdentifier(name))) everything.push(name);
      else if (!set) unknown.add(name);
      if (!set) continue;
      const members = closure(set, outside);
      // ExcludedPermissionSets takes the permissions of the excluded sets (and
      // of what they include) out of the set that excludes them, and of no other.
      const excluded = new Map();
      for (const { object } of members.values()) {
        for (const source of [object, ...(extensionsOf.get(object.key) ?? [])]) {
          for (const { target } of includedPermissionSets(propertyValue(source, "excludedpermissionsets"))) {
            const taken = setNamed(target);
            if (taken) for (const [key, member] of closure(taken)) excluded.set(key, member);
          }
        }
      }
      const kept = [...members.values()].filter(({ object }) => !excluded.has(object.key));
      roots.push({ granted: grantsOf(kept), taken: grantsOf([...excluded.values()]) });
      for (const member of kept) if (!listed.has(member.object.key)) listed.set(member.object.key, member);
    }

    const check = (object, right) => {
      if (everything.length) return { granted: "direct", by: [...new Set(everything)] };
      let best = { granted: false, by: [] };
      for (const { granted, taken } of roots) {
        if (lookup(taken, object, right).granted) continue;
        const found = lookup(granted, object, right);
        if (found.granted === "direct") return found;
        if (found.granted && !best.granted) best = found;
      }
      return best;
    };
    // Every right on a named object that survives the exclusions, for "what is not needed".
    const grants = new Map();
    for (const { granted } of roots) {
      for (const [key, rights] of granted.grants) {
        const object = objects.get(key);
        for (const right of rights.keys()) {
          if (!object || !check(object, right).granted) continue;
          if (!grants.has(key)) grants.set(key, new Map());
          grants.get(key).set(right, true);
        }
      }
    }
    const list = [...listed.values()].map(({ object, via }) => ({
      name: object.name,
      id: object.id,
      key: object.key,
      caption: object.metadata?.caption,
      ...(via ? { includedBy: via } : {}),
      // A set from a symbol package: its inclusions are known, its grants are not.
      ...(object.externalSymbol ? { opaque: true } : {})
    }));
    return {
      sets: list,
      unknown: [...unknown],
      opaque: list.some(({ opaque }) => opaque) || unknown.size > 0,
      full: everything.length > 0,
      grants,
      /** @returns {{ granted: "direct" | "indirect" | false, by: string[] }} */
      check
    };
  }

  return {
    setNamed,
    effective,
    /** True when `object` has the table-data right for its own code. */
    declares: (objectKey, tableKey, right) => declared.get(objectKey)?.get(tableKey)?.has(right) ?? false,
    /** Every permission set of the analyzed source (not of symbol packages). */
    workspaceSets: () => [...new Set(sets.values())].filter(({ externalSymbol }) => !externalSymbol)
  };
}

/** Every `InherentPermissions(PermissionObjectType::TableData, Database::"X", 'rm')` of a procedure. */
export function inherentGrants(procedure) {
  const texts = (procedure.attributes ?? []).filter((text) => /InherentPermissions/iu.test(text));
  if (!texts.length && procedure.metadata?.inherentPermissions) texts.push(procedure.metadata.inherentPermissions);
  return texts.map((text) => {
    const match = /PermissionObjectType\s*::\s*(\w+)\s*,\s*(?:Database|Table|Codeunit|Page|Report|Query|Xmlport)\s*::\s*(?:"((?:""|[^"])*)"|([\w.]+))\s*,\s*'([A-Za-z]+)'/iu.exec(text);
    if (!match) return undefined;
    const letters = match[4].toUpperCase();
    return {
      kind: match[1].toLowerCase() === "tabledata" ? "tabledata" : "execute",
      target: (match[2] ?? match[3]).replaceAll('""', '"'),
      rights: RIGHTS.filter((right) => letters.includes(RIGHT_LETTERS[right]))
    };
  }).filter(Boolean);
}

/** The table-data rights a table grants everyone: InherentPermissions = RIMD. */
export function inherentTableRights(table) {
  const letters = String(table.metadata?.inherentPermissions ?? "").toUpperCase();
  return RIGHTS.filter((right) => right !== "execute" && letters.includes(RIGHT_LETTERS[right]));
}

/** True when everyone may run the object: InherentPermissions = X. */
export function inherentlyExecutable(object) {
  return /x/iu.test(object.metadata?.inherentPermissions ?? "");
}
