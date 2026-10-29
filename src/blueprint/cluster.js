// Components from relations, not from names. Inside each app or module, the
// objects are clustered by how tightly they are coupled (typed and weighted
// relations, see graph/coupling.js); namespaces, folders, and object IDs only
// name the clusters and describe them as selectors afterwards. That works the
// same for code with namespaces, without them, and for a mix of both.
//
//   1. Louvain communities on the coupling of the objects
//   2. hubs, objects that many communities use but none owns (setup tables,
//      utility codeunits), form a shared core instead of gluing communities
//      together; the rest is clustered again without them
//   3. tiny communities join the one they are most coupled to; objects
//      without any coupling join their namespace, folder, or ID neighbors
//   4. the same relations at a coarser resolution say which components
//      belong together in one app: each component goes to the app candidate
//      most of its objects land in, so apps always hold whole components
import { createHash } from "node:crypto";
import Graph from "graphology";
import louvain from "graphology-communities-louvain";
import { coupling } from "../graph/coupling.js";
import { compileSelector, componentMatcher, selectorContext } from "./components.js";

// Permission sets grant access to everything; they never decide where an object belongs.
export const shapes = (edge) => Object.keys(edge.kinds ?? {}).some((kind) => !["permits", "includes"].includes(kind));

// Folders that sort objects by type say nothing about what they do.
const TYPE_FOLDERS = new Set([
  "table", "tables", "tableextension", "tableextensions", "tableext", "tableexts",
  "page", "pages", "pageextension", "pageextensions", "pageext", "pageexts", "pagecustomization", "pagecustomizations",
  "report", "reports", "reportextension", "reportextensions", "reportext", "reportexts", "layout", "layouts", "reportlayouts",
  "codeunit", "codeunits", "query", "queries", "xmlport", "xmlports", "enum", "enums", "enumextension", "enumextensions", "enumext", "enumexts",
  "interface", "interfaces", "permissionset", "permissionsets", "permissionsetextension", "permissionsetextensions", "permissions",
  "controladdin", "controladdins", "profile", "profiles", "entitlement", "entitlements", "translations",
  "src", "source", "sources", "app", "al", "objects", "object", "base"
]);
const typeFolder = (segment) => TYPE_FOLDERS.has(segment.toLowerCase().replace(/[^a-z]/gu, ""));

/** The folder of a file without the folders that only sort by type: src/Sales/Tables/X.al -> src/Sales. */
export function functionalFolder(file) {
  const segments = String(file ?? "").split("/").slice(0, -1);
  while (segments.length && typeFolder(segments.at(-1))) segments.pop();
  return segments.some((segment) => !typeFolder(segment)) ? segments.join("/") : undefined;
}

const hasNamespace = (node) => Boolean(node.namespace) && node.namespace !== "(global)";

// Louvain is randomized; a fixed seed keeps proposals stable.
function seededRandom(seed) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

/** The coupling graph for Louvain, merged per pair of objects, without self-loops. */
function couplingGraph(nodes, edges) {
  const graph = new Graph({ type: "undirected", allowSelfLoops: false });
  for (const id of nodes) graph.addNode(id);
  for (const { source, target, weight } of edges) {
    if (!graph.hasNode(source) || !graph.hasNode(target) || source === target || !weight) continue;
    if (graph.hasEdge(source, target)) graph.updateEdgeAttribute(source, target, "weight", (value) => value + weight);
    else graph.addEdge(source, target, { weight });
  }
  return graph;
}

/**
 * The same graph as compact arrays (compressed sparse rows) for refining and
 * scoring: objects in sorted order, and per object its neighbors and weights.
 */
