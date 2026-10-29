// Proposes a target architecture from the dependency graph as it is today:
// group objects into candidate components, order the components so that as
// little coupling as possible points the wrong way (a weighted feedback arc
// set, Eades-Lin-Smyth heuristic), and derive layers from the result. The
// dependencies that still point the wrong way are what has to be resolved
// before the components can become apps of their own.
//
// By default the relations decide what a component is (cluster.js): typed
// and weighted relations between the objects of each app or module, with
// shared objects pulled into a core. Namespaces, folders, and object IDs only
// name the components and describe them as selectors, so code without
// namespaces, or with a mix, gets components just the same. The same
// relations at a coarser resolution say which components could become an
// app together, and from that follows a namespace for each component.
import { coupling, COUPLING_WEIGHTS } from "../graph/coupling.js";
import { clusterByRelations, deriveSelectors, dominantPrefix, functionalFolder, mostCommon, shapes } from "./cluster.js";

const GROUPINGS = ["auto", "coupling", "namespace", "folder", "module", "app"];

// With --group-by namespace or folder, a group splits until it holds no more than this share of objects.
const MAX_SHARE = 0.15;
const MIN_SPLIT_OBJECTS = 40;

/**
 * Namespace groups: start one segment below the common prefix, then split any
 * group that is still too large one segment deeper. Objects directly in a
 * split namespace stay in a group of their own.
 */
function namespaceGroups(nodes, depth) {
  const segments = (node) => !node.namespace || node.namespace === "(global)" ? [] : node.namespace.split(".");
  const key = (parts) => parts.join(".").toLowerCase();
  const casing = new Map();
  for (const node of nodes) {
    const parts = segments(node);
    for (let length = 1; length <= parts.length; length++) {
      const prefix = key(parts.slice(0, length));
      if (!casing.has(prefix)) casing.set(prefix, new Map());
      const name = parts.slice(0, length).join(".");
      casing.get(prefix).set(name, (casing.get(prefix).get(name) ?? 0) + 1);
    }
  }
  const display = (prefix) => [...(casing.get(prefix) ?? new Map([[prefix, 1]]))].sort((a, b) => b[1] - a[1])[0][0];

  let length = depth;
  if (length === undefined) {
    const all = nodes.map(segments).filter((parts) => parts.length);
    let common = 0;
    while (all.length && all.every((parts) => parts.length > common && parts[common].toLowerCase() === all[0][common].toLowerCase())) common++;
    length = common + 1;
  }
  const assignment = new Map(nodes.map((node) => [node.id, Math.min(length, segments(node).length)]));
  const limit = Math.max(MIN_SPLIT_OBJECTS, Math.ceil(nodes.length * MAX_SHARE));
  for (let round = 0; round < 8 && depth === undefined; round++) {
    const sizes = new Map();
    for (const node of nodes) {
      const prefix = key(segments(node).slice(0, assignment.get(node.id)));
      sizes.set(prefix, (sizes.get(prefix) ?? 0) + 1);
    }
    let split = false;
    for (const node of nodes) {
      const used = assignment.get(node.id);
      const prefix = key(segments(node).slice(0, used));
      if (sizes.get(prefix) > limit && segments(node).length > used) {
        assignment.set(node.id, used + 1);
        split = true;
      }
    }
    if (!split) break;
  }
  return (node) => {
    const prefix = key(segments(node).slice(0, assignment.get(node.id)));
    if (!prefix) return { key: "namespace:(global)", label: "(global)", selector: "*" };
    const name = display(prefix);
    return { key: `namespace:${prefix}`, label: name.split(".").at(-1), fullName: name, selector: `namespace:${name}` };
  };
}

