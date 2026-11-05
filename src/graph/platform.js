import fs from "node:fs/promises";
import path from "node:path";
import { MAX_DIAGRAM_NODES, renderScene } from "../diagram/index.js";

export const GRAPH_RENDER_FORMATS = Object.freeze(["json", "dot", "svg", "html"]);
const SLICE_SCHEMA = "bc-atlas.graph.slice";

function integer(value, name, fallback) {
  const number = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(number) || number < 0 || value === "") {
    throw new Error(`${name} must be a nonnegative integer`);
  }
  return number;
}

function validateGraph(graph) {
  if (!Array.isArray(graph?.nodes) || !Array.isArray(graph?.edges) || !graph.nodes.length) {
    throw new Error("graph must contain a nonempty nodes array and an edges array");
  }
  const ids = new Set();
  for (const node of graph.nodes) {
    if (!node || typeof node.id !== "string" || !node.id || typeof node.label !== "string" || ids.has(node.id)) {
      throw new Error(`invalid or duplicate graph node: ${node?.id}`);
    }
    ids.add(node.id);
  }
  const edgeIds = new Set();
  for (const edge of graph.edges) {
    if (!edge || typeof edge.id !== "string" || !edge.id || edgeIds.has(edge.id) || !ids.has(edge.source) || !ids.has(edge.target)) {
      throw new Error(`invalid graph edge or missing endpoint: ${edge?.id}`);
    }
    edgeIds.add(edge.id);
  }
}