function adjacency(nodes, edges) {
  const order = [...nodes].sort();
  const index = new Map(order.map((id, position) => [id, position]));
  const lists = order.map(() => new Map());
  for (const { source, target, weight } of edges) {
    const from = index.get(source);
    const to = index.get(target);
    if (from === undefined || to === undefined || from === to || !weight) continue;
    lists[from].set(to, (lists[from].get(to) ?? 0) + weight);
    lists[to].set(from, (lists[to].get(from) ?? 0) + weight);
  }
  const offsets = new Int32Array(order.length + 1);
  for (let node = 0; node < order.length; node++) offsets[node + 1] = offsets[node] + lists[node].size;
  const neighbors = new Int32Array(offsets[order.length]);
  const weights = new Float64Array(offsets[order.length]);
  const strength = new Float64Array(order.length);
  let total = 0;
  for (let node = 0; node < order.length; node++) {
    let position = offsets[node];
    for (const [other, weight] of lists[node]) {
      neighbors[position] = other;
      weights[position++] = weight;
      strength[node] += weight;
    }
    total += strength[node];
  }
  return { order, index, offsets, neighbors, weights, strength, total };
}

/** Partition labels as consecutive integers, ordered like the labels themselves (ties break the same way). */
function numbered(labels) {
  const distinct = [...new Set(labels)].sort();
  const number = new Map(distinct.map((label, position) => [label, position]));
  return { partition: Int32Array.from(labels, (label) => number.get(label)), count: distinct.length };
}

function modularity({ offsets, neighbors, weights, strength, total }, partition, count, resolution) {
  if (!total) return 0;
  const inside = new Float64Array(count);
  const degree = new Float64Array(count);
  for (let node = 0; node < partition.length; node++) {
    const community = partition[node];
    degree[community] += strength[node];
    for (let position = offsets[node]; position < offsets[node + 1]; position++) {
      if (partition[neighbors[position]] === community) inside[community] += weights[position];
    }
  }
  let score = 0;
  for (let community = 0; community < count; community++) score += inside[community] / total - resolution * (degree[community] / total) ** 2;
  return score;
}

/** Moves single objects to the neighboring community that raises modularity most, until none does. */
function refine({ offsets, neighbors, weights, strength, total }, start, count, resolution) {
  const partition = Int32Array.from(start);
  if (!total) return partition;
  const sums = new Float64Array(count);
  for (let node = 0; node < partition.length; node++) sums[partition[node]] += strength[node];
  const links = new Float64Array(count);
  const touched = [];
  for (let pass = 0; pass < 20; pass++) {
    let moved = false;
    for (let node = 0; node < partition.length; node++) {
      const degree = strength[node];
      if (!degree) continue;
      const own = partition[node];
      for (let position = offsets[node]; position < offsets[node + 1]; position++) {
        const community = partition[neighbors[position]];
        if (!links[community]) touched.push(community);
        links[community] += weights[position];
      }
      sums[own] -= degree;
      const gain = (community) => links[community] - resolution * sums[community] * degree / total;
      let best = own;
      let bestGain = gain(own);
      touched.sort((a, b) => a - b);
      for (const community of touched) {
        const value = gain(community);
        if (value > bestGain + 1e-9) {
          best = community;
          bestGain = value;
        }
      }
      sums[best] += degree;
      for (const community of touched) links[community] = 0;
      touched.length = 0;
      if (best !== own) {
        partition[node] = best;
        moved = true;
      }
    }
    if (!moved) break;
  }
  return partition;
}

/**
 * The partition with the highest modularity among several Louvain runs and
 * the given candidates (such as today's namespaces), each refined by moving
 * single objects. Structure that exists already survives only where the
 * relations confirm it.
 */
function communities(nodes, edges, { resolution = 1, candidates = [] } = {}) {
  const csr = adjacency(nodes, edges);
  const graph = couplingGraph(nodes, edges);
  const starts = [];
  for (const seed of [7, 11, 13, 17, 19]) {
    const result = graph.size ? louvain(graph, { getEdgeWeight: "weight", rng: seededRandom(seed), resolution }) : {};
    starts.push(csr.order.map((id) => result[id] === undefined ? `s${id}` : `l${result[id]}`));
  }
  for (const read of candidates) starts.push(csr.order.map((id) => read(id) === undefined ? `s${id}` : `k${read(id)}`));
  let best;
  let bestScore = -Infinity;
  for (const labels of starts) {
    const { partition: start, count } = numbered(labels);
    const partition = refine(csr, start, count, resolution);
    const score = modularity(csr, partition, count, resolution);
    if (score > bestScore + 1e-9) {
      best = partition;
      bestScore = score;
    }
  }
  // Objects without coupling stay unassigned; the callers place them.
  const result = {};
  if (best) csr.order.forEach((id, node) => {
    if (csr.offsets[node + 1] > csr.offsets[node]) result[id] = best[node];
  });
  return result;
}

