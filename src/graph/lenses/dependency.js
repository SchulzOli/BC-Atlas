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

// Evidence kept per edge; edges inside one module keep less to bound the size
// of large graphs (a Base Application has ~70,000 of them).
const MAX_EVIDENCE = 12;
const MAX_LOCAL_EVIDENCE = 3;
const toPosix = (file) => file.replaceAll("\\", "/");
const NO_APP = "(no app.json)";
const UNRESOLVED_APP = "(unresolved)";
const PLATFORM_APP = "(platform)";

// System tables and objects that the Business Central platform provides; they
// never appear in AL source or in .alpackages of the Base Application.
const PLATFORM_OBJECTS = new Set([
  "Access Control", "Active Session", "Aggregate Permission Set", "All Profile", "AllObj",
  "AllObjWithCaption", "Application Object Metadata", "Codeunit Metadata", "Company", "Database Locks",
  "Date", "Event Subscription", "Expanded Permission", "Field", "Integer", "Key", "Media",
  "Media Resources", "Media Set", "NAV App Installed App", "Object", "Object Metadata", "Object Options",
  "Page Metadata", "Permission", "Permission Set", "Profile", "Published Application",
  "Report Metadata", "Scheduled Task", "Server Instance", "Session", "Session Event",
  "Table Information", "Table Metadata", "Tenant Media", "Tenant Media Set", "Tenant Media Thumbnails",
  "Tenant Permission", "Tenant Permission Set", "Tenant Profile", "User", "User Metadata",
  "User Personalization", "User Property", "Windows Language"
].map((name) => name.toLowerCase()));

function isPlatform(unresolved) {
  return String(unresolved.type).toLowerCase() === "system" ||
    PLATFORM_OBJECTS.has(normalizeIdentifier(unresolved.name));
}

export function appKey(app) {
  if (!app) return normalizeIdentifier(NO_APP);
  return normalizeIdentifier(app.id ?? app.name);
}

/** Root module of an app, or the nested module (app.json below the app) an object belongs to. */
export function moduleKey(object) {
  return object.module
    ? `module::${normalizeIdentifier(object.module.id ?? object.module.name)}`
    : appKey(object.app);
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
    module: moduleKey(object),
    namespace: object.namespace,
    file: object.externalSymbol ? undefined : toPosix(object.file),
    line: object.externalSymbol ? undefined : object.location?.line,
    origin: object.externalSymbol ? "symbol" : "workspace",
    ...(inSelection ? {} : { outsideSelection: true })
  };
}

function unresolvedNode(unresolved) {
  const type = String(unresolved.type ?? "object").toLowerCase();
  const platform = isPlatform(unresolved);
  const app = normalizeIdentifier(platform ? PLATFORM_APP : UNRESOLVED_APP);
  return {
    id: `${platform ? "platform" : "unresolved"}::${type}::${normalizeIdentifier(unresolved.name)}`,
    label: unresolved.name,
    type,
    app,
    module: app,
    namespace: platform ? "(platform)" : "(unknown)",
    origin: platform ? "platform" : "unresolved"
  };
}

/**
 * Classifies one dependency from the source app's point of view. intra-app
 * and cross-module stay inside one app; every other value crosses an app
 * boundary.
 */
function dependencyClass(source, target, targetNode) {
  if (!target) return targetNode.origin === "platform" ? "implicit" : "unresolved";
  if (appKey(source.app) === appKey(target.app)) {
    return moduleKey(source) === moduleKey(target) ? "intra-app" : "cross-module";
  }
  const declared = declaredDependencyKeys(source.app);
  if ([target.app?.id, target.app?.name].filter(Boolean).map(normalizeIdentifier).some((key) => declared.has(key))) {
    return "declared";
  }
  // app.json "application" and "platform" pull in Microsoft apps implicitly;
  // a Microsoft app that is part of the workspace still has to be declared.
  if (target.externalSymbol && isMicrosoft(target.app)) return "implicit";
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
      sourceModule: moduleKey(source),
      targetModule: targetNode.module,
      dependency: dependencyClass(source, target, targetNode),
      kinds: {},
      weight: 0,
      evidence: []
    };
    edge.kinds[relation.kind] = (edge.kinds[relation.kind] ?? 0) + (relation.weight ?? 1);
    edge.weight += relation.weight ?? 1;
    const limit = edge.dependency === "intra-app" ? MAX_LOCAL_EVIDENCE : MAX_EVIDENCE;
    if (edge.evidence.length < limit) edge.evidence.push(evidenceFor(relation));
    edges.set(id, edge);
  }
  for (const edge of edges.values()) {
    edge.scope = ["intra-app", "cross-module"].includes(edge.dependency) ? "intra-app" : "inter-app";
  }

  return {
    object: { nodes: [...nodes.values()], edges: [...edges.values()] },
    ...(model.modules?.length ? { module: moduleLevel(model, nodes, edges) } : {}),
    app: appLevel(model, nodes, edges)
  };
}

