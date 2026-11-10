// The Dashboard of the BC Atlas pages: everything that is a set of things
// and the relations between them (a diagram view, the architecture, the
// objects, the apps, the health findings) in one shape, so the page can
// show any of them as a 2D graph, a 3D graph, or a table, with the same
// tools, and say what each is read from.
//
// A board is { id, title, summary, nodes, edges, kinds, groups, columns,
// sources }: nodes carry a label, type, group, color, and their facts;
// edges are [from, to, kind, weight] by index.
import path from "node:path";
import { createArchitectureModel } from "../architecture.js";
import { dependencyMatrix } from "../blueprint/drilldown.js";
import { buildScene, RELATION_STYLES, TYPE_STYLES } from "../d2.js";

// The views that show the whole app; the others start from one object,
// boundary, or entry point and stay on the Diagrams page.
const VIEW_BOARDS = [
  ["project", "Project", "Every object and every relation between them.", "the objects of the AL source and all their relations"],
  ["module", "Modules", "Namespaces or folders and what they use of each other.", "the namespaces of the objects and the relations that cross them"],
  ["data", "Data", "Tables and the code that reads, writes, relates, and extends them.", "tables and the `reads`, `writes`, `relates`, and `extends` relations"],
  ["call", "Calls", "Which objects call which.", "the procedure calls and event subscriptions in the code"],
  ["contracts", "Contracts", "Interfaces and what implements them.", "`interface` objects, `implements`, and the `Implementation` of enum values"],
  ["events", "Events", "Event publishers and their subscribers.", "`[IntegrationEvent]`, `[BusinessEvent]`, and `[EventSubscriber]` procedures"],
  ["ui", "Pages", "Pages, their source tables, parts, actions, and navigation.", "pages, page extensions, their `SourceTable`, parts, and `RunObject` actions"],
  ["visibility", "Visibility", "What is public, internal, or local.", "the `Access` property and the `local`, `internal`, and `protected` procedures"]
];

const SEVERITY_COLORS = { error: "#C0392B", warning: "#B7791F", info: "#2A78D6" };
const DEPENDENCY_COLORS = { "intra-app": "#64748B", declared: "#0072B2", implicit: "#009E73", undeclared: "#C0392B", unresolved: "#B7791F" };
const NEUTRAL = "#64748B";

const HOW = ["2d", "3d", "table"];

/** What the Dashboard can show, in the order of its list. */
export function boardCatalog() {
  return [
    ...VIEW_BOARDS.map(([view, title, summary]) => ({
      id: `view:${view}`,
      group: "Diagram views",
      title,
      summary,
      // A view also has its diagram of boxes; visibility its circles.
      how: [...HOW, "diagram", ...(view === "visibility" ? ["circles"] : [])],
      default: "2d"
    })),
    { id: "architecture", group: "Architecture", title: "Components", summary: "The components in their layers and the dependencies between them, allowed or the wrong way.", how: HOW, default: "2d" },
    { id: "objects", group: "Objects and dependencies", title: "Objects", summary: "Every AL object and what it uses.", how: HOW, default: "table" },
    { id: "apps", group: "Objects and dependencies", title: "Apps", summary: "The apps of the workspace, the apps they depend on, and what they use of each other.", how: HOW, default: "3d" },
    { id: "health", group: "Health", title: "Findings", summary: "The objects with health findings and how they depend on each other.", how: HOW, default: "table" }
  ];
}

const plural = (count, word, many = `${word}s`) => `${count.toLocaleString("en-US")} ${count === 1 ? word : many}`;

/** What every page is read from: source, apps, symbols, compiler, settings. */
export function commonSources({ model, assessment }) {
  const root = assessment.context.projectRoot ?? assessment.context.options.projectRoot;
  const relative = (file) => (root ? path.relative(root, file).replaceAll("\\", "/") || file : file);
  const workspace = model.objects.filter(({ externalSymbol }) => !externalSymbol);
  const apps = (model.apps ?? []).filter(({ external }) => !external).map(({ name, version }) => [name, version].filter(Boolean).join(" "));
  const packages = (model.symbolPackages ?? []).map(({ name, version, publisher }) => [publisher, name, version].filter(Boolean).join(" ")).sort();
  const config = assessment.context.config?.path;
  return [
    ["AL source", `${plural(model.files ?? 0, "file")} with ${plural(workspace.length, "object")}`],
    ["app.json", apps.length ? apps.join(", ") : "none found"],
    ["Symbol packages", packages.length ? `${packages.length}: ${packages.slice(0, 6).join(", ")}${packages.length > 6 ? ", ..." : ""}` : "none"],
    ["AL compiler", model.al?.description ?? "not used; calls are resolved from the source"],
    ["Settings", config ? relative(config) : "no .bca.json; defaults"]
  ];
}

