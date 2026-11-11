#!/usr/bin/env node

import { realpathSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";

import { createArchitectureModel } from "./architecture.js";
import { createCapabilities, FAIL_LEVELS, REPORT_VIEWS, VIEW_FORMATS, VIEW_FORMS, VIEW_LENSES, VIEWS as VIEW_CATALOG } from "./capabilities.js";
import { runHealthCheck } from "./commands/check.js";
import { writeView } from "./commands/view.js";
import { viewOverview } from "./app/view.js";
import { runAutomation } from "./automation/run.js";
import { applySetup, createPlan } from "./automation/setup.js";
import { checkForUpdate } from "./commands/update.js";
import { writeExplorer } from "./commands/explore.js";
import { queryGraph, renderGraph } from "./graph/platform.js";
import { assessArchitecture } from "./blueprint/index.js";
import { architectureJson } from "./blueprint/report.js";
import { planExtraction } from "./blueprint/extract.js";
import { planObjectMove } from "./commands/refactor.js";
import { applyRefactoring } from "./refactor/move.js";
import { planSurface } from "./refactor/surface.js";
import { generateReport } from "./commands/report.js";
import { renderHandbook } from "./handbook.js";
import { simulate } from "./simulation/index.js";
import { formatSimulationMarkdown } from "./simulation/report.js";
import { resolveOutput, writeArchitecture } from "./output.js";
import { planMetadataEdit, writeMetadataEdit } from "./docs/al-ui-writer.js";
import { documentationGlossary } from "./docs/tags.js";
import { DOCUMENT_MODES, EXPORT_FORMATS, exportDocumentation } from "./docs/export.js";
import { loadCorpus, scenarioSummary } from "./docs/model.js";
import { loadConfig } from "./config.js";
import { loadPlugins } from "./plugins/registry.js";

const pkg = JSON.parse(await fs.readFile(new URL("../package.json", import.meta.url)));
const VIEWS = VIEW_CATALOG.map(([id]) => id);

const architectureFields = {
  path: z.string().min(1).describe("AL file or project directory"),
  projectRoot: z.string().min(1).optional().describe(
    "App or multi-app workspace root; path becomes the rendered folder focus"
  ),
  view: z.enum(VIEWS).optional(),
  object: z.string().optional(),
  objectInboundDepth: z.number().int().nonnegative().optional(),
  objectOutboundDepth: z.number().int().nonnegative().optional(),
  members: z.array(z.enum(["fields", "actions", "triggers", "events", "procedures"])).optional(),
  scope: z.array(z.string()).optional(),
  focus: z.string().optional(),
  entry: z.array(z.string()).optional(),
  namespace: z.array(z.string()).optional(),
  type: z.array(z.string()).optional(),
  include: z.array(z.string()).optional(),
  exclude: z.array(z.string()).optional(),
  groupBy: z.enum(["namespace", "folder", "type", "role"]).optional(),
  moduleDepth: z.union([z.literal("auto"), z.number().int().positive()]).optional(),
  folderDepth: z.number().int().positive().optional(),
  includeUnresolvedCalls: z.boolean().optional(),
  rootProcedure: z.array(z.string()).optional(),
  callDepth: z.number().int().nonnegative().optional(),
  callDirection: z.enum(["incoming", "outgoing", "both"]).optional(),
  expandProcedures: z.boolean().optional(),
  expandFrameworkCalls: z.boolean().optional(),
  workflowDepth: z.number().int().positive().optional(),
  workflowMaxNodes: z.number().int().positive().optional(),
  workflowEdgeTypes: z.array(z.enum(["calls", "events", "writes", "reads"])).optional(),
  maxEdges: z.number().int().positive().optional(),
  direction: z.enum(["right", "down", "left", "up"]).optional(),
  title: z.string().optional(),
  sourceUrl: z.string().optional(),
  sourceRef: z.string().optional(),
  sourcePathPrefix: z.string().optional(),
  noLegend: z.boolean().optional(),
  details: z.boolean().optional(),
  noExternal: z.boolean().optional(),
  config: z.string().optional(),
  strict: z.boolean().optional()
};

function architectureOptions(args) {
  const { path: _path, output: _output, format: _format, ...values } = args;
  return values;
}

function text(value) {
  return {
    content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }]
  };
}

function tool(handler) {
  return async (args) => {
    try {
      return text(await handler(args));
    } catch (error) {
      return {
        content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
        isError: true
      };
    }
  };
}