export const mostCommon = (values) => {
  const counts = new Map();
  for (const value of values) if (value !== undefined) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))[0];
};

// Words that describe what an object is, not what it is about.
const GENERIC = new Set(["mgt", "management", "card", "list", "subform", "entry", "entries", "line", "lines", "header", "ext", "extension",
  "buffer", "handler", "helper", "impl", "codeunit", "table", "page", "report", "query", "the", "and", "of", "for", "to", "api", "factbox", "part",
  "type", "types", "code", "codes", "status", "no", "doc", "document", "documents", "mgmt", "setup", "test", "tests", "wizard", "archive", "statistics"]);

/** The affix shared by most object names (CON in "CON Sales Header"), so it does not name every cluster. */
export function commonAffix(nodes) {
  const first = nodes.map((node) => String(node.label ?? "").split(/[^A-Za-z0-9]+/u).filter(Boolean)[0]?.toLowerCase());
  const [affix, count] = mostCommon(first) ?? [];
  return affix && affix.length <= 6 && count >= nodes.length * 0.4 ? affix : undefined;
}

const title = (word) => word[0].toUpperCase() + word.slice(1);

/**
 * The longest prefix (namespace segments, folders) that at least `share` of
 * `total` values start with, compared without case: Microsoft.Sales when most
 * values lie in Microsoft.Sales.Document or Microsoft.Sales.Customer.
 */
export function dominantPrefix(values, { separator = ".", share = 0.5, total = values.length, minDepth = 1 } = {}) {
  const counts = new Map();
  for (const value of values.filter(Boolean)) {
    const parts = String(value).split(separator);
    for (let depth = 1; depth <= parts.length; depth++) {
      const prefix = parts.slice(0, depth).join(separator);
      const entry = counts.get(prefix.toLowerCase()) ?? { prefix, depth, count: 0 };
      entry.count++;
      counts.set(prefix.toLowerCase(), entry);
    }
  }
  let best;
  for (const entry of counts.values()) {
    if (entry.depth < minDepth || entry.count < total * share) continue;
    if (!best || entry.depth > best.depth || (entry.depth === best.depth && entry.count > best.count)) best = entry;
  }
  return best?.prefix;
}

/**
 * A name for a cluster: its namespace or functional folder when most members
 * share one, else the words their names share most. `alternatives` names it
 * more precisely when another cluster has the same name.
 */
export function clusterName(members, affix, { namespaceDepth = 2, folderDepth = 1 } = {}) {
  const words = [];
  for (const { label } of members) {
    words.push(...new Set(String(label ?? "").split(/[^A-Za-z]+/u).map((word) => word.toLowerCase())
      .filter((word) => word.length > 2 && word !== affix && !GENERIC.has(word))));
  }
  const counts = new Map();
  for (const word of words) counts.set(word, (counts.get(word) ?? 0) + 1);
  const ranked = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([word]) => title(word));
  const byWords = ranked.slice(1, 4).map((word) => `${ranked[0]} ${word}`);
  // The deepest namespace or folder most members share, below what all objects
  // of the app share (Microsoft, src/Layers/W1/BaseApp says nothing).
  // Most members, else the largest part of them.
  const namespaces = members.filter(hasNamespace).map(({ namespace }) => namespace);
  const namespace = dominantPrefix(namespaces, { total: members.length, minDepth: namespaceDepth }) ??
    dominantPrefix(namespaces, { total: members.length, minDepth: namespaceDepth, share: 0.3 });
  if (namespace) return { label: namespace.split(".").at(-1), fullName: namespace, alternatives: byWords, basis: "namespace" };
  const folder = dominantPrefix(members.map(({ file }) => functionalFolder(file)), { separator: "/", total: members.length, minDepth: folderDepth });
  if (folder && !typeFolder(folder.split("/").at(-1))) return { label: folder.split("/").at(-1), fullName: folder, alternatives: byWords, basis: "folder" };
  if (ranked.length) return { label: ranked[0], fullName: ranked[0], alternatives: byWords };
  return { label: "Group", fullName: "Group", alternatives: [] };
}

