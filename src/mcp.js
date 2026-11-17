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
import { explainComponent, explainPlacement, findObject } from "./blueprint/explain.js";
import { compareArchitecture, formatCompareMarkdown } from "./blueprint/compare.js";
import { CRITERIA, DEFAULT_GOALS } from "./blueprint/goals.js";
import { PLACEMENT_STEPS } from "./blueprint/placement.js";
import { listTemplates, removeTemplate, resolveTemplate, saveTemplate, useTemplate } from "./blueprint/templates.js";
import { architectureContext } from "./blueprint/index.js";
import { adoptTarget } from "./commands/architecture-target.js";
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
import { createService } from "./app/service.js";
import { Workspace } from "./app/workspace.js";
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

// The BC Atlas view as an MCP App (SEP-1865, io.modelcontextprotocol/ui): the page, and one
// workspace per project so that the page asks on an analysis that is there, as in VS Code.
export const APP_URI = "ui://bc-atlas/view.html";
export const APP_MIME = "text/html;profile=mcp-app";
const appServices = new Map();
function appService(input) {
  const root = path.resolve(input ?? ".");
  if (!appServices.has(root)) appServices.set(root, createService(new Workspace(root, {}, { live: true })));
  return { root, service: appServices.get(root) };
}

// What is preferred in an architecture: the template and the weights of the goals (src/blueprint/goals.js, templates.js).
const goalFields = {
  template: z.string().optional().describe("The template that says what a good architecture is: balanced, follow-structure, by-coupling, layered, modular-monolith, small-steps, or one of the project's own (bc_atlas_architecture_templates)"),
  weights: z.record(z.string(), z.number().min(0)).optional().describe("How much each goal weighs, on top of the template, e.g. { \"layering\": 5, \"fewMoves\": 3 }; 0 leaves a goal out. Goals: cohesion, modularity, layering, acyclic, ownership, extractable, stability, size, followNamespaces, followFolders, followApps, fewMoves"),
  size: z.object({ min: z.number().int().min(1).optional(), max: z.number().int().min(1).optional() }).optional().describe("The size a component should have, in objects")
};
// How a proposal groups objects into components.
const proposalFields = {
  groupBy: z.enum(["auto", "coupling", "namespace", "folder", "module", "app"]).optional(),
  depth: z.number().int().positive().optional(),
  minObjects: z.number().int().positive().optional(),
  startFrom: z.array(z.enum(["namespace", "folder"])).optional(),
  ignore: z.array(z.string()).optional(),
  granularity: z.number().positive().optional(),
  sharedCore: z.boolean().optional()
};

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
      ...goalFields,
      paths: z.array(z.string()).optional(),
      limit: z.number().int().positive().default(50).describe("Most work items to return")
    }),
    annotations: { readOnlyHint: true, idempotentHint: true }
  }, tool(async ({ path: input, limit, ...values }) => {
    const report = architectureJson(await assessArchitecture(input, values));
    const { violations, ...rest } = report;
    return { ...rest, workItems: report.workItems.slice(0, limit), violationCount: violations.length };
  }));

  // ------------------------------------------------------------- MCP App
  // The BC Atlas view inside the chat (MCP Apps, io.modelcontextprotocol/ui): the same page the
  // VS Code extension shows. bc_atlas_app opens it; the page asks for everything else through
  // bc_atlas_app_call, which only the page can call.
  server.registerResource("BC Atlas view", APP_URI, {
    description: "The BC Atlas view: the graph of the project with its lenses, findings, stories, the flow and process builders, and the architecture.",
    mimeType: APP_MIME
  }, async () => {
    const { renderAppHtml } = await import("./app/page.js");
    return { contents: [{ uri: APP_URI, mimeType: APP_MIME, text: renderAppHtml({ mode: "mcp" }), _meta: { ui: { prefersBorder: true } } }] };
  });

  server.registerTool("bc_atlas_app", {
    title: "BC Atlas view",
    description: "Show the BC Atlas view to the user, inside the chat: the interactive graph of the project with every lens, the findings, the stories, the builders for flows and processes, and the Architecture menu (goals, templates, why each component is what it is, current against target). It is the same view the VS Code extension shows, and the user can work in it: change flows, compare architectures, adopt a target. Use it when the user wants to see or explore something rather than read about it; lens, story, inside, and select choose what it opens on. In a client that does not render MCP Apps the tool returns a summary of the project and the address of what would be shown; use bc_atlas_view there.",
    inputSchema: z.object({
      path: architectureFields.path,
      lens: z.string().optional().describe("The lens to open: overview, system, components, apps, data, calls, events, health, flows, ... (bc_atlas_view lists them)"),
      story: z.string().optional().describe("A story to open instead: system, architecture, fix, ..."),
      inside: z.string().optional().describe("Open inside this node: an object, an app, a component (component::Sales), or a namespace"),
      select: z.string().optional().describe("Select this node, by id")
    }),
    annotations: { readOnlyHint: true, idempotentHint: true },
    _meta: { ui: { resourceUri: APP_URI }, "ui/resourceUri": APP_URI }
  }, async ({ path: input, lens, story, inside, select }) => {
    const { root, service } = appService(input);
    const overview = await service.call("overview");
    const address = `#${new URLSearchParams(Object.entries({ lens, story, inside, sel: select }).filter(([, value]) => value)).toString()}`;
    const summary = {
      path: root,
      address: address === "#" ? "" : address,
      title: overview.title,
      health: { passed: overview.health?.passed, ...(overview.health?.counts ?? {}) },
      architecture: overview.architecture
    };
    return { content: [{ type: "text", text: `The BC Atlas view of ${overview.title} is shown to the user${address === "#" ? "" : ` (${address})`}.\n${JSON.stringify(summary, null, 2)}` }], structuredContent: summary };
  });

  server.registerTool("bc_atlas_app_call", {
    title: "BC Atlas view: a request of the page",
    description: "A request of the BC Atlas view (bc_atlas_app) to the project it shows: what the VS Code extension answers for the same page. Only the page calls it.",
    inputSchema: z.object({
      path: z.string().describe("The project the view shows"),
      method: z.string().describe("The method of the view service"),
      params: z.record(z.string(), z.unknown()).optional()
    }),
    _meta: { ui: { resourceUri: APP_URI, visibility: ["app"] }, "ui/resourceUri": APP_URI }
  }, async ({ path: input, method, params = {} }) => {
    try {
      const { root, service } = appService(input);
      let result;
      if (method === "saveFile") {
        // A chat client has no save dialog: what the view exports goes into the project.
        const directory = path.join(root, ".bca", "exports");
        const file = path.join(directory, path.basename(String(params.name ?? "export")));
        await fs.mkdir(directory, { recursive: true });
        await fs.writeFile(file, Buffer.from(String(params.content ?? ""), params.encoding === "base64" ? "base64" : "utf8"));
        result = { path: path.relative(root, file).replaceAll("\\", "/") };
      } else if (method === "openFile") {
        throw new Error(`${params.file}${params.line ? `:${params.line}` : ""}`);
      } else {
        result = await service.call(method, params);
      }
      return { content: [{ type: "text", text: JSON.stringify(result ?? null) }] };
    } catch (error) {
      return { isError: true, content: [{ type: "text", text: error.message }] };
    }
  });

  server.registerTool("bc_atlas_architecture_explain", {
    description: "Why the architecture is what it is. With an object (a name, an ID, or type:name): the component it is in, the step that placed it there with its numbers (coupling, shared core, a small group that joined, a neighbour by namespace, folder, or ID, a permission set that follows what it grants, kept, declared, ...), the selector that assigns it, its coupling to every component, and a move when it works more with another. With the name of a component: what it is named after, how its objects came to it (count per step), what they agree on (namespace, folder, name prefix), how much of its coupling stays inside, the thresholds that applied, its members with their step, its neighbours, and which setting would change it. Without either: every component with its reasons, and the vocabulary of steps. Use it before proposing a refactoring, and to answer why a component exists.",
    inputSchema: z.object({
      ...projectFields,
      object: z.string().optional().describe("An object: codeunit:50100, table:Sales Doc, a name, or an ID"),
      component: z.string().optional().describe("A component name from bc_atlas_architecture"),
      propose: z.boolean().optional().describe("Explain the proposal even when .bca.json defines an architecture"),
      ...proposalFields,
      ...goalFields,
      limit: z.number().int().positive().default(30).describe("Most members of a component to list"),
      paths: z.array(z.string()).optional()
    }),
    annotations: { readOnlyHint: true, idempotentHint: true }
  }, tool(async ({ path: input, object, component, limit, ...values }) => {
    const assessment = await assessArchitecture(input, values);
    if (object) {
      const matches = findObject(assessment.levels, object);
      if (!matches.length) throw new Error(`no object "${object}" in the analyzed source`);
      return { objects: matches.map(({ id }) => explainPlacement(assessment, id)), steps: PLACEMENT_STEPS };
    }
    if (component) {
      const explanation = explainComponent(assessment, component, { limit });
      if (!explanation) throw new Error(`no component "${component}"; the components are ${assessment.result.components.map(({ name }) => name).join(", ")}`);
      return { ...explanation, stepsVocabulary: PLACEMENT_STEPS };
    }
    return {
      mode: assessment.proposal ? "proposal" : "configured",
      template: assessment.template.template,
      components: assessment.result.components.map(({ name }) => {
        const { members: _members, ...explanation } = explainComponent(assessment, name, { limit: 1 });
        return explanation;
      }),
      steps: PLACEMENT_STEPS,
      basis: assessment.proposal?.basis
    };
  }));

  server.registerTool("bc_atlas_architecture_compare", {
    description: "The architecture as it is and as it should be (current and target state), to plan a refactoring. Both are scored from 0 to 100 with the same weighted goals (cohesion, modularity, layering, no cycles, data ownership, extractable, stable dependencies, size, follows namespaces, folders, apps, few moves), each goal with what it measured. Returns how the components of the current state become those of the target (same, renamed, reshaped, split, merged, new, gone), the objects that have to move with the command for each (bca refactor move, or bc_atlas_refactor_move), and the steps in order. from: structure (the namespaces, folders, and apps the source has today; default), configured, proposal, best. to: configured (default when .bca.json has components), proposal, best (default otherwise: up to 8 proposals scored with the goals, all listed with their settings and scores, the best wins), structure. Choose what is preferred with template (bc_atlas_architecture_templates lists them) and weights. Read-only; bc_atlas_architecture_adopt makes the target the architecture of the project.",
    inputSchema: z.object({
      ...projectFields,
      from: z.enum(["structure", "configured", "proposal", "best"]).optional(),
      to: z.enum(["structure", "configured", "proposal", "best"]).optional(),
      ...proposalFields,
      ...goalFields,
      limit: z.number().int().min(0).default(50).describe("Most moves to list; 0 for all"),
      format: z.enum(["json", "markdown"]).default("json").describe("markdown: the comparison as a page to show a person"),
      paths: z.array(z.string()).optional()
    }),
    annotations: { readOnlyHint: true, idempotentHint: true }
  }, tool(async ({ path: input, format, ...values }) => {
    const result = await compareArchitecture(input, values);
    return format === "markdown" ? { markdown: formatCompareMarkdown(result), summary: result.summary } : result;
  }));

  server.registerTool("bc_atlas_architecture_adopt", {
    description: "Make a target architecture the architecture of the project: writes its components (name, the selectors that assign objects, layer, what each may depend on) to the architecture section of .bca.json, keeping every other setting. From then on bc_atlas_architecture and bc_atlas_check measure the source against it, and bc_atlas_refactor_move knows the components. The target is chosen like in bc_atlas_architecture_compare: to proposal or best, with template, weights, and the proposal settings. dryRun (default) returns what would be written; call again with dryRun false after the user agreed.",
    inputSchema: z.object({
      ...projectFields,
      to: z.enum(["proposal", "best", "structure"]).default("best"),
      ...proposalFields,
      ...goalFields,
      dryRun: z.boolean().default(true),
      paths: z.array(z.string()).optional()
    }),
    annotations: { readOnlyHint: false, idempotentHint: true }
  }, tool(async ({ path: input, dryRun, ...values }) => {
    const result = await compareArchitecture(input, { ...values, limit: 0 });
    const saved = await adoptTarget(input, values, result, { dryRun });
    return { ...saved, dryRun, target: result.target, summary: result.summary, candidates: result.candidates };
  }));

  server.registerTool("bc_atlas_architecture_templates", {
    description: "The templates that say what a good architecture is for this team and how much each goal weighs. action list (default): the presets (balanced, follow-structure, by-coupling, layered, modular-monolith, small-steps) and the project's own, each with its goal weights and proposal settings, the one in use, the goals that can be weighed with what each means and how it is measured, and the default weights. show: one template with everything it inherits. save: the settings as they are (the template in use, .bca.json, and values: template, weights, size, and proposal settings) as a new template of the project, or a given definition (template: { title, summary, extends, goals: { weights, size }, proposal }); with file it is written to a JSON file several repositories can share. use: take a template into use (architecture.template in .bca.json). remove: remove one of the project's own. save, use, and remove change .bca.json; dryRun (default) writes nothing.",
    inputSchema: z.object({
      path: architectureFields.path,
      projectRoot: architectureFields.projectRoot,
      config: architectureFields.config,
      action: z.enum(["list", "show", "save", "use", "remove"]).default("list"),
      name: z.string().optional().describe("show, save, use, remove: the template"),
      title: z.string().optional().describe("save: its title"),
      summary: z.string().optional().describe("save: when to use it"),
      from: z.string().optional().describe("save: \"current\" (default) for the settings as they are, or the name of a template to copy"),
      template: z.record(z.string(), z.unknown()).optional().describe("save: the definition to save as it is, instead of the settings as they are"),
      values: z.object({ ...proposalFields, ...goalFields }).optional().describe("save: settings on top of those in use, as in bc_atlas_architecture_compare"),
      file: z.string().optional().describe("save: write the template to this JSON file; .bca.json keeps the path"),
      use: z.boolean().optional().describe("save: also take it into use"),
      dryRun: z.boolean().default(true)
    }),
    annotations: { readOnlyHint: false, idempotentHint: true }
  }, tool(async ({ path: input, action, name, dryRun, config, projectRoot, ...rest }) => {
    const context = await architectureContext(input, { config, projectRoot });
    const root = context.projectRoot;
    const architecture = context.options.architecture ?? {};
    if (action === "list") {
      return { templates: listTemplates(root, architecture), criteria: CRITERIA.map(({ id, title, meaning, measured }) => ({ id, title, meaning, measured })), defaults: DEFAULT_GOALS };
    }
    if (!name) throw new Error(`${action} needs "name": the template`);
    if (action === "show") return resolveTemplate(root, architecture, name);
    if (action === "save") return { ...(await saveTemplate(root, { name, title: rest.title, summary: rest.summary, from: rest.from ?? "current", template: rest.template, values: rest.values ?? {}, file: rest.file, use: Boolean(rest.use), config, dryRun })), dryRun };
    if (action === "use") return { ...(await useTemplate(root, { name, config, dryRun })), dryRun };
    return { ...(await removeTemplate(root, { name, config, dryRun })), dryRun };
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
    description: "The BC Atlas view without a window: everything read from the AL source is one graph (apps, components, namespaces, objects, health rules, process tests, people, requirements, and what they do with each other). Without lens, story, inside, or focus it returns what there is to see: the lenses and stories of the project. A lens (overview: how it works, in columns from who uses the app over the process tests, screens, and logic to the data, each relation from left to right; system, components, data, calls, events, health, processes, people, ..., and the lenses of plugins, such as sync for what was recorded in Business Central) returns that part of the graph: nodes with their facts and findings, and relations. inside goes into one node: an object opens to its procedures and what each does, an app, a component, or a namespace to how it works (with lens system: to its objects and everything they do with each other); focus returns a node and what is near it; story returns a generated walk through the graph (what the system is, a process step by step, what to fix, or run:<agent>: one person of the simulation performing the assigned process tests, each step [done], [blocked] with what is missing, or [waiting]; with step, the picture as that step built it). format text, md, or csv returns that text; with output it writes a file, also a picture (svg, png) in a form (2d, diagram, 3d). Reads the source; changes nothing but the output file.",
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
      story: z.string().optional().describe("A story by id (system, fix, architecture, people, process:<use case>, run:<agent>: the run of the simulation of one person, step by step)"),
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
    const { content, output, scene, atlas, counts, format: written } = await writeView(input, { ...values, format });
    if (output) return { output, format: written, project: atlas.title, ...(scene ? { title: scene.title, nodes: counts?.nodes ?? scene.entries.length, relations: counts?.relations ?? scene.edges.length } : {}) };
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
      recordings: z.string().optional().describe("Folder with recordings of Business Central (fact snapshots as JSON) the agents perform as well"),
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

  server.registerTool("bc_atlas_layers", {
    description: "Write the documentation of a repository, in sync with the source, for one app or many: README.md (how it works, where to start), architecture.md (how the apps and components are connected: dependencies, layers, cycles, shared tables), changes.md (what to change in the architecture and how: each change with why, the steps, and the effort, the most important first), and one page per app, component, namespace, and object, each with a picture. Returns where the pages are, whether they were in sync, and the changes. With check it writes nothing and inSync says whether the pages match the source (for a pipeline). For the changes alone, without writing files, use bc_atlas_view with story architecture.",
    inputSchema: z.object({
      path: architectureFields.path,
      projectRoot: architectureFields.projectRoot,
      config: architectureFields.config,
      compiler: projectFields.compiler,
      output: z.string().min(1).optional().describe("Folder of the pages (default: layers.outputDir in .bca.json, else docs/layers)"),
      check: z.boolean().optional().describe("Write nothing; report whether the pages are in sync with the source"),
      pictures: z.enum(["auto", "all", "none"]).optional().describe("Pictures of single objects: auto (up to 400 objects), all, or none"),
      profile: z.string().min(1).optional().describe("A documentation profile of layers.profiles in .bca.json: which pages and sections are written, for which part of the system, in which language, under which file names, from which templates. Without it, the settings of layers itself")
    }),
    annotations: { readOnlyHint: false, idempotentHint: true }
  }, tool(async ({ path: input, ...values }) => {
    const { syncLayers } = await import("./commands/layers.js");
    const { output, check, inSync, current, profile } = await syncLayers(input, values);
    return {
      output,
      ...(profile ? { profile } : {}),
      start: current && !current.fixed.readme ? undefined : `${output}/${current?.fixed.readme ?? "README.md"}`,
      check,
      inSync,
      counts: current?.manifest.counts,
      files: current?.files,
      written: current?.written.length,
      removed: current?.removed.length,
      changes: (current?.atlas.changes ?? []).map(({ title, kind, why, how, effort, optional }) => ({ title, kind, why, how, effort, ...(optional ? { optional } : {}) }))
    };
  }));

  server.registerTool("bc_atlas_bundle", {
    description: "Build the bundle of a project: everything BC Atlas makes of it, end to end, as one artifact. Steps: validation (health check), simulation (battle test on process tests and recordings), a fact snapshot of every process test from the source, the run of every person step by step with the picture it built, the layered documentation with the view, narrative pages when a model is set up, and the test results and build outputs given. Writes one folder and one ZIP file with a manifest (bundle.json: commit, every step with its result, every file with its hash) and returns the manifest. passed is false when a step failed; the bundle is written all the same.",
    inputSchema: z.object({
      path: architectureFields.path,
      projectRoot: architectureFields.projectRoot,
      config: architectureFields.config,
      compiler: projectFields.compiler,
      output: z.string().min(1).describe("Folder of the bundle; the ZIP file gets the same name with .zip. The folder is replaced"),
      testResults: z.array(z.string()).optional().describe("JUnit or xUnit XML files or folders with the results of tests that really ran"),
      include: z.array(z.string()).optional().describe("Files or folders that belong to the bundle: the .app file, logs"),
      noNarrative: z.boolean().optional().describe("Do not ask the model of the ai plugin for narrative pages"),
      noZip: z.boolean().optional().describe("Write the folder only")
    }),
    annotations: { readOnlyHint: false, idempotentHint: true }
  }, tool(async ({ path: input, ...values }) => {
    const { createBundle } = await import("./commands/bundle.js");
    const { output, zip, manifest } = await createBundle(input, values);
    return { ...manifest, files: manifest.files.length, output, zip };
  }));

  server.registerTool("bc_atlas_process", {
    description: "The processes of a project: how the company works with the app. Returns the models of .bca.json (processes: steps in lanes, each lane a role, each step with the process test or recording that shows it works, and what it comes after), how each model runs with the people of the simulation (runs: per step who performs it, whether the lane gets through it, is blocked and by which missing permissions, is done by another role, or is unproven; where the work changes hands; what each step does in the app as events: clicks, pages opened, code run, reads, writes), what to improve (findings with a fix each), and the processes as they are (mined: process mining from the process tests and recordings). Also the roles a lane can be and the tests a step can name. Reads the source and the recordings; runs neither the app nor the tests. Change the models with bc_atlas_process_define.",
    inputSchema: z.object({
      path: architectureFields.path,
      projectRoot: architectureFields.projectRoot,
      config: architectureFields.config,
      compiler: projectFields.compiler,
      tests: z.string().optional().describe("Folder with the process tests (default: simulation.tests, docs.tests, or the app)"),
      recordings: z.string().optional().describe("Folder with recordings of Business Central (fact snapshots), mined and run like process tests"),
      telemetry: z.string().optional().describe("A file or folder of exported telemetry (Application Insights: JSON or CSV). With it every run and mined process has timing: cases, how long a case takes, the ways really taken, per step how often and how long, per way how often and how long the work waits; and findings from it (default: processTelemetry.path in .bca.json)"),
      process: z.string().optional().describe("Only this process: its run and its findings")
    }),
    annotations: { readOnlyHint: true, idempotentHint: true }
  }, tool(async ({ path: input, process: only, ...values }) => {
    const { describeProcesses } = await import("./process/project.js");
    const result = await describeProcesses(input, values);
    if (!only) return result;
    const run = result.runs.find(({ id }) => id === only);
    if (!run) throw new Error(`there is no process "${only}"; there ${result.runs.length === 1 ? "is" : "are"} ${result.runs.map(({ id }) => id).join(", ") || "none"}`);
    return { schema: result.schema, process: result.processes.find(({ id }) => id === only), run, simulated: result.simulated };
  }));

  server.registerTool("bc_atlas_process_define", {
    description: "Define the processes of a project in the processes section of .bca.json. Send operations: set (add a process or change its title), remove, step (add a step with title, lane, test; with step it changes the step of that id), unstep (remove a step; what came after it comes after what it came after), wire and unwire (step into comes after step from; when names the way when it is one of several), lane (rename a lane), adopt (take a whole model: a mined process of bc_atlas_process, or your own). Returns the processes after the change. A change that is not valid writes nothing. Run them with bc_atlas_process.",
    inputSchema: z.object({
      path: architectureFields.path,
      projectRoot: architectureFields.projectRoot,
      config: architectureFields.config,
      operations: z.array(z.object({
        op: z.enum(["set", "remove", "step", "unstep", "wire", "unwire", "lane", "adopt"]),
        process: z.string().optional().describe("The id of the process"),
        title: z.string().optional().describe("set: the title of the process; step: of the step; lane: the new name"),
        step: z.string().optional().describe("step: the id of the step to change; unstep: the step to remove"),
        id: z.string().optional().describe("step: the id of a new step, or a new id"),
        lane: z.string().optional().describe("step: who does it, a role of the company; lane: the lane to rename"),
        test: z.string().optional().describe("step: the process test (document ID) or recording that shows it works"),
        from: z.string().optional().describe("wire, unwire: the step that comes first, by id"),
        into: z.string().optional().describe("wire, unwire: the step that comes after it"),
        when: z.string().optional().describe("wire: the name of the way, when it is one of several"),
        model: z.object({ id: z.string(), title: z.string().optional(), steps: z.array(z.record(z.string(), z.unknown())) }).optional().describe("adopt: a process with id, title, and steps")
      })).optional().describe("Applied in order; all or nothing"),
      dryRun: z.boolean().optional().describe("Check the change and return the result; write nothing")
    }),
    annotations: { readOnlyHint: false, idempotentHint: true }
  }, tool(async ({ path: input, operations, dryRun, ...values }) => {
    const { defineProcesses } = await import("./process/index.js");
    return defineProcesses(input, { ...values, operations: operations ?? [], dryRun });
  }));

  server.registerTool("bc_atlas_flow_define", {
    description: "Define the flows of a project: its own workflows in the flows section of .bca.json. A flow says what to make from the source (steps, each one artifact: layers, report, handbook, catalog, docs, simulate, check, view, diagram, app, knowledge-graph, or a task of a plugin), when (the triggers: pre-commit, pre-push, ci, schedule, manual), and where to save each artifact (to, relative to the project). Send operations to add or change a flow (set), remove it, add or change a step (step; with at it changes that step), remove a step (unstep), move one (move), say that a step comes after another if that one passed, failed, or always (wire, unwire, or id and after on a step: the steps are a graph, and a run skips a step whose condition does not hold), say how a trigger delivers what was saved (deliver: its sync mode), or define a trigger of your own (trigger: a name with the events on, their branches, paths, and tags, a cron, or a Git hook; with none of them only bca run --trigger <name> starts it; untrigger removes it). Without operations it returns the flows as they are, the triggers with their sync modes, and the catalog of artifacts with the options of each. A change that is not valid writes nothing. Run a flow with bc_atlas_run and flows.",
    inputSchema: z.object({
      path: architectureFields.path,
      projectRoot: architectureFields.projectRoot,
      config: architectureFields.config,
      operations: z.array(z.object({
        op: z.enum(["set", "remove", "step", "wire", "unwire", "unstep", "detach", "move", "deliver", "trigger", "untrigger"]),
        flow: z.string().optional().describe("The id of the flow: lowercase letters, digits, '.', '_', '-'"),
        title: z.string().optional().describe("set: the title of the flow"),
        when: z.array(z.string()).optional().describe("set: the triggers the flow runs on: pre-commit, pre-push, ci, schedule, manual, or a trigger of your own"),
        what: z.string().optional().describe("step: the artifact to make"),
        to: z.string().optional().describe("step: where to save it, relative to the project; without it the default of the artifact"),
        at: z.number().int().min(1).optional().describe("step: change this step instead of adding one; unstep, move: the step, from 1"),
        by: z.number().int().optional().describe("move: -1 up, 1 down"),
        id: z.string().optional().describe("step: the name of the step, so that others can come after it"),
        after: z.array(z.union([z.string(), z.object({ step: z.string(), if: z.enum(["passed", "failed", "always"]).optional() })])).optional().describe("step: the steps it comes after, by name; each runs it if that step passed (default), failed, or always. Empty: it starts with the flow"),
        from: z.number().int().min(1).optional().describe("wire, unwire: the step that comes first, from 1; it gets a name when it has none"),
        into: z.number().int().min(1).optional().describe("wire, unwire: the step that comes after it"),
        if: z.enum(["passed", "failed", "always"]).optional().describe("wire: when the step runs; default passed"),
        trigger: z.string().optional().describe("deliver: the trigger, built in or your own"),
        name: z.string().optional().describe("trigger, untrigger: the name of a trigger of your own (lowercase letters, digits, '.', '_', '-'); trigger with the name schedule and a cron sets the built-in schedule"),
        on: z.array(z.enum(["push", "pull-request", "tag", "release", "manual"])).optional().describe("trigger: the events that start it in a pipeline"),
        branches: z.array(z.string()).optional().describe("trigger: only pushes to, and pull requests into, these branches"),
        paths: z.array(z.string()).optional().describe("trigger: only when files under these paths changed, such as src/**/*.al"),
        tags: z.array(z.string()).optional().describe("trigger: only these tags, such as v*"),
        cron: z.string().optional().describe("trigger: a five-field cron expression that starts it on a schedule"),
        hook: z.enum(["post-commit", "post-merge", "post-checkout", "post-rewrite", "pre-rebase", "pre-merge-commit", "prepare-commit-msg", "commit-msg"]).optional().describe("trigger: the Git hook it is"),
        sync: z.enum(["none", "verify", "stage", "artifact", "pull-request", "commit"]).optional().describe("deliver: its sync mode")
      }).catchall(z.union([z.string(), z.number(), z.boolean()])).describe("A step takes the options of its artifact as further fields, such as lens, form, language")).optional().describe("Applied in order; all or nothing"),
      dryRun: z.boolean().optional().describe("Check the change and return the result; write nothing")
    }),
    annotations: { readOnlyHint: false, idempotentHint: true }
  }, tool(async ({ path: input, operations, dryRun, ...values }) => {
    const { defineFlows } = await import("./flows/index.js");
    return defineFlows(input, { ...values, operations: operations ?? [], dryRun });
  }));

  server.registerTool("bc_atlas_flow_export", {
    description: "Export a flow of .bca.json (see bc_atlas_flow_define) as a pipeline of its own: for GitHub Actions, the workflow file .github/workflows/bc-atlas-<flow>.yml. It runs bca run --flow <id> on the events of the flow's triggers (ci: pull requests and pushes to main; schedule: the cron of automation.triggers.schedule; always by hand) and delivers what the flow saves with the sync mode of the trigger (verify, artifact, pull-request, commit; without one, an artifact). Returns the path, the events, the delivery, and the workflow. dryRun writes nothing.",
    inputSchema: z.object({
      path: architectureFields.path,
      projectRoot: architectureFields.projectRoot,
      config: architectureFields.config,
      flow: z.string().min(1).describe("The id of the flow"),
      to: z.enum(["github", "azure-devops"]).default("github").describe("GitHub Actions, or Azure Pipelines (azure-pipelines.bc-atlas-<flow>.yml; a schedule that would open a pull request publishes an artifact instead)"),
      output: z.string().optional().describe("Another file than .github/workflows/bc-atlas-<flow>.yml"),
      force: z.boolean().optional().describe("Replace a file that was not written by this export"),
      dryRun: z.boolean().optional().describe("Return the workflow; write nothing")
    }),
    annotations: { readOnlyHint: false, idempotentHint: true }
  }, tool(async ({ path: input, ...values }) => {
    const { exportFlow } = await import("./flows/index.js");
    const { file: _file, ...result } = await exportFlow(input, { ...values, version });
    return result;
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
    description: "Run the BC Atlas tasks and flows configured for a trigger in .bca.json, or explicit tasks or flows, and report sync status.",
    inputSchema: z.object({
      path: z.string().min(1),
      trigger: z.string().default("manual").describe("pre-commit, pre-push, ci, schedule, manual, or a trigger of your own (automation.triggers)"),
      tasks: z.array(z.enum(["check", "simulate", "report", "docs", "codegraph", "handbook", "diagrams"])).optional(),
      flows: z.array(z.string()).optional().describe("Run these flows by id (see bc_atlas_flow_define) instead of the tasks and flows of the trigger"),
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
