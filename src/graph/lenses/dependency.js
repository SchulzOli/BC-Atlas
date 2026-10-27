import { normalizeIdentifier } from "../../resolver.js";
import { createView, subscriberAttribute } from "../../views.js";

// Relation kinds that make one AL object depend on another. Every kind keeps
// its own weight on the aggregated edge so the viewer can filter by kind.
export const DEPENDENCY_KINDS = Object.freeze([
  "extends",
  "implements",
  "calls",
  "uses",
  "reads",
  "writes",
  "relates",
  "selects",
  "runs",
  "part",
  "subscribes",
  "permits",
  "includes"
]);

const MAX_EVIDENCE = 12;
const toPosix = (file) => file.replaceAll("\\", "/");
const NO_APP = "(no app.json)";
const UNRESOLVED_APP = "(unresolved)";

export function appKey(app) {
  if (!app) return normalizeIdentifier(NO_APP);
  return normalizeIdentifier(app.id ?? app.name);
}

function declaredDependencyKeys(app) {
  return new Set((app?.dependencies ?? []).flatMap((dependency) =>
    [dependency.id, dependency.appId, dependency.name]
      .filter(Boolean)
      .map(normalizeIdentifier)
  ));
}

function isMicrosoft(app) {
  return /microsoft/iu.test(app?.publisher ?? "");
}

function objectNode(object, inSelection) {
  return {
    id: object.key,
    label: object.name,
    type: object.type,
    objectId: object.id,
    app: appKey(object.app),
    namespace: object.namespace,
    file: object.externalSymbol ? undefined : toPosix(object.file),
    line: object.externalSymbol ? undefined : object.location?.line,
    origin: object.externalSymbol ? "symbol" : "workspace",
    ...(inSelection ? {} : { outsideSelection: true })
  };
}

function unresolvedNode(unresolved) {
  const type = String(unresolved.type ?? "object").toLowerCase();
  return {
    id: `unresolved::${type}::${normalizeIdentifier(unresolved.name)}`,
    label: unresolved.name,
    type,
    app: normalizeIdentifier(UNRESOLVED_APP),
    namespace: "(unknown)",
    origin: "unresolved"
  };
}

/**
 * Classifies one dependency from the source app's point of view.
 * intra-app stays inside one app; every other value crosses an app boundary.
 */
function dependencyClass(sourceApp, targetApp, target) {
  if (!target) return "unresolved";
  if (appKey(sourceApp) === appKey(targetApp)) return "intra-app";
  const declared = declaredDependencyKeys(sourceApp);
  if ([targetApp?.id, targetApp?.name].filter(Boolean).map(normalizeIdentifier).some((key) => declared.has(key))) {
    return "declared";
  }
  // app.json "application" and "platform" pull in Microsoft apps implicitly.
  if (isMicrosoft(targetApp)) return "implicit";
  return "undeclared";
}

function subscriptionEdges(model, objectIndex) {
  const edges = [];
  for (const owner of model.objects) {
    for (const procedure of owner.procedures ?? []) {
      for (const attribute of procedure.attributes ?? []) {
        const subscriber = subscriberAttribute(attribute);
        if (!subscriber) continue;
        const target = objectIndex(subscriber.type, subscriber.target);
        edges.push({
          from: owner.key,
          to: target?.key,
          unresolved: target ? undefined : { name: subscriber.target, type: subscriber.type },
          kind: "subscribes",
          sourceProcedure: procedure.name,
          member: subscriber.event,
          location: procedure.location
        });
      }
    }
  }
  return edges;
}

/** Resolved procedure calls, aggregated to the owning objects. */
function callEdges(model) {
  return createView(model, "call", {})
    .edges.filter(({ kind, to, confidence }) =>
      kind === "calls" && to && to !== "call-framework" && confidence === "resolved"
    );
}

function createObjectIndex(objects) {
  const index = new Map();
  for (const object of objects) {
    const names = [object.name, `${object.namespace}.${object.name}`, object.id].filter(Boolean);
    for (const name of names) {
      const key = `${object.type}:${normalizeIdentifier(name)}`;
      if (!index.has(key) || !object.externalSymbol) index.set(key, object);
    }
  }
  return (type, name) => index.get(`${type}:${normalizeIdentifier(name)}`);
}

function evidenceFor(edge) {
  const evidence = {
    kind: edge.kind,
    operation: edge.operation,
    member: edge.sourceProcedure ?? edge.member ?? edge.sourceProcedures?.[0],
    property: edge.property,
    file: edge.location?.file && toPosix(edge.location.file),
    line: edge.location?.line
  };
  return Object.fromEntries(Object.entries(evidence).filter(([, value]) => value !== undefined));
}

function appNode(app, origin, objectCount = 0) {
  return {
    id: appKey(app),
    label: app?.name ?? NO_APP,
    type: "app",
    appId: app?.id,
    publisher: app?.publisher,
    version: app?.version,
    origin,
    objectCount
  };
}

/**
 * Builds the dependency lens from a resolved architecture model: an object
 * level (one node per AL object, one edge per depending pair) and an app level
 * (declared app.json dependencies merged with the observed object references).
 */