// Coarser communities for app candidates; 0.3 keeps business areas (sales,
// purchasing, warehouse) together without merging them into one.
const APP_RESOLUTION = 0.3;

/**
 * Clusters the objects of one app or module by coupling.
 * @returns Map of object id to { key, shared?, label, fullName, alternatives, app: { key, label, fullName } }
 */
// The explorer and the architecture proposal cluster the same apps, and after
// a saved file most apps and modules are unchanged: results are kept by a
// fingerprint of everything they depend on.
const clusterCache = new Map();
const CLUSTER_CACHE_SIZE = 64;

export function clusterByRelations(nodes, levels, weights, { prefix = "" } = {}) {
  const ids = new Set(nodes.map(({ id }) => id));
  const edges = [];
  for (const edge of levels.object.edges) {
    if (!ids.has(edge.source) || !ids.has(edge.target) || edge.source === edge.target || !shapes(edge)) continue;
    const weight = coupling(edge.kinds, weights);
    if (weight) edges.push({ source: edge.source, target: edge.target, weight });
  }
  const fingerprint = createHash("sha1");
  for (const { id, label, namespace, file, objectId } of nodes) fingerprint.update(`\u0000${id}\u0001${label}\u0001${namespace}\u0001${file}\u0001${objectId}`);
  for (const { source, target, weight } of edges) fingerprint.update(`\u0002${source}\u0001${target}\u0001${weight}`);
  const key = fingerprint.digest("hex");
  let result = clusterCache.get(key);
  if (result) clusterCache.delete(key);
  else result = clusterFresh(nodes, edges);
  clusterCache.set(key, result);
  if (clusterCache.size > CLUSTER_CACHE_SIZE) clusterCache.delete(clusterCache.keys().next().value);
  if (!prefix) return result;
  // Keys are local to the call; the caller's prefix makes them unique across apps.
  const apps = new Map();
  const prefixed = new Map();
  for (const [id, cluster] of result) {
    if (!apps.has(cluster.app)) apps.set(cluster.app, { ...cluster.app, key: `${prefix}${cluster.app.key}` });
    prefixed.set(id, { ...cluster, key: `${prefix}${cluster.key}`, app: apps.get(cluster.app) });
  }
  return prefixed;
}

