// Proposes a target architecture from the dependency graph as it is today:
// group objects into candidate components, order the components so that as
// few dependencies as possible point the wrong way (a weighted feedback arc
// set, Eades-Lin-Smyth heuristic), and derive layers from the result. The
// dependencies that still point the wrong way are what has to be resolved
// before the components can become apps of their own.

const GROUPINGS = ["namespace", "folder", "module", "app"];

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

function grouping(nodes, levels, { groupBy, depth }) {
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
export function proposeArchitecture(levels, { groupBy, depth, minObjects = 1 } = {}) {
  const nodes = levels.object.nodes.filter(({ origin }) => origin === "workspace");
  const mode = groupBy ?? (levels.module?.nodes?.some(({ origin }) => origin === "module") ? "module" : "namespace");
  if (!GROUPINGS.includes(mode)) throw new Error(`--group-by must be one of: ${GROUPINGS.join(", ")}`);
  const groupOf = grouping(nodes, levels, { groupBy: mode, depth: depth === undefined ? undefined : Number(depth) });

  const groups = new Map();
  const nodeGroup = new Map();
  for (const node of nodes) {
    const group = groupOf(node);
    if (!groups.has(group.key)) groups.set(group.key, { ...group, objects: 0 });
    groups.get(group.key).objects++;
    nodeGroup.set(node.id, group.key);
  }
  // Tiny groups join the group they depend on most.
  // Permission sets grant access to everything; they follow the components
  // instead of shaping them.
  const shapes = (edge) => Object.keys(edge.kinds ?? {}).some((kind) => !["permits", "includes"].includes(kind));
  const counts = new Map();
  for (const edge of levels.object.edges) {
    if (!shapes(edge)) continue;
    const source = nodeGroup.get(edge.source);
    const target = nodeGroup.get(edge.target);
    if (!source || !target || source === target) continue;
    const id = `${source}\u0000${target}`;
    counts.set(id, (counts.get(id) ?? 0) + 1);
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
    edges.set(key, { source, target, weight: (edges.get(key)?.weight ?? 0) + count });
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
      match: [group.selector, ...(group.absorbed ?? []).map(({ selector }) => selector)],
      dependsOn: forward.filter(({ source }) => source === group.key).map(({ target }) => nameOf.get(target)).sort()
    }));

  // Objects that are more tightly bound to another component than to their
  // own are cheap wins: moving them removes cross-component dependencies.
  const affinity = new Map();
  for (const edge of levels.object.edges) {
    if (!shapes(edge)) continue;
    const source = nodeGroup.get(edge.source);
    const target = nodeGroup.get(edge.target);
    if (!source || !target) continue;
    for (const [node, group] of [[edge.source, merged.get(target) ?? target], [edge.target, merged.get(source) ?? source]]) {
      if (!affinity.has(node)) affinity.set(node, new Map());
      affinity.get(node).set(group, (affinity.get(node).get(group) ?? 0) + 1);
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
      moves.push({
        object: { id: node.id, label: node.label, type: node.type, objectId: node.objectId, file: node.file },
        from: nameOf.get(own),
        to: nameOf.get(best),
        linksToTarget: count,
        linksToOwn: links.get(own) ?? 0,
        gain
      });
    }
  }
  moves.sort((a, b) => b.gain - a.gain || a.object.label.localeCompare(b.object.label));

  return {
    groupBy: mode,
    architecture: { components, allowSameLayer: false },
    feedback: feedback.map(({ source, target, weight }) => ({ source: nameOf.get(source), target: nameOf.get(target), objectEdges: weight })),
    moves: moves.slice(0, 50)
  };
}