const nameOf = (label) => {
  const lines = String(label ?? "").split("\n");
  return lines[1] ?? lines[0] ?? "";
};

/** Edges by index, their kinds in a table. */
function edgeTable(edges, indexOf, styleOf) {
  const kinds = [];
  const position = new Map();
  const rows = [];
  for (const edge of edges) {
    const from = indexOf.get(edge.from);
    const to = indexOf.get(edge.to);
    if (from === undefined || to === undefined || from === to) continue;
    if (!position.has(edge.kind)) {
      position.set(edge.kind, kinds.length);
      kinds.push({ kind: edge.kind, ...styleOf(edge) });
    }
    rows.push([from, to, position.get(edge.kind), edge.weight ?? 1]);
  }
  return { edges: rows, kinds };
}

function groupTable(nodes) {
  const groups = [...new Set(nodes.map(({ group }) => group ?? ""))].sort((a, b) => a.localeCompare(b));
  const position = new Map(groups.map((group, index) => [group, index]));
  return { groups, nodes: nodes.map((node) => ({ ...node, group: position.get(node.group ?? "") })) };
}

function assemble(entry, nodes, edges, styleOf, extra = {}) {
  const table = groupTable(nodes);
  const indexOf = new Map(table.nodes.map(({ id }, index) => [id, index]));
  return { id: entry.id, title: entry.title, summary: entry.summary, ...table, ...edgeTable(edges, indexOf, styleOf), columns: [], ...extra };
}

async function viewBoard(workspace, entry, view) {
  const projection = await createArchitectureModel(workspace.input, { ...workspace.values, view }, { cache: workspace.cache, parseCache: await workspace.parseCache() });
  const { model } = projection;
  if (!model.objects.length) return { id: entry.id, title: entry.title, summary: entry.summary, nodes: [], edges: [], kinds: [], groups: [], columns: [], empty: model.emptyMessage ?? "No matching objects." };
  // Every relation, not only the first maxEdges of a drawing.
  const scene = buildScene(model, { ...projection.renderOptions, maxEdges: Math.max(model.edges.length, 1), showLegend: false });
  const byKey = new Map(model.objects.map((object) => [object.key, object]));
  const pages = new Set((await workspace.objectIndex()).list.map(({ id }) => id));
  const nodes = scene.groups.flatMap((group) => group.nodes.map((node) => {
    const object = byKey.get(node.object);
    return {
      id: node.path,
      label: nameOf(node.label),
      type: node.type,
      group: group.label,
      color: node.stroke,
      // A box that stands for an AL object opens its page.
      ...(node.object && pages.has(node.object) ? { page: node.object } : {}),
      ...(object?.level ? { level: object.level, canBe: object.canBe ?? "" } : {}),
      ...(object?.members?.length ? { objects: object.members.length } : {})
    };
  }));
  const columns = view === "visibility" ? [{ key: "level", label: "Level" }, { key: "canBe", label: "Can be" }]
    : view === "module" ? [{ key: "objects", label: "Objects", numeric: true }] : [];
  return assemble(entry, nodes, scene.edges, ({ color, dash }) => ({ color, ...(dash ? { dash: true } : {}) }), { columns });
}

async function architectureBoard(workspace, entry) {
  const assessment = await workspace.assessment();
  const matrix = dependencyMatrix(assessment);
  const nodes = assessment.result.components.map((component) => ({
    id: component.name,
    label: component.name,
    type: "component",
    group: component.layer === undefined ? "No layer" : `Layer ${component.layer}`,
    color: component.violations ? SEVERITY_COLORS.error : "#4E5D78",
    component: component.name,
    objects: component.metrics?.objects ?? 0,
    wrongWay: component.violations ?? 0,
    instability: component.metrics?.instability ?? 0,
    canBeApp: component.extractable ? "yes" : "no"
  }));
  const edges = matrix.order.flatMap((from, row) => matrix.order.flatMap((to, column) => {
    const cell = matrix.cells[row][column];
    if (!cell || (!cell.links && !cell.wrong)) return [];
    return [{ from, to, kind: cell.wrong ? "wrong way" : cell.allowed ? "allowed" : "not declared", weight: cell.links || cell.wrong }];
  }));
  const colors = { "wrong way": SEVERITY_COLORS.error, allowed: "#0072B2", "not declared": SEVERITY_COLORS.warning };
  return assemble(entry, nodes, edges, ({ kind }) => ({ color: colors[kind] }), {
    columns: [{ key: "objects", label: "Objects", numeric: true }, { key: "wrongWay", label: "Wrong way", numeric: true }, { key: "instability", label: "Instability", numeric: true }, { key: "canBeApp", label: "Can be an app" }],
    note: assessment.proposal ? "No architecture is configured; this is a proposal." : undefined
  });
}

const dominant = (kinds) => Object.entries(kinds ?? {}).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "uses";