function clusterFresh(nodes, edges) {
  const prefix = "";
  const ids = new Set(nodes.map(({ id }) => id));
  const byId = new Map(nodes.map((node) => [node.id, node]));

  // Today's namespaces and functional folders compete with Louvain; the relations decide.
  const candidates = [
    (id) => hasNamespace(byId.get(id)) ? byId.get(id).namespace.toLowerCase() : undefined,
    (id) => functionalFolder(byId.get(id).file)
  ];
  // 1. Communities, 2. hubs out, communities again.
  const first = communities(ids, edges, { candidates });
  const incoming = new Map();
  for (const { source, target, weight } of edges) {
    if (!incoming.has(target)) incoming.set(target, new Map());
    const from = first[source];
    incoming.get(target).set(from, (incoming.get(target).get(from) ?? 0) + weight);
  }
  const degrees = [...incoming.values()].map((map) => [...map.values()].reduce((sum, value) => sum + value, 0)).sort((a, b) => a - b);
  const busy = Math.max(4, degrees[Math.floor(degrees.length * 0.9)] ?? 4);
  const hubs = new Set();
  for (const [id, sources] of incoming) {
    const total = [...sources.values()].reduce((sum, value) => sum + value, 0);
    const own = sources.get(first[id]) ?? 0;
    const others = [...sources.keys()].filter((community) => community !== first[id]).length;
    if (others >= 3 && total >= busy && own / total < 0.4) hubs.add(id);
  }
  const rest = [...ids].filter((id) => !hubs.has(id));
  const second = communities(rest, edges.filter(({ source, target }) => !hubs.has(source) && !hubs.has(target)), { candidates });
  const cluster = new Map(rest.map((id) => [id, second[id] === undefined ? undefined : `c${second[id]}`]));
  for (const id of hubs) cluster.set(id, "shared");

  // 3. Tiny communities join the one they are most coupled to; loose objects their neighbors.
  const coupled = new Map();
  for (const { source, target, weight } of edges) {
    for (const [from, to] of [[source, target], [target, source]]) {
      if (!coupled.has(from)) coupled.set(from, new Map());
      coupled.get(from).set(to, (coupled.get(from).get(to) ?? 0) + weight);
    }
  }
  const sizes = () => {
    const counts = new Map();
    for (const key of cluster.values()) if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
    return counts;
  };
  const minimum = Math.max(3, Math.ceil(nodes.length * 0.01));
  for (let round = 0; round < 3; round++) {
    const counts = sizes();
    const small = [...counts].filter(([key, size]) => key !== "shared" && size < minimum).sort((a, b) => a[1] - b[1]);
    if (!small.length) break;
    for (const [key] of small) {
      const members = [...cluster].filter(([, value]) => value === key).map(([id]) => id);
      const pull = new Map();
      for (const id of members) {
        for (const [other, weight] of coupled.get(id) ?? []) {
          const target = cluster.get(other);
          if (target && target !== key) pull.set(target, (pull.get(target) ?? 0) + weight);
        }
      }
      const [best] = [...pull].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))[0] ?? [];
      // Without coupling to anything else, they are placed like loose objects below.
      for (const id of members) cluster.set(id, best);
    }
  }
  // Objects without coupling: where their namespace, folder, or nearest ID points.
  const placed = [...cluster].filter(([, key]) => key).map(([id]) => byId.get(id));
  const majority = (read, value) => mostCommon(placed.filter((node) => read(node) === value).map((node) => cluster.get(node.id)))?.[0];
  const numbered = placed.filter(({ objectId }) => /^\d+$/u.test(String(objectId ?? ""))).sort((a, b) => Number(a.objectId) - Number(b.objectId));
  for (const id of [...ids].filter((key) => !cluster.get(key))) {
    const node = byId.get(id);
    let key = hasNamespace(node) ? majority((other) => other.namespace, node.namespace) : undefined;
    key ??= functionalFolder(node.file) ? majority((other) => functionalFolder(other.file), functionalFolder(node.file)) : undefined;
    if (!key && /^\d+$/u.test(String(node.objectId ?? "")) && numbered.length) {
      const nearest = numbered.reduce((best, other) => Math.abs(Number(other.objectId) - Number(node.objectId)) < Math.abs(Number(best.objectId) - Number(node.objectId)) ? other : best);
      if (Math.abs(Number(nearest.objectId) - Number(node.objectId)) <= 50) key = cluster.get(nearest.id);
    }
    cluster.set(id, key ?? "unconnected");
  }

  const members = new Map();
  for (const [id, key] of cluster) {
    if (!members.has(key)) members.set(key, []);
    members.get(key).push(byId.get(id));
  }

  // 4. App candidates: whole components, by where most of their objects go at a coarser resolution.
  const coarse = communities(rest, edges.filter(({ source, target }) => !hubs.has(source) && !hubs.has(target)), { resolution: APP_RESOLUTION });
  const appOf = new Map();
  for (const [key, list] of members) {
    if (key === "shared" || key === "unconnected") appOf.set(key, key);
    else appOf.set(key, `a${mostCommon(list.map(({ id }) => coarse[id]))?.[0] ?? key}`);
  }
  // An app candidate too small to stand alone joins the one it is most coupled to.
  const appMinimum = Math.max(10, Math.ceil(nodes.length * 0.05));
  for (let round = 0; round < 3; round++) {
    const sizes = new Map();
    for (const [key, list] of members) sizes.set(appOf.get(key), (sizes.get(appOf.get(key)) ?? 0) + list.length);
    const pull = new Map();
    for (const { source, target, weight } of edges) {
      const a = appOf.get(cluster.get(source));
      const b = appOf.get(cluster.get(target));
      if (!a || !b || a === b || [a, b].some((app) => app === "shared" || app === "unconnected")) continue;
      for (const [from, to] of [[a, b], [b, a]]) {
        if (!pull.has(from)) pull.set(from, new Map());
        pull.get(from).set(to, (pull.get(from).get(to) ?? 0) + weight);
      }
    }
    const small = [...sizes].filter(([app, size]) => app !== "shared" && app !== "unconnected" && size < appMinimum && pull.has(app))
      .sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))[0];
    if (!small) break;
    const [into] = [...pull.get(small[0])].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
    for (const [key, app] of appOf) if (app === small[0]) appOf.set(key, into);
  }

  // Names and the result.
  const affix = commonAffix(nodes);
  const floor = (values, separator) => (dominantPrefix(values, { separator, share: 0.9, total: nodes.length })?.split(separator).length ?? 0) + 1;
  const depths = {
    namespaceDepth: Math.max(2, floor(nodes.filter(hasNamespace).map(({ namespace }) => namespace), ".")),
    folderDepth: floor(nodes.map(({ file }) => functionalFolder(file)), "/")
  };
  const nameOf = (key, list) => key === "shared" ? { label: "Shared", fullName: "Shared", alternatives: [] }
    : key === "unconnected" ? { label: "Unconnected", fullName: "Unconnected", alternatives: [] } : clusterName(list, affix, depths);
  const apps = new Map();
  for (const [key, list] of members) {
    const app = appOf.get(key);
    if (!apps.has(app)) apps.set(app, []);
    apps.get(app).push(...list);
  }
  // An app candidate without a namespace or folder of its own is named after its largest component.
  const largest = new Map();
  for (const [key, list] of members) {
    const app = appOf.get(key);
    if (!largest.has(app) || list.length > members.get(largest.get(app)).length) largest.set(app, key);
  }
  const appNames = new Map([...apps].map(([app, list]) => {
    const name = nameOf(app, list);
    const own = name.basis ? name : nameOf(largest.get(app), members.get(largest.get(app)));
    return [app, { key: `${prefix}${app}`, ...own, alternatives: [...new Set([...(own.alternatives ?? []), ...(name.basis ? [] : [name.label])])] }];
  }));
  const result = new Map();
  for (const [key, list] of members) {
    const name = nameOf(key, list);
    for (const node of list) result.set(node.id, { key: `${prefix}${key}`, shared: key === "shared", ...name, app: appNames.get(appOf.get(key)) });
  }
  return result;
}

