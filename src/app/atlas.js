// The atlas: everything BC Atlas reads from the AL source as ONE graph.
//
// The source code is the only fact. Apps, components, namespaces, objects,
// health rules, process tests, the people who perform them, and the
// requirements they prove are nodes; what they do with each other are
// relations. A lens selects a part of that graph (the data, the events, the
// architecture, the findings, a process), a story walks through it step by
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
import path from "node:path";
import { dependencyMatrix } from "../blueprint/drilldown.js";
import { RELATION_STYLES, TYPE_STYLES } from "../d2.js";
import { pluginAtlas } from "../plugins/atlas.js";
import { definitionOf } from "../simulation/define.js";
import { analyzeVisibility, LEVEL_COLORS } from "../visibility.js";

const NEUTRAL = "#64748B";
const SEVERITY_COLORS = { error: "#C0392B", warning: "#B7791F", info: "#2A78D6" };
const KIND_COLORS = {
  app: "#0072B2",
  component: "#4E5D78",
  module: "#4E5D78",
  rule: "#B7791F",
  process: "#15803D",
  task: "#0891B2",
  person: "#7C3AED",
  role: "#4F46E5",
  requirement: "#A21CAF"
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
  step: { color: "#15803D" },
  next: { color: "#15803D", dash: true },
  touches: { color: "#0891B2" },
  performs: { color: "#15803D" },
  "has role": { color: "#7C3AED" },
  does: { color: "#15803D", dash: true },
  forbids: { color: "#B91C1C", dash: true },
  grants: { color: "#64748B", dash: true },
  grounds: { color: "#0F766E" },
  blocked: { color: SEVERITY_COLORS.error },
  "must not": { color: NEUTRAL, dash: true },
  "can, but must not": { color: SEVERITY_COLORS.error, dash: true },
  holds: { color: "#7C3AED" },
  source: { color: "#31783B" },
  "proven by": { color: "#A21CAF" }
};


/**
 * What the one view can show. `kinds` are the node kinds of a lens,
 * `relations` its kinds of relation ("*" for every relation between
 * objects); with `connected`, only nodes that take part in one of them show.
 * `types` keeps objects of these types even when nothing connects them;
 * `from` keeps only relations that start at an object of these types.
 */