/** Loads a saved Atlas graph or a nodes/edges snapshot, without reading AL. */
export async function queryGraph(input, values = {}) {
  const document = JSON.parse(await fs.readFile(input, "utf8"));
  if (!document || document.schemaVersion !== 1 || (document.schema && !["bc-atlas.graph", SLICE_SCHEMA].includes(document.schema))) {
    throw new Error("unsupported graph schema; expected version 1 of bc-atlas.graph or a nodes/edges snapshot");
  }
  const level = values.level ?? "object";
  let graph = document;
  let frame;
  if (document.schema === "bc-atlas.graph") {
    graph = document.levels?.[level];
    if (!graph) throw new Error(`unknown graph level: ${level}`);
    const frames = document.timeline?.frames;
    if (!Array.isArray(frames) || !frames.length) throw new Error("graph timeline must contain frames");
    frame = integer(values.frame, "frame", frames.length - 1);
    if (frame >= frames.length) throw new Error(`frame must be between 0 and ${frames.length - 1}`);
    validateGraph(graph);
    const present = (item) => {
      if (!Array.isArray(item.presence) || item.presence.some((span) =>
        !Array.isArray(span) || span.length !== 2 || !Number.isInteger(span[0]) || span[0] < 0 ||
        (span[1] !== null && (!Number.isInteger(span[1]) || span[1] <= span[0]))
      )) throw new Error(`invalid presence spans for ${item.id}`);
      return item.presence.some(([start, end]) => start <= frame && (end === null || frame < end));
    };
    graph = { nodes: graph.nodes.filter(present), edges: graph.edges.filter(present) };
  } else if (values.frame !== undefined || (values.level !== undefined && values.level !== "object")) {
    throw new Error("frame and non-object level selections require a temporal bc-atlas.graph document");
  }
  validateGraph(graph);
  const roots = new Set();
  const selectors = values.root === undefined ? [] : [values.root].flat();
  const rootGroups = document.roots ?? {};
  if (typeof rootGroups !== "object" || Array.isArray(rootGroups) || Object.values(rootGroups).some((ids) =>
    !Array.isArray(ids) || ids.some((id) => typeof id !== "string" || !id)
  )) throw new Error("invalid graph root groups; expected named arrays of node IDs");
  if (document.schema === SLICE_SCHEMA && (!Array.isArray(document.selection?.roots) ||
    document.selection.roots.some((id) => !graph.nodes.some((node) => node.id === id))
  )) throw new Error("invalid graph slice selection roots");
  if (values.rootGroup !== undefined) {
    const group = rootGroups[values.rootGroup];
    if (!Array.isArray(group) || !group.length) throw new Error(`unknown or empty root group: ${values.rootGroup}`);
    selectors.push(...group);
  }
  for (const selector of selectors) {
    const exact = graph.nodes.find(({ id }) => id === selector);
    const matches = exact ? [exact] : graph.nodes.filter(({ label, atlasKey }) => label === selector || atlasKey === selector);
    if (matches.length !== 1) throw new Error(`root "${selector}" is ${matches.length ? "ambiguous; use a node ID" : "not present in the selected graph"}`);
    roots.add(matches[0].id);
  }
  const depth = integer(values.depth, "depth", 1);
  const direction = values.direction ?? "outgoing";
  if (!["outgoing", "incoming", "both"].includes(direction)) throw new Error(`unsupported graph direction: ${direction}`);
  const kinds = values.kind === undefined ? [] : [values.kind].flat();
  const edges = graph.edges.filter((edge) => !kinds.length || kinds.some((kind) =>
    Object.hasOwn(edge.kinds ?? {}, kind) || edge.kind === kind
  ));
  const selected = new Set(roots);
  const selectedEdges = new Set();
  if (roots.size) {
    const adjacency = new Map(graph.nodes.map(({ id }) => [id, []]));
    for (const edge of edges) {
      if (direction !== "incoming") adjacency.get(edge.source).push([edge, edge.target]);
      if (direction !== "outgoing") adjacency.get(edge.target).push([edge, edge.source]);
    }
    let frontier = [...roots];
    for (let step = 0; step < depth && frontier.length; step++) {
      const next = [];
      for (const id of frontier) {
        for (const [edge, neighbor] of adjacency.get(id)) {
          selectedEdges.add(edge.id);
          if (!selected.has(neighbor)) {
            selected.add(neighbor);
            next.push(neighbor);
          }
        }
      }
      frontier = next;
    }
  }
  const nodes = roots.size ? graph.nodes.filter(({ id }) => selected.has(id)) : graph.nodes;
  const nodeIds = new Set(nodes.map(({ id }) => id));
  const { nodes: _nodes, edges: _edges, levels: _levels, roots: _roots, selection: _selection, ...metadata } = document;
  return {
    schema: SLICE_SCHEMA,
    schemaVersion: 1,
    metadata: document.schema === SLICE_SCHEMA ? document.metadata : metadata,
    roots: Object.fromEntries(Object.entries(rootGroups).map(([name, ids]) => [name, ids.filter((id) => nodeIds.has(id))])),
    selection: document.schema === SLICE_SCHEMA && !roots.size
      ? { ...document.selection, ...(values.kind === undefined ? {} : { kinds }) }
      : { level, ...(frame === undefined ? {} : { frame }), roots: [...roots], depth, direction, kinds },
    nodes,
    edges: roots.size ? edges.filter(({ id }) => selectedEdges.has(id)) : edges
  };
}

