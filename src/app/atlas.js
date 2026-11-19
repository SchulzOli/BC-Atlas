// The atlas: everything BC Atlas reads from the AL source as ONE graph.
//
// The source code is the only fact. Apps, components, namespaces, objects,
// and health rules are nodes; what they do with each other are
// relations. A lens selects a part of that graph (the data, the events, the
// architecture, the findings), a story walks through it step by
// step, and a finding points at the nodes it is about. The one view of the
// app (src/app/ui) draws any lens as a 2D graph, a diagram, or a 3D graph.
//
// {
//   nodes:     [{ id, kind, label, type?, ...facts }]
//   relations: [{ kind, color, dash? }]            the kinds of relation
//   edges:     [[from, to, relation, weight]]      by index
//   lenses:    [{ id, title, summary, kinds, relations, ... }]
//   findings:  [{ severity, rule, message, fix?, nodes: [index], file?, line? }]
//   stories:   [{ id, title, summary, kind, steps: [{ title, text, lens, nodes: [index] }] }]
// }
import { architectureForView } from "./architecture.js";
import path from "node:path";
import { dependencyMatrix } from "../blueprint/drilldown.js";
import { RELATION_STYLES, TYPE_STYLES } from "../d2.js";
import { analyzeVisibility, LEVEL_COLORS } from "../visibility.js";

const NEUTRAL = "#64748B";
const SEVERITY_COLORS = { error: "#C0392B", warning: "#B7791F", info: "#2A78D6" };
const KIND_COLORS = {
  app: "#0072B2",
  component: "#4E5D78",
  module: "#4E5D78",
  rule: "#B7791F"
};
// Relations the atlas adds to those of the AL source (src/d2.js).
const ATLAS_RELATIONS = {
  "depends on": { color: "#0072B2" },
  "wrong way": { color: SEVERITY_COLORS.error },
  "not declared": { color: SEVERITY_COLORS.warning, dash: true },
  declared: { color: "#0072B2" },
  implicit: { color: "#009E73" },
  undeclared: { color: SEVERITY_COLORS.error },
  unresolved: { color: SEVERITY_COLORS.warning, dash: true },
  error: { color: SEVERITY_COLORS.error },
  warning: { color: SEVERITY_COLORS.warning },
  info: { color: SEVERITY_COLORS.info },
  source: { color: "#31783B" }
};


/**
 * What the one view can show. `kinds` are the node kinds of a lens,
 * `relations` its kinds of relation ("*" for every relation between
 * objects); with `connected`, only nodes that take part in one of them show.
 * `types` keeps objects of these types even when nothing connects them;
 * `from` keeps only relations that start at an object of these types.
 */
export const LENSES = [
  { id: "overview", title: "Overview", section: "How it works", hint: "how it works, from the screens to the data", summary: "How it works, from left to right: the screens, the logic behind them, and the data.", flow: true, form: "diagram", kinds: ["object"], relations: "*", group: "kind", color: "type", reads: "the objects of the AL source and what they do with each other" },
  { id: "system", title: "System", section: "Structure", hint: "every object and every relation", summary: "Every object and every relation between them.", kinds: ["object"], relations: "*", group: "component", color: "type", reads: "the objects of the AL source and all their relations: calls, data access, events, extensions, permissions" },
  { id: "components", title: "Components", section: "Structure", hint: "the layers and their dependencies", form: "diagram", summary: "The components in their layers and the dependencies between them, allowed or the wrong way.", kinds: ["component"], relations: ["depends on", "wrong way", "not declared"], group: "layer", color: "kind", reads: "the components of `architecture` in .bca.json (or the proposal), and the relations between the objects assigned to them" },
  { id: "apps", title: "Apps", section: "Structure", hint: "the apps and what they use of each other", form: "diagram", summary: "The apps of the workspace, the apps they depend on, and what they use of each other.", kinds: ["app"], relations: ["declared", "implicit", "undeclared", "unresolved"], group: "origin", color: "kind", reads: "`app.json` of every app, its `dependencies`, and the relations between objects of different apps" },
  { id: "modules", title: "Modules", section: "Structure", hint: "namespaces and what they use", summary: "Namespaces and what they use of each other.", kinds: ["module"], relations: ["depends on"], group: "app", color: "kind", reads: "the namespaces of the objects and the relations that cross them" },
  { id: "data", title: "Data", section: "Parts", hint: "tables and the code that uses them", summary: "Tables and the code that reads, writes, relates, and extends them.", kinds: ["object"], relations: ["reads", "writes", "relates", "extends"], connected: true, types: ["table", "tableextension"], group: "component", color: "type", reads: "tables and the `reads`, `writes`, `relates`, and `extends` relations" },
  { id: "calls", title: "Calls", section: "Parts", hint: "which objects call which", summary: "Which objects call and run which.", kinds: ["object"], relations: ["calls", "runs", "starts"], connected: true, group: "component", color: "type", reads: "the procedure calls and `Run` statements in the code" },
  { id: "events", title: "Events", section: "Parts", hint: "publishers and subscribers", summary: "Event publishers and their subscribers.", kinds: ["object"], relations: ["publishes", "subscribes", "events"], connected: true, group: "component", color: "type", reads: "`[IntegrationEvent]`, `[BusinessEvent]`, and `[EventSubscriber]` procedures" },
  { id: "contracts", title: "Contracts", section: "Parts", hint: "interfaces and what implements them", summary: "Interfaces and what implements them.", kinds: ["object"], relations: ["implements", "selects"], connected: true, types: ["interface"], group: "component", color: "type", reads: "`interface` objects, `implements`, and the `Implementation` of enum values" },
  { id: "pages", title: "Pages", section: "Parts", hint: "pages, reports, and what they show", summary: "Pages and reports, and what they show, run, and contain.", kinds: ["object"], relations: "*", connected: true, from: ["page", "pageextension", "pagecustomization", "report", "reportextension"], types: ["page", "report"], group: "component", color: "type", reads: "pages, page extensions, reports, their source tables, parts, and actions" },
  { id: "security", title: "Permissions", section: "Parts", hint: "permission sets and what they permit", summary: "Permission sets and what they permit and include.", kinds: ["object"], relations: ["permits", "includes"], connected: true, types: ["permissionset"], group: "component", color: "type", reads: "`permissionset` objects, their `Permissions`, and `IncludedPermissionSets`" },
  { id: "visibility", title: "Visibility", section: "Quality", hint: "public, internal, or local", summary: "What is public, internal, or local, and what could be narrower.", kinds: ["object"], relations: "*", group: "component", color: "level", reads: "the `Access` property and the uses found from other apps and objects" },
  { id: "health", title: "Findings", section: "Quality", hint: "the rules and what they found", summary: "The rules of the health check and the objects they found.", kinds: ["rule", "object"], relations: ["error", "warning", "info"], connected: true, group: "kind", color: "severity", reads: "the findings of `bca check` (rules, AL compiler, analyzers) and the objects they are on" }
];

