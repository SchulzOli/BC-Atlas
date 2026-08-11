import { normalizeIdentifier } from "./resolver.js";
import { operationKind } from "./operation-semantics.js";
import { createCallResolver } from "./call-analysis.js";

const DEFAULT_EDGE_TYPES = ["calls", "events", "writes"];

function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function positiveInteger(value, name, fallback) {
  const number = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(number) || number < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return number;
}

function globToRegExp(pattern) {
  const escaped = String(pattern)
    .replace(/[.+^${}()|[\]\\]/gu, "\\$&")
    .replaceAll("**", "\u0000")
    .replaceAll("*", ".*")
    .replaceAll("\u0000", ".*")
    .replaceAll("?", ".");
  return new RegExp(`^${escaped}$`, "iu");
}

function selectorParts(selector) {
  const match = String(selector).match(/^(procedure|trigger|action|event):(.*)$/iu);
  return match
    ? { type: match[1].toLowerCase(), pattern: match[2] }
    : { pattern: String(selector) };
}

function nodeMatches(node, selector) {
  const { type, pattern } = selectorParts(selector);
  if (type && node.type !== type) return false;
  const normalizedPattern = normalizeIdentifier(pattern);
  const values = [
    node.name,
    node.ownerName ? `${node.ownerName}.${node.name}` : undefined,
    node.key
  ].filter(Boolean).map(normalizeIdentifier);
  if (normalizedPattern.includes("*") || normalizedPattern.includes("?")) {
    const expression = globToRegExp(normalizedPattern);
    return values.some((value) => expression.test(value));
  }
  return values.some((value) => value === normalizedPattern);
}

function normalizeEdgeTypes(value) {
  const types = asArray(value)
    .flatMap((item) => String(item).split(","))
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  const allowed = new Set(["calls", "events", "writes", "reads"]);
  const result = types.length ? types : DEFAULT_EDGE_TYPES;
  const invalid = result.filter((kind) => !allowed.has(kind));
  if (invalid.length) {
    throw new Error(
      `Unsupported workflow edge type(s): ${invalid.join(", ")}; use calls, events, writes, or reads`
    );
  }
  return new Set(result);
}

function procedureKey(owner, procedure, index) {
  const suffix = procedure.location?.line ?? index;
  return `${owner.key}::${procedure.kind}::${normalizeIdentifier(procedure.name)}::${suffix}`;
}

function actionKey(owner, action, index) {
  const suffix = action.location?.line ?? index;
  return `${owner.key}::action::${normalizeIdentifier(action.name)}::${suffix}`;
}

function makeNode(owner, member, key, type = member.kind) {
  return {
    key,
    name: member.name,
    ownerName: owner.name,
    type,
    namespace: owner.namespace,
    file: owner.file,
    location: member.location,
    relations: []
  };
}

function addCallEdges({
  edges,
  from,
  calls,
  owner,
  callResolver,
  edgeTypes
}) {
  for (const [index, call] of (calls ?? []).entries()) {
    const record = callResolver.variableFor(owner, call, "record");
    const dataKind = operationKind(call.name);
    if (record && dataKind) {
      if (!edgeTypes.has(dataKind)) continue;
      const table = callResolver.object("table", record.target);
      edges.push({
        id: `workflow${edges.length}`,
        from,
        to: table?.key,
        unresolved: table ? undefined : { name: record.target, type: "table" },
        kind: dataKind,
        label: `${call.name} #${index + 1}`,
        confidence: table ? "resolved" : "syntactic",
        sequence: "definite",
        order: index + 1,
        location: call.location
      });
      continue;
    }
    if (!edgeTypes.has("calls")) continue;
    const resolved = callResolver.resolveCall(owner, call);
    const to = resolved.target;
    edges.push({
      id: `workflow${edges.length}`,
      from,
      to: to?.key,
      unresolved: to ? undefined : {
        name: call.receiver ? `${call.receiver}.${call.name}` : call.name,
        type: resolved.confidence === "ambiguous" ? "ambiguous procedure" : "procedure"
      },
      kind: "calls",
      label: `calls #${index + 1}`,
      confidence: resolved.confidence,
      sequence: "definite",
      order: index + 1,
      location: call.location
    });
  }
}