function grouping(nodes, levels, { groupBy, depth, weights }) {
  const modules = new Map((levels.module?.nodes ?? []).map((node) => [node.id, node]));
  const apps = new Map((levels.app?.nodes ?? []).map((node) => [node.id, node]));
  const byApp = (node) => {
    const label = apps.get(node.app)?.label ?? "(no app)";
    return { key: `app:${label}`, label, selector: `app:${label}` };
  };
  const byModule = (node) => {
    const label = modules.get(node.module)?.label ?? apps.get(node.app)?.label ?? "(no app)";
    return { key: `module:${label}`, label, selector: `module:${label}` };
  };
  // Apps and modules are boundaries that exist already; components form inside them.
  const coarse = modules.size ? byModule : byApp;
  const selected = nodes.filter(({ outsideSelection }) => !outsideSelection);
  const members = new Map();
  for (const node of selected) {
    const key = coarse(node).key;
    if (!members.has(key)) members.set(key, []);
    members.get(key).push(node);
  }
  const clustered = new Map();
  const cluster = (list) => {
    for (const [id, group] of clusterByRelations(list, levels, weights, { prefix: `${coarse(list[0]).key}|` })) clustered.set(id, group);
  };

  let inner;
  if (groupBy === "module") {
    if (!modules.size) throw new Error("--group-by module needs nested app.json modules; use namespace or folder");
    inner = byModule;
  } else if (groupBy === "app") {
    inner = byApp;
  } else if (groupBy === "auto" || groupBy === "coupling") {
    // The relations decide whether an app or module holds more than one component.
    for (const list of members.values()) {
      if (list.length >= 6) cluster(list);
    }
    inner = (node) => clustered.get(node.id) ? { ...clustered.get(node.id), outer: coarse(node), derived: true } : coarse(node);
  } else {
    // namespace or folder: the structure decides where there is one; objects without it follow their relations.
    const structured = groupBy === "namespace"
      ? (node) => node.namespace && node.namespace !== "(global)"
      : (node) => Boolean(functionalFolder(node.file));
    const byStructure = groupBy === "namespace" ? namespaceGroups(selected.filter(structured), depth) : folderGroups(selected.filter(structured), depth);
    for (const list of members.values()) {
      const loose = list.filter((node) => !structured(node));
      if (loose.length) cluster(loose);
    }
    inner = (node) => {
      if (clustered.has(node.id)) return { ...clustered.get(node.id), outer: coarse(node), derived: true };
      const group = byStructure(node);
      const outer = coarse(node);
      return { ...group, key: `${outer.key}|${group.key}`, outer, derived: true };
    };
  }
  // Objects outside the analyzed path (context such as the System
  // Application) keep their app as one fixed component.
  const groupOf = (node) => node.outsideSelection ? { ...byApp(node), fixed: true } : inner(node);
  groupOf.coarse = coarse;
  return groupOf;
}

/** Folder groups by the folders that say what objects do (not by type folders), split like namespaces. */
function folderGroups(nodes, depth) {
  const segments = (node) => (functionalFolder(node.file) ?? "").split("/").filter(Boolean);
  const length = depth ?? 1;
  const assignment = new Map(nodes.map((node) => [node.id, Math.min(length, segments(node).length)]));
  const limit = Math.max(MIN_SPLIT_OBJECTS, Math.ceil(nodes.length * MAX_SHARE));
  for (let round = 0; round < 8 && depth === undefined; round++) {
    const sizes = new Map();
    for (const node of nodes) {
      const prefix = segments(node).slice(0, assignment.get(node.id)).join("/");
      sizes.set(prefix, (sizes.get(prefix) ?? 0) + 1);
    }
    let split = false;
    for (const node of nodes) {
      const used = assignment.get(node.id);
      if (sizes.get(segments(node).slice(0, used).join("/")) > limit && segments(node).length > used) {
        assignment.set(node.id, used + 1);
        split = true;
      }
    }
    if (!split) break;
  }
  return (node) => {
    const folder = segments(node).slice(0, assignment.get(node.id)).join("/");
    return { key: `folder:${folder}`, label: folder.split("/").at(-1), fullName: folder };
  };
}