const plural = (count, word, many = `${word}s`) => `${Number(count).toLocaleString("en-US")} ${count === 1 ? word : many}`;
const list = (items, most = 4) => (items.length > most ? `${items.slice(0, most).join(", ")}, and ${items.length - most} more` : items.join(", "));

/** What everything is read from: source, apps, symbols, compiler, settings. */
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

/** A link to a place in the source, from the `sourceUrl` template of .bca.json. */
export function sourceUrl(template, options, file, line) {
  if (!template || !file) return undefined;
  const prefixed = [options.sourcePathPrefix, file.replaceAll("\\", "/")].filter(Boolean).join("/").replaceAll(/\/+/gu, "/");
  return template
    .replaceAll("{file}", prefixed)
    .replaceAll("{line}", String(line ?? 1))
    .replaceAll("{ref}", options.sourceRef ?? "main");
}

/** Collects nodes and relations by name, and hands out their indexes. */
function builder() {
  const nodes = [];
  const index = new Map();
  const relations = [];
  const relationIndex = new Map();
  const edges = [];
  const seen = new Map();
  return {
    nodes,
    relations,
    edges,
    has: (id) => index.has(id),
    at: (id) => index.get(id),
    node(node) {
      if (!index.has(node.id)) {
        index.set(node.id, nodes.length);
        nodes.push(node);
      }
      return index.get(node.id);
    },
    edge(from, to, kind, weight = 1) {
      const a = index.get(from);
      const b = index.get(to);
      if (a === undefined || b === undefined || a === b) return;
      if (!relationIndex.has(kind)) {
        relationIndex.set(kind, relations.length);
        const style = ATLAS_RELATIONS[kind] ?? RELATION_STYLES[kind] ?? { color: NEUTRAL };
        relations.push({ kind, color: style.color, ...(style.dash ? { dash: true } : {}) });
      }
      const relation = relationIndex.get(kind);
      const key = `${a}>${b}>${relation}`;
      if (seen.has(key)) edges[seen.get(key)][3] += weight;
      else {
        seen.set(key, edges.length);
        edges.push([a, b, relation, weight]);
      }
    }
  };
}

const compact = (object) => Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined && value !== "" && value !== null));