async function generateDiagram(args) {
  const architecture = await createArchitectureModel(args.path, architectureOptions(args));
  const target = resolveOutput({ output: args.output, format: args.format ?? "svg" });
  const { files } = await writeArchitecture(architecture, target);
  return {
    output: target.finalOutput,
    files,
    format: target.format,
    analyzedFiles: architecture.model.files,
    nodes: architecture.model.objects.length,
    edges: architecture.model.edges.length
  };
}

const projectFields = {
  path: architectureFields.path,
  projectRoot: architectureFields.projectRoot,
  namespace: architectureFields.namespace,
  type: architectureFields.type,
  include: architectureFields.include,
  exclude: architectureFields.exclude,
  config: architectureFields.config,
  compiler: z.string().optional().describe("AL compiler: auto (AL Language extension or AL Development Tools when installed), off, or a path"),
  compilerLog: z.string().optional().describe("Import diagnostics from an AL compiler error log file or folder")
};

const graphFields = {
  path: z.string().min(1).describe("Saved version 1 Atlas graph or nodes/edges JSON file; no AL analysis is performed"),
  root: z.array(z.string().min(1)).optional().describe("Exact node IDs, labels, or Atlas keys"),
  rootGroup: z.string().min(1).optional().describe("Named root group in the saved graph"),
  depth: z.number().int().nonnegative().optional(),
  direction: z.enum(["outgoing", "incoming", "both"]).optional(),
  kind: z.array(z.string().min(1)).optional(),
  level: z.string().min(1).optional(),
  frame: z.number().int().nonnegative().optional()
};

