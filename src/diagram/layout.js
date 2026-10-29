// Lays out a diagram scene (see buildScene in ../d2.js) with ELK's layered
// algorithm: groups as containers, relations routed orthogonally around
// the boxes, labels placed on their relation. The result is a drawing with
// absolute coordinates that every renderer (SVG, PDF) draws the same way.
import ELK from "elkjs/lib/elk.bundled.js";
import { textWidth, wrap } from "./text.js";

export const STYLE = Object.freeze({
  font: "Arial, Helvetica, 'Liberation Sans', sans-serif",
  text: "#1f2937",
  muted: "#4b5563",
  faint: "#6b7280",
  group: { fill: "#f8fafc", stroke: "#94a3b8", text: "#334155" },
  title: 20,
  kind: 11,
  name: 13,
  detail: 11,
  label: 10,
  groupLabel: 12,
  line: 1.3,
  pad: { x: 12, y: 9 },
  node: { min: 120, max: 264 },
  margin: 24
});

// More edges than this and the labels would cover the drawing; the color and
// the legend tell the kind, the tooltip the label.
const LABELLED_EDGES = 300;
// Up to this many relations, routes run at right angles, which reads best;
// beyond it they would detour around whole groups, so they become curves.
const ORTHOGONAL_EDGES = 120;
const DIRECTIONS = { right: "RIGHT", down: "DOWN", left: "LEFT", up: "UP" };

let elk;

/** Lines of a node: its kind and ID, its name, then its details (or, with titleFirst, the name first). */
function nodeLines(node) {
  const parts = node.label.split("\n");
  const [kind = "", name = "", ...details] = node.titleFirst ? ["", ...parts] : parts;
  const inner = STYLE.node.max - STYLE.pad.x * 2;
  const lines = [
    ...wrap(kind, inner, STYLE.kind).map((text) => ({ text, size: STYLE.kind, color: node.stroke })),
    ...wrap(name, inner, STYLE.name, { bold: true }).map((text) => ({ text, size: STYLE.name, bold: true, color: STYLE.text })),
    ...details.flatMap((detail) => wrap(detail, inner, STYLE.detail)).map((text) => ({ text, size: STYLE.detail, color: STYLE.muted }))
  ].filter(({ text }) => text);
  const width = Math.max(...lines.map(({ text, size, bold }) => textWidth(text, size, { bold })), 0) + STYLE.pad.x * 2;
  const height = lines.reduce((total, { size }) => total + size * STYLE.line, 0) + STYLE.pad.y * 2;
  return { lines, width: Math.min(STYLE.node.max, Math.max(STYLE.node.min, Math.ceil(width))), height: Math.ceil(height) };
}

/**
 * @param scene from buildScene
 * @returns { width, height, title, empty, groups, nodes, edges, legend }
 */