export function dependencyLens(model, { filter = () => true } = {}) {
  const byKey = new Map(model.objects.map((object) => [object.key, object]));
  const selected = new Set(model.objects.filter((object) => !object.externalSymbol && filter(object)).map(({ key }) => key));
  const objectIndex = createObjectIndex(model.objects);
  const nodes = new Map();
  const edges = new Map();

  for (const key of selected) nodes.set(key, objectNode(byKey.get(key), true));

  const relations = [
    ...model.edges.filter(({ kind }) => DEPENDENCY_KINDS.includes(kind)),
    ...subscriptionEdges(model, objectIndex),
    ...callEdges(model)
  ];
  for (const relation of relations) {
    if (!selected.has(relation.from) || relation.from === relation.to) continue;
    const source = byKey.get(relation.from);
    const target = relation.to ? byKey.get(relation.to) : undefined;
    if (relation.to && !target) continue;
    const targetNode = target
      ? nodes.get(target.key) ?? objectNode(target, false)
      : unresolvedNode(relation.unresolved ?? { name: "unknown", type: "object" });
    nodes.set(targetNode.id, targetNode);

    const id = `${source.key}->${targetNode.id}`;
    const edge = edges.get(id) ?? {
      id,
      source: source.key,
      target: targetNode.id,
      sourceApp: appKey(source.app),
      targetApp: targetNode.app,
      dependency: dependencyClass(source.app, target?.app, target),
      kinds: {},
      weight: 0,
      evidence: []
    };
    edge.kinds[relation.kind] = (edge.kinds[relation.kind] ?? 0) + (relation.weight ?? 1);
    edge.weight += relation.weight ?? 1;
    if (edge.evidence.length < MAX_EVIDENCE) edge.evidence.push(evidenceFor(relation));
    edges.set(id, edge);
  }
  for (const edge of edges.values()) {
    edge.scope = edge.dependency === "intra-app" ? "intra-app" : "inter-app";
  }

  return {
    object: { nodes: [...nodes.values()], edges: [...edges.values()] },
    app: appLevel(model, nodes, edges)
  };
}

function appLevel(model, objectNodes, objectEdges) {
  const apps = new Map();
  const counts = new Map();
  for (const node of objectNodes.values()) counts.set(node.app, (counts.get(node.app) ?? 0) + 1);

  const knownApps = new Map();
  for (const app of model.apps ?? []) knownApps.set(appKey(app), app);
  for (const object of model.objects) if (object.app) knownApps.set(appKey(object.app), object.app);

  for (const node of objectNodes.values()) {
    if (apps.has(node.app)) continue;
    if (node.origin === "unresolved") {
      apps.set(node.app, { ...appNode({ name: UNRESOLVED_APP }, "unresolved"), id: node.app });
      continue;
    }
    const app = knownApps.get(node.app);
    apps.set(node.app, appNode(app, app?.external ? "symbol" : "workspace"));
  }
  for (const node of apps.values()) node.objectCount = counts.get(node.id) ?? 0;

  const edges = new Map();
  const edgeFor = (source, target) => {
    const id = `${source}->${target}`;
    if (!edges.has(id)) {
      edges.set(id, { id, source, target, declared: false, kinds: {}, weight: 0, objectEdges: 0 });
    }
    return edges.get(id);
  };

  // Declared dependencies of the workspace apps (app.json).
  for (const [key, app] of knownApps) {
    if (app.external || !apps.has(key)) continue;
    for (const dependency of app.dependencies ?? []) {
      const identity = normalizeIdentifier(dependency.id ?? dependency.appId ?? dependency.name);
      const target = [...knownApps.entries()].find(([candidateKey, candidate]) =>
        candidateKey === identity || normalizeIdentifier(candidate.name) === normalizeIdentifier(dependency.name)
      );
      const targetKey = target?.[0] ?? identity;
      if (!apps.has(targetKey)) {
        apps.set(targetKey, appNode(
          target?.[1] ?? { id: dependency.id ?? dependency.appId, name: dependency.name, publisher: dependency.publisher, version: dependency.version },
          target?.[1]?.external ? "symbol" : "declared-only"
        ));
      }
      edgeFor(key, targetKey).declared = true;
    }
  }

  // Observed dependencies: every object edge that crosses an app boundary.
  for (const edge of objectEdges.values()) {
    if (edge.scope !== "inter-app") continue;
    const appEdge = edgeFor(edge.sourceApp, edge.targetApp);
    appEdge.objectEdges++;
    appEdge.weight += edge.weight;
    for (const [kind, weight] of Object.entries(edge.kinds)) {
      appEdge.kinds[kind] = (appEdge.kinds[kind] ?? 0) + weight;
    }
    appEdge.classes = [...new Set([...(appEdge.classes ?? []), edge.dependency])];
  }
  for (const edge of edges.values()) {
    const classes = edge.classes ?? [];
    delete edge.classes;
    edge.scope = "inter-app";
    edge.dependency = edge.declared
      ? edge.objectEdges ? "declared" : "declared-unused"
      : classes.includes("undeclared") ? "undeclared"
        : classes.includes("unresolved") ? "unresolved"
          : "implicit";
  }
  return { nodes: [...apps.values()], edges: [...edges.values()] };
}