/**
 * Groups inside one component (its sub-domains): the coupling of its objects
 * among themselves, clustered and named the same way as components. Groups
 * smaller than `minSize` join the group they are most coupled to; objects
 * without coupling inside the component form the group "Loose".
 * @param nodes the component's objects { id, label, namespace, file, objectId }
 * @param edges { source, target, weight } between them
 * @returns Map of object id to { key, label, fullName, basis }
 */
export function subgroups(nodes, edges, { minSize = 3, affix = commonAffix(nodes) } = {}) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const inside = edges.filter(({ source, target }) => byId.has(source) && byId.has(target) && source !== target);
  const one = (list) => ({ key: "g0", ...clusterName(list, affix) });
  if (nodes.length < minSize * 2) {
    const group = one(nodes);
    return new Map(nodes.map(({ id }) => [id, group]));
  }
  const candidates = [
    (id) => hasNamespace(byId.get(id)) ? byId.get(id).namespace.toLowerCase() : undefined,
    (id) => functionalFolder(byId.get(id).file)
  ];
  const found = communities(new Set(byId.keys()), inside, { candidates });
  const group = new Map(nodes.map(({ id }) => [id, found[id] === undefined ? undefined : String(found[id])]));

  const coupled = new Map();
  for (const { source, target, weight } of inside) {
    for (const [from, to] of [[source, target], [target, source]]) {
      if (!coupled.has(from)) coupled.set(from, new Map());
      coupled.get(from).set(to, (coupled.get(from).get(to) ?? 0) + weight);
    }
  }
  for (let round = 0; round < 3; round++) {
    const sizes = new Map();
    for (const key of group.values()) if (key !== undefined) sizes.set(key, (sizes.get(key) ?? 0) + 1);
    const small = [...sizes].filter(([, size]) => size < minSize).sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]));
    if (!small.length || sizes.size === 1) break;
    for (const [key] of small) {
      const members = [...group].filter(([, value]) => value === key).map(([id]) => id);
      const pull = new Map();
      for (const id of members) {
        for (const [other, weight] of coupled.get(id) ?? []) {
          const target = group.get(other);
          if (target !== undefined && target !== key) pull.set(target, (pull.get(target) ?? 0) + weight);
        }
      }
      const [best] = [...pull].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0] ?? [];
      if (best !== undefined) for (const id of members) group.set(id, best);
    }
  }

  // Objects without coupling inside the component (often extensions of
  // objects elsewhere): the group most of their namespace or folder is in,
  // else a group per namespace or folder, else "Loose".
  const placed = [...group].filter(([, key]) => key !== undefined).map(([id]) => byId.get(id));
  const majority = (read, value) => mostCommon(placed.filter((node) => read(node) === value).map((node) => group.get(node.id)))?.[0];
  const readers = [(node) => (hasNamespace(node) ? node.namespace : undefined), (node) => functionalFolder(node.file)];
  const loose = [...group].filter(([, key]) => key === undefined).map(([id]) => byId.get(id));
  for (const node of loose) {
    for (const read of readers) {
      const value = read(node);
      const key = value === undefined ? undefined : majority(read, value);
      if (key !== undefined) {
        group.set(node.id, key);
        break;
      }
    }
  }
  for (const read of readers) {
    const rest = loose.filter(({ id }) => group.get(id) === undefined);
    const byValue = new Map();
    for (const node of rest) {
      const value = read(node);
      if (value === undefined) continue;
      if (!byValue.has(value)) byValue.set(value, []);
      byValue.get(value).push(node);
    }
    for (const [value, list] of byValue) if (list.length >= minSize) for (const node of list) group.set(node.id, `v${value}`);
  }

  const members = new Map();
  for (const [id, key] of group) {
    const name = key ?? "loose";
    if (!members.has(name)) members.set(name, []);
    members.get(name).push(byId.get(id));
  }
  // Largest first; the same name twice gets its next alternative.
  const ordered = [...members].sort((a, b) => (a[0] === "loose") - (b[0] === "loose") || b[1].length - a[1].length || a[0].localeCompare(b[0]));
  const used = new Set();
  const result = new Map();
  ordered.forEach(([key, list], index) => {
    let name = key === "loose" ? { label: "Loose", fullName: "Loose", alternatives: [] } : clusterName(list, affix);
    const label = [name.label, ...(name.alternatives ?? [])].find((candidate) => !used.has(candidate.toLowerCase())) ?? `${name.label} ${index + 1}`;
    used.add(label.toLowerCase());
    name = { label, fullName: label === name.label ? name.fullName : label, basis: label === name.label ? name.basis : undefined };
    for (const node of list) result.set(node.id, { key: key === "loose" ? "loose" : `g${index}`, ...name });
  });
  return result;
}