export function createMcpServer(version = pkg.version, { plugins } = {}) {
  const server = new McpServer({ name: "bc-atlas", version });

  server.registerTool("bc_atlas_capabilities", {
    description: "Read the versioned BC Atlas command and safety contract.",
    inputSchema: z.object({}),
    annotations: { readOnlyHint: true, idempotentHint: true }
  }, tool(async () => createCapabilities(version)));

  server.registerTool("bc_atlas_inspect", {
    description: "Analyze AL source and return a selected architecture model as JSON.",
    inputSchema: z.object(architectureFields),
    annotations: { readOnlyHint: true, idempotentHint: true }
  }, tool(async (args) => (await createArchitectureModel(args.path, architectureOptions(args))).model));

  server.registerTool("bc_atlas_graph_query", {
    description: "Query a saved graph without analyzing AL. Return a reusable graph slice with original IDs, directions, unresolved boundaries and evidence; select roots, relation kinds, traversal depth and temporal presence.",
    inputSchema: z.object(graphFields),
    annotations: { readOnlyHint: true, idempotentHint: true }
  }, tool(async ({ path: input, ...values }) => queryGraph(input, values)));

  server.registerTool("bc_atlas_graph_render", {
    description: "Render a saved graph query as self-contained SVG/HTML, DOT, or JSON using the local Atlas renderer. No Graphviz installation or AL analysis is required.",
    inputSchema: z.object({
      ...graphFields,
      output: z.string().min(1),
      format: z.enum(["json", "dot", "svg", "html"]).optional(),
      title: z.string().optional(),
      maxNodes: z.number().int().nonnegative().optional(),
      maxEdges: z.number().int().nonnegative().optional()
    }),
    annotations: { idempotentHint: true }
  }, tool(async ({ path: input, ...values }) => renderGraph(input, values)));

  server.registerTool("bc_atlas_generate_diagram", {
    description: "Analyze AL source and write a D2, JSON, or SVG architecture file.",
    inputSchema: z.object({
      ...architectureFields,
      output: z.string().min(1).describe("Output file path"),
      format: z.enum(["d2", "json", "svg"]).default("svg")
    }),
    annotations: { idempotentHint: true }
  }, tool(generateDiagram));

  server.registerTool("bc_atlas_explore", {
    description: "Write the interactive dependency explorer (HTML) or its temporal graph document (JSON): object and app dependencies classified as intra-app, declared, implicit, undeclared, or unresolved, optionally replayed over Git history.",
    inputSchema: z.object({
      ...projectFields,
      output: z.string().min(1).describe("Output file path (.html or .json)"),
      format: z.enum(["html", "json"]).optional(),
      lens: z.enum(["dependency"]).optional(),
      paths: z.array(z.string()).optional().describe("Only analyze AL files below these project-relative folders or globs"),
      history: z.boolean().optional(),
      historyBy: z.enum(["commits", "prs", "releases"]).optional().describe("One frame per commit, merged pull request, or release tag; implies history"),
      last: z.number().int().positive().optional().describe("Only the last n steps"),
      maxCommits: z.number().int().positive().optional(),
      since: z.string().optional(),
      title: z.string().optional()
    }),
    annotations: { idempotentHint: true }
  }, tool(async ({ path: input, ...values }) => {
    const { document, file, format } = await writeExplorer(input, values);
    return {
      output: file,
      format,
      frames: document.timeline.frames.length,
      objects: document.levels.object.nodes.length,
      dependencies: document.levels.object.edges.length,
      crossApp: document.levels.object.edges.filter(({ scope }) => scope === "inter-app").length,
      apps: document.levels.app.nodes.map(({ id, label, origin }) => ({ id, label, origin })),
      appDependencies: document.levels.app.edges.map(({ source, target, dependency, objectEdges }) =>
        ({ source, target, dependency, objectEdges }))
    };
  }));

  server.registerTool("bc_atlas_architecture", {
    description: "Find or check the target architecture: components, layers, allowed dependencies, every dependency that points the wrong way grouped into work items with a resolution strategy (declare-dependency, move-extension, move-subscriber, move-permissions, move-field-to-extension, move-object-down, extract-interface, raise-event, ...) and, for moves, the bca refactor command that performs them; data ownership (which components write, read, or extend each table), checks of the architecture, clean-architecture metrics, and which components can become apps of their own. Proposes an architecture when .bca.json defines none.",
    inputSchema: z.object({
      ...projectFields,
      propose: z.boolean().optional().describe("Propose an architecture even when .bca.json defines one"),
      groupBy: z.enum(["auto", "coupling", "namespace", "folder", "module", "app"]).optional().describe("auto or coupling: the typed, weighted relations decide; namespace or folder: the code structure decides, objects without it follow their relations; module or app: one component each"),
      depth: z.number().int().positive().optional(),
      minObjects: z.number().int().positive().optional().describe("Merge smaller groups into the component they depend on most"),
      startFrom: z.array(z.enum(["namespace", "folder"])).optional().describe("Existing structures that compete with the relations as a starting point; [] for relations only"),
      ignore: z.array(z.string()).optional().describe("Relation kinds that never shape a component, e.g. [\"permits\", \"includes\", \"uses\"]"),
      granularity: z.number().positive().optional().describe("Above 1: more, smaller components; below 1: fewer, larger ones"),
      sharedCore: z.boolean().optional().describe("Pull objects that many components use into a shared core"),
      paths: z.array(z.string()).optional(),
      limit: z.number().int().positive().default(50).describe("Most work items to return")
    }),
    annotations: { readOnlyHint: true, idempotentHint: true }
  }, tool(async ({ path: input, limit, ...values }) => {
    const report = architectureJson(await assessArchitecture(input, values));
    const { violations, ...rest } = report;
    return { ...rest, workItems: report.workItems.slice(0, limit), violationCount: violations.length };
  }));

  server.registerTool("bc_atlas_extraction_plan", {
    description: "Plan extracting one component of the architecture as an app of its own: objects and files to move, the components it uses and that use it, blockers (wrong-way dependencies, internal objects, mutual dependencies) with their work items, the app.json it needs (dependencies, idRanges, internalsVisibleTo), tables whose data must move (ObsoleteState PendingMove/Moved with MovedTo/MovedFrom), permission sets to split, and the steps in order.",
    inputSchema: z.object({
      ...projectFields,
      component: z.string().min(1).describe("Component name from bc_atlas_architecture"),
      paths: z.array(z.string()).optional()
    }),
    annotations: { readOnlyHint: true, idempotentHint: true }
  }, tool(async ({ path: input, component, ...values }) => planExtraction(await assessArchitecture(input, values), component)));

  server.registerTool("bc_atlas_refactor_move", {
    description: "Move an AL object to another component: the file moves to the component's folder (cut out of a file it shares), its namespace becomes the component's, and referencing files get the using they need. Returns a diff and warnings (app dependencies, ID ranges, table data). dryRun (default) writes nothing; apply with dryRun false, then compile and run bc_atlas_check. Work items of bc_atlas_architecture name the object and component in their command.",
    inputSchema: z.object({
      path: architectureFields.path,
      projectRoot: architectureFields.projectRoot,
      config: architectureFields.config,
      object: z.string().min(1).describe("Object selector: codeunit:50100, table:Sales Doc, or a name"),
      to: z.string().optional().describe("Target component"),
      folder: z.string().optional().describe("Target folder relative to the project root (default: the component's folder)"),
      namespace: z.string().optional().describe("Target namespace (default: the component's namespace)"),
      dryRun: z.boolean().default(true)
    }),
    annotations: { destructiveHint: false, idempotentHint: false }
  }, tool(async ({ path: input, dryRun, ...values }) => {
    const { assessment, plan } = await planObjectMove(input, values);
    const applied = dryRun ? undefined : await applyRefactoring(assessment.model.root, plan);
    const { operations, ...rest } = plan;
    return { ...rest, operations: operations.map(({ action, from, path: file }) => ({ action, from, path: file })), applied: Boolean(applied) };
  }));

  server.registerTool("bc_atlas_refactor_surface", {
    description: "Lock the public surface of components: objects no other component uses (codeunits without events, queries, non-extensible enums) get Access = Internal, and .bca.json lists the objects other components use in exposes, so bc_atlas_check reports any new use of something else. bc_atlas_architecture returns each component's surface. dryRun (default) returns the diff.",
    inputSchema: z.object({
      path: architectureFields.path,
      projectRoot: architectureFields.projectRoot,
      config: architectureFields.config,
      component: z.string().optional().describe("Only this component (default: all)"),
      internal: z.boolean().default(true).describe("Set Access = Internal on objects no other component uses"),
      exposes: z.boolean().default(true).describe("Write exposes to .bca.json"),
      dryRun: z.boolean().default(true)
    }),
    annotations: { destructiveHint: false, idempotentHint: true }
  }, tool(async ({ path: input, dryRun, component, internal, exposes, ...values }) => {
    const assessment = await assessArchitecture(input, { ...values, compiler: "off" });
    const plan = await planSurface(assessment, { component, internal, exposes });
    const applied = dryRun ? undefined : await applyRefactoring(assessment.model.root, plan);
    const { operations, ...rest } = plan;
    return { ...rest, operations: operations.map(({ action, path: file }) => ({ action, path: file })), applied: Boolean(applied) };
  }));

  server.registerTool("bc_atlas_check", {
    description: "Assess architecture health: cycles, policy violations, fan-in/fan-out hot spots, diagnostics, and unresolved references; with the AL compiler installed, also compiler and code-analyzer findings.",
    inputSchema: z.object({
      ...projectFields,
      failOn: z.enum(FAIL_LEVELS).optional(),
      analyzers: z.array(z.string()).optional().describe("Code analyzers for the AL compile, e.g. CodeCop, UICop"),
      maxFanIn: z.number().int().positive().optional(),
      maxFanOut: z.number().int().positive().optional()
    }),
    annotations: { readOnlyHint: true, idempotentHint: true }
  }, tool(async ({ path: input, ...values }) => (await runHealthCheck(input, values)).report));

  server.registerTool("bc_atlas_report", {
    description: "Write a Markdown architecture report with an overview, health summary, and diagrams for several views.",
    inputSchema: z.object({
      ...projectFields,
      outputDir: z.string().min(1).default("docs/atlas"),
      views: z.array(z.enum([...REPORT_VIEWS, "call", "visibility"])).optional(),
      format: z.enum(["svg", "d2"]).default("svg"),
      codegraph: z.boolean().optional(),
      handbook: z.boolean().optional().describe("Also write the system handbook to <outputDir>/handbook"),
      json: z.boolean().optional(),
      title: z.string().optional()
    }),
    annotations: { idempotentHint: true }
  }, tool(async ({ path: input, views, ...values }) => {
    const result = await generateReport(input, { ...values, views: views?.join(",") });
    return {
      readme: result.readme,
      outputDirectory: result.outputDirectory,
      passed: result.health.passed,
      counts: result.health.counts,
      diagrams: result.diagrams.map(({ view, skipped, tooLarge, nodes, edges }) => ({ view, skipped, d2Only: tooLarge || undefined, nodes, edges }))
    };
  }));

  server.registerTool("bc_atlas_handbook", {
    description: "Read the system handbook: pages that explain the app across all objects. README (apps, components, central objects), events (publishers, subscribers, events of other apps the app hooks into), data (who inserts, modifies, deletes, and reads each table), permissions, interfaces (implementations, enum bindings), ui (pages by usage category, APIs), code-health (complexity, obsolete code, documentation coverage). Answers questions such as who writes a table or who subscribes to an event.",
    inputSchema: z.object({
      ...projectFields,
      page: z.enum(["README", "events", "data", "permissions", "interfaces", "ui", "code-health"]).optional().describe("One page; all pages when omitted"),
      language: z.string().optional().describe("en (default) or de")
    }),
    annotations: { readOnlyHint: true, idempotentHint: true }
  }, tool(async ({ path: input, page, ...values }) => {
    const { pages, objects } = await renderHandbook(input, values);
    const selected = page ? pages.filter(({ file }) => file === `${page}.md`) : pages;
    return { objects, pages: selected.map(({ file, title, content }) => ({ page: file.replace(/\.md$/u, ""), title, markdown: content })) };
  }));

  server.registerTool("bc_atlas_view", {
    description: "The BC Atlas view without a window: everything read from the AL source is one graph (apps, components, namespaces, objects, health rules, process tests, people, requirements, and what they do with each other). Without lens, story, inside, or focus it returns what there is to see: the lenses and stories of the project. A lens (system, components, data, calls, events, health, processes, people, ..., and the lenses of plugins, such as sync for what was recorded in Business Central) returns that part of the graph: nodes with their facts and findings, and relations. inside goes into one node: an object opens to its procedures and what each does, an app, a component, or a namespace to its objects; focus returns a node and what is near it; story returns a generated walk through the graph (what the system is, a process step by step, what to fix). format text, md, or csv returns that text; with output it writes a file, also a picture (svg, png) in a form (2d, diagram, 3d). Reads the source; changes nothing but the output file.",
    inputSchema: z.object({
      path: architectureFields.path,
      projectRoot: architectureFields.projectRoot,
      config: architectureFields.config,
      compiler: projectFields.compiler,
      paths: z.array(z.string()).optional().describe("Only analyze AL files below these project-relative folders or globs"),
      lens: z.string().optional().describe(`The part of the graph to return: ${VIEW_LENSES.join(", ")}, or a lens of a plugin (sync). processes, people, requirements need documented UI tests, health a finding`),
      inside: z.string().optional().describe("Go into this node: an object (codeunit:50100, table:Sales Header, or a name), or an app, a component (component:Core), or a namespace"),
      focus: z.string().optional().describe("Only this node and what is near it: a name, an ID, or a selector such as table:Customer or person:Anna"),
      depth: z.number().int().positive().optional().describe("Steps from the focus node (default 1)"),
      find: z.string().optional().describe("Only nodes whose name, type, component, namespace, or ID match (in a picture they stand out)"),
      hide: z.array(z.string()).optional().describe("Kinds of node to leave out: codeunit, table, other apps, ..."),
      off: z.array(z.string()).optional().describe("Kinds of relation to leave out: uses, reads, permits, ..."),
      check: z.boolean().optional().describe("Text: the findings with their fixes below each node. Picture: a ring on every node with a finding"),
      story: z.string().optional().describe("A story by id (system, fix, architecture, people, process:<use case>)"),
      step: z.number().int().positive().optional().describe("One step of the story, from 1: the nodes it is about"),
      stories: z.boolean().optional().describe("Every story as one document"),
      form: z.enum(VIEW_FORMS).optional().describe("Form of a picture (default 2d)"),
      color: z.enum(["type", "component", "namespace", "app", "level", "findings"]).optional(),
      size: z.enum(["relations", "usedBy", "uses", "lines", "complexity", "objects", "findings"]).optional(),
      group: z.enum(["component", "namespace", "app", "kind", "none"]).optional(),
      select: z.string().optional().describe("The selected node of a picture"),
      theme: z.enum(["light", "dark"]).optional(),
      width: z.number().int().optional(),
      height: z.number().int().optional(),
      format: z.enum(VIEW_FORMATS).optional().describe("json (default), text, md, csv, link; svg and png need output"),
      rows: z.enum(["nodes", "relations"]).optional().describe("csv: one row per node or per relation"),
      output: z.string().min(1).optional().describe("Write to this file; its extension selects the format when format is omitted")
    }),
    annotations: { idempotentHint: true }
  }, tool(async ({ path: input, ...values }) => {
    const asked = ["lens", "inside", "focus", "story", "stories", "find", "select", "hide", "off"].some((name) => values[name] !== undefined && values[name] !== false);
    const format = values.format ?? (values.output ? undefined : "json");
    if ((format === "svg" || format === "png") && !values.output) throw new Error(`a ${format} picture needs output, the file to write`);
    const { content, output, scene, atlas, format: written } = await writeView(input, { ...values, format });
    if (output) return { output, format: written, project: atlas.title, ...(scene ? { title: scene.title, nodes: scene.entries.length, relations: scene.edges.length } : {}) };
    // What there is to see, and not every node of the project at once.
    if (!asked && written === "json") return viewOverview(atlas);
    return written === "json" ? JSON.parse(content) : content;
  }));

  server.registerTool("bc_atlas_simulate", {
    description: "Battle-test the app as a company uses it: agents with roles, permission sets, and task groups (simulation section of .bca.json, or derived from the [PERMISSIONS] of the tests) perform the process tests (AL UI tests with [SCENARIO]) step by step. Returns who completes or is blocked at which step and which permission is missing, who can do what they must not, whether each process runs end to end, the fit-gap analysis against the company's requirements, and findings with what to do. Pass agent or task for the details: an agent's attempts and unused permissions, or what every step of a process test needs and why. Reads the source; runs nothing.",
    inputSchema: z.object({
      path: architectureFields.path,
      projectRoot: architectureFields.projectRoot,
      config: architectureFields.config,
      compiler: projectFields.compiler,
      tests: z.string().optional().describe("Folder with the process tests (default: simulation.tests, docs.tests, or the app)"),
      company: z.string().optional().describe("JSON file with roles, agents, taskGroups, and requirements instead of .bca.json"),
      failOn: z.enum(FAIL_LEVELS).optional(),
      language: z.string().optional().describe("en (default) or de"),
      agent: z.string().optional().describe("Return this agent's attempts, missing permissions, and unused permissions"),
      task: z.string().optional().describe("Return this process test's steps with what each needs and why"),
      markdown: z.boolean().optional().describe("Return the whole report as Markdown documentation instead of JSON")
    }),
    annotations: { readOnlyHint: true, idempotentHint: true }
  }, tool(async ({ path: input, agent, task, markdown, ...values }) => {
    const report = await simulate(input, values);
    if (markdown) return formatSimulationMarkdown(report);
    const { agents, tasks, ...rest } = report;
    const named = (list, name, key) => {
      const found = list.filter((item) => String(item[key]).toLowerCase() === name.toLowerCase());
      if (!found.length) throw new Error(`${key === "name" ? "agent" : "process test"} "${name}" was not found; known: ${list.map((item) => item[key]).join(", ")}`);
      return found;
    };
    return {
      ...rest,
      // The overview names every agent and process test; the details come on request.
      agents: agent ? named(agents, agent, "name") : agents.map(({ name, roles, permissionSets, taskGroups }) => ({ name, roles, permissionSets: permissionSets.map((set) => set.name), taskGroups })),
      tasks: task ? named(tasks, task, "id") : tasks.map(({ id, title, features, permissions, source }) => ({ id, title, features, permissions, source }))
    };
  }));

  server.registerTool("bc_atlas_simulation_define", {
    description: "Define the simulation: the company of the battle test in the simulation section of .bca.json. Send operations to add or change an agent (a person who uses the app, with roles), a role (permission sets, task groups, what it must not do), a task group (process tests), or a requirement, to remove one, or to ground a process test on a recording of Business Central (a fact snapshot of the sync plugin). The changed simulation runs at once and the result comes back: who completes or is blocked where, who can do what they must not, and every finding. Without operations it returns the simulation as it is (derived: true when nothing is defined and the process tests describe the company). dryRun runs the change and writes nothing. A change keeps the fields it does not name; the first change starts from the company the process tests describe.",
    inputSchema: z.object({
      path: architectureFields.path,
      projectRoot: architectureFields.projectRoot,
      config: architectureFields.config,
      compiler: projectFields.compiler,
      tests: z.string().optional().describe("Folder with the process tests (default: simulation.tests, docs.tests, or the app)"),
      operations: z.array(z.object({
        op: z.enum(["set", "remove", "ground", "unground", "company"]),
        kind: z.enum(["agent", "role", "taskGroup", "requirement"]).optional().describe("For set and remove"),
        name: z.string().optional().describe("Name of the agent, role, or task group; id of the requirement; name of the company"),
        roles: z.array(z.string()).optional(),
        permissionSets: z.array(z.string()).optional(),
        taskGroups: z.array(z.string()).optional(),
        tasks: z.array(z.string()).optional().describe("Process tests by document ID"),
        features: z.array(z.string()).optional(),
        mustNot: z.array(z.string()).optional().describe("Process tests, features, or task groups the role or agent must not be able to do"),
        objects: z.array(z.string()).optional().describe("Requirement: objects that should cover it, as page:Name"),
        title: z.string().optional(),
        description: z.string().optional(),
        task: z.string().optional().describe("ground, unground: the process test by document ID"),
        snapshot: z.string().optional().describe("ground: the recording, by its key or name")
      })).optional().describe("Applied in order; all or nothing"),
      init: z.boolean().optional().describe("Write the company the process tests describe into .bca.json, as the start of a definition"),
      dryRun: z.boolean().optional().describe("Run the changed simulation and return it; write nothing")
    }),
    annotations: { readOnlyHint: false, idempotentHint: true }
  }, tool(async ({ path: input, operations, init, dryRun, ...values }) => {
    const { defineSimulation } = await import("./simulation/define.js");
    const result = await defineSimulation(input, { ...values, operations: operations ?? [], init, dryRun });
    const { report } = result;
    return {
      file: result.file,
      written: result.written,
      derived: result.derived,
      definition: result.definition,
      result: { passed: report.passed, summary: report.summary, counts: report.counts, findings: report.findings }
    };
  }));

  server.registerTool("bc_atlas_setup_plan", {
    description: "Detect an AL project and return setup questions with recommended answers for features, Git hooks, pipelines, schedules, and sync.",
    inputSchema: z.object({ path: z.string().min(1).describe("AL app folder") }),
    annotations: { readOnlyHint: true, idempotentHint: true }
  }, tool(async ({ path: input }) => createPlan(input)));

  server.registerTool("bc_atlas_setup_apply", {
    description: "Write .bca.json, Git hooks, and a pipeline from setup answers. Preview with dryRun (default) before writing.",
    inputSchema: z.object({
      path: z.string().min(1),
      answers: z.object({
        features: z.array(z.enum(["check", "report", "docs", "codegraph"])).optional(),
        tests: z.string().optional(),
        docsExport: z.array(z.enum(EXPORT_FORMATS)).optional(),
        docsAs: z.enum(DOCUMENT_MODES).optional(),
        language: z.string().optional(),
        hooks: z.enum(["husky", "git", "none"]).optional(),
        preCommit: z.array(z.enum(["check", "report", "docs", "codegraph"])).optional(),
        prePush: z.array(z.enum(["check", "report", "docs", "codegraph"])).optional(),
        hookSync: z.enum(["verify", "stage", "none"]).optional(),
        editor: z.enum(["vscode", "none"]).optional(),
        updates: z.enum(["dependabot", "none"]).optional(),
        ci: z.enum(["github", "azure-devops", "none"]).optional(),
        ciSync: z.enum(["verify", "artifact", "none"]).optional(),
        schedule: z.string().optional().describe("Cron expression (UTC) or none"),
        scheduleSync: z.enum(["pull-request", "commit", "artifact", "verify", "none"]).optional()
      }).default({}),
      dryRun: z.boolean().default(true),
      force: z.boolean().default(false)
    })
  }, tool(async ({ path: input, answers, dryRun, force }) => applySetup(input, answers, { dryRun, force, version })));

  server.registerTool("bc_atlas_update_check", {
    description: "Check whether a newer BC Atlas version is available and return the release notes since the installed version. Update with the CLI: bca update.",
    inputSchema: z.object({}),
    annotations: { readOnlyHint: true, openWorldHint: true }
  }, tool(async () => checkForUpdate(version)));

  server.registerTool("bc_atlas_run", {
    description: "Run the BC Atlas tasks configured for a trigger in .bca.json, or explicit tasks, and report sync status.",
    inputSchema: z.object({
      path: z.string().min(1),
      trigger: z.enum(["pre-commit", "pre-push", "ci", "schedule", "manual"]).default("manual"),
      tasks: z.array(z.enum(["check", "simulate", "report", "docs", "codegraph", "handbook", "diagrams"])).optional(),
      sync: z.enum(["none", "verify", "stage", "artifact", "pull-request", "commit"]).optional()
    })
  }, tool(async ({ path: input, ...options }) => {
    const { root: _root, ...result } = await runAutomation(input, options);
    return result;
  }));

  server.registerTool("bc_atlas_docs_list", {
    description: "List documented AL UI-test scenarios.",
    inputSchema: z.object({ path: z.string().min(1) }),
    annotations: { readOnlyHint: true, idempotentHint: true }
  }, tool(async ({ path: input }) => (await loadCorpus(input)).scenarios.map(scenarioSummary)));

  server.registerTool("bc_atlas_docs_show", {
    description: "Read one documented AL UI-test scenario and its source hash.",
    inputSchema: z.object({ path: z.string().min(1), id: z.string().min(1) }),
    annotations: { readOnlyHint: true, idempotentHint: true }
  }, tool(async ({ path: input, id }) => {
    const scenario = (await loadCorpus(input)).byId.get(id);
    if (!scenario) throw new Error(`document ID "${id}" was not found`);
    return { ...scenarioSummary(scenario), fileHash: scenario.fileHash, value: scenario.value };
  }));

  server.registerTool("bc_atlas_docs_validate", {
    description: "Validate IDs, metadata, links, and prerequisites in AL UI-test documentation.",
    inputSchema: z.object({ path: z.string().min(1), strict: z.boolean().default(false) }),
    annotations: { readOnlyHint: true, idempotentHint: true }
  }, tool(async ({ path: input, strict }) => {
    const corpus = await loadCorpus(input);
    const diagnostics = corpus.diagnostics.filter(({ severity }) =>
      severity === "error" || (strict && severity === "warning")
    );
    return { valid: diagnostics.length === 0, scenarios: corpus.scenarios.length, diagnostics };
  }));

  server.registerTool("bc_atlas_docs_generate", {
    description: "Generate user guides or test cases from documented AL UI tests as Markdown, HTML, DITA 1.3 tasks, or Azure DevOps Test Plans CSV.",
    inputSchema: z.object({
      path: z.string().min(1).describe("AL UI-test file or directory"),
      outputDirectory: z.string().min(1).default("docs/generated"),
      formats: z.array(z.enum(EXPORT_FORMATS)).default(["markdown"]),
      as: z.enum(DOCUMENT_MODES).default("guide"),
      appRoot: z.string().min(1).optional().describe("AL app source for real captions, tooltips, and coverage"),
      language: z.string().optional().describe("Language tag such as de-DE; captions come from the app's XLIFF"),
      title: z.string().optional()
    }),
    annotations: { idempotentHint: true }
  }, tool(async ({ path: input, as: mode, ...options }) => {
    const result = await exportDocumentation(await loadCorpus(input), { ...options, mode });
    return { written: result.files, warnings: result.warnings };
  }));

  server.registerTool("bc_atlas_docs_edit", {
    description: "Preview or apply one AL documentation metadata change. Real writes require expectedFileHash.",
    inputSchema: z.object({
      path: z.string().min(1),
      id: z.string().min(1),
      operation: z.enum(["set", "unset"]),
      tag: z.string().min(1),
      value: z.string().optional(),
      qualifier: z.string().optional(),
      dryRun: z.boolean().default(true),
      expectedFileHash: z.string().optional()
    })
  }, tool(async ({ path: input, id, operation, tag, value, qualifier, dryRun, expectedFileHash }) => {
    if (!dryRun && !expectedFileHash) {
      throw new Error("expectedFileHash is required when dryRun is false");
    }
    const plan = await planMetadataEdit(input, id, {
      tag,
      value,
      qualifier,
      remove: operation === "unset",
      expectedFileHash
    });
    if (!dryRun) await writeMetadataEdit(plan);
    return {
      applied: !dryRun,
      changed: plan.changed,
      file: plan.file,
      documentId: plan.documentId,
      fileHash: plan.fileHash,
      preview: plan.preview
    };
  }));

  server.registerTool("bc_atlas_docs_glossary", {
    description: "Read the supported AL documentation tags and prerequisite types.",
    inputSchema: z.object({}),
    annotations: { readOnlyHint: true, idempotentHint: true }
  }, tool(async () => documentationGlossary()));

  // Tools of plugins (plugin.json contributes.mcpTools); the plugin is activated on the first call.
  for (const { plugin, tool: definition } of plugins?.mcpTools() ?? []) {
    const shape = Object.fromEntries(Object.entries(definition.input).map(([name, field]) => {
      let schema = field.enum ? z.enum(field.enum) : field.type === "boolean" ? z.boolean() : field.type === "number" ? z.number() : z.string();
      if (field.description) schema = schema.describe(field.description);
      return [name, field.optional ? schema.optional() : schema];
    }));
    server.registerTool(definition.name, {
      description: `${definition.description} (plugin ${plugin.id})`,
      inputSchema: z.object(shape),
      annotations: { readOnlyHint: definition.readOnly, idempotentHint: definition.readOnly }
    }, tool(async (args) => {
      const implementation = (await plugins.activate(plugin.id)).mcpTools?.[definition.name];
      if (typeof implementation !== "function") throw new Error(`plugin "${plugin.id}" declares ${definition.name} but does not implement it`);
      return implementation(args);
    }));
  }

  return server;
}

/** The plugins of the project the server starts in (built-in ones when there is no .bca.json). */
async function serverPlugins() {
  try {
    const root = process.cwd();
    return await loadPlugins(root, (await loadConfig(root)).values);
  } catch (error) {
    console.error(`bca-mcp: plugins: ${error.message}; continuing with the built-in plugins`);
    return loadPlugins(process.cwd(), {});
  }
}

export async function startMcpServer(version = pkg.version) {
  const plugins = await serverPlugins();
  serveStdio(() => createMcpServer(version, { plugins }), {
    onerror: (error) => console.error(`bca-mcp: ${error.message}`)
  });
  console.error(`BC Atlas ${version} MCP server running on stdio.`);
}

// npm installs bin entries as symlinks, so compare real paths.
function invokedDirectly() {
  try {
    return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}
if (invokedDirectly()) await startMcpServer();