/** The objects of the source, their apps, components, and namespaces, and what they do with each other. */
async function structure(workspace, graph) {
  const [{ model, options }, assessment, index] = await Promise.all([workspace.model(), workspace.assessment(), workspace.objectIndex()]);
  const { levels, result } = assessment;
  const appLabel = new Map(levels.app.nodes.map(({ id, label }) => [id, label]));
  const raw = new Map(model.objects.map((object) => [object.key, object]));
  const summary = new Map(index.list.map((object) => [object.id, object]));
  let visibility = new Map();
  try {
    visibility = new Map(analyzeVisibility(model).points.filter(({ kind }) => kind === "object").map((point) => [point.id, point]));
  } catch {
    // Without levels the Visibility lens colors by type.
  }

  // Objects of the workspace, and those of other apps that the workspace refers to.
  const referred = new Set();
  const workspaceIds = new Set(levels.object.nodes.filter(({ origin }) => origin === "workspace").map(({ id }) => id));
  for (const edge of levels.object.edges) {
    if (workspaceIds.has(edge.source)) referred.add(edge.target);
    if (workspaceIds.has(edge.target)) referred.add(edge.source);
  }
  const namespaces = new Map();
  for (const node of levels.object.nodes) {
    const own = node.origin === "workspace";
    if (!own && !referred.has(node.id)) continue;
    const object = raw.get(node.id);
    const level = visibility.get(node.id);
    const meta = object?.metadata;
    graph.node(compact({
      id: node.id,
      kind: "object",
      label: node.label,
      type: node.type,
      color: own ? TYPE_STYLES[node.type]?.[1] ?? NEUTRAL : "#94A3B8",
      objectId: node.objectId,
      namespace: node.namespace,
      app: appLabel.get(node.app),
      component: result.assignment.get(node.id),
      external: own ? undefined : true,
      file: node.file,
      line: object?.location?.line ?? node.line,
      url: sourceUrl(options.sourceUrl, options, node.file, object?.location?.line ?? node.line),
      level: level?.level,
      canBe: level?.canBe,
      why: level?.why,
      caption: meta?.caption,
      about: meta?.documentation,
      access: meta?.access,
      obsolete: meta?.obsolete?.state,
      // A test codeunit tests the app; it is not part of how the app works.
      test: /^test/iu.test(meta?.subtype ?? "") ? true : undefined,
      lines: meta?.size?.lines,
      procedures: meta?.size?.procedures,
      complexity: meta?.complexity?.total,
      uses: summary.get(node.id)?.uses,
      usedBy: summary.get(node.id)?.usedBy,
      wrongWay: summary.get(node.id)?.violations || undefined
    }));
    if (own && node.namespace) {
      const key = `module::${node.app}::${node.namespace}`;
      const entry = namespaces.get(key) ?? namespaces.set(key, { id: key, namespace: node.namespace, app: appLabel.get(node.app), objects: 0 }).get(key);
      entry.objects++;
    }
  }
  const moduleOf = (node) => (node?.origin === "workspace" && node.namespace ? `module::${node.app}::${node.namespace}` : undefined);
  const objectNode = new Map(levels.object.nodes.map((node) => [node.id, node]));
  for (const module of namespaces.values()) {
    graph.node({ id: module.id, kind: "module", label: module.namespace, color: KIND_COLORS.module, app: module.app, objects: module.objects });
  }
  for (const edge of levels.object.edges) {
    for (const [kind, weight] of Object.entries(edge.kinds ?? { uses: edge.weight ?? 1 })) graph.edge(edge.source, edge.target, kind, weight);
    const from = moduleOf(objectNode.get(edge.source));
    const to = moduleOf(objectNode.get(edge.target));
    if (from && to && from !== to) graph.edge(from, to, "depends on", edge.weight ?? 1);
  }

  // Apps and what they use of each other.
  for (const app of levels.app.nodes) {
    const own = app.origin === "workspace";
    if (!own && !levels.app.edges.some((edge) => edge.source === app.id || edge.target === app.id)) continue;
    graph.node(compact({
      id: `app::${app.id}`,
      kind: "app",
      label: app.label,
      color: own ? KIND_COLORS.app : "#94A3B8",
      origin: own ? "This workspace" : "Dependencies",
      external: own ? undefined : true,
      publisher: app.publisher,
      version: app.version,
      objects: app.objectCount
    }));
  }
  for (const edge of levels.app.edges) {
    const kind = edge.dependency === "intra-app" ? undefined : edge.dependency ?? "declared";
    if (kind) graph.edge(`app::${edge.source}`, `app::${edge.target}`, kind, edge.weight ?? 1);
  }

  // Components in their layers, and the dependencies between them.
  const matrix = dependencyMatrix(assessment);
  for (const component of result.components) {
    graph.node(compact({
      id: `component::${component.name}`,
      kind: "component",
      label: component.name,
      color: component.violations ? SEVERITY_COLORS.error : KIND_COLORS.component,
      layer: component.layer === undefined ? "No layer" : `Layer ${component.layer}`,
      objects: component.metrics?.objects,
      wrongWay: component.violations || undefined,
      instability: component.metrics?.instability,
      // How much of its coupling stays inside, in percent.
      cohesion: component.metrics?.cohesion === undefined ? undefined : Math.round(component.metrics.cohesion * 100),
      cycle: component.inCycle ? "yes" : undefined,
      canBeApp: component.extractable ? "yes" : "no"
    }));
  }
  matrix.order.forEach((from, row) => matrix.order.forEach((to, column) => {
    const cell = matrix.cells[row][column];
    if (!cell || (!cell.links && !cell.wrong)) return;
    graph.edge(`component::${from}`, `component::${to}`, cell.wrong ? "wrong way" : cell.allowed ? "depends on" : "not declared", cell.links || cell.wrong);
  }));
  return { model, assessment, index };
}