/**
 * Selectors that reproduce an assignment of objects to components: a
 * namespace or functional folder whose objects (nearly) all belong to one
 * component, else object ID ranges, else single objects; then a check against
 * the component matcher adds object selectors for every object that would
 * still land elsewhere.
 * @param assignment Map of object id to component key
 * @param groups Map of component key to { selectors: [] } (filled in place)
 * @param outer node => { key, selector } of its app or module
 */
export function deriveSelectors(nodes, assignment, groups, levels, outer) {
  // A selector gets its app or module in front only when it would match objects elsewhere too.
  const context = selectorContext(levels);
  const scopes = new Map();
  const scoped = (node, selector) => {
    const { key, selector: prefix } = outer(node);
    const id = `${key}\u0000${selector}`;
    if (!scopes.has(id)) {
      const matches = compileSelector(selector, context);
      const foreign = levels.object.nodes.some((other) => matches(other) && (other.origin !== "workspace" || outer(other).key !== key));
      scopes.set(id, foreign ? `${prefix} & ${selector}` : selector);
    }
    return scopes.get(id);
  };
  const outerOf = (node) => outer(node).key;
  const covered = new Set();
  // Namespaces and functional folders that belong to one component.
  const units = new Map();
  for (const node of nodes) {
    const keys = [];
    if (hasNamespace(node)) keys.push({ key: `ns:${node.namespace.toLowerCase()}|${outerOf(node)}`, selector: `namespace:${node.namespace}`, rank: 0 });
    const folder = functionalFolder(node.file);
    if (folder) keys.push({ key: `folder:${folder}|${outerOf(node)}`, selector: `folder:${folder}`, rank: 1 });
    for (const unit of keys) {
      if (!units.has(unit.key)) units.set(unit.key, { ...unit, nodes: [] });
      units.get(unit.key).nodes.push(node);
    }
  }
  for (const unit of [...units.values()].sort((a, b) => a.rank - b.rank || b.nodes.length - a.nodes.length || a.key.localeCompare(b.key))) {
    const open = unit.nodes.filter(({ id }) => !covered.has(id));
    if (open.length < 2) continue;
    const [owner, count] = mostCommon(open.map(({ id }) => assignment.get(id)));
    if (count < open.length * 0.8) continue;
    groups.get(owner).selectors.push(scoped(unit.nodes[0], unit.selector));
    for (const node of open) covered.add(node.id);
  }
  // Object ID ranges for the rest; a range ends where another component's object lies.
  const rest = nodes.filter(({ id }) => !covered.has(id));
  const numbered = rest.filter(({ objectId }) => /^\d+$/u.test(String(objectId ?? ""))).sort((a, b) => Number(a.objectId) - Number(b.objectId));
  const sameId = new Map();
  for (const node of numbered) sameId.set(node.objectId, (sameId.get(node.objectId) ?? new Set()).add(assignment.get(node.id)));
  let run;
  const close = () => {
    if (!run) return;
    const range = run.from === run.to ? `id:${run.from}` : `id:${run.from}..${run.to}`;
    groups.get(run.owner).selectors.push(scoped(run.node, range));
    run = undefined;
  };
  for (const node of numbered) {
    const owner = assignment.get(node.id);
    if (sameId.get(node.objectId).size > 1) {
      close();
      continue;
    }
    if (run && run.owner === owner && run.outer === outerOf(node)) run.to = Number(node.objectId);
    else {
      close();
      run = { owner, from: Number(node.objectId), to: Number(node.objectId), node, outer: outerOf(node) };
    }
  }
  close();
  // Check: every object must land where it belongs.
  const fixUp = () => {
    const components = [...groups].filter(([, group]) => group.selectors.length).map(([key, group]) => ({ name: key, match: group.selectors }));
    if (!components.length) return 0;
    const assign = componentMatcher(components, levels);
    let fixes = 0;
    for (const node of nodes) {
      const owner = assignment.get(node.id);
      if (assign(node) === owner) continue;
      const identity = node.objectId ?? node.label;
      groups.get(owner).selectors.push(scoped(node, `object:${node.type}:${identity}`));
      fixes++;
    }
    return fixes;
  };
  if (fixUp()) fixUp();
  for (const group of groups.values()) group.selectors = [...new Set(group.selectors)];
}