function phaseRules(phases) {
  if (Array.isArray(phases)) {
    return phases.map((phase) => ({
      label: phase.label ?? phase.name,
      match: asArray(phase.match ?? phase.matches ?? phase.pattern)
    })).filter(({ label, match }) => label && match.length);
  }
  if (phases && typeof phases === "object") {
    return Object.entries(phases).map(([label, match]) => ({
      label,
      match: asArray(match)
    }));
  }
  return [];
}

function applyPhases(objects, phases) {
  const rules = phaseRules(phases);
  return objects.map((object) => {
    const phase = rules.find((rule) =>
      rule.match.some((selector) => nodeMatches(object, selector))
    );
    return { ...object, viewGroup: phase?.label ?? object.viewGroup ?? "Workflow" };
  });
}

function stopSelectors(condition) {
  if (
    condition &&
    typeof condition === "object" &&
    !Array.isArray(condition)
  ) {
    return asArray(condition.match ?? condition.pattern);
  }
  return asArray(condition);
}

function collapsedGraph(objects, edges, selectors, entryKeys) {
  const collapsed = new Set(
    objects
      .filter((node) =>
        !entryKeys.has(node.key) &&
        !["action", "event", "table"].includes(node.type) &&
        selectors.some((selector) => nodeMatches(node, selector))
      )
      .map(({ key }) => key)
  );
  if (!collapsed.size) return { objects, edges, collapsed: [] };

  let result = [...edges];
  for (const key of collapsed) {
    const node = objects.find((candidate) => candidate.key === key);
    const incoming = result.filter(({ to }) => to === key);
    const outgoing = result.filter(({ from }) => from === key);
    const bypasses = [];
    for (const before of incoming) {
      for (const after of outgoing) {
        if (!after.to || before.from === after.to) continue;
        bypasses.push({
          ...after,
          id: `workflow-collapse-${key}-${bypasses.length}`,
          from: before.from,
          label: `via ${node.name}: ${after.label ?? after.kind}`,
          confidence: "inferred",
          sequence: "inferred",
          collapsed: [node.key]
        });
      }
    }
    result = result
      .filter(({ from, to }) => from !== key && to !== key)
      .concat(bypasses);
  }
  return {
    objects: objects.filter(({ key }) => !collapsed.has(key)),
    edges: result,
    collapsed: [...collapsed]
  };
}

function selectProjection(objects, edges, seeds, options) {
  const depthLimit = positiveInteger(options.depth, "workflow depth", 8);
  const nodeLimit = positiveInteger(options.maxNodes, "workflow maxNodes", 100);
  const edgeLimit = positiveInteger(options.maxEdges, "workflow maxEdges", 250);
  const stop = asArray(options.stop ?? options.stopConditions);
  const objectIndex = new Map(objects.map((object) => [object.key, object]));
  const outgoing = new Map();
  for (const edge of edges) {
    const list = outgoing.get(edge.from) ?? [];
    list.push(edge);
    outgoing.set(edge.from, list);
  }
  for (const list of outgoing.values()) {
    list.sort((a, b) => (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER));
  }

  const selected = new Set();
  const selectedEdges = [];
  const queue = seeds.map((key) => ({ key, depth: 0 }));
  let truncatedByNodes = false;
  let truncatedByEdges = false;
  while (queue.length) {
    const { key, depth } = queue.shift();
    if (selected.has(key)) continue;
    if (selected.size >= nodeLimit) {
      truncatedByNodes = true;
      break;
    }
    selected.add(key);
    const node = objectIndex.get(key);
    if (
      depth >= depthLimit ||
      (node && stop.some((condition) =>
        stopSelectors(condition)
          .some((selector) => nodeMatches(node, selector))
      ))
    ) continue;
    for (const edge of outgoing.get(key) ?? []) {
      if (selectedEdges.length >= edgeLimit) {
        truncatedByEdges = true;
        break;
      }
      selectedEdges.push(edge);
      if (edge.to && !selected.has(edge.to)) queue.push({ key: edge.to, depth: depth + 1 });
    }
    if (truncatedByEdges) break;
  }
  return {
    objects: objects.filter(({ key }) => selected.has(key)),
    edges: selectedEdges
      .filter(({ from }) => selected.has(from))
      .map((edge) => {
        if (!edge.to || selected.has(edge.to)) return edge;
        const target = objectIndex.get(edge.to);
        return {
          ...edge,
          to: undefined,
          unresolved: {
            name: target?.ownerName
              ? `${target.ownerName}.${target.name}`
              : target?.name ?? "truncated branch",
            type: "workflow limit"
          }
        };
      }),
    limits: {
      depth: depthLimit,
      maxNodes: nodeLimit,
      maxEdges: edgeLimit,
      truncatedByNodes,
      truncatedByEdges
    }
  };
}