/** The health findings: every rule a node, pointing at the objects it found. */
async function health(workspace, graph, findings) {
  const report = await workspace.healthReport();
  for (const finding of report.findings) {
    const rule = `rule::${finding.rule}`;
    graph.node({ id: rule, kind: "rule", label: finding.rule, color: SEVERITY_COLORS[finding.severity] ?? NEUTRAL, severity: finding.severity });
    const target = finding.object && graph.has(finding.object) ? finding.object : undefined;
    if (target) graph.edge(rule, target, finding.severity);
    findings.push(compact({
      severity: finding.severity,
      rule: finding.rule,
      message: finding.message,
      fix: finding.fix ?? finding.help,
      nodes: [graph.at(rule), ...(target ? [graph.at(target)] : [])],
      file: finding.file,
      line: finding.line,
      origin: "health"
    }));
  }
  // A rule is as severe as its worst finding.
  const rank = { error: 3, warning: 2, info: 1 };
  for (const finding of findings) {
    const node = graph.nodes[finding.nodes[0]];
    if (node?.kind === "rule" && (rank[finding.severity] ?? 0) > (rank[node.severity] ?? 0)) {
      node.severity = finding.severity;
      node.color = SEVERITY_COLORS[finding.severity];
    }
  }
  return report;
}

export const NOTHING_TO_CHANGE = "No app uses another without declaring it, no components depend on each other in a circle, no dependency points the wrong way, and no table is written from outside its component.";

/**
 * What to change in the architecture, and how: everything the analysis knows about it as one list,
 * the most important first. The view (the story "architecture"), `bca view`, the layered
 * documentation (changes.md), and agents all show this list.
 *
 * @returns [{ id, kind, title, why, how: [step], effort: "S" | "M" | "L", optional?, proposed?, brief?, lens, nodes: [index], file?, line? }]
 *   kind: architecture (decide on one), apps (what an app declares), cycle, dependency (one that points the
 *   wrong way), data (a table others write), surface (what is public without need), extract (a component
 *   that can be an app)
 */