async function objectsBoard(workspace, entry, { findings } = {}) {
  const assessment = await workspace.assessment();
  const index = await workspace.objectIndex();
  const apps = new Map(assessment.levels.app.nodes.map(({ id, label }) => [id, label]));
  const counts = new Map();
  if (findings) {
    for (const finding of (await workspace.healthReport()).findings) {
      if (!finding.object) continue;
      const entryCounts = counts.get(finding.object) ?? counts.set(finding.object, { error: 0, warning: 0, info: 0 }).get(finding.object);
      entryCounts[finding.severity] = (entryCounts[finding.severity] ?? 0) + 1;
    }
  }
  const worst = (count) => (count.error ? "error" : count.warning ? "warning" : "info");
  const nodes = index.list.filter(({ id }) => !findings || counts.has(id)).map((object) => ({
    id: object.id,
    label: object.label,
    type: object.type,
    group: findings ? worst(counts.get(object.id)) : object.component ?? object.namespace ?? "",
    color: findings ? SEVERITY_COLORS[worst(counts.get(object.id))] : TYPE_STYLES[object.type]?.[1] ?? NEUTRAL,
    page: object.id,
    objectId: object.objectId ?? "",
    namespace: object.namespace ?? "",
    app: object.app ?? "",
    ...(object.component ? { component: object.component } : {}),
    ...(findings ? { errors: counts.get(object.id).error, warnings: counts.get(object.id).warning, infos: counts.get(object.id).info } : { wrongWay: object.violations })
  }));
  const edges = assessment.levels.object.edges.map((edge) => ({ from: edge.source, to: edge.target, kind: dominant(edge.kinds), weight: edge.weight }));
  return assemble(entry, nodes, edges, ({ kind }) => ({ color: RELATION_STYLES[kind]?.color ?? NEUTRAL }), {
    columns: [
      { key: "objectId", label: "ID", numeric: true },
      { key: "namespace", label: "Namespace" },
      ...(apps.size > 1 ? [{ key: "app", label: "App" }] : []),
      ...(findings
        ? [{ key: "errors", label: "Errors", numeric: true }, { key: "warnings", label: "Warnings", numeric: true }, { key: "infos", label: "Infos", numeric: true }]
        : [{ key: "wrongWay", label: "Wrong way", numeric: true }])
    ],
    ...(findings && !nodes.length ? { empty: "No health findings on objects." } : {})
  });
}

async function appsBoard(workspace, entry) {
  const { levels } = await workspace.assessment();
  const nodes = levels.app.nodes.map((app) => ({
    id: app.id,
    label: app.label,
    type: "app",
    group: app.origin === "workspace" ? "This workspace" : "Dependencies",
    color: app.origin === "workspace" ? "#0072B2" : NEUTRAL,
    publisher: app.publisher ?? "",
    version: app.version ?? "",
    objects: app.objectCount ?? 0
  }));
  const edges = levels.app.edges.map((edge) => ({ from: edge.source, to: edge.target, kind: edge.dependency ?? "uses", weight: edge.weight }));
  return assemble(entry, nodes, edges, ({ kind }) => ({ color: DEPENDENCY_COLORS[kind] ?? NEUTRAL }), {
    columns: [{ key: "publisher", label: "Publisher" }, { key: "version", label: "Version" }, { key: "objects", label: "Objects", numeric: true }]
  });
}

const READS = {
  architecture: "the components of `architecture` in .bca.json (or the proposal), and the relations between the objects assigned to them",
  objects: "every AL object and the relations between them: calls, data access, events, extensions, and more",
  apps: "`app.json` of every app, its `dependencies`, and the relations between objects of different apps",
  health: "the findings of `bca check` (rules, AL compiler, analyzers) and the objects they are on"
};

/**
 * One board for the Dashboard.
 * @param workspace the analyzed project (workspace.js)
 * @param id an id of boardCatalog()
 */
export async function createBoard(workspace, id) {
  const entry = boardCatalog().find((candidate) => candidate.id === id);
  if (!entry) throw new Error(`unknown board "${id}"`);
  const view = id.startsWith("view:") ? id.slice(5) : undefined;
  const board = view ? await viewBoard(workspace, entry, view)
    : id === "architecture" ? await architectureBoard(workspace, entry)
      : id === "apps" ? await appsBoard(workspace, entry)
        : await objectsBoard(workspace, entry, { findings: id === "health" });
  const [{ model }, assessment] = await Promise.all([workspace.model(), workspace.assessment()]);
  const reads = view ? VIEW_BOARDS.find(([name]) => name === view)[3] : READS[id];
  return {
    ...board,
    how: entry.how,
    // What this board is read from, then what every page is read from.
    sources: [["This content", reads], ...commonSources({ model, assessment })],
    ...(view ? { command: `bca export --view ${view}` } : id === "architecture" ? { command: "bca architecture" } : id === "health" ? { command: "bca check" } : {})
  };
}
