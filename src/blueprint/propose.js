// Proposes a target architecture from the dependency graph as it is today:
// group objects into candidate components, order the components so that as
// few dependencies as possible point the wrong way (a weighted feedback arc
// set, Eades-Lin-Smyth heuristic), and derive layers from the result. The
// dependencies that still point the wrong way are what has to be resolved
// before the components can become apps of their own.
//
// Dependencies weigh what it would take to cut them (see graph/coupling.js),
// so the order, the merged groups, and the objects that belong elsewhere
// follow how tightly objects are bound, not how often they mention each other.
import Graph from "graphology";
import louvain from "graphology-communities-louvain";
import { coupling, COUPLING_WEIGHTS } from "../graph/coupling.js";

const GROUPINGS = ["auto", "coupling", "namespace", "folder", "module", "app"];

// Permission sets grant access to everything; they follow the components
// instead of shaping them.
const shapes = (edge) => Object.keys(edge.kinds ?? {}).some((kind) => !["permits", "includes"].includes(kind));

// Louvain is randomized; a fixed seed keeps proposals stable.
function seededRandom(seed) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

/**
 * Coupling groups: every namespace (or, without one, folder) of a module or
 * app is a unit; units that are tightly coupled to each other form one group
 * (Louvain communities on the coupling weights, inside each module or app).
 */
