import { normalizeIdentifier } from "./resolver.js";
import { aggregateRelations } from "./relation-aggregation.js";
import { createCallResolver } from "./call-analysis.js";
import { markCycles, workflowView } from "./workflow.js";

function globToRegExp(pattern) {
  const escaped = String(pattern)
    .replace(/[.+^${}()|[\]\\]/gu, "\\$&")
    .replaceAll("**", "\u0000")
    .replaceAll("*", "[^/]*")
    .replaceAll("\u0000", ".*")
    .replaceAll("?", ".");
  return new RegExp(`^${escaped}$`, "iu");
}

function matchesAny(value, patterns = []) {
  return patterns.some((pattern) => globToRegExp(pattern).test(value));
}

export function filterModel(model, options = {}) {
  const types = new Set(
    (options.types ?? [])
      .flatMap((value) => value.split(","))
      .map((value) => value.toLowerCase())
      .filter(Boolean)
  );
  const namespaces = options.namespaces ?? [];
  const include = options.include ?? [];
  const exclude = options.exclude ?? [];
  const focusPath = options.focusPath?.replaceAll("\\", "/").replace(/^\.\//u, "");

  const objects = model.objects.filter((object) => {
    if (object.externalSymbol) return false;
    const searchable = `${object.type}:${object.id ?? ""}:${object.name}`;
    if (types.size && !types.has(object.type)) return false;
    if (namespaces.length && !matchesAny(object.namespace, namespaces)) return false;
    const file = object.file.replaceAll("\\", "/");
    if (focusPath && file !== focusPath && !file.startsWith(`${focusPath.replace(/\/$/u, "")}/`)) {
      return false;
    }
    if (include.length && !matchesAny(file, include) && !matchesAny(searchable, include)) {
      return false;
    }
    return !matchesAny(file, exclude) && !matchesAny(searchable, exclude);
  });
  const keys = new Set(objects.map(({ key }) => key));
  const objectByKey = new Map(model.objects.map((object) => [object.key, object]));
  const boundaryObjects = new Map();

  function boundaryFor(adjacent, focus, edge) {
    let category = edge.targetOrigin;
    if (adjacent.externalSymbol && /microsoft/iu.test(adjacent.app?.publisher ?? "")) {
      category = "microsoft-base-app";
    } else if (adjacent.app?.id && focus.app?.dependencies?.some((dependency) =>
      [dependency.id, dependency.appId].includes(adjacent.app.id)
    )) {
      category = "declared-dependency";
    } else if (adjacent.app?.id && adjacent.app.id === focus.app?.id) {
      category = "same-app-outside-focus";
    } else if (!category || category === "same-app" || category === "workspace-app") {
      category = "unknown";
    }
    const appName = adjacent.app?.name ?? "Unknown app";
    const namespace = adjacent.namespace ?? "(global)";
    const key = `boundary::${category}::${normalizeIdentifier(appName)}::${normalizeIdentifier(namespace)}`;
    if (!boundaryObjects.has(key)) {
      boundaryObjects.set(key, {
        key,
        name: `${category.replaceAll("-", " ")}: ${appName} / ${namespace}`,
        type: "module",
        namespace: "(boundary)",
        file: "",
        relations: [],
        members: [],
        boundaryCategory: category,
        isBoundary: true,
        viewGroup: "Adjacent context"
      });
    }
    const boundary = boundaryObjects.get(key);
    if (!boundary.members.includes(adjacent.key)) boundary.members.push(adjacent.key);
    return boundary;
  }

  const edges = [];
  for (const edge of model.edges) {
    const fromInside = keys.has(edge.from);
    const toInside = edge.to ? keys.has(edge.to) : false;
    if (fromInside && (!edge.to || toInside)) {
      edges.push(edge);
      continue;
    }
    if (fromInside && edge.to) {
      const adjacent = objectByKey.get(edge.to);
      if (!adjacent) continue;
      const boundary = boundaryFor(adjacent, objectByKey.get(edge.from), edge);
      edges.push({ ...edge, to: boundary.key, targetOrigin: boundary.boundaryCategory });
      continue;
    }
    if (toInside) {
      const adjacent = objectByKey.get(edge.from);
      if (!adjacent) continue;
      const boundary = boundaryFor(adjacent, objectByKey.get(edge.to), edge);
      edges.push({ ...edge, from: boundary.key, targetOrigin: boundary.boundaryCategory });
    }
  }
  return {
    ...model,
    focusPath,
    objects: [...objects, ...boundaryObjects.values()],
    edges
  };
}

function selectObject(model, selector) {
  const normalized = normalizeIdentifier(selector);
  const [kind, identity] = selector.includes(":")
    ? selector.split(/:(.*)/su, 2)
    : [undefined, selector];
  const matches = model.objects.filter((object) => {
    if (kind && object.type !== kind.toLowerCase()) return false;
    return [object.id, object.name, object.key]
      .filter(Boolean)
      .some((value) => normalizeIdentifier(value) === normalizeIdentifier(identity ?? normalized));
  });
  if (matches.length !== 1) {
    throw new Error(
      matches.length
        ? `Object selector "${selector}" is ambiguous (${matches.length} matches)`
        : `Object selector "${selector}" did not match any object`
    );
  }
  return matches[0];
}

function objectView(model, options = {}) {
  const selector = options.object;
  if (!selector) throw new Error("--object is required for the object view");
  const focus = selectObject(model, selector);
  const keys = new Set([focus.key]);
  for (const [direction, requestedDepth] of [
    ["outbound", options.objectOutboundDepth ?? 1],
    ["inbound", options.objectInboundDepth ?? 1]
  ]) {
    const depth = Number(requestedDepth);
    if (!Number.isInteger(depth) || depth < 0) {
      throw new Error(`object ${direction} depth must be a non-negative integer`);
    }
    const visited = new Set([focus.key]);
    let frontier = new Set([focus.key]);
    for (let level = 0; level < depth; level++) {
      const next = new Set();
      for (const edge of model.edges) {
        const candidate = direction === "outbound" && frontier.has(edge.from)
          ? edge.to
          : direction === "inbound" && edge.to && frontier.has(edge.to)
            ? edge.from
            : undefined;
        if (candidate && !visited.has(candidate)) {
          visited.add(candidate);
          keys.add(candidate);
          next.add(candidate);
        }
      }
      frontier = next;
      if (!frontier.size) break;
    }
  }
  return {
    ...model,
    titleSuffix: focus.name,
    objects: model.objects
      .filter(({ key }) => keys.has(key))
      .map((object) => object.key === focus.key ? { ...object, isFocus: true } : object),
    edges: model.edges.filter((edge) => keys.has(edge.from) && (!edge.to || keys.has(edge.to)))
  };
}

function dataView(model) {
  const dataTypes = new Set(["table", "tableextension", "query", "report", "xmlport", "page"]);
  const selectedEdges = model.edges.filter(
    (edge) => ["reads", "writes", "relates", "extends"].includes(edge.kind)
  );
  const relevantEdges = aggregateRelations(selectedEdges, {
    identity: (edge) => [
      edge.from,
      edge.to ?? `${edge.unresolved?.type}:${edge.unresolved?.name}`,
      edge.kind,
      edge.relationClass ?? "unspecified",
      edge.temporary ? "temporary" : "persisted"
    ].join("|"),
    occurrence: (edge) => ({
      operation: edge.operation,
      sourceProcedure: edge.sourceProcedure ?? edge.member,
      transactionSegment: edge.transactionSegment,
      location: edge.location,
      via: edge.via
    })
  });
  const relevantKeys = new Set();
  const access = new Map();
  for (const object of model.objects.filter(({ type }) => type === "table")) {
    relevantKeys.add(object.key);
    access.set(object.key, { reads: 0, writes: 0 });
  }
  for (const edge of relevantEdges) {
    const source = model.objects.find(({ key }) => key === edge.from);
    const target = model.objects.find(({ key }) => key === edge.to);
    if (source && (dataTypes.has(source.type) || target?.type === "table")) relevantKeys.add(source.key);
    if (target?.type === "table") relevantKeys.add(target.key);
    if (target?.type === "table" && ["reads", "writes"].includes(edge.kind)) {
      const counts = access.get(target.key);
      if (counts) counts[edge.kind] += edge.weight ?? 1;
    }
  }
  const objects = model.objects
    .filter(({ key }) => relevantKeys.has(key))
    .map((object) => {
      const counts = access.get(object.key);
      if (!counts) return object;
      const dataAccess = counts.reads && counts.writes
        ? "read-write"
        : counts.reads ? "read-only" : counts.writes ? "write-only" : "never-accessed";
      return { ...object, dataAccess, readCount: counts.reads, writeCount: counts.writes };
    });
  return {
    ...model,
    objects,
    edges: relevantEdges.filter(
      (edge) => relevantKeys.has(edge.from) && (!edge.to || relevantKeys.has(edge.to))
    ),
    dataSummary: Object.fromEntries(
      ["read-only", "write-only", "read-write", "never-accessed"].map((state) => [
        state,
        objects.filter(({ dataAccess }) => dataAccess === state).length
      ])
    )
  };
}

function moduleName(namespace, depth) {
  if (namespace === "(global)") return namespace;
  return namespace.split(".").slice(0, depth).join(".");
}

function automaticModuleDepth(objects) {
  const namespaces = objects
    .map(({ namespace }) => namespace)
    .filter((namespace) => namespace && namespace !== "(global)")
    .map((namespace) => namespace.split("."));
  if (!namespaces.length) return 1;
  let common = 0;
  const shortest = Math.min(...namespaces.map((segments) => segments.length));
  while (
    common < shortest &&
    namespaces.every((segments) => segments[common] === namespaces[0][common])
  ) {
    common++;
  }
  const longest = Math.max(...namespaces.map((segments) => segments.length));
  return Math.min(common + 1, longest);
}

function folderModuleName(file, depth = 1) {
  const directory = file.replaceAll("\\", "/").split("/").slice(0, -1);
  return directory.length ? directory.slice(0, depth).join("/") : "(root)";
}

function moduleView(model, options = {}) {
  const groupBy = options.groupBy ?? "namespace";
  const depth = options.moduleDepth === "auto" || options.moduleDepth === undefined
    ? automaticModuleDepth(model.objects)
    : Number(options.moduleDepth);
  const folderDepth = Number(options.folderDepth ?? 1);
  const modules = new Map();
  const keyToModule = new Map();
  for (const object of model.objects) {
    const name = groupBy === "folder"
      ? folderModuleName(object.file, folderDepth)
      : moduleName(object.namespace, depth);
    if (!modules.has(name)) {
      modules.set(name, {
        key: `module::${normalizeIdentifier(name)}`,
        name,
        type: "module",
        namespace: "(modules)",
        file: "",
        relations: [],
        members: []
      });
    }
    modules.get(name).members.push(object.key);
    keyToModule.set(object.key, modules.get(name).key);
  }
  const edges = aggregateRelations(model.edges, {
    project: (edge) => {
      if (!edge.to) return undefined;
      const from = keyToModule.get(edge.from);
      const to = keyToModule.get(edge.to);
      if (!from || !to || from === to) return undefined;
      return { ...edge, from, to, confidence: "resolved" };
    },
    identity: (edge) => `${edge.from}|${edge.to}|${edge.kind}`
  }).map((edge, index) => ({ ...edge, id: `m${index}` }));
  return { ...model, objects: [...modules.values()], edges };
}

function callSelectorMatches(node, selector) {
  const wanted = normalizeIdentifier(selector);
  const values = [node.name, node.signature, `${node.ownerName}.${node.name}`, node.key]
    .filter(Boolean)
    .map(normalizeIdentifier);
  if (wanted.includes("*") || wanted.includes("?")) {
    const expression = globToRegExp(wanted);
    return values.some((value) => expression.test(value));
  }
  return values.includes(wanted);
}

function projectCalls(objects, edges, roots, depth, direction) {
  if (!roots.length) return { objects, edges };
  const selected = new Set(roots);
  let frontier = [...roots];
  for (let level = 0; level < depth && frontier.length; level++) {
    const next = [];
    const frontierKeys = new Set(frontier);
    for (const edge of edges) {
      if (direction !== "incoming" && frontierKeys.has(edge.from) && edge.to && !selected.has(edge.to)) {
        selected.add(edge.to);
        next.push(edge.to);
      }
      if (direction !== "outgoing" && edge.to && frontierKeys.has(edge.to) && !selected.has(edge.from)) {
        selected.add(edge.from);
        next.push(edge.from);
      }
    }
    frontier = next;
  }
  return {
    objects: objects.filter(({ key }) => selected.has(key)),
    edges: edges.filter(({ from, to }) =>
      selected.has(from) && (!to || selected.has(to))
    )
  };
}

function aggregateOwnerCalls(model, procedures, edges) {
  const owners = new Map(model.objects.map((object) => [object.key, object]));
  const ownerForProcedure = new Map(procedures.map((procedure) => [procedure.key, procedure.ownerKey]));
  for (const procedure of procedures) {
    if (!procedure.ownerKey) owners.set(procedure.key, procedure);
  }
  const usedOwners = new Set(procedures.map(({ ownerKey, key }) => ownerKey ?? key));
  const ownerEdges = aggregateRelations(edges, {
    project: (edge) => {
      const from = ownerForProcedure.get(edge.from);
      const to = edge.to ? ownerForProcedure.get(edge.to) ?? edge.to : undefined;
      if (!from) return undefined;
      usedOwners.add(from);
      if (to && owners.has(to)) usedOwners.add(to);
      return { ...edge, from, to };
    },
    identity: (edge) =>
      `${edge.from}|${edge.to ?? edge.unresolved?.name}|${edge.kind}|${edge.confidence}`
  });
  return {
    objects: [...usedOwners].map((key) => owners.get(key)).filter(Boolean),
    edges: ownerEdges
  };
}

function callView(model, options = {}) {
  const objects = [];
  const edges = [];
  const procedureRecords = [];

  for (const owner of model.objects) {
    for (const [index, procedure] of (owner.procedures ?? []).entries()) {
      const key = `${owner.key}::procedure::${normalizeIdentifier(procedure.name)}::${procedure.location?.line ?? index}`;
      const item = {
        key,
        name: procedure.name,
        signature: procedure.signature,
        ownerKey: owner.key,
        ownerName: owner.name,
        procedureName: procedure.name,
        arity: procedure.arity ?? 0,
        returnTargetType: procedure.returnTargetType,
        returnTarget: procedure.returnTarget,
        type: procedure.kind,
        namespace: `${owner.namespace}.${owner.name}`,
        file: owner.file,
        location: procedure.location,
        relations: []
      };
      objects.push(item);
      procedureRecords.push({ owner, procedure, node: item });
    }
  }
  const callResolver = createCallResolver(model, procedureRecords);

  for (const owner of model.objects) {
    for (const procedure of owner.procedures ?? []) {
      const from = callResolver.nodeFor(owner, procedure);
      if (!from) continue;
      for (const call of procedure.calls ?? []) {
        const resolved = callResolver.resolveCall(owner, call);
        const to = resolved.target;
        edges.push({
          id: `c${edges.length}`,
          from: from.key,
          to: to?.key,
          unresolved: to ? undefined : {
            name: call.receiver ? `${call.receiver}.${call.name}` : call.name,
            type: resolved.confidence === "ambiguous" ? "ambiguous procedure" : "procedure"
          },
          kind: "calls",
          confidence: resolved.confidence,
          location: call.location
        });
      }
      for (const attribute of procedure.attributes ?? []) {
        const subscriber = subscriberAttribute(attribute);
        if (!subscriber) continue;
        const targetOwner = callResolver.object(subscriber.type, subscriber.target);
        const candidates = callResolver.candidates(targetOwner, subscriber.event);
        const to = candidates.length === 1 ? candidates[0] : undefined;
        edges.push({
          id: `s${edges.length}`,
          from: from.key,
          to: to?.key,
          unresolved: to ? undefined : {
            name: `${subscriber.target}.${subscriber.event}`,
            type: "event"
          },
          kind: "subscribes",
          confidence: to ? "resolved" : "syntactic",
          location: procedure.location
        });
      }
    }
  }
  const rootSelectors = asArray(options.rootProcedure);
  const roots = objects
    .filter((object) => rootSelectors.some((selector) => callSelectorMatches(object, selector)))
    .map(({ key }) => key);
  if (rootSelectors.length && !roots.length) {
    throw new Error(`Call root did not match a procedure: ${rootSelectors.join(", ")}`);
  }
  const depth = Number(options.callDepth ?? 3);
  if (!Number.isInteger(depth) || depth < 0) throw new Error("call depth must be a non-negative integer");
  const direction = options.callDirection ?? "outgoing";
  if (!["incoming", "outgoing", "both"].includes(direction)) {
    throw new Error("call direction must be incoming, outgoing, or both");
  }

  const frameworkKey = "call-framework";
  const framework = {
    key: frameworkKey,
    name: "Framework / standard library",
    type: "module",
    namespace: "(calls)",
    file: "",
    relations: [],
    members: [],
    frameworkCalls: true
  };
  let callEdges = edges;
  if (!options.expandFrameworkCalls) {
    callEdges = edges.map((edge) => edge.confidence === "syntactic"
      ? { ...edge, to: frameworkKey, unresolved: undefined, frameworkCollapsed: true }
      : edge
    );
    if (callEdges.some(({ to }) => to === frameworkKey)) objects.push(framework);
  }

  const projection = projectCalls(objects, callEdges, roots, depth, direction);
  const retainedEdges = options.includeUnresolvedCalls || options.expandFrameworkCalls
    ? projection.edges
    : projection.edges.filter(({ to, confidence }) => to || confidence === "ambiguous");
  const connected = new Set(retainedEdges.flatMap(({ from, to }) => [from, to].filter(Boolean)));
  let result = {
    objects: options.includeUnresolvedCalls
      ? projection.objects
      : projection.objects.filter(({ key }) => connected.has(key) || roots.includes(key)),
    edges: retainedEdges
  };
  const level = options.expandProcedures ? "procedure" : "object";
  const rootOwners = result.objects
    .filter(({ key }) => roots.includes(key))
    .map(({ ownerKey, key }) => ownerKey ?? key);
  if (level === "object") result = aggregateOwnerCalls(model, result.objects, result.edges);
  const cycled = markCycles(result.objects, result.edges);
  return {
    ...model,
    objects: cycled.objects,
    edges: cycled.edges,
    callGraph: {
      level,
      roots: level === "object" ? [...new Set(rootOwners)] : roots,
      rootProcedures: roots,
      depth,
      direction,
      frameworkCollapsed: !options.expandFrameworkCalls,
      cycles: cycled.cycles
    }
  };
}

function asArray(value) {
  return value === undefined ? [] : Array.isArray(value) ? value : [value];
}

function connectedProjection(model, seedKeys) {
  const keys = new Set(seedKeys);
  let changed = true;
  while (changed) {
    changed = false;
    for (const edge of model.edges) {
      if (keys.has(edge.from) && edge.to && !keys.has(edge.to)) {
        keys.add(edge.to);
        changed = true;
      } else if (edge.to && keys.has(edge.to) && !keys.has(edge.from)) {
        keys.add(edge.from);
        changed = true;
      }
    }
  }
  return {
    ...model,
    objects: model.objects.filter(({ key }) => keys.has(key)),
    edges: model.edges.filter(
      ({ from, to }) => keys.has(from) && (!to || keys.has(to))
    )
  };
}

function focusSeeds(model, focus) {
  if (!focus) return [];
  const wanted = normalizeIdentifier(focus);
  return model.objects
    .filter((object) =>
      [object.name, object.id, object.ownerName, object.eventName]
        .filter(Boolean)
        .some((value) => normalizeIdentifier(value).includes(wanted))
    )
    .map(({ key }) => key);
}

function scopeMatches(object, scope) {
  const separator = scope.indexOf(":");
  if (separator < 1) {
    throw new Error(
      `Invalid boundary scope "${scope}"; use namespace:, folder:, app:, or object:`
    );
  }
  const kind = scope.slice(0, separator).toLowerCase();
  const value = scope.slice(separator + 1);
  if (!value) throw new Error(`Boundary scope "${scope}" has no value`);
  if (kind === "namespace") {
    return value.includes("*") || value.includes("?")
      ? matchesAny(object.namespace, [value])
      : object.namespace === value || object.namespace.startsWith(`${value}.`);
  }
  if (kind === "folder") {
    const file = object.file.replaceAll("\\", "/");
    const folder = value.replaceAll("\\", "/").replace(/^\.?\//u, "").replace(/\/$/u, "");
    return folder.includes("*") || folder.includes("?")
      ? matchesAny(file, [folder, `${folder}/**`])
      : file === folder || file.startsWith(`${folder}/`);
  }
  if (kind === "app" || kind === "application") {
    const wanted = normalizeIdentifier(value);
    return [object.app?.id, object.app?.name, object.app?.publisher]
      .filter(Boolean)
      .some((candidate) => normalizeIdentifier(candidate) === wanted);
  }
  if (kind === "object") {
    const [type, identity] = value.includes(":")
      ? value.split(/:(.*)/su, 2)
      : [undefined, value];
    if (type && object.type !== type.toLowerCase()) return false;
    const wanted = normalizeIdentifier(identity);
    return [object.id, object.name, object.key]
      .filter(Boolean)
      .some((candidate) => normalizeIdentifier(candidate) === wanted);
  }
  throw new Error(
    `Unsupported boundary scope kind "${kind}"; use namespace, folder, app, or object`
  );
}

function boundaryView(model, options = {}) {
  const scopes = asArray(options.scope);
  if (!scopes.length) {
    throw new Error(
      "--scope is required for the boundary view (namespace:, folder:, app:, or object:)"
    );
  }
  const inside = new Set(
    model.objects
      .filter((object) => scopes.some((scope) => scopeMatches(object, scope)))
      .map(({ key }) => key)
  );
  if (!inside.size) {
    throw new Error(`Boundary scope did not match any object: ${scopes.join(", ")}`);
  }

  const edges = model.edges
    .filter((edge) =>
      edge.to
        ? inside.has(edge.from) !== inside.has(edge.to)
        : inside.has(edge.from)
    )
    .map((edge) => ({
      ...edge,
      label: `${edge.kind} ${inside.has(edge.from) ? "outbound" : "inbound"}`
    }));
  const keys = new Set(
    edges.flatMap(({ from, to }) => [from, to].filter(Boolean))
  );
  return {
    ...model,
    titleSuffix: scopes.join(", "),
    objects: model.objects
      .filter(({ key }) => keys.has(key))
      .map((object) => ({
        ...object,
        viewGroup: inside.has(object.key) ? "Inside boundary" : "Outside boundary",
        isFocus: inside.has(object.key)
      })),
    edges
  };
}

function contractsView(model, options = {}) {
  const kinds = new Set(["implements", "selects"]);
  const edges = model.edges
    .filter(({ kind }) => kinds.has(kind))
    .map((edge) => ({
      ...edge,
      label: edge.kind === "selects"
        ? [
            "enum implementation",
            edge.contract ? `for ${edge.contract}` : undefined,
            edge.member ? `value ${edge.member}` : undefined
          ].filter(Boolean).join(" ")
        : "implements"
    }));
  const keys = new Set(edges.flatMap(({ from, to }) => [from, to].filter(Boolean)));
  let view = {
    ...model,
    emptyMessage: "No interfaces or implementations found",
    objects: model.objects
      .filter(({ key }) => keys.has(key))
      .map((object) => ({
        ...object,
        viewGroup: object.type === "interface"
          ? "Interfaces"
          : ["enum", "enumextension"].includes(object.type)
            ? "Enum dispatch"
            : "Implementations"
      })),
    edges
  };
  if (options.focus) {
    const seeds = focusSeeds(view, options.focus);
    if (!seeds.length) throw new Error(`Contract focus "${options.focus}" did not match`);
    view = connectedProjection(view, seeds);
  }
  return view;
}

function subscriberAttribute(attribute) {
  const match = attribute.match(
    /EventSubscriber\s*\(\s*ObjectType::([\w.]+)\s*,\s*([^,]+?)\s*,\s*'((?:''|[^'])*)'/iu
  );
  if (!match) return undefined;
  const reference = match[2].trim();
  const separator = reference.indexOf("::");
  return {
    type: match[1].split(".").at(-1).toLowerCase(),
    target: cleanSubscriberReference(separator >= 0 ? reference.slice(separator + 2) : reference),
    event: match[3].replaceAll("''", "'")
  };
}