function changes({ graph, assessment }) {
  const result = [];
  const { nodes, edges, relations } = graph;
  const outcome = assessment.result ?? {};
  const components = outcome.components ?? [];
  const index = (id) => graph.at(id);
  const component = (name) => index(`component::${name}`);
  const present = (indexes) => [...new Set(indexes.filter((at) => at !== undefined && at >= 0))];
  // An object as the analysis names it: "codeunit 50201 CON Item Sync".
  const named = (text) => nodes.findIndex((node) => node.kind === "object" && !node.external && `${node.type} ${node.objectId ? `${node.objectId} ` : ""}${node.label}` === text);
  const proposed = Boolean(assessment.proposal);
  const share = outcome.summary?.coupling?.share;
  const kindOf = (relation) => relations[relation].kind;

  // 1. Without an architecture nothing is checked: decide on one first.
  if (proposed && components.length > 1) {
    const layers = new Set(components.map(({ layer }) => layer)).size;
    result.push({
      id: "architecture",
      kind: "architecture",
      title: "Decide on the architecture",
      why: `No architecture is configured. From the code, BC Atlas proposes ${plural(components.length, "component")} in ${plural(layers, "layer")}: ${list(components.map(({ name }) => name), 8)}.${share === undefined ? "" : ` ${Math.round(share * 100)}% of the coupling stays inside them.`} Until it is saved nothing checks it, and every change below that names a component rests on this proposal.`,
      how: [
        "Look at it: the Components lens of the view, or `bca architecture`.",
        "Change what does not fit: `bca architecture --group-by namespace` (or `folder`, `app`), or name the components yourself under `architecture` in .bca.json.",
        "Save it: `bca architecture --write`.",
        "Accept today's state: `bca architecture --update-baseline`. From then on `bca check` fails only on new dependencies the wrong way."
      ],
      effort: "S",
      lens: "components",
      nodes: present(components.map(({ name }) => component(name)))
    });
  }

  // 2. What an app uses of another app without saying so, and what nobody can find.
  const between = edges.filter(([from, to]) => nodes[from].kind === "app" && nodes[to].kind === "app")
    .sort((a, b) => (kindOf(a[2]) === "unresolved") - (kindOf(b[2]) === "unresolved"));
  for (const [from, to, relation, weight] of between) {
    const [a, b] = [nodes[from], nodes[to]];
    const count = plural(weight ?? 1, "relation");
    if (kindOf(relation) === "undeclared") {
      result.push({
        id: `apps:${a.label}>${b.label}`,
        kind: "apps",
        title: `Declare that ${a.label} depends on ${b.label}`,
        why: `${a.label} uses ${b.label} (${count}), but its app.json does not name ${b.label}. It compiles only as long as something else brings ${b.label} along.`,
        how: [
          `Add ${b.label} to \`dependencies\` in the app.json of ${a.label}: its id, name, publisher, and version.`,
          `Or, when ${a.label} should not know ${b.label}: remove the use. The Apps lens shows the ${count} between them.`
        ],
        effort: "S",
        lens: "apps",
        nodes: [from, to]
      });
    } else if (kindOf(relation) === "unresolved") {
      result.push({
        id: `apps:${a.label}>unresolved`,
        kind: "apps",
        title: `Bring in what ${a.label} refers to`,
        why: `${a.label} refers to objects (${count}) that are in no app of this repository and in no symbol package. What depends on them, and what a change to them breaks, is not known.`,
        how: [
          "Download the symbols of the apps it depends on into `.alpackages` (AL: Download Symbols), or add the app that holds them to the workspace.",
          "Run BC Atlas again: the relations to these objects then show."
        ],
        effort: "S",
        lens: "apps",
        nodes: [from, to]
      });
    }
  }

  // 3. Components that depend on each other.
  for (const members of outcome.cycles ?? []) {
    const between = (outcome.edges ?? []).filter(({ source, target }) => members.includes(source) && members.includes(target));
    const thin = between.slice().sort((a, b) => a.objectEdges - b.objectEdges || a.weight - b.weight)[0];
    result.push({
      id: `cycle:${members.join(">")}`,
      kind: "cycle",
      title: `Break the cycle between ${members.join(" and ")}`,
      why: `${members.join(" and ")} depend on each other, so none of them can be understood, tested, or released without the others.${thin ? ` The way from ${thin.source} to ${thin.target} is the thinnest: ${plural(thin.objectEdges, "object dependency", "object dependencies")} (${Object.entries(thin.kinds ?? {}).map(([kind, count]) => `${count} ${kind}`).join(", ")}).` : ""}`,
      how: [
        ...(thin ? [`Cut the way from ${thin.source} to ${thin.target}: move what causes it into ${thin.target}, or let ${thin.target} raise an event or offer an interface that ${thin.source} answers.`] : ["Decide which of them is below the other, and turn the dependencies that go the other way."]),
        "The dependencies to turn are the ones the wrong way, below."
      ],
      effort: "M",
      lens: "components",
      nodes: present(members.map(component))
    });
  }

  // 4. Each dependency that points the wrong way, with the way to resolve it.
  for (const item of (outcome.workItems ?? []).slice(0, 60)) {
    const targets = (item.targets ?? []).map(({ label, type }) => `${type} ${label}`);
    result.push({
      id: `dependency:${item.id}`,
      kind: "dependency",
      title: `${item.source.label}: ${item.title[0].toLowerCase()}${item.title.slice(1)}`,
      why: `The ${item.source.type} ${item.source.label} of ${item.sourceComponent} depends on ${list(targets)} of ${item.targetComponent}${item.violations > 1 ? ` (${item.violations} dependencies)` : ""}, which the ${proposed ? "proposed" : "configured"} architecture does not allow.`,
      how: [...(item.steps ?? []), ...(item.alternatives ?? []).map((alternative) => `Or: ${alternative.title[0].toLowerCase()}${alternative.title.slice(1)} (effort ${alternative.effort}).`)],
      effort: item.effort ?? "M",
      // Against a proposal it is a suggestion; against what is configured, a violation.
      ...(proposed ? { proposed: true } : {}),
      lens: "system",
      nodes: present([index(item.source.id), ...(item.targets ?? []).map(({ label, type }) => nodes.findIndex((node) => node.kind === "object" && node.label === label && node.type === type))]),
      file: item.source.file,
      line: item.source.line
    });
  }

  // 5. A table of one component that others write.
  for (const owned of outcome.dataOwnership ?? []) {
    if (owned.status !== "shared-writes" || !owned.writers?.length) continue;
    const writers = owned.writers.map(({ component: name, objects }) => `${name} (${list(objects, 3)})`);
    result.push({
      id: `data:${owned.id}`,
      kind: "data",
      title: `Let ${owned.component} own the writes to ${owned.table}`,
      why: `The ${owned.table} belongs to ${owned.component}, and ${list(writers, 3)} ${owned.writers.length === 1 ? "writes" : "write"} it as well. Whoever changes the table has to know every one of them.`,
      brief: `of ${owned.component}, also written by ${list(writers, 3)}`,
      how: [
        `Put the writes behind a codeunit of ${owned.component} and call it from ${list(owned.writers.map(({ component: name }) => name), 3)}.`,
        `Or move the table to the component that writes it most, when it belongs there.`
      ],
      effort: "M",
      lens: "data",
      nodes: present([index(owned.id), ...owned.writers.flatMap(({ objects }) => objects.map(named))]),
      file: owned.file,
      line: owned.line
    });
  }

  // 6. What is public and used by nobody outside its component.
  for (const check of outcome.checks ?? []) {
    if (check.rule !== "could-be-internal") continue;
    const [, count, names] = check.message.match(/^(\d+) object\(s\) of .+? could be Access = Internal: (.+)$/u) ?? [];
    if (!count) continue;
    result.push({
      id: `surface:${check.component}`,
      kind: "surface",
      title: `Make ${plural(Number(count), "object")} of ${check.component} internal`,
      why: `Nothing outside ${check.component} uses ${names}. As long as ${Number(count) === 1 ? "it is" : "they are"} public, other apps can start to depend on ${Number(count) === 1 ? "it" : "them"}, and every change is a breaking one.`,
      how: [
        "Set `Access = Internal` on these objects.",
        "List what other components use under `exposes` of the component in .bca.json."
      ],
      effort: "S",
      optional: true,
      lens: "visibility",
      nodes: present([component(check.component), ...names.split(", ").map(named)])
    });
  }

  // 7. A component that could be an app of its own.
  const apps = nodes.filter((node) => node.kind === "app" && !node.external && (!node.origin || node.origin === "This workspace")).length;
  for (const part of components) {
    // A component that is one app already is one.
    if (!part.extractable || (part.match ?? []).every((selector) => String(selector).startsWith("app:")) || components.length <= apps) continue;
    const cohesion = part.metrics?.cohesion;
    result.push({
      id: `extract:${part.name}`,
      kind: "extract",
      title: `${part.name} can become an app of its own`,
      why: `${part.name} (${plural(part.metrics?.objects ?? 0, "object")}) ${part.dependsOnActual?.length ? `depends only on ${list(part.dependsOnActual)}` : "depends on no other component"}, nothing it uses points back at it${cohesion === undefined ? "" : `, and ${Math.round(cohesion * 100)}% of its coupling stays inside`}. An app of its own is built, tested, and released on its own.`,
      how: [`\`bca architecture --extract "${part.name}"\` writes the plan: what blocks it, its app.json, the tables to move, and the steps in order.`],
      effort: "L",
      optional: true,
      lens: "components",
      nodes: present([component(part.name)])
    });
  }
  return result;
}

