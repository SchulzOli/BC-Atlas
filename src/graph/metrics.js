import Graph from "graphology";
import louvain from "graphology-communities-louvain";
import pagerank from "graphology-metrics/centrality/pagerank.js";
import { findCycles } from "../insights.js";
import { coupling, COUPLING_WEIGHTS } from "./coupling.js";

// PageRank and communities follow coupling, not the number of references: a
// permission set that grants 500 objects does not make them a community.
function toGraph(level) {
  const graph = new Graph({ type: "directed", allowSelfLoops: false });
  for (const node of level.nodes) graph.addNode(node.id);
  for (const edge of level.edges) {
    if (graph.hasNode(edge.source) && graph.hasNode(edge.target) && edge.source !== edge.target && edge.coupling > 0) {
      graph.mergeEdge(edge.source, edge.target, { weight: edge.coupling });
    }
  }
  return graph;
}

/**
 * Build layer: 0 for nodes without dependencies, otherwise one more than the
 * deepest dependency. Cycle members share a layer, so the result is the order
 * in which the graph can be built bottom-up.
 */
function buildLayers(graph, cycles) {
  const component = new Map();
  cycles.forEach((members, index) => members.forEach((key) => component.set(key, `cycle:${index}`)));
  const groupOf = (key) => component.get(key) ?? key;
  const members = new Map();
  graph.forEachNode((key) => {
    const group = groupOf(key);
    if (!members.has(group)) members.set(group, []);
    members.get(group).push(key);
  });
  const layer = new Map();
  const visiting = new Set();
  const visit = (group) => {
    if (layer.has(group)) return layer.get(group);
    if (visiting.has(group)) return 0;
    visiting.add(group);
    let depth = 0;
    for (const key of members.get(group)) {
      for (const target of graph.outNeighbors(key)) {
        const targetGroup = groupOf(target);
        if (targetGroup !== group) depth = Math.max(depth, visit(targetGroup) + 1);
      }
    }
    visiting.delete(group);
    layer.set(group, depth);
    return depth;
  };
  for (const group of members.keys()) visit(group);
  return (key) => layer.get(groupOf(key)) ?? 0;
}

/**
 * Adds coupling to every edge, and degree, cross-app degree, PageRank,
 * community, cycle, and build-layer metrics to every node.
 * @param options { weights } coupling weights per relation kind
 */
export function addMetrics(level, { weights = COUPLING_WEIGHTS } = {}) {
  for (const edge of level.edges) edge.coupling = edge.kinds && Object.keys(edge.kinds).length ? coupling(edge.kinds, weights) : edge.weight || 1;
  const graph = toGraph(level);
  const cycles = findCycles(
    level.nodes.map(({ id }) => ({ key: id })),
    level.edges.map(({ source, target }) => ({ from: source, to: target }))
  );
  const cycleOf = new Map();
  cycles.forEach((members, index) => members.forEach((key) => cycleOf.set(key, index)));
  const layerOf = buildLayers(graph, cycles);
  const rank = graph.size ? pagerank(graph, { getEdgeWeight: "weight" }) : {};
  const communities = graph.size ? louvain(graph, { getEdgeWeight: "weight", rng: seededRandom(7) }) : {};
  // Degrees count every dependency, including the ones without coupling.
  const degree = new Map();
  for (const edge of level.edges) {
    if (edge.source === edge.target) continue;
    for (const [key, side] of [[edge.source, "out"], [edge.target, "in"]]) {
      if (!degree.has(key)) degree.set(key, { in: new Set(), out: new Set() });
      degree.get(key)[side].add(side === "out" ? edge.target : edge.source);
    }
  }
  for (const [key, value] of degree) degree.set(key, { in: value.in.size, out: value.out.size });
  const inter = new Map();
  for (const edge of level.edges) {
    if (edge.scope !== "inter-app") continue;
    const source = inter.get(edge.source) ?? { in: 0, out: 0 };
    source.out++;
    inter.set(edge.source, source);
    const target = inter.get(edge.target) ?? { in: 0, out: 0 };
    target.in++;
    inter.set(edge.target, target);
  }
  for (const node of level.nodes) {
    node.metrics = {
      inDegree: degree.get(node.id)?.in ?? 0,
      outDegree: degree.get(node.id)?.out ?? 0,
      crossAppIn: inter.get(node.id)?.in ?? 0,
      crossAppOut: inter.get(node.id)?.out ?? 0,
      pagerank: Number((rank[node.id] ?? 0).toFixed(6)),
      community: communities[node.id] ?? 0,
      buildLayer: layerOf(node.id),
      ...(cycleOf.has(node.id) ? { cycle: cycleOf.get(node.id) } : {})
    };
  }
  for (const edge of level.edges) {
    if (cycleOf.has(edge.source) && cycleOf.get(edge.source) === cycleOf.get(edge.target)) edge.inCycle = true;
  }
  return { cycles: cycles.length, layers: Math.max(0, ...level.nodes.map(({ metrics }) => metrics.buildLayer)) + 1 };
}

// Louvain is randomized; a fixed seed keeps generated files stable.
function seededRandom(seed) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}