function cleanSubscriberReference(value) {
  const text = value.trim();
  return text.startsWith('"') && text.endsWith('"')
    ? text.slice(1, -1).replaceAll('""', '"')
    : text;
}

function eventsView(model, options = {}) {
  const objectIndex = new Map();
  const publisherIndex = new Map();
  const objects = [];
  const edges = [];

  for (const owner of model.objects) {
    objectIndex.set(`${owner.type}:${normalizeIdentifier(owner.name)}`, owner);
    objectIndex.set(
      `${owner.type}:${normalizeIdentifier(`${owner.namespace}.${owner.name}`)}`,
      owner
    );
    if (owner.id) objectIndex.set(`${owner.type}:${owner.id}`, owner);
    for (const procedure of owner.procedures ?? []) {
      if (procedure.kind !== "event") continue;
      const item = {
        key: `${owner.key}::event::${normalizeIdentifier(procedure.name)}`,
        name: procedure.name,
        eventName: procedure.name,
        ownerName: owner.name,
        type: "event",
        namespace: owner.namespace,
        file: owner.file,
        location: procedure.location,
        relations: [],
        viewGroup: "Publishers"
      };
      objects.push(item);
      publisherIndex.set(
        `${owner.key}:${normalizeIdentifier(procedure.name)}`,
        item
      );
    }
  }

  const subscribers = new Map();
  for (const owner of model.objects) {
    for (const procedure of owner.procedures ?? []) {
      for (const attribute of procedure.attributes ?? []) {
        const match = subscriberAttribute(attribute);
        if (!match) continue;
        const subscriberKey =
          `${owner.key}::subscriber::${normalizeIdentifier(procedure.name)}`;
        let subscriber = subscribers.get(subscriberKey);
        if (!subscriber) {
          subscriber = {
            key: subscriberKey,
            name: procedure.name,
            ownerName: owner.name,
            type: "subscriber",
            namespace: owner.namespace,
            file: owner.file,
            location: procedure.location,
            relations: [],
            viewGroup: "Subscribers"
          };
          subscribers.set(subscriberKey, subscriber);
          objects.push(subscriber);
        }
        const targetName = match.target;
        const targetOwner = objectIndex.get(
          `${match.type}:${normalizeIdentifier(targetName)}`
        );
        const publisher = targetOwner
          ? publisherIndex.get(
              `${targetOwner.key}:${normalizeIdentifier(match.event)}`
            )
          : undefined;
        edges.push({
          id: `event${edges.length}`,
          from: publisher?.key ?? subscriber.key,
          to: publisher ? subscriber.key : undefined,
          unresolved: publisher ? undefined : {
            name: `${targetName}.${match.event}`,
            type: "event"
          },
          kind: publisher ? "publishes" : "subscribes",
          label: publisher ? "publishes to" : "subscribes (unresolved)",
          confidence: publisher ? "resolved" : "syntactic",
          location: procedure.location
        });
      }
    }
  }

  let view = {
    ...model,
    emptyMessage: "No event publishers or subscribers found",
    objects,
    edges
  };
  if (options.focus) {
    const wanted = normalizeIdentifier(options.focus);
    const seeds = objects
      .filter((object) =>
        [object.name, object.ownerName, object.eventName]
          .filter(Boolean)
          .some((value) => normalizeIdentifier(value).includes(wanted))
      )
      .map(({ key }) => key);
    for (const edge of edges) {
      if (
        edge.unresolved &&
        normalizeIdentifier(edge.unresolved.name).includes(wanted)
      ) {
        seeds.push(edge.from);
      }
    }
    if (!seeds.length) throw new Error(`Event focus "${options.focus}" did not match`);
    view = connectedProjection(view, seeds);
  }
  return view;
}