/** The stories: walks through the graph that explain, document, test, and demonstrate the system. */
function stories({ graph, findings, report, assessment, title, changed = [], lensIds = new Set() }) {
  const result = [];
  const { nodes, edges, relations } = graph;
  const objects = nodes.map((node, index) => ({ node, index })).filter(({ node }) => node.kind === "object" && !node.external);
  const relationOf = (kind) => relations.findIndex((relation) => relation.kind === kind);
  const ends = (kinds) => {
    const wanted = new Set(kinds.map(relationOf).filter((position) => position >= 0));
    const found = new Set();
    for (const [from, to, relation] of edges) {
      if (!wanted.has(relation)) continue;
      found.add(from);
      found.add(to);
    }
    return [...found];
  };
  const names = (indexes, most) => list(indexes.map((index) => nodes[index].label), most);
  const ofType = (...types) => objects.filter(({ node }) => types.includes(node.type)).map(({ index }) => index);

  // 1. The system, from the outside in.
  const tour = [];
  const byType = new Map();
  for (const { node } of objects) byType.set(node.type, (byType.get(node.type) ?? 0) + 1);
  const apps = nodes.map((node, index) => ({ node, index })).filter(({ node }) => node.kind === "app" && !node.external);
  // First how it works: the screens, the logic behind them, and the data.
  const own = objects.filter(({ node }) => !node.test);
  const of = (...types) => own.filter(({ node }) => types.includes(node.type)).length;
  const parts = [
    [of("page", "pageextension", "pagecustomization", "report", "reportextension", "requestpage"), "screen"],
    [of("codeunit", "query", "xmlport", "interface"), "logic object"],
    [of("table", "tableextension"), "table"]
  ].filter(([count]) => count);
  tour.push({
    title: "How it works",
    text: `From left to right: ${parts.map(([count, one, many]) => plural(count, one, many)).join(", ")}. The screens run the logic, and the logic reads and writes the data. A line leads from what uses to what is used.`,
    lens: "overview",
    nodes: []
  });
  tour.push({
    title,
    text: `${plural(objects.length, "object")} in ${plural(apps.length, "app")}: ${[...byType].sort((a, b) => b[1] - a[1]).map(([type, count]) => `${count} ${type}${count === 1 ? "" : "s"}`).join(", ")}. Every dot is one of them, every line something one does with another. All of it is read from the AL source.`,
    lens: "system",
    nodes: []
  });
  if (apps.length > 1) {
    tour.push({ title: "The apps", text: `${names(apps.map(({ index }) => index), 6)}. A line is what one app uses of another.`, lens: "apps", nodes: apps.map(({ index }) => index) });
  }
  const components = nodes.map((node, index) => ({ node, index })).filter(({ node }) => node.kind === "component");
  if (components.length > 1) {
    tour.push({
      title: `${plural(components.length, "component")}${assessment.proposal ? " (proposed)" : ""}`,
      text: `${names(components.map(({ index }) => index), 8)}. ${assessment.proposal ? "No architecture is configured, so this is what BC Atlas proposes from the code. " : ""}Lower layers know nothing of higher ones.`,
      lens: "components",
      nodes: components.map(({ index }) => index)
    });
    for (const { node } of components.slice().sort((a, b) => (b.node.objects ?? 0) - (a.node.objects ?? 0)).slice(0, 6)) {
      const members = objects.filter(({ node: object }) => object.component === node.label).map(({ index }) => index);
      if (!members.length) continue;
      tour.push({ title: node.label, text: `${plural(members.length, "object")}: ${names(members, 5)}.${node.wrongWay ? ` ${plural(node.wrongWay, "dependency", "dependencies")} point the wrong way.` : ""}`, lens: "system", nodes: members });
    }
  }
  const hubs = objects.slice().sort((a, b) => ((b.node.uses ?? 0) + (b.node.usedBy ?? 0)) - ((a.node.uses ?? 0) + (a.node.usedBy ?? 0))).slice(0, 5).filter(({ node }) => (node.uses ?? 0) + (node.usedBy ?? 0) > 0);
  if (hubs.length) {
    tour.push({ title: "What everything depends on", text: `${hubs.map(({ node }) => `${node.label} (used by ${node.usedBy ?? 0}, uses ${node.uses ?? 0})`).join("; ")}. A change here reaches furthest.`, lens: "system", nodes: hubs.map(({ index }) => index) });
  }
  const tables = ofType("table", "tableextension");
  if (tables.length) {
    tour.push({ title: "The data", text: `${plural(tables.length, "table")}: ${names(tables, 6)}. Orange lines write, blue lines read.`, lens: "data", nodes: tables });
  }
  const eventful = ends(["publishes", "subscribes", "events"]);
  if (eventful.length) tour.push({ title: "Events", text: `${names(eventful, 6)} publish events or subscribe to them. This is where other code can step in without changing these objects.`, lens: "events", nodes: eventful });
  const interfaces = ofType("interface");
  if (interfaces.length) tour.push({ title: "Contracts", text: `${plural(interfaces.length, "interface")}: ${names(interfaces, 6)}. What implements an interface can be exchanged.`, lens: "contracts", nodes: interfaces });
  const pages = ofType("page", "pageextension", "report");
  if (pages.length) tour.push({ title: "The user interface", text: `${plural(pages.length, "page and report", "pages and reports")}: ${names(pages, 6)}.`, lens: "pages", nodes: pages });
  const sets = ofType("permissionset");
  if (sets.length) tour.push({ title: "Permissions", text: `${plural(sets.length, "permission set")}: ${names(sets, 6)}.`, lens: "security", nodes: sets });
  const counts = report.counts ?? {};
  tour.push({
    title: report.passed ? "Health: passed" : "Health: failed",
    text: `${plural(counts.error ?? 0, "error")}, ${plural(counts.warning ?? 0, "warning")}, ${counts.info ?? 0} info. ${findings.length ? "Turn on Check to see them on the graph." : "Nothing to fix."}`,
    lens: findings.some(({ origin }) => origin === "health") ? "health" : "system",
    nodes: [...new Set(findings.filter(({ origin }) => origin === "health").flatMap((finding) => finding.nodes))]
  });
  result.push({ id: "system", kind: "tour", title: `What ${title} is`, summary: "The system from the outside in: how it works, then its apps, components, hubs, data, events, the user interface, and its health.", steps: tour });

  // 3. What to fix, one finding at a time.
  const serious = findings.filter(({ severity }) => severity !== "info");
  const fixes = (serious.length ? serious : findings).slice(0, 40);
  if (fixes.length) {
    result.push({
      id: "fix",
      kind: "check",
      title: "What to fix",
      summary: `${plural(fixes.length, "finding")}, the most severe first, each on the nodes it is about.`,
      steps: fixes
        .slice()
        .sort((a, b) => ({ error: 0, warning: 1, info: 2 })[a.severity] - ({ error: 0, warning: 1, info: 2 })[b.severity])
        .map((finding) => ({
          title: `${finding.severity}: ${finding.rule}`,
          text: `${finding.message}${finding.fix ? ` Fix: ${finding.fix}` : ""}`,
          lens: "health",
          nodes: finding.nodes,
          status: finding.severity
        }))
    });
  }

  // 4. What to change in the architecture, and how. Also when there is nothing: that is an answer too.
  if (!changed.length && objects.length) {
    result.push({
      id: "architecture",
      kind: "check",
      title: "What to change, and how",
      summary: "Nothing to change in the architecture, as it stands.",
      steps: [{ title: "Nothing to change", text: NOTHING_TO_CHANGE, lens: lensIds.has("overview") ? "overview" : "system", nodes: [] }]
    });
  }
  if (changed.length) {
    const must = changed.filter(({ optional }) => !optional).length;
    result.push({
      id: "architecture",
      kind: "check",
      title: "What to change, and how",
      summary: `${plural(changed.length, "change")} to the architecture, the most important first${must < changed.length ? `; ${must ? `the last ${changed.length - must} are` : "all of them are"} options` : ""}. Each says why, and how to do it.`,
      steps: changed.slice(0, 60).map((change) => ({
        title: change.title,
        text: `${change.why} How: ${change.how.join(" ")} Effort: ${change.effort}.`,
        lens: lensIds.has(change.lens) ? change.lens : "system",
        nodes: change.nodes,
        status: change.optional ? "info" : (change.kind === "dependency" && !change.proposed) || change.kind === "apps" ? "error" : "warning"
      }))
    });
  }

  return result;
}