async function writeGraphFile(input, output, content) {
  const source = await fs.realpath(input);
  let destination = path.resolve(output);
  try {
    destination = await fs.realpath(destination);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (process.platform === "win32" ? source.toLowerCase() === destination.toLowerCase() : source === destination) {
    throw new Error("graph output must not overwrite the input graph");
  }
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.writeFile(destination, content);
  return destination;
}

export async function writeGraphQuery(input, values = {}) {
  const graph = await queryGraph(input, values);
  const file = values.output ? await writeGraphFile(input, values.output, `${JSON.stringify(graph, null, 2)}\n`) : undefined;
  return { graph, file };
}

const quote = (value) => JSON.stringify(String(value));
const edgeLabel = (edge) => Object.keys(edge.kinds ?? {}).join(", ") || edge.kind || "dependency";
const nodeLabel = (node) => [node.type && `${node.type}${node.objectId ? ` ${node.objectId}` : ""}`, node.label].filter(Boolean).join("\n");
const fill = (node, roots) => roots.has(node.id) ? "#dbeafe" : node.origin === "unresolved" ? "#ffedd5" : "#f1f5f9";

function graphDot(graph, title) {
  const roots = new Set(graph.selection.roots);
  return [
    "digraph BCAtlas {",
    `graph [rankdir=LR, label=${quote(title)}, labelloc=t];`,
    'node [shape=box, style="rounded,filled"];',
    ...graph.nodes.map((node) => `${quote(node.id)} [label=${quote(nodeLabel(node))}, fillcolor=${quote(fill(node, roots))}];`),
    ...graph.edges.map((edge) => `${quote(edge.source)} -> ${quote(edge.target)} [label=${quote(edgeLabel(edge))}];`),
    "}", ""
  ].join("\n");
}

function graphScene(graph, title) {
  const roots = new Set(graph.selection.roots);
  const paths = new Map(graph.nodes.map(({ id }, index) => [id, `g0.n${index}`]));
  return {
    title, direction: "right", omitted: 0, maxEdges: graph.edges.length,
    groups: [{
      key: "g0", label: "Roots: blue | Unresolved boundaries: orange", dash: 3,
      nodes: graph.nodes.map((node, index) => ({
        key: `n${index}`, path: paths.get(node.id), object: node.id, type: node.type,
        label: nodeLabel(node), fill: fill(node, roots), stroke: "#64748b",
        tooltip: [node.id, node.file, node.line, node.origin].filter((value) => value !== undefined).join("\n")
      }))
    }],
    edges: graph.edges.map((edge) => ({
      from: paths.get(edge.source), to: paths.get(edge.target), kind: edgeLabel(edge),
      arrow: "->", label: edgeLabel(edge), color: edge.inCycle ? "#b91c1c" : "#64748b",
      tooltip: [edge.id, edge.evidenceSampled ? "Evidence sampled" : "", JSON.stringify(edge.evidence ?? [])].filter(Boolean).join("\n")
    }))
  };
}

/** Renders a query result using Atlas's local SVG renderer, or portable JSON/DOT. */
export async function renderGraph(input, values = {}) {
  const requested = path.resolve(values.output ?? "bc-atlas-graph.svg");
  const extension = path.extname(requested).slice(1).toLowerCase();
  const format = values.format ?? (extension || "svg");
  if (!GRAPH_RENDER_FORMATS.includes(format)) throw new Error(`unsupported graph format: ${format}`);
  const output = extension === format ? requested
    : `${GRAPH_RENDER_FORMATS.includes(extension) ? requested.slice(0, -extension.length - 1) : requested}.${format}`;
  const graph = await queryGraph(input, values);
  const title = values.title ?? "BC Atlas graph";
  let content;
  if (format === "json") content = `${JSON.stringify(graph, null, 2)}\n`;
  else if (format === "dot") content = graphDot(graph, title);
  else {
    const maxNodes = integer(values.maxNodes, "max-nodes", MAX_DIAGRAM_NODES);
    const maxEdges = integer(values.maxEdges, "max-edges", 5000);
    if (graph.nodes.length > maxNodes || graph.edges.length > maxEdges) {
      throw new Error(`graph has ${graph.nodes.length} nodes and ${graph.edges.length} edges; focus it with graph query/root/depth or raise max-nodes/max-edges`);
    }
    const svg = await renderScene(graphScene(graph, title), "svg");
    const escape = (value) => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
    content = format === "svg" ? svg
      : `<!doctype html>\n<html lang="en"><meta charset="utf-8"><title>${escape(title)}</title><body>${svg}</body></html>\n`;
  }
  const file = await writeGraphFile(input, output, content);
  return { output: file, format, nodes: graph.nodes.length, edges: graph.edges.length, roots: graph.selection.roots.length };
}