export function markCycles(objects, edges) {
  const keys = new Set(objects.map(({ key }) => key));
  const adjacency = new Map([...keys].map((key) => [key, []]));
  for (const edge of edges) {
    if (edge.to && keys.has(edge.from) && keys.has(edge.to)) {
      adjacency.get(edge.from).push(edge.to);
    }
  }
  let currentIndex = 0;
  const indexes = new Map();
  const lowLinks = new Map();
  const stack = [];
  const onStack = new Set();
  const components = [];

  function visit(key) {
    indexes.set(key, currentIndex);
    lowLinks.set(key, currentIndex++);
    stack.push(key);
    onStack.add(key);
    for (const target of adjacency.get(key)) {
      if (!indexes.has(target)) {
        visit(target);
        lowLinks.set(key, Math.min(lowLinks.get(key), lowLinks.get(target)));
      } else if (onStack.has(target)) {
        lowLinks.set(key, Math.min(lowLinks.get(key), indexes.get(target)));
      }
    }
    if (lowLinks.get(key) !== indexes.get(key)) return;
    const component = [];
    let member;
    do {
      member = stack.pop();
      onStack.delete(member);
      component.push(member);
    } while (member !== key);
    if (
      component.length > 1 ||
      edges.some(({ from, to }) => from === key && to === key)
    ) components.push(component);
  }

  for (const key of keys) if (!indexes.has(key)) visit(key);
  const cycleByKey = new Map();
  components.forEach((component, index) => {
    for (const key of component) cycleByKey.set(key, index + 1);
  });
  return {
    objects: objects.map((object) =>
      cycleByKey.has(object.key)
        ? { ...object, cycle: cycleByKey.get(object.key) }
        : object
    ),
    edges: edges.map((edge) =>
      edge.to &&
      cycleByKey.get(edge.from) === cycleByKey.get(edge.to) &&
      cycleByKey.has(edge.from)
        ? { ...edge, isCycle: true }
        : edge
    ),
    cycles: components
  };
}