/**
 * The whole atlas of one analyzed project.
 * @param workspace the analyzed project (workspace.js)
 */
export async function createAtlas(workspace) {
  const graph = builder();
  const findings = [];
  const { model, assessment } = await structure(workspace, graph);
  const report = await health(workspace, graph, findings);
  const overview = await workspace.overview();

  // A lens with nothing in it is left out.
  const kinds = new Set(graph.nodes.map(({ kind }) => kind));
  const present = new Set(graph.relations.map(({ kind }) => kind));
  // "*": every kind of relation that connects two objects.
  const between = new Set(graph.edges.filter(([from, to]) => graph.nodes[from].kind === "object" && graph.nodes[to].kind === "object").map(([, , relation]) => relation));
  const betweenObjects = graph.relations.filter((_, relation) => between.has(relation)).map(({ kind }) => kind);
  const lenses = LENSES.filter((lens) => {
    if (!lens.kinds.every((kind) => kinds.has(kind))) return false;
    return lens.relations === "*" || !lens.connected || lens.relations.some((kind) => present.has(kind));
  })
    .map((lens) => ({ ...lens, relations: lens.relations === "*" ? betweenObjects : lens.relations.filter((kind) => present.has(kind)) }));

  const changed = changes({ graph, assessment });
  return {
    schema: 1,
    title: overview.title,
    version: overview.version,
    live: overview.live,
    updatedAt: overview.updatedAt,
    summary: {
      apps: report.summary.apps.length,
      files: report.summary.files,
      objects: report.summary.objects,
      relations: report.summary.relationships,
      health: { passed: report.passed, failOn: report.failOn, ...report.counts },
      // With how much of the coupling stays inside the components, in percent.
      architecture: { ...overview.architecture, ...(assessment.result?.summary?.coupling?.share === undefined ? {} : { inside: Math.round(assessment.result.summary.coupling.share * 100) }) }
    },
    sources: commonSources({ model, assessment }),
    config: overview.config,
    levels: Object.fromEntries(Object.entries(LEVEL_COLORS).map(([level, { color }]) => [level, color])),
    // Why the components are what they are, the goals, the templates, and current against target: for the Architecture menu.
    architecture: architectureForView(assessment, { compare: !overview.live }),
    nodes: graph.nodes,
    relations: graph.relations,
    edges: graph.edges,
    lenses,
    findings,
    // What to change in the architecture, and how: the most important first.
    changes: changed,
    stories: stories({ graph, findings, report, assessment, title: overview.title, changed, lensIds: new Set(lenses.map(({ id }) => id)) })
  };
}