function uiView(model, options = {}) {
  const pageTypes = new Set(["page", "pageextension", "pagecustomization"]);
  const pageKeys = new Set(
    model.objects.filter(({ type }) => pageTypes.has(type)).map(({ key }) => key)
  );
  const relevant = model.edges.filter((edge) =>
    pageKeys.has(edge.from) &&
    (
      edge.kind === "part" ||
      edge.kind === "runs" ||
      edge.kind === "extends" ||
      (edge.kind === "reads" && edge.property === "sourcetable")
    )
  );
  const objectKeys = new Set(pageKeys);
  for (const edge of relevant) if (edge.to) objectKeys.add(edge.to);

  const objects = model.objects
    .filter(({ key }) => objectKeys.has(key))
    .map((object) => ({
      ...object,
      viewGroup: pageTypes.has(object.type)
        ? "Pages"
        : object.type === "table"
          ? "Source tables"
          : "Navigation targets"
    }));
  const edges = [];
  const actionIndex = new Map();

  for (const page of model.objects.filter(({ key }) => pageKeys.has(key))) {
    for (const action of page.actions ?? []) {
      const key = `${page.key}::action::${normalizeIdentifier(action.name)}`;
      const item = {
        key,
        name: action.name,
        ownerName: page.name,
        type: "action",
        namespace: page.namespace,
        file: page.file,
        location: action.location,
        relations: [],
        viewGroup: "Actions"
      };
      objects.push(item);
      actionIndex.set(`${page.key}:${normalizeIdentifier(action.name)}`, item);
      edges.push({
        id: `ui${edges.length}`,
        from: page.key,
        to: key,
        kind: "contains",
        label: "action",
        confidence: "resolved"
      });
    }
  }

  for (const edge of relevant) {
    const action = edge.member
      ? actionIndex.get(`${edge.from}:${normalizeIdentifier(edge.member)}`)
      : undefined;
    edges.push({
      ...edge,
      from: edge.kind === "runs" && action ? action.key : edge.from,
      label: edge.kind === "part" && edge.member
        ? `part ${edge.member}`
        : edge.kind === "reads"
          ? "source table"
          : edge.kind
    });
  }

  let view = {
    ...model,
    emptyMessage: "No pages, page extensions, or page customizations found",
    objects,
    edges
  };
  if (options.focus) {
    const seeds = objects
      .filter((object) =>
        pageKeys.has(object.key) &&
        normalizeIdentifier(object.name).includes(normalizeIdentifier(options.focus))
      )
      .map(({ key }) => key);
    if (!seeds.length) throw new Error(`UI focus "${options.focus}" did not match a page`);
    const keys = new Set(seeds);
    for (let depth = 0; depth < 2; depth++) {
      for (const edge of edges) {
        if (keys.has(edge.from) && edge.to) keys.add(edge.to);
        if (edge.kind === "extends" && edge.to && keys.has(edge.to)) keys.add(edge.from);
      }
    }
    view = {
      ...view,
      objects: objects.filter(({ key }) => keys.has(key)),
      edges: edges.filter(
        ({ from, to }) => keys.has(from) && (!to || keys.has(to))
      )
    };
  }
  return view;
}

export function createView(model, view = "project", options = {}) {
  switch (view) {
    case "project": return model;
    case "module": return moduleView(model, options);
    case "object": return objectView(model, options);
    case "data": return dataView(model);
    case "call": return callView(model, options);
    case "boundary": return boundaryView(model, options);
    case "contracts": return contractsView(model, options);
    case "events": return eventsView(model, options);
    case "ui": return uiView(model, options);
    case "workflow": return workflowView(model, options);
    default: throw new Error(`Unsupported view: ${view}`);
  }
}

export const testing = { globToRegExp, selectObject };