export function workflowView(model, options = {}) {
  const edgeTypes = normalizeEdgeTypes(options.edgeTypes);
  const nodes = [];
  const procedureRecords = [];
  const actionRecords = [];

  for (const owner of model.objects) {
    for (const [index, procedure] of (owner.procedures ?? []).entries()) {
      const node = makeNode(owner, procedure, procedureKey(owner, procedure, index));
      nodes.push(node);
      procedureRecords.push({ owner, procedure, node });
    }
    for (const [index, action] of (owner.actions ?? []).entries()) {
      const node = makeNode(owner, action, actionKey(owner, action, index), "action");
      nodes.push(node);
      actionRecords.push({ owner, action, node });
    }
  }
  const callResolver = createCallResolver(model, procedureRecords);

  const edges = [];
  for (const { owner, procedure, node } of procedureRecords) {
    addCallEdges({
      edges,
      from: node.key,
      calls: procedure.calls,
      owner,
      callResolver,
      edgeTypes
    });
  }
  for (const { owner, action, node } of actionRecords) {
    const trigger = procedureRecords.find(
      (record) =>
        record.owner.key === owner.key &&
        record.procedure.kind === "trigger" &&
        normalizeIdentifier(record.procedure.action) === normalizeIdentifier(action.name)
    );
    if (trigger) {
      edges.push({
        id: `workflow${edges.length}`,
        from: node.key,
        to: trigger.node.key,
        kind: "starts",
        label: "starts",
        confidence: "resolved",
        sequence: "definite",
        order: 0
      });
    } else {
      addCallEdges({
        edges,
        from: node.key,
        calls: action.calls,
        owner,
        callResolver,
        edgeTypes
      });
    }
  }

  if (edgeTypes.has("events")) {
    for (const { owner, procedure, node } of procedureRecords) {
      for (const attribute of procedure.attributes ?? []) {
        const match = attribute.match(
          /EventSubscriber\s*\(\s*ObjectType::(\w+)\s*,\s*(?:\w+::)?(?:"([^"]+)"|([^,\s]+))\s*,\s*'([^']+)'/iu
        );
        if (!match) continue;
        const publisherOwner = callResolver.object(match[1].toLowerCase(), match[2] ?? match[3]);
        const publisherCandidates = callResolver.candidates(publisherOwner, match[4]);
        const publisher = publisherCandidates.length === 1 ? publisherCandidates[0] : undefined;
        edges.push({
          id: `workflow${edges.length}`,
          from: publisher?.key ?? node.key,
          to: publisher ? node.key : undefined,
          unresolved: publisher ? undefined : {
            name: `${match[2] ?? match[3]}.${match[4]}`,
            type: "event publisher"
          },
          kind: "events",
          label: publisher ? "dispatches event" : "subscribes to unresolved event",
          confidence: publisher ? "inferred" : "syntactic",
          sequence: "inferred",
          location: procedure.location
        });
      }
    }
  }

  const dataKeys = new Set(
    edges
      .filter(({ kind, to }) => ["writes", "reads"].includes(kind) && to)
      .map(({ to }) => to)
  );
  for (const object of model.objects) {
    if (dataKeys.has(object.key)) {
      nodes.push({ ...object, ownerName: object.name, viewGroup: "Data mutations" });
    }
  }

  const entrySelectors = asArray(options.entries ?? options.entry);
  let seeds = entrySelectors.length
    ? nodes
      .filter((node) => entrySelectors.some((selector) => nodeMatches(node, selector)))
      .map(({ key }) => key)
    : [];
  if (entrySelectors.length && !seeds.length) {
    throw new Error(`Workflow entry did not match: ${entrySelectors.join(", ")}`);
  }
  if (!seeds.length) {
    const inbound = new Set(edges.map(({ to }) => to).filter(Boolean));
    seeds = nodes
      .filter((node) =>
        node.type === "action" ||
        node.type === "trigger" ||
        node.type === "event" ||
        (node.type === "procedure" && !inbound.has(node.key))
      )
      .map(({ key }) => key);
  }
  const entryKeys = new Set(seeds);
  const collapsed = collapsedGraph(
    nodes,
    edges,
    asArray(options.collapse ?? options.collapseUtilities),
    entryKeys
  );
  const projection = selectProjection(
    collapsed.objects,
    collapsed.edges,
    seeds.filter((key) => collapsed.objects.some((node) => node.key === key)),
    options
  );
  const cycled = markCycles(projection.objects, projection.edges);
  const inboundCount = new Map();
  for (const edge of cycled.edges) {
    if (edge.to) inboundCount.set(edge.to, (inboundCount.get(edge.to) ?? 0) + 1);
  }
  const objects = applyPhases(
    cycled.objects.map((object) => ({
      ...object,
      isFocus: entryKeys.has(object.key),
      workflowEntry: entryKeys.has(object.key),
      shared: (inboundCount.get(object.key) ?? 0) > 1
        ? inboundCount.get(object.key)
        : undefined
    })),
    options.phases
  );

  return {
    ...model,
    titleSuffix: entrySelectors.length ? entrySelectors.join(", ") : "inferred entry points",
    emptyMessage: "No workflow entry points found",
    objects,
    edges: cycled.edges,
    workflow: {
      entries: seeds,
      edgeTypes: [...edgeTypes],
      collapsed: collapsed.collapsed,
      cycles: cycled.cycles,
      ...projection.limits
    }
  };
}