/**
 * One object from the inside: its procedures, triggers, and fields as nodes,
 * and what each of them does with other objects.
 * @returns { id, nodes: [{ id, kind: "member", label, type, ... }], relations: [{ kind, color, dash? }], edges: [[from id, to id, relation, weight]] }
 */
export async function createInside(workspace, id) {
  const [{ model }, assessment] = await Promise.all([workspace.model(), workspace.assessment()]);
  const object = model.objects.find(({ key }) => key === id);
  if (!object) return undefined;
  const nodes = [];
  const member = new Map();
  const add = (name, type, facts = {}) => {
    const key = `${id}::${type}::${name}`;
    if (!member.has(name)) {
      member.set(name, key);
      nodes.push(compact({ id: key, kind: "member", label: name, type, color: TYPE_STYLES[type]?.[1] ?? NEUTRAL, parent: id, ...facts }));
    }
    return member.get(name);
  };
  for (const procedure of object.procedures ?? []) {
    const subscriber = (procedure.attributes ?? []).some((attribute) => /EventSubscriber/iu.test(attribute));
    add(procedure.signature ?? procedure.name, procedure.kind === "trigger" ? "trigger" : procedure.kind === "event" ? "event" : subscriber ? "subscriber" : "procedure", {
      level: procedure.visibility,
      line: procedure.location?.line,
      file: object.file,
      lines: procedure.metadata?.lines,
      complexity: procedure.metadata?.complexity,
      about: procedure.metadata?.documentation,
      header: procedure.header
    });
  }
  const edges = [];
  const relations = [];
  const seen = new Set();
  const edge = (from, to, kind) => {
    const key = `${from}>${to}>${kind}`;
    if (from === to || seen.has(key)) return;
    seen.add(key);
    let relation = relations.findIndex((entry) => entry.kind === kind);
    if (relation < 0) {
      const style = ATLAS_RELATIONS[kind] ?? RELATION_STYLES[kind] ?? { color: NEUTRAL };
      relation = relations.push({ kind, color: style.color, ...(style.dash ? { dash: true } : {}) }) - 1;
    }
    edges.push([from, to, relation, 1]);
  };
  for (const key of member.values()) edge(id, key, "contains");
  for (const link of assessment.levels.object.edges) {
    if (link.source === id) {
      for (const evidence of link.evidence ?? []) {
        const from = evidence.member && member.get(evidence.member);
        edge(from ?? id, link.target, evidence.kind);
      }
    } else if (link.target === id) {
      for (const kind of Object.keys(link.kinds ?? {})) edge(link.source, id, kind);
    }
  }
  return { id, nodes, relations, edges };
}