function knownAppsOf(model) {
  const knownApps = new Map();
  for (const app of model.apps ?? []) knownApps.set(appKey(app), app);
  for (const object of model.objects) if (object.app) knownApps.set(appKey(object.app), object.app);
  return knownApps;
}

/**
 * Module level: one node per nested module plus one root module per app. Module
 * manifests declare which modules and apps a module may use; observed object
 * references between modules are checked against them.
 */
function moduleLevel(model, objectNodes, objectEdges) {
  const knownApps = knownAppsOf(model);
  const manifests = new Map((model.modules ?? []).map((module) => [moduleKey({ module }), module]));
  const modules = new Map();
  for (const node of objectNodes.values()) {
    if (!modules.has(node.module)) {
      const manifest = manifests.get(node.module);
      const app = knownApps.get(node.app);
      modules.set(node.module, {
        id: node.module,
        label: manifest?.name ?? app?.name ??
          ({ unresolved: UNRESOLVED_APP, platform: PLATFORM_APP }[node.origin] ?? NO_APP),
        type: "module",
        app: node.app,
        appId: (manifest ?? app)?.id,
        path: manifest?.path?.replaceAll("\\", "/"),
        origin: manifest ? "module" : node.origin === "workspace" ? "workspace" : node.origin,
        objectCount: 0
      });
    }
    modules.get(node.module).objectCount++;
  }

  const edges = new Map();
  const edgeFor = (source, target) => {
    const id = `${source}->${target}`;
    if (!edges.has(id)) {
      edges.set(id, { id, source, target, declared: false, kinds: {}, weight: 0, objectEdges: 0, classes: [] });
    }
    return edges.get(id);
  };
  const moduleOrApp = (dependency) => {
    const identity = normalizeIdentifier(dependency.id ?? dependency.appId ?? dependency.name);
    if (modules.has(`module::${identity}`)) return `module::${identity}`;
    return modules.has(identity) ? identity : undefined;
  };
  for (const [key, manifest] of manifests) {
    if (!modules.has(key)) continue;
    for (const dependency of manifest.dependencies ?? []) {
      const target = moduleOrApp(dependency);
      if (target && target !== key) edgeFor(key, target).declared = true;
    }
  }
  for (const edge of objectEdges.values()) {
    if (edge.sourceModule === edge.targetModule) continue;
    const moduleEdge = edgeFor(edge.sourceModule, edge.targetModule);
    moduleEdge.objectEdges++;
    moduleEdge.weight += edge.weight;
    for (const [kind, weight] of Object.entries(edge.kinds)) {
      moduleEdge.kinds[kind] = (moduleEdge.kinds[kind] ?? 0) + weight;
    }
    if (!moduleEdge.classes.includes(edge.dependency)) moduleEdge.classes.push(edge.dependency);
  }
  for (const edge of edges.values()) {
    const { classes } = edge;
    delete edge.classes;
    const sameApp = modules.get(edge.source)?.app === modules.get(edge.target)?.app;
    edge.scope = sameApp ? "intra-app" : "inter-app";
    edge.dependency = edge.declared
      ? edge.objectEdges ? "declared" : "declared-unused"
      : ["undeclared", "unresolved", "implicit"].find((value) => classes.includes(value)) ??
        (!sameApp ? "declared" : manifests.has(edge.source) ? "undeclared" : "cross-module");
  }
  return { nodes: [...modules.values()], edges: [...edges.values()] };
}

function appLevel(model, objectNodes, objectEdges) {
  const apps = new Map();
  const counts = new Map();
  for (const node of objectNodes.values()) counts.set(node.app, (counts.get(node.app) ?? 0) + 1);

  const knownApps = knownAppsOf(model);

  for (const node of objectNodes.values()) {
    if (apps.has(node.app)) continue;
    if (["unresolved", "platform"].includes(node.origin)) {
      const name = node.origin === "platform" ? PLATFORM_APP : UNRESOLVED_APP;
      apps.set(node.app, { ...appNode({ name, publisher: node.origin === "platform" ? "Microsoft" : undefined }, node.origin), id: node.app });
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