/** Orders groups so that most dependency weight points to later groups. */
function eadesLinSmyth(keys, edges) {
  const out = new Map(keys.map((key) => [key, new Map()]));
  const into = new Map(keys.map((key) => [key, new Map()]));
  for (const { source, target, weight } of edges) {
    out.get(source).set(target, weight);
    into.get(target).set(source, weight);
  }
  const remaining = new Set(keys);
  const sum = (map) => [...map].reduce((total, [key, weight]) => total + (remaining.has(key) ? weight : 0), 0);
  const front = [];
  const back = [];
  while (remaining.size) {
    let changed = true;
    while (changed) {
      changed = false;
      for (const key of [...remaining]) {
        // Groups nothing depends on go first (dependents), groups that depend
        // on nothing go last (the core).
        if (!sum(into.get(key))) {
          front.push(key);
          remaining.delete(key);
          changed = true;
        } else if (!sum(out.get(key))) {
          back.unshift(key);
          remaining.delete(key);
          changed = true;
        }
      }
    }
    if (!remaining.size) break;
    let best;
    let bestScore = -Infinity;
    for (const key of [...remaining].sort()) {
      const score = sum(into.get(key)) ? sum(out.get(key)) - sum(into.get(key)) : Infinity;
      if (score > bestScore) {
        best = key;
        bestScore = score;
      }
    }
    front.push(best);
    remaining.delete(best);
  }
  return [...front, ...back];
}

// "Sales Post" -> "SalesPost"; namespace segments have no spaces.
const segment = (name) => String(name ?? "").split(/[^A-Za-z0-9]+/u).filter(Boolean).map((word) => word[0].toUpperCase() + word.slice(1)).join("");

/**
 * What each component could become: an app of its own, a component inside an
 * app candidate with others, or the shared core; and the namespace it would
 * get. A component whose objects (nearly) all share a namespace keeps it.
 * Otherwise the namespace follows its app candidate: the namespace most of
 * the candidate's objects share already, else the root (the first segment most
 * namespaced objects start with, else the publisher) and the candidate's name.
 */
