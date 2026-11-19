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
import { normalizeIdentifier } from "../resolver.js";
import { clusterName, commonAffix, dominantPrefix, functionalFolder, hasNamespace, mostCommon, roleNaming, uniqueNames } from "./naming.js";
import { THRESHOLDS } from "./placement.js";

// Naming lives in naming.js; these stay importable from here.
export { clusterName, commonAffix, dominantPrefix, functionalFolder, mostCommon };

// Permission sets grant access to everything; they never decide where an
// object belongs. architecture.proposal.ignore can name other kinds too.
const DEFAULT_IGNORED = Object.freeze(["permits", "includes"]);
/** A test whether an edge shapes components: it has a kind that is not ignored. */
export function shaper(ignore = DEFAULT_IGNORED) {
  const ignored = new Set(ignore);
  return (edge) => Object.keys(edge.kinds ?? {}).some((kind) => !ignored.has(kind));
}
export const shapes = shaper();

const round = (value, digits = 1) => Number(Number(value).toFixed(digits));

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
 * @param candidates [{ name, read }] existing structures to start from
 * @returns { of: { id: community }, start, modularity, scores }: which start
 *   won ("relations" or a candidate's name), its modularity, and the best
 *   modularity of every start
 */
function communities(nodes, edges, { resolution = 1, candidates = [] } = {}) {
  const csr = adjacency(nodes, edges);
  const graph = couplingGraph(nodes, edges);
  const starts = [];
  for (const seed of [7, 11, 13, 17, 19]) {
    const result = graph.size ? louvain(graph, { getEdgeWeight: "weight", rng: seededRandom(seed), resolution }) : {};
    starts.push({ name: "relations", labels: csr.order.map((id) => result[id] === undefined ? `s${id}` : `l${result[id]}`) });
  }
  for (const { name, read } of candidates) starts.push({ name, labels: csr.order.map((id) => read(id) === undefined ? `s${id}` : `k${read(id)}`) });
  let best;
  let bestScore = -Infinity;
  let winner;
  const scores = {};
  for (const { name, labels } of starts) {
    const { partition: start, count } = numbered(labels);
    const partition = refine(csr, start, count, resolution);
    const score = modularity(csr, partition, count, resolution);
    scores[name] = Math.max(scores[name] ?? -Infinity, score);
    if (score > bestScore + 1e-9) {
      best = partition;
      bestScore = score;
      winner = name;
    }
  }
  // Objects without coupling stay unassigned; the callers place them.
  const of = {};
  if (best) csr.order.forEach((id, node) => {
    if (csr.offsets[node + 1] > csr.offsets[node]) of[id] = best[node];
  });
  const rounded = (value) => Number(value.toFixed(3));
  return { of, start: winner, modularity: best ? rounded(bestScore) : 0, scores: Object.fromEntries(Object.entries(scores).map(([name, score]) => [name, rounded(score)])) };
}

// Coarser communities for app candidates; 0.3 keeps business areas (sales,
// purchasing, warehouse) together without merging them into one.
const APP_RESOLUTION = 0.3;

/**
 * Clusters the objects of one app or module by coupling.
 * @returns Map of object id to { key, shared?, label, fullName, alternatives, naming, app: { key, label, fullName },
 *   placement: { step, detail } (why the object is in this cluster, see placement.js),
 *   thresholds (the size-dependent numbers that applied to this app or module) }
 */
// The view and the architecture proposal cluster the same apps, and after
// a saved file most apps and modules are unchanged: results are kept by a
// fingerprint of everything they depend on.
const clusterCache = new Map();
const CLUSTER_CACHE_SIZE = 64;

/**
 * @param options { prefix, ignore, startFrom, granularity, appGranularity,
 *   sharedCore } (see settings.js; defaults reproduce the original proposal)
 */
export function clusterByRelations(nodes, levels, weights, { prefix = "", ignore, startFrom = ["namespace", "folder"], granularity = 1, appGranularity = APP_RESOLUTION, sharedCore = true } = {}) {
  const ids = new Set(nodes.map(({ id }) => id));
  const edges = [];
  const shaping = ignore ? shaper(ignore) : shapes;
  for (const edge of levels.object.edges) {
    if (!ids.has(edge.source) || !ids.has(edge.target) || edge.source === edge.target || !shaping(edge)) continue;
    // Ignored kinds do not count on an edge that other kinds keep.
    const kinds = ignore ? Object.fromEntries(Object.entries(edge.kinds ?? {}).filter(([kind]) => !ignore.includes(kind))) : edge.kinds;
    const weight = coupling(kinds, weights);
    if (weight) edges.push({ source: edge.source, target: edge.target, weight });
  }
  const options = { startFrom: [...startFrom].sort(), granularity, appGranularity, sharedCore };
  const fingerprint = createHash("sha1");
  fingerprint.update(JSON.stringify(options));
  for (const { id, label, namespace, file, objectId } of nodes) fingerprint.update(`\u0000${id}\u0001${label}\u0001${namespace}\u0001${file}\u0001${objectId}`);
  for (const { source, target, weight } of edges) fingerprint.update(`\u0002${source}\u0001${target}\u0001${weight}`);
  const key = fingerprint.digest("hex");
  let result = clusterCache.get(key);
  if (result) clusterCache.delete(key);
  else result = clusterFresh(nodes, edges, options);
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

function clusterFresh(nodes, edges, { startFrom, granularity, appGranularity, sharedCore }) {
  const prefix = "";
  const ids = new Set(nodes.map(({ id }) => id));
  const byId = new Map(nodes.map((node) => [node.id, node]));

  // Today's namespaces and functional folders compete with Louvain; the relations decide.
  const readers = {
    namespace: (id) => hasNamespace(byId.get(id)) ? byId.get(id).namespace.toLowerCase() : undefined,
    folder: (id) => functionalFolder(byId.get(id).file)
  };
  const candidates = startFrom.map((structure) => ({ name: structure, read: readers[structure] }));
  const resolution = granularity;
  // 1. Communities, 2. hubs out, communities again.
  const first = communities(ids, edges, { candidates, resolution }).of;
  const incoming = new Map();
  for (const { source, target, weight } of edges) {
    if (!incoming.has(target)) incoming.set(target, new Map());
    const from = first[source];
    incoming.get(target).set(from, (incoming.get(target).get(from) ?? 0) + weight);
  }
  const degrees = [...incoming.values()].map((map) => [...map.values()].reduce((sum, value) => sum + value, 0)).sort((a, b) => a - b);
  const busy = Math.max(THRESHOLDS.hubMinIncoming, degrees[Math.floor(degrees.length * THRESHOLDS.hubPercentile)] ?? THRESHOLDS.hubMinIncoming);
  const hubNeeds = { communities: THRESHOLDS.hubCommunities, incoming: round(busy), ownShare: THRESHOLDS.hubOwnShare };
  const hubs = new Map();
  for (const [id, sources] of incoming) {
    const total = [...sources.values()].reduce((sum, value) => sum + value, 0);
    const own = sources.get(first[id]) ?? 0;
    const others = [...sources.keys()].filter((community) => community !== first[id]).length;
    if (sharedCore && others >= THRESHOLDS.hubCommunities && total >= busy && own / total < THRESHOLDS.hubOwnShare) {
      hubs.set(id, { communities: others, incoming: round(total), ownShare: round(own / total, 2), needs: hubNeeds });
    }
  }
  const rest = [...ids].filter((id) => !hubs.has(id));
  const found = communities(rest, edges.filter(({ source, target }) => !hubs.has(source) && !hubs.has(target)), { candidates, resolution });
  const second = found.of;
  const cluster = new Map(rest.map((id) => [id, second[id] === undefined ? undefined : `c${second[id]}`]));
  for (const id of hubs.keys()) cluster.set(id, "shared");

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
  // A share of the objects, so that a large app has no dust; but never so many that a real
  // module of a large app counts as dust (1% of 5,000 objects would be 50).
  const minimum = Math.max(THRESHOLDS.smallGroup.objects, Math.min(THRESHOLDS.smallGroup.most, Math.ceil(nodes.length * THRESHOLDS.smallGroup.share)));
  // Why each object is where it is; an object keeps the first reason that moved it.
  const reasons = new Map();
  for (let pass = 0; pass < 3; pass++) {
    const counts = sizes();
    const small = [...counts].filter(([key, size]) => key !== "shared" && size < minimum).sort((a, b) => a[1] - b[1]);
    if (!small.length) break;
    for (const [key] of small) {
      // As it is now: a group that took others in on the way is no longer small, and stays.
      const members = [...cluster].filter(([, value]) => value === key).map(([id]) => id);
      const size = members.length;
      if (!size || size >= minimum) continue;
      const pull = new Map();
      for (const id of members) {
        for (const [other, weight] of coupled.get(id) ?? []) {
          const target = cluster.get(other);
          if (target && target !== key) pull.set(target, (pull.get(target) ?? 0) + weight);
        }
      }
      const [best, weight] = [...pull].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))[0] ?? [];
      // Without coupling to anything else, they are placed like loose objects below.
      for (const id of members) {
        cluster.set(id, best);
        if (best && !reasons.has(id)) reasons.set(id, { step: "small-group", detail: { size, minimum, weight: round(weight) } });
        if (!best) reasons.delete(id);
      }
    }
  }
  // Objects without coupling: where their namespace, folder, or nearest ID points.
  const placed = [...cluster].filter(([, key]) => key).map(([id]) => byId.get(id));
  const majority = (read, value) => {
    const same = placed.filter((node) => read(node) === value);
    const [key, objects] = mostCommon(same.map((node) => cluster.get(node.id))) ?? [];
    return key === undefined ? undefined : { key, objects, of: same.length };
  };
  const numbered = placed.filter(({ objectId }) => /^\d+$/u.test(String(objectId ?? ""))).sort((a, b) => Number(a.objectId) - Number(b.objectId));
  for (const id of [...ids].filter((key) => !cluster.get(key))) {
    const node = byId.get(id);
    const folder = functionalFolder(node.file);
    const inNamespace = hasNamespace(node) ? majority((other) => other.namespace, node.namespace) : undefined;
    const inFolder = !inNamespace && folder ? majority((other) => functionalFolder(other.file), folder) : undefined;
    let key = inNamespace?.key ?? inFolder?.key;
    if (inNamespace) reasons.set(id, { step: "namespace-neighbour", detail: { namespace: node.namespace, objects: inNamespace.objects, of: inNamespace.of } });
    else if (inFolder) reasons.set(id, { step: "folder-neighbour", detail: { folder, objects: inFolder.objects, of: inFolder.of } });
    if (!key && /^\d+$/u.test(String(node.objectId ?? "")) && numbered.length) {
      const nearest = numbered.reduce((best, other) => Math.abs(Number(other.objectId) - Number(node.objectId)) < Math.abs(Number(best.objectId) - Number(node.objectId)) ? other : best);
      const distance = Math.abs(Number(nearest.objectId) - Number(node.objectId));
      if (distance <= THRESHOLDS.idDistance) {
        key = cluster.get(nearest.id);
        reasons.set(id, { step: "id-neighbour", detail: { neighbour: { id: nearest.id, label: nearest.label, objectId: nearest.objectId }, distance, limit: THRESHOLDS.idDistance } });
      }
    }
    if (!key) reasons.set(id, { step: "unconnected", detail: {} });
    cluster.set(id, key ?? "unconnected");
  }
  // Everything else is where the relations put it: how much of its coupling stays in its component.
  for (const [id, key] of cluster) {
    if (reasons.has(id) && reasons.get(id).step !== "small-group") continue;
    let inside = 0;
    let total = 0;
    for (const [other, weight] of coupled.get(id) ?? []) {
      total += weight;
      if (cluster.get(other) === key) inside += weight;
    }
    const numbers = { inside: round(inside), total: round(total), share: total ? round(inside / total, 2) : 0 };
    if (reasons.has(id)) Object.assign(reasons.get(id).detail, numbers);
    else if (hubs.has(id)) reasons.set(id, { step: "shared-core", detail: { ...hubs.get(id), ...numbers } });
    else reasons.set(id, { step: "coupling", detail: { ...numbers, start: found.start, modularity: found.modularity, scores: found.scores } });
  }

  const members = new Map();
  for (const [id, key] of cluster) {
    if (!members.has(key)) members.set(key, []);
    members.get(key).push(byId.get(id));
  }

  // 4. App candidates: whole components, by where most of their objects go at a coarser resolution.
  const coarse = communities(rest, edges.filter(({ source, target }) => !hubs.has(source) && !hubs.has(target)), { resolution: appGranularity }).of;
  const appOf = new Map();
  for (const [key, list] of members) {
    if (key === "shared" || key === "unconnected") appOf.set(key, key);
    else appOf.set(key, `a${mostCommon(list.map(({ id }) => coarse[id]))?.[0] ?? key}`);
  }
  // An app candidate too small to stand alone joins the one it is most coupled to.
  const appMinimum = Math.max(THRESHOLDS.appCandidate.objects, Math.ceil(nodes.length * THRESHOLDS.appCandidate.share));
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
  const nameOf = (key, list) => key === "shared" ? { label: "Shared", fullName: "Shared", alternatives: [], naming: roleNaming("the shared core") }
    : key === "unconnected" ? { label: "Unconnected", fullName: "Unconnected", alternatives: [], naming: roleNaming("objects without relations") } : clusterName(list, affix, depths);
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
  // The numbers that applied to this app or module, for the rationale of its components.
  const thresholds = Object.freeze({
    smallGroup: minimum,
    hub: Object.freeze(hubNeeds),
    idDistance: THRESHOLDS.idDistance,
    appCandidate: appMinimum
  });
  const result = new Map();
  for (const [key, list] of members) {
    const name = nameOf(key, list);
    for (const node of list) {
      result.set(node.id, { key: `${prefix}${key}`, shared: key === "shared", ...name, app: appNames.get(appOf.get(key)), placement: reasons.get(node.id), thresholds });
    }
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
    { name: "namespace", read: (id) => hasNamespace(byId.get(id)) ? byId.get(id).namespace.toLowerCase() : undefined },
    { name: "folder", read: (id) => functionalFolder(byId.get(id).file) }
  ];
  const found = communities(new Set(byId.keys()), inside, { candidates }).of;
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
  // Largest first; groups that would get the same name are told apart (naming.js).
  const ordered = [...members].sort((a, b) => (a[0] === "loose") - (b[0] === "loose") || b[1].length - a[1].length || a[0].localeCompare(b[0]));
  const named = ordered.map(([key, list], index) => ({
    key: key === "loose" ? "loose" : `g${index}`,
    list,
    size: list.length,
    ...(key === "loose" ? { label: "Loose", fullName: "Loose", alternatives: [], naming: roleNaming("objects without relations inside the component") } : clusterName(list, affix))
  }));
  uniqueNames(named);
  const result = new Map();
  for (const { key, list, name, label, fullName, basis, naming } of named) {
    const group = { key, label: name, fullName: name === label ? fullName : name, basis: name === label ? basis : undefined, naming };
    for (const node of list) result.set(node.id, { ...group });
  }
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
  // Nodes by normalized label and object ID, for object: selectors, which
  // fixUp adds one per misplaced object; testing each against every node of
  // the model (symbols included) was quadratic.
  let named;
  const candidatesFor = (matches) => {
    if (!matches.object) return levels.object.nodes;
    if (!named) {
      named = new Map();
      for (const other of levels.object.nodes) {
        for (const value of new Set([other.label, other.objectId].filter(Boolean).map(normalizeIdentifier))) {
          if (!named.has(value)) named.set(value, []);
          named.get(value).push(other);
        }
      }
    }
    return named.get(matches.object.name) ?? [];
  };
  const scoped = (node, selector) => {
    const { key, selector: prefix } = outer(node);
    const id = `${key}\u0000${selector}`;
    if (!scopes.has(id)) {
      const matches = compileSelector(selector, context);
      const foreign = candidatesFor(matches).some((other) => matches(other) && (other.origin !== "workspace" || outer(other).key !== key));
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
    if (count < open.length * THRESHOLDS.selectorOwnership) continue;
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