export async function layoutScene(scene) {
  elk ??= new ELK();
  const sized = new Map();
  for (const group of scene.groups) {
    for (const node of group.nodes) sized.set(node.path, { ...node, group: group.key, ...nodeLines(node) });
  }
  const edges = scene.edges.filter(({ from, to }) => sized.has(from) && sized.has(to));
  const labelled = edges.length <= LABELLED_EDGES;
  const curved = edges.length > ORTHOGONAL_EDGES;
  const groupPadding = `[top=${STYLE.groupLabel + 20},left=14,bottom=14,right=14]`;
  const graph = {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": DIRECTIONS[scene.direction] ?? "RIGHT",
      "elk.hierarchyHandling": "INCLUDE_CHILDREN",
      "elk.edgeRouting": curved ? "SPLINES" : "ORTHOGONAL",
      "elk.spacing.nodeNode": "28",
      "elk.layered.spacing.nodeNodeBetweenLayers": "56",
      "elk.spacing.edgeNode": "14",
      "elk.spacing.edgeEdge": "8",
      "elk.layered.spacing.edgeNodeBetweenLayers": "18",
      "elk.spacing.edgeLabel": "2",
      "elk.edgeLabels.placement": "CENTER",
      "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
      "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
      "elk.layered.thoroughness": String(sized.size > 400 ? 2 : 7),
      "elk.padding": "[top=0,left=0,bottom=0,right=0]",
      // Relations inside a group would otherwise come back relative to the group.
      "elk.json.edgeCoords": "ROOT"
    },
    // A bare group has no frame: its nodes sit directly in the drawing.
    children: scene.groups.flatMap((group) => {
      const children = group.nodes.map((node) => ({ id: node.path, width: sized.get(node.path).width, height: sized.get(node.path).height }));
      return group.bare ? children : [{ id: group.key, layoutOptions: { "elk.padding": groupPadding }, children }];
    }),
    edges: edges.map((edge, index) => ({
      id: `e${index}`,
      sources: [edge.from],
      targets: [edge.to],
      labels: labelled && edge.label
        ? [{ text: edge.label, width: Math.ceil(textWidth(edge.label, STYLE.label) + 8), height: Math.ceil(STYLE.label * 1.4) }]
        : []
    }))
  };
  const result = await elk.layout(graph);

  const top = STYLE.margin + (scene.title ? STYLE.title * 1.5 : 0);
  const left = STYLE.margin;
  const groups = [];
  const nodes = [];
  const sources = new Map(scene.groups.map((group) => [group.key, group]));
  for (const group of result.children) {
    if (sized.has(group.id)) {
      nodes.push({ ...sized.get(group.id), x: left + group.x, y: top + group.y });
      continue;
    }
    const source = sources.get(group.id);
    groups.push({ key: source.key, label: source.label, dash: source.dash, external: Boolean(source.external), x: left + group.x, y: top + group.y, width: group.width, height: group.height });
    for (const child of group.children ?? []) {
      nodes.push({ ...sized.get(child.id), x: left + group.x + child.x, y: top + group.y + child.y });
    }
  }
  const laidEdges = result.edges.map((edge, index) => {
    const points = (edge.sections ?? []).flatMap((section, position) => [
      ...(position === 0 ? [section.startPoint] : []),
      ...(section.bendPoints ?? []),
      section.endPoint
    ]).map(({ x, y }) => ({ x: left + x, y: top + y }));
    const label = edge.labels?.[0];
    return {
      ...edges[index],
      points,
      // Curved routes are cubic Béziers: after the start, control points come in threes.
      ...(curved ? { curved: true } : {}),
      ...(label ? { labelBox: { x: left + label.x, y: top + label.y, width: label.width, height: label.height } } : {})
    };
  });

  let width = Math.max(result.width ?? 0, scene.title ? textWidth(scene.title, STYLE.title, { bold: true }) : 0) + STYLE.margin * 2;
  let height = top + (result.height ?? 0) + STYLE.margin;
  let empty;
  if (scene.empty) {
    empty = { text: scene.empty, x: left, y: top + 6 };
    width = Math.max(width, textWidth(scene.empty, 14) + STYLE.margin * 2);
    height = Math.max(height, top + 40);
  }
  const legend = scene.legend?.kinds.length ? legendBox(scene.legend, left, height, Math.max(width - STYLE.margin * 2, 360)) : undefined;
  if (legend) {
    height = legend.y + legend.height + STYLE.margin;
    width = Math.max(width, legend.x + legend.width + STYLE.margin);
  }
  return {
    width: Math.ceil(width),
    height: Math.ceil(height),
    title: scene.title ? { text: scene.title, x: left, y: STYLE.margin + STYLE.title } : undefined,
    empty,
    groups,
    nodes,
    edges: laidEdges,
    legend,
    labelled
  };
}

/** The legend: one sample line per relation kind, then the notes, wrapped to the drawing's width. */
function legendBox(legend, x, y, maxWidth) {
  const pad = 10;
  const rowHeight = 18;
  const items = legend.kinds.map((kind) => ({ ...kind, width: 30 + textWidth(kind.kind, 11) + 16 }));
  const rows = [];
  let row = [];
  let used = 0;
  const inner = Math.min(maxWidth, 760) - pad * 2;
  for (const item of items) {
    if (row.length && used + item.width > inner) {
      rows.push(row);
      row = [];
      used = 0;
    }
    row.push({ ...item, offset: used });
    used += item.width;
  }
  if (row.length) rows.push(row);
  const notes = legend.notes.flatMap((note) => wrap(note, inner, 10));
  const contentWidth = Math.max(...rows.map((items) => items.reduce((total, { width }) => total + width, 0)), ...notes.map((note) => textWidth(note, 10)), textWidth("Legend", 11, { bold: true }));
  return {
    x,
    y,
    width: Math.ceil(contentWidth + pad * 2),
    height: Math.ceil(pad * 2 + 16 + rows.length * rowHeight + notes.length * 13 + 4),
    pad,
    rowHeight,
    rows,
    notes
  };
}