function recommend(kept, nodes, componentOf, levels) {
  const publishers = new Map((levels.app?.nodes ?? []).map((node) => [node.id, node.publisher]));
  const namespaced = (list) => list.filter(({ namespace }) => namespace && namespace !== "(global)").map(({ namespace }) => namespace);
  const root = dominantPrefix(namespaced(nodes).map((namespace) => namespace.split(".")[0]), { total: namespaced(nodes).length })
    ?? (segment(mostCommon(nodes.map(({ app }) => publishers.get(app)))?.[0]) || undefined);
  // "Contoso Core" under the root Contoso is Contoso.Core.
  const qualify = (base, ...parts) => [base, ...parts.map((part) => root && part.startsWith(root) && part.length > root.length ? part.slice(root.length) : part)].filter(Boolean).join(".");

  const apps = new Map();
  for (const group of kept.filter(({ fixed }) => !fixed)) {
    const app = group.app ?? { key: group.key, label: group.name };
    if (!apps.has(app.key)) apps.set(app.key, { ...app, outer: group.outer, components: [] });
    apps.get(app.key).components.push(group);
  }
  // An app or module that stays one app candidate keeps its name.
  const perOuter = new Map();
  for (const app of apps.values()) {
    if (!app.outer || app.components.every(({ shared }) => shared)) continue;
    perOuter.set(app.outer.key, [...(perOuter.get(app.outer.key) ?? []), app]);
  }
  for (const [, list] of perOuter) {
    if (list.length !== 1 || list[0].components.length < 2) continue;
    list[0].label = list[0].outer.label;
    list[0].whole = true;
  }
  for (const app of apps.values()) app.components.sort((a, b) => b.objects - a.objects || a.name.localeCompare(b.name));
  const size = (app) => app.components.reduce((sum, { objects }) => sum + objects, 0);
  const candidates = [...apps.values()].sort((a, b) => size(b) - size(a));
  for (const app of candidates) if (app.components.length === 1) app.label = app.components[0].name;
  uniqueNames(candidates);

  const members = new Map();
  for (const node of nodes) {
    const key = componentOf(node.id);
    if (!members.has(key)) members.set(key, []);
    members.get(key).push(node);
  }
  // Names without what only tells them apart in the report: "Utils (Contoso Core)", "Utils 2".
  const plain = (name) => String(name).replace(/ \(.*\)$/u, "").replace(/ \d+$/u, "");
  const recommendations = [];
  const taken = new Set();
  for (const app of candidates) {
    const objects = app.components.flatMap(({ key }) => members.get(key) ?? []);
    const appName = plain(app.name);
    const existing = dominantPrefix(namespaced(objects), { total: objects.length, minDepth: app.whole ? 1 : 2 });
    const base = existing ?? (app.whole || app.components.length === 1 ? root : qualify(root, segment(appName)));
    const appWords = new Set(appName.toLowerCase().split(/[^a-z0-9]+/u));
    for (const group of app.components) {
      const role = group.shared ? "shared" : group.key.endsWith("unconnected") ? "review" : app.components.length > 1 ? "component" : "app";
      const own = members.get(group.key) ?? [];
      const [namespace, inNamespace] = mostCommon(namespaced(own)) ?? [];
      const keeps = Boolean(namespace) && inNamespace >= own.length * 0.8 && !taken.has(namespace);
      const names = [...new Set([plain(group.name), group.label, ...(group.alternatives ?? [])].filter((name) => name && !name.includes(".")))];
      let options;
      if (keeps) options = [namespace];
      else if (role === "app" || role === "shared") options = [existing, ...names.map((name) => qualify(root, segment(name)))].filter(Boolean);
      else {
        // Below the app candidate's namespace, the component's name without the app's words.
        const deeper = dominantPrefix(namespaced(own), { total: own.length, minDepth: 2 });
        const baseEnd = String(base ?? "").split(".").at(-1)?.toLowerCase();
        options = [
          ...(deeper && base && deeper.toLowerCase().startsWith(`${base.toLowerCase()}.`) ? [deeper] : []),
          // The component named like its app candidate gets the candidate's namespace itself.
          ...names.map((name) => segment(name.split(/[^A-Za-z0-9]+/u).filter((word) => word && (app.whole || !appWords.has(word.toLowerCase()))).join(" ")))
            .map((word) => !word || word.toLowerCase() === baseEnd ? base : qualify(base, word)),
          base
        ].filter(Boolean);
        if (!options.length) options = [qualify(root, segment(group.name))];
      }
      let suggested = options.find((option) => !taken.has(option));
      for (let index = 2; !suggested; index++) if (!taken.has(`${options[0]}${index}`)) suggested = `${options[0]}${index}`;
      taken.add(suggested);
      recommendations.push({
        component: group.name,
        role,
        app: role === "shared" || role === "review" ? undefined : app.name,
        ...(app.whole && role === "component" ? { existingApp: true } : {}),
        namespace: suggested,
        ...(keeps ? { keepsNamespace: true } : {})
      });
    }
  }
  return recommendations;
}

const ROLE_TEXT = {
  app: () => "Can become an app of its own",
  component: ({ app, existingApp }) => existingApp ? `Component of ${app}, which stays one app` : `Component of app candidate ${app}`,
  shared: () => "Shared core: objects that many components use; the base the others depend on",
  review: () => "Objects without relations to the rest; place them by hand"
};