export const LENSES = [
  { id: "overview", title: "Overview", section: "How it works", hint: "how it works, from who uses it to the data", summary: "How it works, from left to right: who uses it, what they do, on which screens, with which logic, in which data.", flow: true, form: "diagram", kinds: ["object", "task", "person"], needs: [], relations: "*", group: "kind", color: "type", reads: "the objects of the AL source and what they do with each other, the process tests, and the people of `simulation` in .bca.json" },
  { id: "system", title: "System", section: "Structure", hint: "every object and every relation", summary: "Every object and every relation between them.", kinds: ["object"], relations: "*", group: "component", color: "type", reads: "the objects of the AL source and all their relations: calls, data access, events, extensions, permissions" },
  { id: "components", title: "Components", section: "Structure", hint: "the layers and their dependencies", form: "diagram", summary: "The components in their layers and the dependencies between them, allowed or the wrong way.", kinds: ["component"], relations: ["depends on", "wrong way", "not declared"], group: "layer", color: "kind", reads: "the components of `architecture` in .bca.json (or the proposal), and the relations between the objects assigned to them" },
  { id: "apps", title: "Apps", section: "Structure", hint: "the apps and what they use of each other", form: "diagram", summary: "The apps of the workspace, the apps they depend on, and what they use of each other.", kinds: ["app"], relations: ["declared", "implicit", "undeclared", "unresolved"], group: "origin", color: "kind", reads: "`app.json` of every app, its `dependencies`, and the relations between objects of different apps" },
  { id: "modules", title: "Modules", section: "Structure", hint: "namespaces and what they use", summary: "Namespaces and what they use of each other.", kinds: ["module"], relations: ["depends on"], group: "app", color: "kind", reads: "the namespaces of the objects and the relations that cross them" },
  { id: "data", title: "Data", section: "Parts", hint: "tables and the code that uses them", summary: "Tables and the code that reads, writes, relates, and extends them.", kinds: ["object"], relations: ["reads", "writes", "relates", "extends"], connected: true, types: ["table", "tableextension"], group: "component", color: "type", reads: "tables and the `reads`, `writes`, `relates`, and `extends` relations" },
  { id: "calls", title: "Calls", section: "Parts", hint: "which objects call which", summary: "Which objects call and run which.", kinds: ["object"], relations: ["calls", "runs", "starts"], connected: true, group: "component", color: "type", reads: "the procedure calls and `Run` statements in the code" },
  { id: "events", title: "Events", section: "Parts", hint: "publishers and subscribers", summary: "Event publishers and their subscribers.", kinds: ["object"], relations: ["publishes", "subscribes", "events"], connected: true, group: "component", color: "type", reads: "`[IntegrationEvent]`, `[BusinessEvent]`, and `[EventSubscriber]` procedures" },
  { id: "contracts", title: "Contracts", section: "Parts", hint: "interfaces and what implements them", summary: "Interfaces and what implements them.", kinds: ["object"], relations: ["implements", "selects"], connected: true, types: ["interface"], group: "component", color: "type", reads: "`interface` objects, `implements`, and the `Implementation` of enum values" },
  { id: "pages", title: "Pages", section: "Parts", hint: "pages, reports, and what they show", summary: "Pages and reports, and what they show, run, and contain.", kinds: ["object"], relations: "*", connected: true, from: ["page", "pageextension", "pagecustomization", "report", "reportextension"], types: ["page", "report"], group: "component", color: "type", reads: "pages, page extensions, reports, their source tables, parts, and actions" },
  { id: "security", title: "Permissions", section: "People and rules", hint: "permission sets and what they permit", summary: "Permission sets and what they permit and include.", kinds: ["object"], relations: ["permits", "includes"], connected: true, types: ["permissionset"], group: "component", color: "type", reads: "`permissionset` objects, their `Permissions`, and `IncludedPermissionSets`" },
  { id: "visibility", title: "Visibility", section: "Quality", hint: "public, internal, or local", summary: "What is public, internal, or local, and what could be narrower.", kinds: ["object"], relations: "*", group: "component", color: "level", reads: "the `Access` property and the uses found from other apps and objects" },
  { id: "health", title: "Findings", section: "Quality", hint: "the rules and what they found", summary: "The rules of the health check and the objects they found.", kinds: ["rule", "object"], relations: ["error", "warning", "info"], connected: true, group: "kind", color: "severity", reads: "the findings of `bca check` (rules, AL compiler, analyzers) and the objects they are on" },
  { id: "processes", title: "Processes", section: "How it works", hint: "the process tests, step by step", form: "diagram", summary: "The process tests step by step, and the objects each one touches.", kinds: ["process", "task", "object"], relations: ["step", "next", "touches"], connected: true, group: "kind", color: "kind", reads: "the AL UI tests with `[SCENARIO]`, and the code behind every step" },
  { id: "people", title: "People", section: "People and rules", hint: "who performs what, and what blocks them", form: "diagram", summary: "Who performs which process test with which permission sets, and what blocks them.", kinds: ["person", "task", "object"], relations: ["performs", "blocked", "must not", "can, but must not", "holds"], connected: true, group: "kind", color: "kind", reads: "the roles and agents of `simulation` in .bca.json, their permission sets, and the process tests" },
  { id: "requirements", title: "Requirements", section: "People and rules", hint: "what the company needs, and its proof", form: "diagram", summary: "What the company needs, and the process tests that prove it.", kinds: ["requirement", "task"], relations: ["proven by"], group: "kind", color: "status", reads: "the `requirements` of `simulation` in .bca.json and the process tests" },
  { id: "simulation", title: "Simulation", section: "People and rules", hint: "the company that uses the app", form: "diagram", summary: "The company that uses the app: its people and roles, the process tests each role does or must not do, the recordings they stand on, and the requirements they prove.", kinds: ["person", "role", "task", "requirement", "recording"], needs: ["person", "role"], relations: ["has role", "does", "forbids", "blocked", "can, but must not", "proven by", "grounds"], group: "kind", color: "status", reads: "the `simulation` section of .bca.json (or the [PERMISSIONS] of the process tests), the process tests, and the recordings of the sync plugin" },
  { id: "run", title: "Run", section: "How it works", hint: "the simulation at work", form: "diagram", summary: "The canvas the simulation runs on: who performs which process test, and the objects each step touches.", kinds: ["person", "task", "object"], needs: ["person"], relations: ["performs", "blocked", "can, but must not", "next", "touches"], connected: true, group: "kind", color: "kind", reads: "the agents of `simulation` in .bca.json, the process tests, and what each step of a test needs" }
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
  // Colors of relations a plugin brings along.
  const styles = new Map();
  return {
    nodes,
    relations,
    edges,
    style: (kind, style) => styles.set(kind, style),
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
        const style = ATLAS_RELATIONS[kind] ?? RELATION_STYLES[kind] ?? styles.get(kind) ?? { color: NEUTRAL };
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

/** The process tests, the people who perform them, and the requirements they prove. */
async function processes(workspace, graph, findings) {
  const battle = await workspace.battleTest().catch(() => undefined);
  if (!battle) return undefined;
  // `page 50210 Purchase Requests` names an object by type and ID.
  const byNumber = new Map();
  for (const node of graph.nodes) if (node.kind === "object" && node.objectId) byNumber.set(`${node.type}:${node.objectId}`, node.id);
  const objectOf = (need) => byNumber.get(`${need.type}:${need.id}`);
  // How far a process test or a process gets: it works, it stops, or nobody can say.
  const STATUS = { done: "#15803D", runs: "#15803D", fit: "#15803D", blocked: SEVERITY_COLORS.error, waiting: SEVERITY_COLORS.warning, unstaffed: SEVERITY_COLORS.warning, unverified: SEVERITY_COLORS.warning };
  const taskStatus = new Map((battle.processes ?? []).flatMap((process) => (process.steps ?? []).map((step) => [step.task, step.status])));

  for (const task of battle.tasks ?? []) {
    graph.node(compact({
      id: `task::${task.id}`,
      kind: "task",
      label: task.title,
      color: taskStatus.get(task.id) && taskStatus.get(task.id) !== "done" ? STATUS[taskStatus.get(task.id)] ?? KIND_COLORS.task : KIND_COLORS.task,
      status: taskStatus.get(task.id),
      about: task.goal,
      steps: task.steps?.length,
      file: task.source?.file,
      procedure: task.source?.procedure
    }));
    for (const step of task.steps ?? []) {
      for (const need of step.needs ?? []) {
        const object = objectOf(need);
        if (object) graph.edge(`task::${task.id}`, object, "touches");
      }
    }
  }
  for (const process of battle.processes ?? []) {
    graph.node(compact({ id: `process::${process.id}`, kind: "process", label: process.title, color: process.status === "blocked" ? STATUS.blocked : KIND_COLORS.process, status: process.status, handovers: process.handovers }));
    let previous;
    for (const step of process.steps ?? []) {
      graph.edge(`process::${process.id}`, `task::${step.task}`, "step");
      if (previous) graph.edge(`task::${previous}`, `task::${step.task}`, "next");
      previous = step.task;
    }
  }
  // The roles of the company: what they hold, do, and must not do, as it is defined.
  for (const role of battle.roles ?? []) {
    const id = `role::${role.name}`;
    graph.node(compact({ id, kind: "role", label: role.name, color: KIND_COLORS.role, about: role.description, permissionSets: role.permissionSets?.join(", "), taskGroups: role.taskGroups?.join(", ") }));
    for (const set of role.permissionSets ?? []) {
      const object = graph.nodes.find((node) => node.kind === "object" && node.type === "permissionset" && String(node.label).toLowerCase() === String(set).toLowerCase());
      if (object) graph.edge(id, object.id, "grants");
    }
    for (const task of role.tasks ?? []) if (graph.at(`task::${task}`) !== undefined) graph.edge(id, `task::${task}`, "does");
    for (const task of role.mustNot ?? []) if (graph.at(`task::${task}`) !== undefined) graph.edge(id, `task::${task}`, "forbids");
  }
  for (const agent of battle.agents ?? []) {
    const id = `person::${agent.name}`;
    const blocked = (agent.attempts ?? []).some(({ expected, outcome }) => (expected === "complete" && outcome !== "completed") || (expected === "deny" && outcome !== "denied"));
    graph.node(compact({
      id,
      kind: "person",
      label: agent.roles?.length ? `${agent.name} (${agent.roles.join(", ")})` : agent.name,
      color: blocked ? SEVERITY_COLORS.error : KIND_COLORS.person,
      roles: agent.roles?.join(", "),
      permissionSets: agent.permissionSets?.map(({ name }) => name).join(", ")
    }));
    for (const set of agent.permissionSets ?? []) {
      const object = byNumber.get(`permissionset:${set.id}`);
      if (object) graph.edge(id, object, "holds");
    }
    for (const role of agent.roles ?? []) if (graph.at(`role::${role}`) !== undefined) graph.edge(id, `role::${role}`, "has role");
    for (const attempt of agent.attempts ?? []) {
      const kind = attempt.expected === "deny"
        ? (attempt.outcome === "denied" ? "must not" : "can, but must not")
        : (attempt.outcome === "completed" ? "performs" : "blocked");
      graph.edge(id, `task::${attempt.task}`, kind);
    }
  }
  for (const requirement of battle.fitGap?.requirements ?? []) {
    const id = `requirement::${requirement.id}`;
    graph.node(compact({
      id,
      kind: "requirement",
      label: `${requirement.id}: ${requirement.title}`,
      color: requirement.status === "fit" ? STATUS.fit : SEVERITY_COLORS.warning,
      status: requirement.label ?? requirement.status,
      about: requirement.action
    }));
    for (const task of requirement.tasks ?? []) graph.edge(id, `task::${task.id ?? task}`, "proven by");
  }
  for (const finding of battle.findings ?? []) {
    const agent = finding.agent ? graph.nodes.findIndex((node) => node.kind === "person" && (node.label === finding.agent || node.label.startsWith(`${finding.agent} (`))) : -1;
    const task = finding.task ? graph.nodes.findIndex((node) => node.kind === "task" && node.label === finding.task) : -1;
    findings.push(compact({
      severity: finding.severity,
      rule: finding.code,
      message: finding.message,
      fix: finding.action,
      nodes: [agent, task].filter((position) => position >= 0),
      origin: "battle test"
    }));
  }
  return battle;
}

/**
 * Grounding: a process test stands on a recording of the same process in Business Central
 * (a fact snapshot of the sync plugin). The test says what should happen, the recording what
 * did; where the two differ is a finding.
 * @param settings the simulation section: grounding { <document ID>: <recording> }; without an
 *   entry, a test is grounded on the recording that has its title
 */
function grounding(graph, findings, settings = {}) {
  const tasks = graph.nodes.filter((node) => node.kind === "task");
  const recordings = graph.nodes.filter((node) => node.kind === "recording");
  if (!tasks.length) return;
  const plain = (text) => String(text).toLowerCase().replace(/[^a-z0-9]+/gu, " ").trim();
  const explicit = new Map(Object.entries(settings.grounding ?? {}).map(([task, snapshot]) => [plain(task), snapshot]));
  const targets = (from, kind) => new Set(graph.edges.filter(([a, , relation]) => a === from && graph.relations[relation].kind === kind).map(([, to]) => to));
  const names = (indexes) => [...indexes].map((index) => graph.nodes[index].label).sort().join(", ");
  for (const task of tasks) {
    const wanted = explicit.get(plain(task.id.slice("task::".length)));
    const recording = wanted
      ? recordings.find((node) => node.id === `sync::recording::${wanted}` || plain(node.label) === plain(wanted) || plain(node.id.split("::").at(-1)) === plain(wanted))
      : recordings.find((node) => plain(node.label) === plain(task.label));
    if (!recording) {
      if (wanted) {
        findings.push({ severity: "warning", rule: "grounding-missing", message: `The process test "${task.label}" is grounded on the recording "${wanted}", which is not among the recordings of the project.`, fix: "Record the process in Business Central and sync it (`bca sync run`), or change the grounding with `bca simulate define --ground`.", nodes: [graph.at(task.id)], origin: "battle test" });
      }
      if (recordings.length || wanted) task.grounded = "no";
      continue;
    }
    graph.edge(recording.id, task.id, "grounds");
    task.grounded = recording.label;
    const touched = targets(graph.at(task.id), "touches");
    const ran = targets(graph.at(recording.id), "runs through");
    const beyond = [...ran].filter((index) => !touched.has(index));
    const unseen = [...touched].filter((index) => !ran.has(index));
    if (beyond.length || unseen.length) {
      findings.push({
        severity: "info",
        rule: "grounding-differs",
        message: `The recording "${recording.label}" and the process test "${task.label}" differ: ${[beyond.length ? `what ran in Business Central went through ${names(beyond)}, which the test does not touch` : "", unseen.length ? `the test touches ${names(unseen)}, which the recording did not run through` : ""].filter(Boolean).join("; ")}.`,
        fix: "Extend the process test so it covers what really runs, or record the process again if the app changed since.",
        nodes: [graph.at(task.id), graph.at(recording.id), ...beyond, ...unseen],
        origin: "battle test"
      });
    }
  }
}

/**
 * What the plugins of the project add (src/plugins/atlas.js): nodes, relations, lenses,
 * findings, and stories of what the AL source cannot show.
 * @returns { lenses, stories } to append to those of BC Atlas
 */
async function contributions(workspace, graph, findings, assessment) {
  const lenses = [];
  const stories = [];
  const numbered = new Map();
  for (const node of graph.nodes) if (node.kind === "object" && node.objectId) numbered.set(`${node.type}:${node.objectId}`, node.id);
  const named = (type, name) => graph.nodes.find((node) => node.kind === "object" && node.type === type && String(node.label).toLowerCase() === String(name).toLowerCase())?.id;
  const context = {
    atlas: { nodes: graph.nodes, relations: graph.relations, edges: graph.edges },
    /** The node id of an AL object by type and ID or name, or nothing. */
    object: (type, idOrName) => numbered.get(`${String(type).toLowerCase()}:${idOrName}`) ?? named(String(type).toLowerCase(), idOrName)
  };
  const root = assessment.context.projectRoot ?? assessment.context.options.projectRoot;
  for (const { plugin, contribution, error } of await pluginAtlas({ root, configPath: assessment.context.config?.path }, context)) {
    if (error) {
      findings.push({ severity: "warning", rule: "plugin-atlas-failed", message: `Plugin ${plugin} could not add to the atlas: ${error}`, nodes: [], origin: plugin });
      continue;
    }
    for (const [kind, style] of Object.entries(contribution.styles ?? {})) graph.style(kind, style);
    for (const node of contribution.nodes ?? []) {
      if (!node?.id || !node.kind || !node.label) continue;
      graph.node(compact({ color: NEUTRAL, ...node, plugin }));
    }
    for (const { from, to, kind, weight } of contribution.relations ?? []) graph.edge(from, to, kind, weight ?? 1);
    const at = (ids) => [...new Set((ids ?? []).map((id) => graph.at(id)).filter((index) => index !== undefined))];
    for (const finding of contribution.findings ?? []) {
      const nodes = at(finding.nodes);
      // The same finding as a health rule of the plugin: one finding, now on its nodes.
      const known = findings.find(({ rule, message }) => rule === finding.rule && message === finding.message);
      if (known) known.nodes = [...new Set([...known.nodes, ...nodes])];
      else findings.push(compact({ severity: finding.severity ?? "info", rule: finding.rule, message: finding.message, fix: finding.fix, nodes, origin: plugin }));
    }
    for (const lens of contribution.lenses ?? []) {
      if (!lens?.id || LENSES.some(({ id }) => id === lens.id) || lenses.some(({ id }) => id === lens.id)) continue;
      lenses.push({ group: "kind", color: "kind", reads: `the plugin ${plugin}`, ...lens, plugin });
    }
    for (const story of contribution.stories ?? []) {
      if (!story?.id || !story.steps?.length) continue;
      stories.push({ kind: "process", ...story, plugin, steps: story.steps.map((step) => ({ ...step, nodes: at(step.nodes) })) });
    }
  }
  return { lenses, stories };
}

/**
 * The runs of the simulation: one per person, step by step through the process tests the person
 * is assigned. Every step says where it is (the test, the objects the step needs) and how it
 * ends for this person: done, stopped here with what is missing, or not reached. A run builds
 * its picture: what a step has not reached yet does not show.
 */
function runs(graph, battle) {
  if (!battle) return [];
  const byNumber = new Map();
  for (const node of graph.nodes) if (node.kind === "object" && node.objectId) byNumber.set(`${node.type}:${node.objectId}`, node.id);
  const order = new Map((battle.tasks ?? []).map((task, index) => [task.id, index]));
  const tasks = new Map((battle.tasks ?? []).map((task) => [task.id, task]));
  const indexes = (ids) => [...new Set(ids.map((id) => graph.at(id)).filter((index) => index !== undefined))];
  return (battle.agents ?? []).map((agent) => {
    const person = `person::${agent.name}`;
    const assigned = (agent.attempts ?? []).filter(({ expected }) => expected === "complete").sort((a, b) => order.get(a.task) - order.get(b.task));
    if (!assigned.length || graph.at(person) === undefined) return undefined;
    const who = agent.roles?.length ? `${agent.name} (${agent.roles.join(", ")})` : agent.name;
    const sets = (agent.permissionSets ?? []).map(({ name }) => name);
    const steps = [{
      title: who,
      text: `${agent.name} ${agent.roles?.length ? `has the role ${agent.roles.join(" and ")}` : "has no role"}${sets.length ? `, with the permission sets ${sets.join(", ")}` : ""}, and is assigned ${assigned.length} process test${assigned.length === 1 ? "" : "s"}: ${assigned.map(({ title }) => title).join("; ")}.`,
      lens: "run",
      nodes: indexes([person])
    }];
    for (const attempt of assigned) {
      const task = tasks.get(attempt.task);
      for (const step of task?.steps ?? []) {
        const stopped = attempt.blockedAt === step.index;
        const reached = !attempt.blockedAt || step.index <= attempt.blockedAt;
        const missing = (attempt.missing ?? []).filter((item) => item.step === step.index);
        const end = stopped
          ? `${agent.name} is stopped here: ${missing.map((item) => `${item.right} on ${item.object} is missing (${item.because})`).join("; ") || "a permission is missing"}.${attempt.missingPermissions?.length ? ` Add to a permission set: ${attempt.missingPermissions.map((line) => `\`${line}\``).join(", ")}.` : ""}`
          : reached ? `${agent.name} can do this.` : `Not reached: ${agent.name} was stopped at step ${attempt.blockedAt}.`;
        steps.push({
          title: `${attempt.title} · step ${step.index}`,
          text: `${step.text} ${end}`,
          lens: "run",
          nodes: indexes([person, `task::${attempt.task}`, ...(step.needs ?? []).map((need) => byNumber.get(`${need.type}:${need.id}`)).filter(Boolean)]),
          status: stopped ? "blocked" : reached ? "done" : "waiting"
        });
      }
    }
    const completed = assigned.filter(({ outcome }) => outcome === "completed").length;
    steps.push({
      title: `${agent.name}: ${completed} of ${assigned.length} done`,
      text: `${agent.name} completes ${completed} of ${assigned.length} assigned process test${assigned.length === 1 ? "" : "s"}.${assigned.filter(({ outcome }) => outcome === "blocked").map(({ title, blockedAt }) => ` "${title}" stops at step ${blockedAt}.`).join("")}`,
      lens: "run",
      // The end of the run is the whole picture it built.
      nodes: [...new Set(steps.flatMap(({ nodes }) => nodes))],
      ...(completed < assigned.length ? { status: "blocked" } : { status: "done" })
    });
    return { id: `run:${agent.name}`, kind: "run", build: true, title: `${agent.name} at work`, summary: `${who} performs ${assigned.length} assigned process test${assigned.length === 1 ? "" : "s"}, step by step: where each step goes, and where it stops.`, steps };
  }).filter(Boolean);
}

/** The stories: walks through the graph that explain, document, test, and demonstrate the system. */
function stories({ graph, findings, report, assessment, battle, title }) {
  const result = [];
  const { nodes, edges, relations } = graph;
  const at = (id) => graph.at(id);
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
  // First how it works: who does what, on which screens, with which logic, in which data.
  const own = objects.filter(({ node }) => !node.test);
  const of = (...types) => own.filter(({ node }) => types.includes(node.type)).length;
  const parts = [
    [nodes.filter(({ kind }) => kind === "person").length, "person", "people"],
    [nodes.filter(({ kind }) => kind === "task").length, "process test"],
    [of("page", "pageextension", "pagecustomization", "report", "reportextension", "requestpage"), "screen"],
    [of("codeunit", "query", "xmlport", "interface"), "logic object"],
    [of("table", "tableextension"), "table"]
  ].filter(([count]) => count);
  tour.push({
    title: "How it works",
    text: `From left to right: ${parts.map(([count, one, many]) => plural(count, one, many)).join(", ")}. ${parts[0][1] === "person" ? "People perform the process tests on the screens; the " : parts[0][1] === "process test" ? "The process tests run on the screens; the " : "The "}screens run the logic, and the logic reads and writes the data. A line leads from what uses to what is used.`,
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

  // 2. One story per process: the process tests in order, step by step.
  for (const process of battle?.processes ?? []) {
    const steps = [];
    for (const step of process.steps ?? []) {
      const task = battle.tasks.find(({ id }) => id === step.task);
      if (!task) continue;
      const position = at(`task::${task.id}`);
      const performers = (step.performers ?? []).map((performer) => performer.agent ?? performer.name ?? performer).filter((value) => typeof value === "string");
      steps.push({
        title: task.title,
        text: `${task.goal ?? ""}${performers.length ? ` Performed by ${list(performers)}.` : ""}${step.status && step.status !== "done" ? ` Status: ${step.status}.` : ""}`.trim(),
        lens: "processes",
        nodes: [position],
        status: step.status
      });
      for (const action of task.steps ?? []) {
        const touched = [...new Set((action.needs ?? []).map((need) => graph.nodes.findIndex((node) => node.kind === "object" && node.type === need.type && node.objectId === need.id)).filter((index) => index >= 0))];
        const why = [...new Set((action.needs ?? []).map(({ object, right, because }) => `${right} on ${object} (${because})`))];
        steps.push({
          title: `${task.title} · step ${action.index}`,
          text: `${action.text}${why.length ? ` Needs: ${list(why, 3)}.` : ""}`,
          lens: "processes",
          nodes: [position, ...touched]
        });
      }
    }
    if (steps.length) {
      result.push({
        id: `process:${process.id}`,
        kind: "process",
        title: process.title,
        summary: `${plural(process.steps?.length ?? 0, "process test")} in order, step by step, with the objects each step touches${process.status === "blocked" ? "; someone is blocked" : ""}.`,
        status: process.status,
        steps
      });
    }
  }

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
          lens: finding.origin === "battle test" ? "people" : "health",
          nodes: finding.nodes,
          status: finding.severity
        }))
    });
  }

  // 4. The dependencies that point the wrong way, and how to resolve each.
  const work = assessment.result.workItems ?? [];
  if (work.length) {
    result.push({
      id: "architecture",
      kind: "check",
      title: "Dependencies the wrong way",
      summary: `${plural(work.length, "work item")} to reach the ${assessment.proposal ? "proposed" : "configured"} architecture.`,
      steps: work.slice(0, 40).map((item) => ({
        title: `${item.source.label}: ${item.title}`,
        text: `${item.source.label} (${item.sourceComponent}) depends on ${list((item.targets ?? []).map(({ label }) => label))} in ${item.targetComponent}. ${(item.steps ?? []).join(" ")} Effort: ${item.effort}.`,
        lens: "system",
        nodes: [at(item.source.id), ...(item.targets ?? []).map(({ label, type }) => nodes.findIndex((node) => node.kind === "object" && node.label === label && node.type === type))].filter((index) => index !== undefined && index >= 0),
        status: "error"
      }))
    });
  }

  // 5. The people: what each one can do, and what stops them.
  if (battle?.agents?.length) {
    result.push({
      id: "people",
      kind: "process",
      title: "Who can do what",
      summary: "Every agent of the company with their roles, permission sets, and process tests.",
      steps: battle.agents.map((agent) => {
        const attempts = agent.attempts ?? [];
        const done = attempts.filter(({ expected, outcome }) => expected === "complete" && outcome === "completed");
        const blocked = attempts.filter(({ expected, outcome }) => expected === "complete" && outcome !== "completed");
        const leak = attempts.filter(({ expected, outcome }) => expected === "deny" && outcome !== "denied");
        return {
          title: agent.roles?.length ? `${agent.name} (${agent.roles.join(", ")})` : agent.name,
          text: [
            `Holds ${list((agent.permissionSets ?? []).map(({ name }) => name)) || "no permission set"}.`,
            done.length ? `Can: ${list(done.map(({ title: task }) => task))}.` : "",
            blocked.length ? `Blocked: ${blocked.map((attempt) => `${attempt.title} (${list(attempt.missingPermissions ?? [], 2) || "missing permissions"})`).join("; ")}.` : "",
            leak.length ? `Can, but must not: ${list(leak.map(({ title: task }) => task))}.` : ""
          ].filter(Boolean).join(" "),
          lens: "people",
          nodes: [at(`person::${agent.name}`), ...attempts.map(({ task }) => at(`task::${task}`))].filter((index) => index !== undefined),
          status: blocked.length || leak.length ? "error" : undefined
        };
      })
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
  const battle = await processes(workspace, graph, findings);
  const added = await contributions(workspace, graph, findings, assessment);
  const simulationSettings = assessment.context.options?.simulation ?? {};
  if (battle) grounding(graph, findings, simulationSettings);
  const overview = await workspace.overview();

  // A lens with nothing in it is left out.
  const kinds = new Set(graph.nodes.map(({ kind }) => kind));
  const present = new Set(graph.relations.map(({ kind }) => kind));
  // "*": every kind of relation that connects two objects.
  const between = new Set(graph.edges.filter(([from, to]) => graph.nodes[from].kind === "object" && graph.nodes[to].kind === "object").map(([, , relation]) => relation));
  const betweenObjects = graph.relations.filter((_, relation) => between.has(relation)).map(({ kind }) => kind);
  const lenses = LENSES.filter((lens) => {
    const special = lens.needs ?? lens.kinds.filter((kind) => kind !== "object" && kind !== "task");
    if (special.length ? !special.every((kind) => kinds.has(kind)) : !kinds.has(lens.kinds[0])) return false;
    return lens.relations === "*" || !lens.connected || lens.relations.some((kind) => present.has(kind));
  })
    .map((lens) => ({ ...lens, relations: lens.relations === "*" ? betweenObjects : lens.relations.filter((kind) => present.has(kind)) }))
    // The lenses of plugins, when they have something to show.
    .concat(added.lenses
      .map((lens) => ({ ...lens, relations: lens.relations.filter((kind) => present.has(kind)) }))
      .filter((lens) => lens.kinds.some((kind) => kinds.has(kind)) && lens.relations.length));

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
      architecture: overview.architecture,
      ...(battle ? { battle: { passed: battle.passed, ...battle.summary, company: battle.company?.name } } : {})
    },
    sources: commonSources({ model, assessment }),
    config: overview.config,
    levels: Object.fromEntries(Object.entries(LEVEL_COLORS).map(([level, { color }]) => [level, color])),
    // The simulation as it is defined, and what a definition can name: for the Simulate menu of the view.
    ...(battle ? { simulation: {
      derived: Boolean(battle.company?.derived),
      definition: battle.company?.derived ? { ...definitionOf(battle), ...(simulationSettings.grounding ? { grounding: simulationSettings.grounding } : {}) } : Object.fromEntries(["company", "taskGroups", "roles", "agents", "requirements", "grounding"].filter((key) => simulationSettings[key] !== undefined).map((key) => [key, simulationSettings[key]])),
      tasks: (battle.tasks ?? []).map(({ id, title, features }) => ({ id, title, features })),
      permissionSets: graph.nodes.filter((node) => node.kind === "object" && node.type === "permissionset").map(({ label }) => label).sort(),
      recordings: graph.nodes.filter((node) => node.kind === "recording").map(({ id, label }) => ({ id: id.split("::").at(-1), label }))
    } } : {}),
    nodes: graph.nodes,
    relations: graph.relations,
    edges: graph.edges,
    lenses,
    findings,
    stories: [
      ...stories({ graph, findings, report, assessment, battle, title: overview.title }),
      // The runs of the simulation, when its canvas is among the lenses.
      ...(lenses.some(({ id }) => id === "run") ? runs(graph, battle) : []),
      // A step of a plugin's story names a lens of the atlas, its own or one of BC Atlas.
      ...added.stories.filter((story) => story.steps.every(({ lens }) => lenses.some(({ id }) => id === lens)))
    ]
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