function couplingGroups(nodes, levels, weights, coarse) {
  const selected = new Set(nodes.map(({ id }) => id));
  const several = new Set(nodes.map((node) => coarse(node).key)).size > 1;
  const units = new Map();
  const unitOf = new Map();
  for (const node of nodes) {
    const outer = coarse(node);
    const namespace = node.namespace && node.namespace !== "(global)" ? node.namespace : undefined;
    const folder = (node.file ?? "").split("/").slice(0, -1).join("/");
    const local = namespace
      ? { key: `ns:${namespace.toLowerCase()}`, label: namespace.split(".").at(-1), fullName: namespace, selector: `namespace:${namespace}` }
      : { key: `folder:${folder}`, label: folder.split("/").at(-1) || "(root)", fullName: folder || "(root)", selector: folder ? `folder:${folder}` : "*" };
    const key = `${outer.key}|${local.key}`;
    if (!units.has(key)) {
      units.set(key, { ...local, key, outer, objects: 0, selector: several && local.selector !== "*" ? `${outer.selector} & ${local.selector}` : local.selector === "*" ? outer.selector : local.selector });
    }
    units.get(key).objects++;
    unitOf.set(node.id, key);
  }
  // Communities of objects (they see how cohesive a namespace is inside);
  // a unit joins the community most of its objects belong to.
  const graph = new Graph({ type: "undirected", allowSelfLoops: false });
  for (const node of nodes) graph.addNode(node.id);
  for (const edge of levels.object.edges) {
    if (!selected.has(edge.source) || !selected.has(edge.target) || edge.source === edge.target || !shapes(edge)) continue;
    if (units.get(unitOf.get(edge.source)).outer.key !== units.get(unitOf.get(edge.target)).outer.key) continue;
    const weight = coupling(edge.kinds, weights);
    if (graph.hasEdge(edge.source, edge.target)) graph.updateEdgeAttribute(edge.source, edge.target, "weight", (value) => value + weight);
    else graph.addEdge(edge.source, edge.target, { weight });
  }
  const objectCommunity = graph.size ? louvain(graph, { getEdgeWeight: "weight", rng: seededRandom(7) }) : {};
  const votes = new Map();
  for (const node of nodes) {
    const unit = unitOf.get(node.id);
    if (!votes.has(unit)) votes.set(unit, new Map());
    const vote = objectCommunity[node.id] ?? `alone:${node.id}`;
    votes.get(unit).set(vote, (votes.get(unit).get(vote) ?? 0) + 1);
  }
  const community = Object.fromEntries([...votes].map(([unit, counts]) =>
    [unit, [...counts].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))[0][0]]));
  // Name a group after its largest unit; keep every unit's selector.
  const groups = new Map();
  for (const unit of units.values()) {
    const key = `coupling:${unit.outer.key}:${community[unit.key] ?? unit.key}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(unit);
  }
  const groupOfUnit = new Map();
  for (const [key, members] of groups) {
    members.sort((a, b) => b.objects - a.objects || a.fullName.localeCompare(b.fullName));
    const [largest] = members;
    const group = { key, label: largest.label, fullName: largest.fullName, selector: largest.selector, selectors: members.map(({ selector }) => selector) };
    for (const unit of members) groupOfUnit.set(unit.key, group);
  }
  return (node) => groupOfUnit.get(unitOf.get(node.id));
}

// Namespaces split until no candidate holds more than this share of objects.
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
  let inner;
  if (groupBy === "module") {
    if (!modules.size) throw new Error("--group-by module needs nested app.json modules; use namespace or folder");
    inner = (node) => {
      const label = modules.get(node.module)?.label ?? apps.get(node.app)?.label ?? "(no app)";
      return { key: `module:${label}`, label, selector: `module:${label}` };
    };
  } else if (groupBy === "auto") {
    // Modules (or apps) first; a group that is still too large is split by
    // namespace, so a monolith such as the Base Application's root module
    // becomes components too.
    const coarse = modules.size
      ? (node) => {
          const label = modules.get(node.module)?.label ?? apps.get(node.app)?.label ?? "(no app)";
          return { key: `module:${label}`, label, selector: `module:${label}` };
        }
      : byApp;
    const selected = nodes.filter(({ outsideSelection }) => !outsideSelection);
    const sizes = new Map();
    for (const node of selected) sizes.set(coarse(node).key, (sizes.get(coarse(node).key) ?? 0) + 1);
    const limit = Math.max(MIN_SPLIT_OBJECTS, Math.ceil(selected.length * MAX_SHARE));
    const large = new Set([...sizes].filter(([, size]) => size > limit).map(([key]) => key));
    const fine = namespaceGroups(selected.filter((node) => large.has(coarse(node).key)), depth);
    inner = (node) => {
      const group = coarse(node);
      if (!large.has(group.key)) return group;
      // Restrict the namespace to its module, so namespaces shared with other
      // apps (Microsoft.Foundation) do not pull their objects in.
      const part = fine(node);
      return { ...part, key: `${group.key}|${part.key}`, selector: part.selector === "*" ? group.selector : `${group.selector} & ${part.selector}` };
    };
  } else if (groupBy === "coupling") {
    const coarse = modules.size
      ? (node) => {
          const label = modules.get(node.module)?.label ?? apps.get(node.app)?.label ?? "(no app)";
          return { key: `module:${label}`, label, selector: `module:${label}` };
        }
      : byApp;
    inner = couplingGroups(nodes.filter(({ outsideSelection }) => !outsideSelection), levels, weights, coarse);
  } else if (groupBy === "app") {
    inner = byApp;
  } else if (groupBy === "folder") {
    const folderDepth = depth ?? 1;
    inner = (node) => {
      const parts = (node.file ?? "").split("/").slice(0, -1);
      const folder = parts.length ? parts.slice(0, folderDepth).join("/") : "(root)";
      return { key: `folder:${folder}`, label: folder.split("/").at(-1), fullName: folder, selector: folder === "(root)" ? "*" : `folder:${folder}` };
    };
  } else {
    inner = namespaceGroups(nodes.filter(({ outsideSelection }) => !outsideSelection), depth);
  }
  // Objects outside the analyzed path (context such as the System
  // Application) keep their app as one fixed component.
  return (node) => node.outsideSelection ? { ...byApp(node), fixed: true } : inner(node);
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

function uniqueNames(groups) {
  const used = new Map();
  for (const group of groups) {
    let name = group.label || group.key;
    if (used.has(name)) name = group.fullName ?? group.key.replace(/^[a-z]+:/u, "");
    used.set(name, true);
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
  // With context apps outside the analyzed path, a namespace group of one app
  // is restricted to that app so shared namespaces do not overlap.
  if (mode === "namespace" && nodes.some(({ outsideSelection }) => outsideSelection)) {
    const appLabels = new Map((levels.app?.nodes ?? []).map((node) => [node.id, node.label]));
    for (const group of groups.values()) {
      if (group.fixed || group.apps.size !== 1 || !group.selector.startsWith("namespace:")) continue;
      group.selector = `app:${appLabels.get([...group.apps][0])} & ${group.selector}`;
    }
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

  const components = kept
    .sort((a, b) => layer.get(a.key) - layer.get(b.key) || a.name.localeCompare(b.name))
    .map((group) => ({
      name: group.name,
      ...(group.fixed ? { description: "Outside the analyzed path; kept as one component" } : {}),
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
    moves: moves.slice(0, 50)
  };
}