// Larger groups get the plain names first. A name that a group of another app
// or module holds already gets that app or module; inside one, a more precise name.
function uniqueNames(groups) {
  const used = new Map();
  for (const group of [...groups].sort((a, b) => (b.objects ?? 0) - (a.objects ?? 0))) {
    const base = group.label || group.key;
    const qualified = group.outer && `${base} (${group.outer.label})`;
    const elsewhere = used.has(base) && group.outer && used.get(base) !== group.outer.key;
    const candidates = (elsewhere ? [qualified, base] : [base, ...(group.alternatives ?? []), qualified]).filter(Boolean);
    let name = candidates.find((candidate) => !used.has(candidate));
    for (let index = 2; !name; index++) if (!used.has(`${base} ${index}`)) name = `${base} ${index}`;
    used.set(name, group.outer?.key);
    group.name = name;
  }
}

/**
 * Proposes components, layers, and allowed dependencies for the workspace
 * objects of a dependency graph. Returns an `architecture` configuration that
 * evaluateArchitecture and .bca.json accept, plus the evidence behind it.
 */
export function proposeArchitecture(levels, { groupBy, depth, minObjects = 1, weights = COUPLING_WEIGHTS } = {}) {
  const nodes = levels.object.nodes.filter(({ origin }) => origin === "workspace");
  const mode = groupBy ?? "auto";
  if (!GROUPINGS.includes(mode)) throw new Error(`--group-by must be one of: ${GROUPINGS.join(", ")}`);
  const groupOf = grouping(nodes, levels, { groupBy: mode, depth: depth === undefined ? undefined : Number(depth), weights });

  const groups = new Map();
  const nodeGroup = new Map();
  for (const node of nodes) {
    const group = groupOf(node);
    if (!groups.has(group.key)) groups.set(group.key, { ...group, objects: 0, apps: new Set() });
    groups.get(group.key).objects++;
    groups.get(group.key).apps.add(node.app);
    nodeGroup.set(node.id, group.key);
  }
  // Components formed inside an app or module get selectors that reproduce
  // exactly their objects: namespaces, functional folders, ID ranges, or objects.
  const derived = nodes.filter((node) => groups.get(nodeGroup.get(node.id))?.derived);
  if (derived.length) {
    const targets = new Map([...groups].filter(([, group]) => group.derived));
    for (const group of targets.values()) group.selectors = [];
    deriveSelectors(derived, nodeGroup, targets, levels, (node) => groupOf.coarse(node));
  }
  // Tiny groups join the group they are most tightly coupled to.
  const counts = new Map();
  const objectEdges = new Map();
  for (const edge of levels.object.edges) {
    if (!shapes(edge)) continue;
    const source = nodeGroup.get(edge.source);
    const target = nodeGroup.get(edge.target);
    if (!source || !target || source === target) continue;
    const id = `${source}\u0000${target}`;
    counts.set(id, (counts.get(id) ?? 0) + coupling(edge.kinds, weights));
    objectEdges.set(id, (objectEdges.get(id) ?? 0) + 1);
  }
  const merged = new Map();
  for (const group of groups.values()) {
    if (group.objects >= minObjects) continue;
    const best = [...counts].filter(([id]) => id.startsWith(`${group.key}\u0000`))
      .sort((a, b) => b[1] - a[1])[0];
    if (best) merged.set(group.key, best[0].split("\u0000")[1]);
  }

  const edges = new Map();
  for (const [id, count] of counts) {
    let [source, target] = id.split("\u0000");
    source = merged.get(source) ?? source;
    target = merged.get(target) ?? target;
    if (source === target) continue;
    const key = `${source}\u0000${target}`;
    const edge = edges.get(key) ?? { source, target, weight: 0, objectEdges: 0 };
    edge.weight += count;
    edge.objectEdges += objectEdges.get(id);
    edges.set(key, edge);
  }
  const keys = [...groups.keys()].filter((key) => !merged.has(key));
  const order = eadesLinSmyth(keys, [...edges.values()]);
  const position = new Map(order.map((key, index) => [key, index]));
  const forward = [...edges.values()].filter(({ source, target }) => position.get(source) < position.get(target));
  const feedback = [...edges.values()].filter(({ source, target }) => position.get(source) > position.get(target))
    .sort((a, b) => a.weight - b.weight);

  // Layer 0 is the core: groups whose allowed dependencies all lie below.
  const layer = new Map();
  for (const key of [...order].reverse()) {
    const targets = forward.filter(({ source }) => source === key).map(({ target }) => layer.get(target) ?? 0);
    layer.set(key, forward.some(({ source }) => source === key) ? Math.max(...targets) + 1 : 0);
  }

  const kept = keys.map((key) => groups.get(key));
  uniqueNames(kept);
  const nameOf = new Map(kept.map((group) => [group.key, group.name]));
  for (const [small, into] of merged) groups.get(into).absorbed = [...(groups.get(into).absorbed ?? []), groups.get(small)];
  const recommendations = recommend(kept, nodes.filter(({ outsideSelection }) => !outsideSelection), (id) => merged.get(nodeGroup.get(id)) ?? nodeGroup.get(id), levels);
  const recommendationOf = new Map(recommendations.map((recommendation) => [recommendation.component, recommendation]));

  const components = kept
    .sort((a, b) => layer.get(a.key) - layer.get(b.key) || a.name.localeCompare(b.name))
    .map((group) => ({
      name: group.name,
      ...(group.fixed ? { description: "Outside the analyzed path; kept as one component" } : {}),
      ...(recommendationOf.has(group.name) ? { description: `${ROLE_TEXT[recommendationOf.get(group.name).role](recommendationOf.get(group.name))}; namespace ${recommendationOf.get(group.name).namespace}` } : {}),
      layer: layer.get(group.key),
      match: [...new Set([...(group.selectors ?? [group.selector]), ...(group.absorbed ?? []).flatMap(({ selector, selectors }) => selectors ?? [selector])])],
      dependsOn: forward.filter(({ source }) => source === group.key).map(({ target }) => nameOf.get(target)).sort()
    }));

  // Objects that are more tightly bound to another component than to their
  // own are cheap wins: moving them removes cross-component coupling.
  const affinity = new Map();
  for (const edge of levels.object.edges) {
    if (!shapes(edge)) continue;
    const source = nodeGroup.get(edge.source);
    const target = nodeGroup.get(edge.target);
    if (!source || !target) continue;
    const weight = coupling(edge.kinds, weights);
    for (const [node, group] of [[edge.source, merged.get(target) ?? target], [edge.target, merged.get(source) ?? source]]) {
      if (!affinity.has(node)) affinity.set(node, new Map());
      affinity.get(node).set(group, (affinity.get(node).get(group) ?? 0) + weight);
    }
  }
  const moves = [];
  for (const node of nodes) {
    if (node.outsideSelection) continue;
    const own = merged.get(nodeGroup.get(node.id)) ?? nodeGroup.get(node.id);
    const links = affinity.get(node.id);
    if (!links) continue;
    const [best, count] = [...links].filter(([group]) => group !== own).sort((a, b) => b[1] - a[1])[0] ?? [];
    const gain = (count ?? 0) - (links.get(own) ?? 0);
    if (best && gain >= 2) {
      const round = (value) => Number(value.toFixed(1));
      moves.push({
        object: { id: node.id, label: node.label, type: node.type, objectId: node.objectId, file: node.file },
        from: nameOf.get(own),
        to: nameOf.get(best),
        linksToTarget: round(count),
        linksToOwn: round(links.get(own) ?? 0),
        gain: round(gain)
      });
    }
  }
  moves.sort((a, b) => b.gain - a.gain || a.object.label.localeCompare(b.object.label));

  return {
    groupBy: mode,
    architecture: { components, allowSameLayer: false },
    feedback: feedback.map(({ source, target, weight, objectEdges: count }) => ({ source: nameOf.get(source), target: nameOf.get(target), objectEdges: count, coupling: Number(weight.toFixed(1)) })),
    moves: moves.slice(0, 50),
    recommendations
  };
}
